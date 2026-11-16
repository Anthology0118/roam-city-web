import asyncio
import uuid
from datetime import date, timedelta
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, update

from app.agent.planner_agent import _exec_tool, parse_intent, rewrite_rag_query
from app.db.models import GuideChunk, Spot
from app.db.session import AsyncSessionLocal
from app.main import app, lifespan


@pytest.mark.asyncio
async def test_api_spots_rag_booking_multiturn_and_favorites():
    async with lifespan(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            health = await client.get("/api/health")
            assert health.status_code == 200
            assert health.json()["status"] == "ok"

            spots = await client.get("/api/spots")
            assert spots.status_code == 200
            assert spots.json()["total"] >= 36

            rag = await client.get("/api/guides/search", params={"q": "茶卡盐湖 拍照 避坑"})
            assert rag.status_code == 200
            assert rag.json()["items"][0]["guide_id"] == "qing"

            # Favorite toggle (resilient to prior DB state)
            fav1 = await client.post("/api/favorites/westlake")
            assert fav1.status_code == 200
            liked1 = fav1.json()["liked"]
            favs_after_1 = (await client.get("/api/favorites")).json()["spot_ids"]
            assert ("westlake" in favs_after_1) is liked1
            fav2 = await client.post("/api/favorites/westlake")
            assert fav2.status_code == 200
            assert fav2.json()["liked"] is (not liked1)

            # Optimistic lock booking + cancellation
            tomorrow = (date.today() + timedelta(days=1)).isoformat()
            spot_before = (await client.get("/api/spots/gugong")).json()["daily_stock"]
            booking = await client.post(
                "/api/bookings",
                json={
                    "spot_id": "gugong",
                    "visit_date": tomorrow,
                    "session_slot": "下午场 12:00-17:00",
                    "ticket_type": "学生票",
                    "count": 2,
                    "visitor_name": "张三",
                    "phone": "13800138000",
                },
            )
            assert booking.status_code == 201
            order = booking.json()
            assert order["total_price"] == 60
            assert order["remaining_stock"] == spot_before - 2

            cancel = await client.post(f"/api/bookings/{order['id']}/cancel")
            assert cancel.status_code == 200
            assert cancel.json()["status"] == "CANCELLED"
            assert (await client.get("/api/spots/gugong")).json()["daily_stock"] == spot_before

            # Multi-turn Agent SSE
            sid = f"test-session-{uuid.uuid4().hex[:8]}"
            async with client.stream(
                "POST", "/api/agent/chat", json={"query": "周末2天预算300看山水", "session_id": sid}
            ) as sse1:
                assert sse1.status_code == 200
                body1 = (await sse1.aread()).decode("utf-8")
                assert "event: plan" in body1
                assert "event: done" in body1

            async with client.stream(
                "POST", "/api/agent/chat", json={"query": "预算加到600，顺便预约门票", "session_id": sid}
            ) as sse2:
                assert sse2.status_code == 200
                body2 = (await sse2.aread()).decode("utf-8")
                assert "event: booking_draft" in body2
                assert "第 1 轮" in body2

            hist = await client.get(f"/api/agent/sessions/{sid}")
            assert hist.status_code == 200
            assert len(hist.json()["turns"]) >= 4

            sessions_list = await client.get("/api/agent/sessions")
            assert sessions_list.status_code == 200
            assert any(item["session_id"] == sid for item in sessions_list.json()["items"])

            deleted = await client.delete(f"/api/agent/sessions/{sid}")
            assert deleted.status_code == 200
            assert deleted.json()["deleted_turns"] >= 4


@pytest.mark.asyncio
async def test_concurrent_booking_never_oversells():
    async with lifespan(app):
        # Set spot stock to 5 temporarily and fire 8 concurrent requests of 2 tickets each (max 2 can succeed)
        async with AsyncSessionLocal() as db:
            orig_stock = (await db.get(Spot, "potala")).daily_stock
            await db.execute(update(Spot).where(Spot.id == "potala").values(daily_stock=5, version=1))
            await db.commit()

        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        transport = ASGITransport(app=app)
        try:
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                async def attempt(i: int):
                    return await client.post(
                        "/api/bookings",
                        json={
                            "spot_id": "potala",
                            "visit_date": tomorrow,
                            "session_slot": "上午场 08:00-12:00",
                            "ticket_type": "成人票",
                            "count": 2,
                            "visitor_name": f"并发用户{i}",
                            "phone": "13800138000",
                        },
                    )

                responses = await asyncio.gather(*(attempt(i) for i in range(8)))
                ok_orders = [r.json() for r in responses if r.status_code == 201]
                conflicts = [r for r in responses if r.status_code == 409]

                assert len(ok_orders) <= 2  # 5 tickets / 2 per order => at most 2 orders succeed
                assert len(ok_orders) + len(conflicts) == 8
                stock_left = (await client.get("/api/spots/potala")).json()["daily_stock"]
                assert stock_left == 5 - len(ok_orders) * 2
                assert stock_left >= 0
        finally:
            async with AsyncSessionLocal() as db:
                await db.execute(update(Spot).where(Spot.id == "potala").values(daily_stock=orig_stock))
                await db.commit()


@pytest.mark.asyncio
async def test_agent_constraints_rewrite_and_extended_tools():
    async with lifespan(app):
        intent1 = parse_intent("从西安出发去人文历史景点玩3天，不要去西北和西藏，只要免费景点")
        assert intent1["days"] == 3
        assert intent1["start_city"] == "西安"
        assert intent1["free_only"] is True
        assert intent1["budget"] == 0
        assert "西北" in intent1["exclude_keywords"]
        assert "西藏" in intent1["exclude_keywords"]

        rewritten = rewrite_rag_query("那边避坑怎么说", {"keywords": ["茶卡盐湖"], "category": "自然山水"}, [object()])
        assert "茶卡盐湖" in rewritten

        async with AsyncSessionLocal() as db:
            all_spots = list((await db.execute(select(Spot))).scalars().all())
            res_fav, _ = await _exec_tool("manage_favorites", {"action": "list"}, db, all_spots)
            assert "favorite_spot_ids" in res_fav

            res_draft, effects = await _exec_tool(
                "prepare_booking_draft", {"spot_id": "gugong", "suggested_count": 2}, db, all_spots
            )
            assert res_draft["status"] == "ready"
            assert effects["booking_draft"]["suggested_count"] == 2  # type: ignore[index]

            res_orders, _ = await _exec_tool("query_bookings", {}, db, all_spots)
            assert "orders" in res_orders


@pytest.mark.asyncio
async def test_rag_modes_ingest_and_llm_test_endpoint():
    async with lifespan(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            for m in ("hybrid", "bm25", "vector"):
                r = await client.get("/api/guides/search", params={"q": "茶卡盐湖", "mode": m})
                assert r.status_code == 200
                assert r.json()["mode"] == m
                assert len(r.json()["items"]) >= 1

            ing = await client.post(
                "/api/guides/ingest",
                json={
                    "title": "测试自定义秘境攻略",
                    "category": "测试",
                    "content": "# 交通贴士\n建议清晨乘坐接驳车避开高峰人流。\n\n# 门票建议\n提前三天预约。",
                    "tags": ["测试攻略"],
                },
            )
            assert ing.status_code == 201
            gid = ing.json()["guide_id"]
            assert ing.json()["chunks_created"] == 2

            hit = await client.get("/api/guides/search", params={"q": "清晨乘坐接驳车避开高峰"})
            assert any(item["guide_id"] == gid for item in hit.json()["items"])

            # Clean up test-ingested chunks
            async with AsyncSessionLocal() as db:
                await db.execute(delete(GuideChunk).where(GuideChunk.guide_id == gid))
                await db.commit()

            # LLM connectivity tester validation when key is absent
            t_empty = await client.post("/api/agent/test-llm", json={"api_key": "", "base_url": "https://api.deepseek.com/v1"})
            assert t_empty.status_code == 200
            assert t_empty.json()["ok"] is False

            t_bad_url = await client.post("/api/agent/test-llm", json={"api_key": "sk-test", "base_url": "ftp://bad"})
            assert t_bad_url.status_code == 200
            assert t_bad_url.json()["ok"] is False
