from datetime import date, timedelta
import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app, lifespan


@pytest.mark.asyncio
async def test_api_spots_rag_booking_and_agent_sse():
    async with lifespan(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            health = await client.get("/api/health")
            assert health.status_code == 200
            assert health.json()["status"] == "ok"

            spots = await client.get("/api/spots", params={"cat": "自然山水"})
            assert spots.status_code == 200
            assert spots.json()["total"] >= 4

            rag = await client.get("/api/guides/search", params={"q": "茶卡盐湖 拍照 避坑"})
            assert rag.status_code == 200
            assert rag.json()["items"][0]["guide_id"] == "qing"

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
            assert order["total_price"] == 60  # 60 * 0.5 * 2
            assert order["remaining_stock"] == spot_before - 2

            cancel = await client.post(f"/api/bookings/{order['id']}/cancel")
            assert cancel.status_code == 200
            assert cancel.json()["status"] == "CANCELLED"
            spot_after = (await client.get("/api/spots/gugong")).json()["daily_stock"]
            assert spot_after == spot_before

            async with client.stream("POST", "/api/agent/chat", json={"query": "周末2天预算300看山水并预约门票"}) as sse:
                assert sse.status_code == 200
                body = (await sse.aread()).decode("utf-8")
                assert "event: plan" in body
                assert "event: booking_draft" in body
                assert "event: citations" in body
                assert "event: done" in body
