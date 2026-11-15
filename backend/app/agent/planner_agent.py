import asyncio
from collections.abc import AsyncGenerator
from dataclasses import asdict
import json
import re
import time
import uuid
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.algo.route_planner import SpotNode, build_itinerary
from app.core.config import get_settings
from app.db.models import ChatTurn, Spot
from app.rag.retriever import hybrid_search_guides

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "search_spots",
            "description": "按分类、预算上限或关键词从数据库检索真实景区，返回真实票价、坐标与余票。",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "enum": ["自然山水", "人文历史", "古城古镇", "海岛海滨"]},
                    "max_price": {"type": "integer"},
                    "keyword": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "hybrid_search_guides",
            "description": "基于 BM25 + 向量相似度 RRF 混合检索旅游攻略避坑、交通与装备信息。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "top_k": {"type": "integer", "default": 3},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "optimize_route_2opt",
            "description": "使用 Haversine + 贪心 + 2-opt TSP 算法对候选景区求最短路径并按天数分配。",
            "parameters": {
                "type": "object",
                "properties": {
                    "spot_ids": {"type": "array", "items": {"type": "string"}},
                    "days": {"type": "integer", "minimum": 1, "maximum": 7},
                    "budget": {"type": "integer"},
                },
                "required": ["spot_ids", "days"],
            },
        },
    },
]


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def parse_intent(query: str, prev_intent: dict | None = None) -> dict:
    """Extract and merge multi-turn travel constraints (days, budget, category, keywords, booking intent)."""
    base = dict(prev_intent or {})

    days_match = re.search(r"(\d+)\s*[天日]", query)
    if days_match:
        days = min(7, max(1, int(days_match.group(1))))
    elif "周末" in query:
        days = 2
    else:
        days = base.get("days", 3)

    budget_match = re.search(r"(?:预算|加到|调到|改为|最多)\s*(\d+)|(\d+)\s*元", query)
    if budget_match:
        budget = int(budget_match.group(1) or budget_match.group(2))
    else:
        budget = base.get("budget")

    cat_map = {
        "山水": "自然山水", "山": "自然山水", "湖": "自然山水", "草原": "自然山水", "雪山": "自然山水",
        "历史": "人文历史", "古迹": "人文历史", "博物馆": "人文历史", "故宫": "人文历史", "西湖": "人文历史", "兵马俑": "人文历史", "石窟": "人文历史", "冰雕": "人文历史",
        "古镇": "古城古镇", "古城": "古城古镇", "水乡": "古城古镇", "丽江": "古城古镇", "乌镇": "古城古镇", "喀什": "古城古镇",
        "海": "海岛海滨", "海岛": "海岛海滨", "沙滩": "海岛海滨", "三亚": "海岛海滨", "鼓浪屿": "海岛海滨", "青岛": "海岛海滨",
    }
    category = base.get("category")
    for kw, cat in cat_map.items():
        if kw in query:
            category = cat
            break

    wants_booking = any(k in query for k in ("预约", "订票", "买票", "门票")) or bool(base.get("wants_booking") and "取消" not in query)
    prev_keywords: list[str] = list(base.get("keywords", []))
    new_tokens = [t for t in re.findall(r"[\u4e00-\u9fff]{2,}", query) if t not in {"周末", "预算", "预约", "门票", "顺便", "加上", "换成", "改为"}]
    merged_keywords = list(dict.fromkeys(new_tokens + prev_keywords))[:8] if new_tokens else prev_keywords

    return {
        "days": days,
        "budget": budget,
        "category": category,
        "wants_booking": wants_booking,
        "keywords": merged_keywords,
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


async def _load_session_context(session: AsyncSession, session_id: str) -> tuple[list[ChatTurn], dict | None]:
    rows = (
        await session.execute(
            select(ChatTurn).where(ChatTurn.session_id == session_id).order_by(ChatTurn.id.asc())
        )
    ).scalars().all()
    last_intent = None
    for r in reversed(rows):
        if r.intent_json and r.intent_json != "{}":
            try:
                last_intent = json.loads(r.intent_json)
                break
            except Exception:
                pass
    return list(rows), last_intent


async def _exec_tool(name: str, args: dict, session: AsyncSession, all_spots: list[Spot]) -> tuple[dict, list[dict] | None, dict | None]:
    if name == "search_spots":
        cat = args.get("category")
        max_price = args.get("max_price")
        kw = (args.get("keyword") or "").lower()
        hits = []
        for s in all_spots:
            if cat and s.category != cat:
                continue
            if max_price is not None and s.price > max_price:
                continue
            if kw and kw not in f"{s.name} {s.city} {s.description} {s.tags_json}".lower():
                continue
            hits.append({"id": s.id, "name": s.name, "city": s.city, "price": s.price, "rating": s.rating, "daily_stock": s.daily_stock})
        return {"matched": len(hits), "spots": hits[:12]}, None, None

    if name == "hybrid_search_guides":
        chunks = await hybrid_search_guides(session, query=args.get("query", ""), top_k=int(args.get("top_k", 3)))
        cites = [
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
        return {"count": len(cites), "chunks": cites}, cites, None

    if name == "optimize_route_2opt":
        wanted = set(args.get("spot_ids") or [])
        cands = [s for s in all_spots if s.id in wanted] if wanted else all_spots[:6]
        plan = build_itinerary([_to_node(s) for s in cands], days=int(args.get("days", 3)), budget=args.get("budget"))
        return plan, None, plan

    return {"error": f"Unknown tool: {name}"}, None, None


async def stream_travel_agent(
    query: str, session: AsyncSession, session_id: str | None = None
) -> AsyncGenerator[str, None]:
    t0 = time.perf_counter()
    ttft_ms: int | None = None
    settings = get_settings()
    sid = session_id or uuid.uuid4().hex[:12]

    history_turns, prev_intent = await _load_session_context(session, sid)

    yield _sse("status", {"step": "intent", "session_id": sid, "turn": len(history_turns) // 2 + 1, "message": "正在结合上下文解析出行约束..."})
    intent = parse_intent(query, prev_intent=prev_intent)
    yield _sse("tool_result", {"tool": "intent_parser", "summary": intent})

    all_spots = (await session.execute(select(Spot))).scalars().all()
    mode = "local_fallback"
    plan: dict | None = None
    citations: list[dict] = []
    full_answer_parts: list[str] = []

    # ---- Optional Real LLM Multi-Turn Tool-Calling Loop ----
    if settings.llm_api_key:
        mode = "llm_tool_calling"
        messages: list[dict] = [
            {
                "role": "system",
                "content": (
                    "你是漫游城市 AI 旅行规划师。优先调用 search_spots、hybrid_search_guides、optimize_route_2opt 工具获取真实景点、攻略和路径规划结果，"
                    "严禁编造景点价格或路线距离；引用攻略请标注 [1]、[2] 等角标。"
                ),
            }
        ]
        for turn in history_turns[-6:]:
            messages.append({"role": turn.role, "content": turn.content})
        messages.append({"role": "user", "content": query})

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                for _ in range(4):
                    resp = await client.post(
                        f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                        headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                        json={"model": settings.llm_model, "messages": messages, "tools": TOOLS_SCHEMA},
                    )
                    resp.raise_for_status()
                    choice = resp.json()["choices"][0]
                    msg = choice["message"]
                    tool_calls = msg.get("tool_calls") or []
                    if not tool_calls:
                        final_text = msg.get("content") or ""
                        for i in range(0, len(final_text), 16):
                            if ttft_ms is None:
                                ttft_ms = int((time.perf_counter() - t0) * 1000)
                            chunk = final_text[i : i + 16]
                            full_answer_parts.append(chunk)
                            yield _sse("token", {"text": chunk})
                            await asyncio.sleep(0.01)
                        break

                    messages.append(msg)
                    for tc in tool_calls:
                        fn_name = tc["function"]["name"]
                        fn_args = json.loads(tc["function"].get("arguments") or "{}")
                        yield _sse("tool_call", {"tool": fn_name, "args": fn_args})
                        result, maybe_cites, maybe_plan = await _exec_tool(fn_name, fn_args, session, list(all_spots))
                        if maybe_cites is not None:
                            citations = maybe_cites
                            yield _sse("citations", {"items": citations})
                        if maybe_plan is not None:
                            plan = maybe_plan
                            yield _sse("plan", plan)
                        yield _sse("tool_result", {"tool": fn_name, "summary": f"工具 {fn_name} 执行完成"})
                        messages.append(
                            {"role": "tool", "tool_call_id": tc["id"], "content": json.dumps(result, ensure_ascii=False)}
                        )
        except Exception:
            mode = "local_fallback"
            full_answer_parts.clear()

    # ---- Deterministic Local Fallback Pipeline (always guarantees grounded output) ----
    if mode == "local_fallback":
        yield _sse("tool_call", {"tool": "search_spots", "args": {"category": intent["category"], "budget": intent["budget"]}})
        matched = []
        for s in all_spots:
            hay = f"{s.name} {s.city} {s.category} {s.description} {s.tags_json}".lower()
            if any(token in hay for token in intent["keywords"]):
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

        yield _sse("status", {"step": "generate", "session_id": sid, "message": "正在生成带溯源引用的行程解读..."})

        day_lines = []
        for d in plan["days"]:
            names = " → ".join(f"{st['name']}（¥{st['price']} / {st['duration_hours']}h）" for st in d["stops"])
            day_lines.append(f"- **{d['day']}**（约 {d['total_hours']} 小时）：{names}")
        cite_note = (
            f"结合站内攻略建议：{citations[0]['section_title']}——{citations[0]['content'][:75]}… [1]"
            if citations
            else ""
        )
        ctx_prefix = f"已结合第 {len(history_turns) // 2} 轮对话偏好更新方案：\n\n" if history_turns else ""
        narrative = (
            ctx_prefix
            + f"为您完成 **{intent['days']} 日** 确定性行程求解（共计门票 **¥{plan['total_ticket_cost']}**，"
            f"2-opt 优化后跨站距离 **{plan['optimized_distance_km']} km**"
            + (f"，较贪心基线减少绕行 **{plan['distance_saved_km']} km**" if plan["distance_saved_km"] > 0 else "")
            + "）：\n\n"
            + "\n".join(day_lines)
            + (f"\n\n{cite_note}" if cite_note else "")
        )
        if intent["wants_booking"]:
            narrative += "\n\n已在右侧为您准备好 **Human-in-the-Loop 预约确认单**，核对出行人信息后即可一键入库。"

        for i in range(0, len(narrative), 14):
            if ttft_ms is None:
                ttft_ms = int((time.perf_counter() - t0) * 1000)
            piece = narrative[i : i + 14]
            full_answer_parts.append(piece)
            yield _sse("token", {"text": piece})
            await asyncio.sleep(0.012)

    # Persist conversation turns for multi-turn continuity
    session.add(ChatTurn(session_id=sid, role="user", content=query, intent_json=json.dumps(intent, ensure_ascii=False)))
    session.add(ChatTurn(session_id=sid, role="assistant", content="".join(full_answer_parts), intent_json="{}"))
    await session.commit()

    total_ms = int((time.perf_counter() - t0) * 1000)
    yield _sse("done", {"session_id": sid, "ttft_ms": ttft_ms or total_ms, "total_ms": total_ms, "mode": mode})
