import asyncio
from collections.abc import AsyncGenerator
from dataclasses import asdict
import json
import re
import time
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.algo.route_planner import SpotNode, build_itinerary
from app.core.config import get_settings
from app.db.models import Spot
from app.rag.retriever import hybrid_search_guides


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def parse_intent(query: str) -> dict:
    """Extract structured travel constraints (days, budget, category, keywords, booking intent)."""
    days_match = re.search(r"(\d+)\s*[天日]", query)
    days = min(7, max(1, int(days_match.group(1)))) if days_match else (2 if "周末" in query else 3)

    budget_match = re.search(r"预算\s*(\d+)|(\d+)\s*元", query)
    budget = int(budget_match.group(1) or budget_match.group(2)) if budget_match else None

    cat_map = {
        "山水": "自然山水", "山": "自然山水", "湖": "自然山水",
        "历史": "人文历史", "古迹": "人文历史", "博物馆": "人文历史", "故宫": "人文历史", "西湖": "人文历史",
        "古镇": "古城古镇", "古城": "古城古镇", "水乡": "古城古镇", "丽江": "古城古镇", "乌镇": "古城古镇",
        "海": "海岛海滨", "海岛": "海岛海滨", "沙滩": "海岛海滨", "三亚": "海岛海滨", "鼓浪屿": "海岛海滨",
    }
    category = None
    for kw, cat in cat_map.items():
        if kw in query:
            category = cat
            break

    wants_booking = any(k in query for k in ("预约", "订票", "买票", "门票"))
    return {
        "days": days,
        "budget": budget,
        "category": category,
        "wants_booking": wants_booking,
    }


def _to_node(s: Spot) -> SpotNode:
    return SpotNode(
        id=s.id,
        name=s.name,
        city=s.city,
        category=s.category,
        price=s.price,
        rating=s.rating,
        duration_hours=s.duration_hours,
        lat=s.lat,
        lng=s.lng,
        scene=s.scene,
    )


async def stream_travel_agent(query: str, session: AsyncSession) -> AsyncGenerator[str, None]:
    t0 = time.perf_counter()
    ttft_ms: int | None = None
    settings = get_settings()

    yield _sse("status", {"step": "intent", "message": "正在解析自然语言约束与出行意图..."})
    intent = parse_intent(query)
    yield _sse("tool_result", {"tool": "intent_parser", "summary": intent})

    # Step 1: Query real candidate spots from DB
    yield _sse("tool_call", {"tool": "search_spots", "args": {"category": intent["category"], "budget": intent["budget"]}})
    all_spots = (await session.execute(select(Spot))).scalars().all()

    matched = []
    for s in all_spots:
        hay = f"{s.name} {s.city} {s.category} {s.description} {s.tags_json}".lower()
        if any(token in hay for token in re.findall(r"[\u4e00-\u9fff]{2,}", query)):
            matched.append(s)

    if not matched and intent["category"]:
        matched = [s for s in all_spots if s.category == intent["category"]]
    if not matched:
        matched = sorted(all_spots, key=lambda x: -x.rating)[:6]

    if intent["budget"] is not None:
        affordable = [s for s in matched if s.price <= intent["budget"]]
        if affordable:
            matched = affordable

    yield _sse(
        "tool_result",
        {"tool": "search_spots", "summary": f"命中 {len(matched)} 个真实景区", "spot_ids": [s.id for s in matched]},
    )

    # Step 2: Hybrid RAG over guide chunks
    yield _sse("tool_call", {"tool": "hybrid_search_guides", "args": {"query": query, "top_k": 3}})
    chunks = await hybrid_search_guides(session, query=query, top_k=3)
    citations = [
        {
            "index": i + 1,
            "chunk_id": c.id,
            "guide_id": c.guide_id,
            "guide_title": c.guide_title,
            "section_title": c.section_title,
            "content": c.content,
            "rrf_score": c.rrf_score,
        }
        for i, c in enumerate(chunks)
    ]
    yield _sse("tool_result", {"tool": "hybrid_search_guides", "summary": f"检索到 {len(citations)} 条攻略片段"})
    yield _sse("citations", {"items": citations})

    # Step 3: Deterministic 2-opt TSP itinerary optimization
    yield _sse("tool_call", {"tool": "optimize_route_2opt", "args": {"days": intent["days"], "candidates": len(matched)}})
    plan = build_itinerary([_to_node(s) for s in matched], days=intent["days"], budget=intent["budget"])
    yield _sse(
        "tool_result",
        {
            "tool": "optimize_route_2opt",
            "summary": f"完成 {len(plan['days'])} 天路线规划，总门票 ¥{plan['total_ticket_cost']}，优化里程 {plan['optimized_distance_km']} km",
        },
    )
    yield _sse("plan", plan)

    # Step 4: Human-in-the-Loop booking draft when booking intent is detected
    if intent["wants_booking"] and plan["days"] and plan["days"][0]["stops"]:
        top_stop = plan["days"][0]["stops"][0]
        yield _sse(
            "booking_draft",
            {
                "spot_id": top_stop["spot_id"],
                "spot_name": top_stop["name"],
                "unit_price": top_stop["price"],
                "suggested_count": 2 if any(w in query for w in ("爸妈", "父母", "两人", "2张", "两张", "亲子")) else 1,
                "reason": "检测到购票意图，已为您预填首站景区与建议人数，确认后提交数据库事务下单。",
            },
        )

    # Step 5: Stream grounded response (LLM API if configured, else deterministic local synthesis)
    yield _sse("status", {"step": "generate", "message": "正在生成带溯源引用的行程解读..."})

    mode = "local_fallback"
    if settings.llm_api_key:
        mode = "llm"
        system_prompt = (
            "你是漫游城市 AI 旅行规划师。你只能基于提供的【已优化行程JSON】和【攻略引用片段】回答，"
            "严禁编造不存在的景区或门票价格；引用攻略时请标注 [1]、[2] 等角标。"
        )
        user_payload = (
            f"用户需求：{query}\n\n"
            f"【已优化行程JSON】\n{json.dumps(plan, ensure_ascii=False)}\n\n"
            f"【攻略引用片段】\n{json.dumps([asdict(c) for c in chunks], ensure_ascii=False)}"
        )
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                async with client.stream(
                    "POST",
                    f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                    json={
                        "model": settings.llm_model,
                        "stream": True,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_payload},
                        ],
                    },
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        raw = line[6:].strip()
                        if raw == "[DONE]":
                            break
                        delta = json.loads(raw)["choices"][0]["delta"].get("content", "")
                        if delta:
                            if ttft_ms is None:
                                ttft_ms = int((time.perf_counter() - t0) * 1000)
                            yield _sse("token", {"text": delta})
        except Exception:
            mode = "local_fallback"

    if mode == "local_fallback":
        day_lines = []
        for d in plan["days"]:
            names = " → ".join(f"{st['name']}（¥{st['price']} / {st['duration_hours']}h）" for st in d["stops"])
            day_lines.append(f"- **{d['day']}**（约 {d['total_hours']} 小时）：{names}")
        cite_note = (
            f"结合站内攻略建议：{citations[0]['section_title']}——{citations[0]['content'][:75]}… [1]"
            if citations
            else ""
        )
        narrative = (
            f"已为您完成 **{intent['days']} 日** 确定性行程求解（共计门票 **¥{plan['total_ticket_cost']}**，"
            f"2-opt 优化后跨站距离 **{plan['optimized_distance_km']} km**"
            + (f"，较贪心基线减少绕行 **{plan['distance_saved_km']} km**" if plan["distance_saved_km"] > 0 else "")
            + "）：\n\n"
            + "\n".join(day_lines)
            + (f"\n\n{cite_note}" if cite_note else "")
        )
        if intent["wants_booking"]:
            narrative += "\n\n已在右侧为您准备好 **Human-in-the-Loop 预约确认单**，核对出行人信息后即可一键入库。"

        for i in range(0, len(narrative), 12):
            if ttft_ms is None:
                ttft_ms = int((time.perf_counter() - t0) * 1000)
            yield _sse("token", {"text": narrative[i : i + 12]})
            await asyncio.sleep(0.015)

    total_ms = int((time.perf_counter() - t0) * 1000)
    yield _sse("done", {"ttft_ms": ttft_ms or total_ms, "total_ms": total_ms, "mode": mode})
