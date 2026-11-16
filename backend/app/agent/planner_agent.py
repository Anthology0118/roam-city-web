import asyncio
from collections.abc import AsyncGenerator
import json
import re
import time
import uuid
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.algo.route_planner import SpotNode, build_itinerary
from app.core.config import get_settings
from app.db.models import AppSetting, BookingOrder, ChatTurn, FavoriteSpot, Spot
from app.rag.retriever import hybrid_search_guides

REGION_PROVINCES: dict[str, tuple[str, ...]] = {
    "西北": ("青海", "甘肃", "新疆", "宁夏", "陕西"),
    "西南": ("四川", "云南", "贵州", "西藏", "重庆"),
    "江南": ("浙江", "江苏", "上海", "安徽"),
    "华东": ("浙江", "江苏", "上海", "安徽", "江西", "福建", "山东", "台湾"),
    "东北": ("黑龙江", "吉林", "辽宁"),
    "华南": ("海南", "广东", "广西"),
    "华北": ("北京", "天津", "河北", "山西", "内蒙古"),
}

STOP_TOKENS = {
    "周末", "预算", "预约", "订票", "买票", "门票", "顺便", "加上", "换成", "改为",
    "我想", "想去", "看看", "帮我", "安排", "一下", "不要", "不去", "避开", "排除",
    "只要", "只看", "出发", "怎么", "如何", "有什么", "请问", "可以", "推荐",
}

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "search_spots",
            "description": "按分类、价格上限、是否免费、关键词或排除地区从数据库检索真实景区，返回票价、坐标与实时余票。",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "enum": ["自然山水", "人文历史", "古城古镇", "海岛海滨"]},
                    "max_price": {"type": "integer"},
                    "free_only": {"type": "boolean"},
                    "keyword": {"type": "string"},
                    "exclude_keywords": {"type": "array", "items": {"type": "string"}},
                    "min_stock": {"type": "integer", "default": 1},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "hybrid_search_guides",
            "description": "基于 BM25 + 向量相似度 RRF 混合检索旅游攻略避坑、交通与装备信息，返回带角标的引用片段。",
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
            "description": "使用 Haversine + 贪心 + 2-opt TSP 算法对候选景区求最短路径，支持指定起点与每日节奏时长限制。",
            "parameters": {
                "type": "object",
                "properties": {
                    "spot_ids": {"type": "array", "items": {"type": "string"}},
                    "days": {"type": "integer", "minimum": 1, "maximum": 7},
                    "budget": {"type": "integer"},
                    "start_spot_id": {"type": "string"},
                    "max_hours_per_day": {"type": "number", "default": 8.0},
                },
                "required": ["spot_ids", "days"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "prepare_booking_draft",
            "description": "当用户表达订票/预约意图时，校验余票并生成 Human-in-the-Loop 预约确认单推给前端弹窗或表单预填。",
            "parameters": {
                "type": "object",
                "properties": {
                    "spot_id": {"type": "string"},
                    "suggested_count": {"type": "integer", "minimum": 1, "maximum": 9, "default": 1},
                    "reason": {"type": "string"},
                },
                "required": ["spot_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_favorites",
            "description": "查询或更新用户的景区心愿单（list / add / remove）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["list", "add", "remove"]},
                    "spot_id": {"type": "string"},
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_bookings",
            "description": "查询用户当前的门票预约订单记录及状态（CONFIRMED / CANCELLED）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": ["CONFIRMED", "CANCELLED"]},
                },
            },
        },
    },
]


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _expand_exclusions(excludes: list[str]) -> list[str]:
    expanded: list[str] = []
    for raw in excludes:
        w = raw.strip().lower()
        if not w:
            continue
        expanded.append(w)
        for region, provinces in REGION_PROVINCES.items():
            if region in w:
                expanded.extend(p.lower() for p in provinces)
    return list(dict.fromkeys(expanded))


def _spot_matches_exclusion(spot: Spot, expanded_excludes: list[str]) -> bool:
    if not expanded_excludes:
        return False
    hay = f"{spot.id} {spot.name} {spot.city} {spot.category} {spot.description} {spot.tags_json}".lower()
    return any(ex in hay for ex in expanded_excludes)


def parse_intent(query: str, prev_intent: dict | None = None) -> dict:
    """Extract and merge multi-turn travel constraints including origin, exclusions, pace, and booking."""
    base = dict(prev_intent or {})

    # 1. Days
    days_match = re.search(r"(\d+)\s*[天日]", query)
    if days_match:
        days = min(7, max(1, int(days_match.group(1))))
    elif "周末" in query:
        days = 2
    else:
        days = base.get("days", 3)

    # 2. Budget & Free-only constraints
    free_only = bool(base.get("free_only", False))
    if any(w in query for w in ("只要免费", "只看免费", "免门票", "0元", "免费景点")):
        free_only = True
        budget: int | None = 0
    else:
        budget_match = re.search(r"(?:预算|加到|调到|改为|最多|放宽到)\s*(\d+)|(\d+)\s*元", query)
        if budget_match:
            budget = int(budget_match.group(1) or budget_match.group(2))
            if budget > 0:
                free_only = False
        else:
            budget = base.get("budget")

    # 3. Category
    cat_map = {
        "山水": "自然山水", "山": "自然山水", "湖": "自然山水", "草原": "自然山水", "雪山": "自然山水", "峡谷": "自然山水",
        "历史": "人文历史", "古迹": "人文历史", "博物馆": "人文历史", "故宫": "人文历史", "西湖": "人文历史",
        "兵马俑": "人文历史", "古城墙": "人文历史", "石窟": "人文历史", "冰雕": "人文历史", "布达拉宫": "人文历史",
        "古镇": "古城古镇", "古城": "古城古镇", "水乡": "古城古镇", "丽江": "古城古镇", "乌镇": "古城古镇", "喀什": "古城古镇", "凤凰": "古城古镇",
        "海": "海岛海滨", "海岛": "海岛海滨", "沙滩": "海岛海滨", "三亚": "海岛海滨", "鼓浪屿": "海岛海滨", "青岛": "海岛海滨",
    }
    category = base.get("category")
    for kw, cat in cat_map.items():
        if kw in query and not re.search(rf"(?:不去|不要|避开|排除)[^，,。；;]*{re.escape(kw)}", query):
            category = cat
            break
    if any(w in query for w in ("不限主题", "都可以", "全部类型")):
        category = None

    # 4. Exclusions ("不去西北和西藏", "不要去西北", "避开三亚", ignore pace/spacing phrases)
    non_place_excludes = {
        "太累", "太赶", "紧张", "花钱", "太贵", "门票", "购物",
        "相隔这么近", "隔这么近", "离这么近", "太近", "这么近", "很近", "太远", "这么远", "拥挤",
    }
    excludes: list[str] = list(base.get("exclude_keywords", []))
    for ex_match in re.finditer(r"(?:不去|不要去|不要|避开|排除)\s*([\u4e00-\u9fff、和与及或]+)", query):
        raw_seg = ex_match.group(1)
        for sep in ("想去", "改去", "只看", "只要", "怎么", "玩", "看"):
            if sep in raw_seg:
                raw_seg = raw_seg.split(sep)[0]
        for piece in re.split(r"[、和与及或]+", raw_seg):
            token = re.sub(r"^(?:去|到)", "", piece.strip())
            if len(token) >= 2 and token not in non_place_excludes and token not in excludes:
                excludes.append(token)
    if "取消排除" in query or "不限地区" in query:
        excludes = []

    # 5. Departure / Start city ("从西安出发", "起点杭州")
    start_city = base.get("start_city")
    start_match = re.search(r"从\s*([\u4e00-\u9fff]{2,5}?)\s*(?:出发|起飞|开始)|起点[设为是：:\s]*([\u4e00-\u9fff]{2,5})", query)
    if start_match:
        start_city = (start_match.group(1) or start_match.group(2)).strip()

    # 6. Pace / Crowd
    relaxed_words = ("不累", "别太赶", "慢游", "带娃", "亲子", "老人", "爸妈", "父母", "轻松")
    if any(w in query for w in relaxed_words):
        pace = "relaxed"
    elif any(w in query for w in ("特种兵", "紧凑", "多看")):
        pace = "compact"
    else:
        pace = base.get("pace", "standard")

    # 7. Booking intent & ticket count
    if any(w in query for w in ("取消预约", "不订票", "不用预约", "暂不买票")):
        wants_booking = False
    else:
        wants_booking = any(k in query for k in ("预约", "订票", "买票", "门票")) or bool(base.get("wants_booking"))

    cnt_match = re.search(r"(\d+)\s*张", query)
    if cnt_match:
        requested_count = min(9, max(1, int(cnt_match.group(1))))
    elif any(w in query for w in ("爸妈", "父母", "两人", "两张", "亲子", "情侣")):
        requested_count = 2
    else:
        requested_count = base.get("requested_count", 1)

    # 8. Positive keywords (strip exclusions & stop words cleanly)
    cleaned_for_kw = re.sub(r"(?:不去|不要|避开|排除)\s*[\u4e00-\u9fff]{2,6}", " ", query)
    raw_tokens = re.findall(r"[\u4e00-\u9fff]{2,}", cleaned_for_kw)
    new_tokens = [
        t for t in raw_tokens
        if t not in STOP_TOKENS and not any(ex in t for ex in excludes)
    ]
    prev_keywords = [k for k in base.get("keywords", []) if not any(ex in k for ex in excludes)]
    merged_keywords = list(dict.fromkeys(new_tokens + prev_keywords))[:8] if new_tokens else prev_keywords

    return {
        "days": days,
        "budget": budget,
        "free_only": free_only,
        "category": category,
        "exclude_keywords": excludes,
        "start_city": start_city,
        "pace": pace,
        "wants_booking": wants_booking,
        "requested_count": requested_count,
        "keywords": merged_keywords,
    }


def rewrite_rag_query(query: str, intent: dict, history_turns: list[ChatTurn]) -> str:
    """Resolve pronouns and elliptical follow-ups into a standalone RAG search query."""
    deictics = ("那里", "那边", "这个", "这地方", "当地", "避坑", "攻略", "注意", "怎么玩", "怎么去", "预算")
    needs_context = len(history_turns) > 0 and (len(query) <= 18 or any(d in query for d in deictics))
    if not needs_context:
        return query
    ctx_terms: list[str] = []
    if intent.get("start_city"):
        ctx_terms.append(str(intent["start_city"]))
    for kw in intent.get("keywords", [])[:4]:
        if kw not in query:
            ctx_terms.append(kw)
    if intent.get("category") and intent["category"] not in query:
        ctx_terms.append(intent["category"])
    return " ".join(ctx_terms + [query]).strip() if ctx_terms else query


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


def _filter_spots(
    all_spots: list[Spot],
    category: str | None = None,
    max_price: int | None = None,
    free_only: bool = False,
    keyword: str = "",
    keywords: list[str] | None = None,
    exclude_keywords: list[str] | None = None,
    min_stock: int = 0,
) -> list[Spot]:
    expanded_excludes = _expand_exclusions(exclude_keywords or [])
    kw_lower = keyword.strip().lower()
    kw_list = [k.lower() for k in (keywords or []) if k.strip()]
    hits: list[Spot] = []

    for s in all_spots:
        if _spot_matches_exclusion(s, expanded_excludes):
            continue
        if category and s.category != category:
            continue
        if free_only and s.price > 0:
            continue
        if max_price is not None and s.price > max_price:
            continue
        if min_stock > 0 and s.daily_stock < min_stock:
            continue
        hay = f"{s.id} {s.name} {s.city} {s.category} {s.description} {s.tags_json}".lower()
        if kw_lower and kw_lower not in hay:
            continue
        if kw_list and not any(k in hay for k in kw_list):
            continue
        hits.append(s)

    return hits


def _resolve_start_spot_id(start_city: str | None, candidates: list[Spot]) -> str | None:
    if not start_city:
        return None
    target = start_city.lower()
    for s in candidates:
        if target in s.city.lower() or target in s.name.lower() or target == s.id.lower():
            return s.id
    return None


async def _load_session_context(session: AsyncSession, session_id: str) -> tuple[list[ChatTurn], dict | None]:
    rows = (
        await session.execute(
            select(ChatTurn).where(ChatTurn.session_id == session_id).order_by(ChatTurn.id.asc())
        )
    ).scalars().all()
    last_intent = None
    for r in reversed(rows):
        if r.role == "user" and r.intent_json and r.intent_json != "{}":
            try:
                last_intent = json.loads(r.intent_json)
                break
            except Exception:
                pass
    return list(rows), last_intent


async def load_saved_llm_settings(session: AsyncSession) -> dict[str, str]:
    rows = (
        await session.execute(
            select(AppSetting).where(AppSetting.key.in_(["llm_api_key", "llm_base_url", "llm_model"]))
        )
    ).scalars().all()
    return {r.key: r.value for r in rows if r.value}


async def _exec_tool(
    name: str, args: dict, session: AsyncSession, all_spots: list[Spot]
) -> tuple[dict, dict[str, object]]:
    """Execute one Agent tool call and return (json_result, sse_side_effects)."""
    effects: dict[str, object] = {}

    if name == "search_spots":
        hits = _filter_spots(
            all_spots,
            category=args.get("category"),
            max_price=args.get("max_price"),
            free_only=bool(args.get("free_only", False)),
            keyword=args.get("keyword") or "",
            exclude_keywords=args.get("exclude_keywords") or [],
            min_stock=int(args.get("min_stock", 0)),
        )
        serialized = [
            {
                "id": s.id,
                "name": s.name,
                "city": s.city,
                "category": s.category,
                "price": s.price,
                "rating": s.rating,
                "duration_hours": s.duration_hours,
                "daily_stock": s.daily_stock,
            }
            for s in sorted(hits, key=lambda x: (-x.rating, x.price))[:14]
        ]
        return {"matched": len(hits), "spots": serialized}, effects

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
        effects["citations"] = cites
        return {"count": len(cites), "chunks": cites}, effects

    if name == "optimize_route_2opt":
        wanted = set(args.get("spot_ids") or [])
        cands = [s for s in all_spots if s.id in wanted] if wanted else all_spots[:8]
        plan = build_itinerary(
            [_to_node(s) for s in cands],
            days=int(args.get("days", 3)),
            budget=args.get("budget"),
            max_hours_per_day=float(args.get("max_hours_per_day", 8.0)),
            start_spot_id=args.get("start_spot_id"),
        )
        effects["plan"] = plan
        return plan, effects

    if name == "prepare_booking_draft":
        sid = str(args.get("spot_id") or "")
        spot = next((s for s in all_spots if s.id == sid), None)
        if not spot:
            return {"error": f"景区 {sid} 不存在，请先调用 search_spots 获取真实 spot_id"}, effects
        cnt = min(9, max(1, int(args.get("suggested_count", 1))))
        if spot.daily_stock < cnt:
            return {"error": f"{spot.name} 当前余票仅剩 {spot.daily_stock} 张，不足 {cnt} 张"}, effects
        draft = {
            "spot_id": spot.id,
            "spot_name": spot.name,
            "unit_price": spot.price,
            "suggested_count": cnt,
            "reason": str(args.get("reason") or "已通过工具核验景区实时余票，请确认出行人信息后提交事务下单。"),
        }
        effects["booking_draft"] = draft
        return {"status": "ready", "draft": draft}, effects

    if name == "manage_favorites":
        action = str(args.get("action") or "list")
        spot_id = str(args.get("spot_id") or "")
        if action in ("add", "remove") and spot_id:
            existing = await session.get(FavoriteSpot, spot_id)
            spot_exists = any(s.id == spot_id for s in all_spots)
            if not spot_exists:
                return {"error": f"景区 {spot_id} 不存在"}, effects
            if action == "add" and not existing:
                session.add(FavoriteSpot(spot_id=spot_id))
                await session.commit()
            elif action == "remove" and existing:
                await session.delete(existing)
                await session.commit()
        fav_ids = list((await session.execute(select(FavoriteSpot.spot_id))).scalars().all())
        return {"action": action, "favorite_spot_ids": fav_ids, "count": len(fav_ids)}, effects

    if name == "query_bookings":
        status_filter = args.get("status")
        stmt = select(BookingOrder).order_by(BookingOrder.created_at.desc())
        if status_filter in ("CONFIRMED", "CANCELLED"):
            stmt = stmt.where(BookingOrder.status == status_filter)
        rows = (await session.execute(stmt)).scalars().all()
        items = [
            {
                "id": o.id,
                "spot_id": o.spot_id,
                "spot_name": o.spot_name,
                "visit_date": o.visit_date,
                "ticket_type": o.ticket_type,
                "count": o.count,
                "total_price": o.total_price,
                "status": o.status,
            }
            for o in rows[:10]
        ]
        return {"count": len(items), "orders": items}, effects

    return {"error": f"Unknown tool: {name}"}, effects


async def _stream_openai_turn(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    tools: list[dict] | None,
) -> AsyncGenerator[tuple[str, object], None]:
    """Stream a single OpenAI-compatible chat completion turn, yielding ('token', delta) or ('final_msg', msg)."""
    payload: dict = {"model": model, "messages": messages, "stream": True}
    if tools:
        payload["tools"] = tools

    content_parts: list[str] = []
    tool_acc: dict[int, dict] = {}
    usage_info: dict | None = None

    async with client.stream(
        "POST",
        f"{base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json=payload,
    ) as resp:
        resp.raise_for_status()
        async for raw_line in resp.aiter_lines():
            line = raw_line.strip()
            if not line or not line.startswith("data:"):
                continue
            data_str = line[5:].strip()
            if data_str == "[DONE]":
                break
            chunk = json.loads(data_str)
            if chunk.get("usage"):
                usage_info = chunk["usage"]
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}

            text_delta = delta.get("content")
            if text_delta:
                content_parts.append(text_delta)
                yield ("token", text_delta)

            for tc_delta in delta.get("tool_calls") or []:
                idx = int(tc_delta.get("index", 0))
                entry = tool_acc.setdefault(
                    idx,
                    {"id": "", "type": "function", "function": {"name": "", "arguments": ""}},
                )
                if tc_delta.get("id"):
                    entry["id"] = tc_delta["id"]
                fn = tc_delta.get("function") or {}
                if fn.get("name"):
                    entry["function"]["name"] += fn["name"]
                if fn.get("arguments"):
                    entry["function"]["arguments"] += fn["arguments"]

    ordered_tools = [tool_acc[i] for i in sorted(tool_acc.keys())] if tool_acc else []
    msg = {
        "role": "assistant",
        "content": "".join(content_parts) if content_parts else None,
        **({"tool_calls": ordered_tools} if ordered_tools else {}),
    }
    yield ("final_msg", {"message": msg, "usage": usage_info})


async def stream_travel_agent(
    query: str,
    session: AsyncSession,
    session_id: str | None = None,
    llm_overrides: dict | None = None,
) -> AsyncGenerator[str, None]:
    t0 = time.perf_counter()
    ttft_ms: int | None = None
    settings = get_settings()
    sid = session_id or uuid.uuid4().hex[:12]

    saved_cfg = await load_saved_llm_settings(session)
    overrides = llm_overrides or {}
    api_key = (overrides.get("api_key") or saved_cfg.get("llm_api_key") or settings.llm_api_key or "").strip()
    base_url = (
        overrides.get("base_url")
        or saved_cfg.get("llm_base_url")
        or settings.llm_base_url
        or "https://api.deepseek.com/v1"
    ).strip()
    model_name = (
        overrides.get("model")
        or saved_cfg.get("llm_model")
        or settings.llm_model
        or "deepseek-chat"
    ).strip()

    history_turns, prev_intent = await _load_session_context(session, sid)
    turn_num = len(history_turns) // 2 + 1

    yield _sse(
        "status",
        {"step": "intent", "session_id": sid, "turn": turn_num, "message": "正在结合上下文解析出行约束..."},
    )
    intent = parse_intent(query, prev_intent=prev_intent)
    budget_text = "免费" if intent["free_only"] else (f"¥{intent['budget']}" if intent["budget"] is not None else "不限")
    summary_parts = [f"{intent['days']}天", f"预算{budget_text}", intent["category"] or "全类型"]
    if intent["start_city"]:
        summary_parts.append(f"起点:{intent['start_city']}")
    if intent["exclude_keywords"]:
        summary_parts.append(f"排除:{'/'.join(intent['exclude_keywords'])}")
    yield _sse(
        "tool_result",
        {"tool": "intent_parser", "summary": "意图解析：" + " · ".join(summary_parts), "detail": intent},
    )

    rewritten_rag_query = rewrite_rag_query(query, intent, history_turns)
    if rewritten_rag_query != query:
        yield _sse(
            "tool_result",
            {
                "tool": "query_rewrite",
                "summary": f"多轮消解改写: {query} -> {rewritten_rag_query}",
                "rewritten": rewritten_rag_query,
            },
        )

    all_spots = list((await session.execute(select(Spot))).scalars().all())
    mode = "local_fallback"
    fallback_reason: str | None = None
    plan: dict | None = None
    citations: list[dict] = []
    full_answer_parts: list[str] = []
    usage_summary: dict | None = None

    # ---- Optional Real Streaming LLM Multi-Turn Tool-Calling Loop ----
    if api_key:
        mode = "llm_tool_calling"
        messages: list[dict] = [
            {
                "role": "system",
                "content": (
                    "你是漫游城市 AI 旅行规划师。工作规范：\n"
                    "1. 必须先调用 `search_spots` 获取真实景区、`hybrid_search_guides` 检索攻略避坑、"
                    "`optimize_route_2opt` 做确定性最短排线，严禁编造票价、库存或距离；\n"
                    "2. 如果用户提到收藏/心愿单或查询订单，主动调用 `manage_favorites` / `query_bookings`；\n"
                    "3. 如果用户有订票或预约意图，务必调用 `prepare_booking_draft`；\n"
                    "4. 最终回答请用清晰 Markdown 排版（标题、分日列表、加粗要点），引用攻略必须标注 [1]、[2] 角标。"
                ),
            }
        ]
        for turn in history_turns[-6:]:
            messages.append({"role": turn.role, "content": turn.content})
        messages.append({"role": "user", "content": query})

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                finished_answer = False
                for step_idx in range(5):
                    yield _sse(
                        "status",
                        {"step": "llm", "session_id": sid, "message": f"大模型 ReAct 推理第 {step_idx + 1} 步 ({model_name})..."},
                    )
                    final_payload: dict | None = None
                    step_tokens: list[str] = []

                    async for kind, val in _stream_openai_turn(
                        client, base_url, api_key, model_name, messages, TOOLS_SCHEMA
                    ):
                        if kind == "token":
                            delta = str(val)
                            if ttft_ms is None:
                                ttft_ms = int((time.perf_counter() - t0) * 1000)
                            step_tokens.append(delta)
                            full_answer_parts.append(delta)
                            yield _sse("token", {"text": delta})
                        elif kind == "final_msg":
                            final_payload = val  # type: ignore[assignment]

                    if final_payload and final_payload.get("usage"):
                        usage_summary = final_payload["usage"]
                    msg = (final_payload or {}).get("message") or {"role": "assistant", "content": ""}
                    tool_calls = msg.get("tool_calls") or []

                    if not tool_calls:
                        finished_answer = bool("".join(step_tokens).strip())
                        break

                    # Discard any tentative pre-tool narration before tool loop continues cleanly
                    messages.append(msg)
                    for tc in tool_calls:
                        fn_name = tc["function"]["name"]
                        try:
                            fn_args = json.loads(tc["function"].get("arguments") or "{}")
                        except Exception:
                            fn_args = {}
                        t_tool = time.perf_counter()
                        yield _sse("tool_call", {"tool": fn_name, "args": fn_args})
                        result, effects = await _exec_tool(fn_name, fn_args, session, all_spots)
                        tool_ms = int((time.perf_counter() - t_tool) * 1000)

                        if "citations" in effects:
                            citations = effects["citations"]  # type: ignore[assignment]
                            yield _sse("citations", {"items": citations})
                        if "plan" in effects:
                            plan = effects["plan"]  # type: ignore[assignment]
                            yield _sse("plan", plan)
                        if "booking_draft" in effects:
                            yield _sse("booking_draft", effects["booking_draft"])  # type: ignore[arg-type]

                        yield _sse(
                            "tool_result",
                            {
                                "tool": fn_name,
                                "latency_ms": tool_ms,
                                "summary": f"工具 {fn_name} 执行完成（{tool_ms}ms）",
                                "detail": result if fn_name != "hybrid_search_guides" else {"count": result.get("count")},
                            },
                        )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tc.get("id") or f"call_{uuid.uuid4().hex[:8]}",
                                "content": json.dumps(result, ensure_ascii=False),
                            }
                        )

                # If model kept calling tools until max iterations without a summary, force one final synthesis
                if not finished_answer:
                    async for kind, val in _stream_openai_turn(
                        client, base_url, api_key, model_name, messages, None
                    ):
                        if kind == "token":
                            delta = str(val)
                            if ttft_ms is None:
                                ttft_ms = int((time.perf_counter() - t0) * 1000)
                            full_answer_parts.append(delta)
                            yield _sse("token", {"text": delta})
        except Exception as exc:
            mode = "local_fallback"
            fallback_reason = str(exc) or exc.__class__.__name__
            full_answer_parts.clear()
            ttft_ms = None
            yield _sse(
                "tool_result",
                {
                    "tool": "llm_guard",
                    "status": "fallback",
                    "summary": f"外部模型调用异常，已无缝切换确定性兜底引擎：{fallback_reason[:120]}",
                },
            )

    # ---- Deterministic Local Fallback Pipeline (with exclusion, origin anchor & guardrail reflection) ----
    if mode == "local_fallback":
        t_search = time.perf_counter()
        yield _sse(
            "tool_call",
            {
                "tool": "search_spots",
                "args": {
                    "category": intent["category"],
                    "budget": intent["budget"],
                    "free_only": intent["free_only"],
                    "exclude": intent["exclude_keywords"],
                    "start_city": intent["start_city"],
                },
            },
        )
        matched = _filter_spots(
            all_spots,
            category=intent["category"],
            max_price=intent["budget"],
            free_only=intent["free_only"],
            keywords=intent["keywords"],
            exclude_keywords=intent["exclude_keywords"],
        )

        # Progressive relaxation if strict keyword intersection returned empty
        if not matched and intent["category"]:
            matched = _filter_spots(
                all_spots,
                category=intent["category"],
                max_price=intent["budget"],
                free_only=intent["free_only"],
                exclude_keywords=intent["exclude_keywords"],
            )
        if not matched and intent["free_only"]:
            matched = _filter_spots(all_spots, free_only=True, exclude_keywords=intent["exclude_keywords"])
        if not matched:
            matched = _filter_spots(all_spots, exclude_keywords=intent["exclude_keywords"])

        # Ensure departure spot is included in candidates if requested
        start_spot_id = _resolve_start_spot_id(intent["start_city"], all_spots)
        if start_spot_id and all(s.id != start_spot_id for s in matched):
            start_obj = next((s for s in all_spots if s.id == start_spot_id), None)
            if start_obj and (intent["budget"] is None or start_obj.price <= intent["budget"]):
                matched = [start_obj] + matched

        matched = sorted(matched, key=lambda x: (-x.rating, x.price))
        search_ms = int((time.perf_counter() - t_search) * 1000)
        yield _sse(
            "tool_result",
            {
                "tool": "search_spots",
                "latency_ms": search_ms,
                "summary": f"命中 {len(matched)} 个真实景区（已过滤排除地区与预算约束）",
                "spot_ids": [s.id for s in matched[:12]],
            },
        )

        # RAG search with multi-turn rewritten query
        t_rag = time.perf_counter()
        yield _sse("tool_call", {"tool": "hybrid_search_guides", "args": {"query": rewritten_rag_query, "top_k": 3}})
        chunks = await hybrid_search_guides(session, query=rewritten_rag_query, top_k=3)
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
        rag_ms = int((time.perf_counter() - t_rag) * 1000)
        yield _sse(
            "tool_result",
            {
                "tool": "hybrid_search_guides",
                "latency_ms": rag_ms,
                "summary": f"RRF 混合检索命中 {len(citations)} 条攻略片段（{rag_ms}ms）",
            },
        )
        yield _sse("citations", {"items": citations})

        # Deterministic 2-opt optimization with pace & origin awareness
        max_hours = 6.0 if intent["pace"] == "relaxed" else (9.5 if intent["pace"] == "compact" else 8.0)
        t_opt = time.perf_counter()
        yield _sse(
            "tool_call",
            {
                "tool": "optimize_route_2opt",
                "args": {
                    "days": intent["days"],
                    "candidates": len(matched),
                    "max_hours_per_day": max_hours,
                    "start_spot_id": start_spot_id,
                },
            },
        )
        plan = build_itinerary(
            [_to_node(s) for s in matched],
            days=intent["days"],
            budget=intent["budget"],
            max_hours_per_day=max_hours,
            start_spot_id=start_spot_id,
        )
        opt_ms = int((time.perf_counter() - t_opt) * 1000)
        yield _sse(
            "tool_result",
            {
                "tool": "optimize_route_2opt",
                "latency_ms": opt_ms,
                "summary": f"完成 {len(plan['days'])} 天路线规划，总门票 ¥{plan['total_ticket_cost']}，优化里程 {plan['optimized_distance_km']} km",
            },
        )

        # Agent Guardrail Reflection: verify budget, stock & start anchor invariants
        reflection_notes: list[str] = []
        if intent["budget"] is not None and plan["total_ticket_cost"] > intent["budget"]:
            reflection_notes.append(
                f"最低单站票价（¥{plan['total_ticket_cost']}）高于预算 ¥{intent['budget']}，已自动保留高性价比首站供参考"
            )
        else:
            reflection_notes.append("预算约束核查通过")

        if intent["exclude_keywords"]:
            reflection_notes.append(f"已确认剔除排除词：{', '.join(intent['exclude_keywords'])}")

        top_stop = plan["days"][0]["stops"][0] if plan["days"] and plan["days"][0]["stops"] else None
        if intent["wants_booking"] and top_stop:
            spot_obj = next((s for s in all_spots if s.id == top_stop["spot_id"]), None)
            req_cnt = int(intent.get("requested_count", 1))
            if spot_obj and spot_obj.daily_stock >= req_cnt:
                yield _sse(
                    "booking_draft",
                    {
                        "spot_id": top_stop["spot_id"],
                        "spot_name": top_stop["name"],
                        "unit_price": top_stop["price"],
                        "suggested_count": req_cnt,
                        "reason": f"检测到购票意图且余票充足（剩 {spot_obj.daily_stock} 张），已预填首站确认单。",
                    },
                )
                reflection_notes.append(f"库存核查通过（{spot_obj.name} 余票 {spot_obj.daily_stock} 张 >= {req_cnt}）")
            elif spot_obj:
                reflection_notes.append(f"库存告警：{spot_obj.name} 仅剩 {spot_obj.daily_stock} 张，不足 {req_cnt} 张")

        yield _sse(
            "tool_result",
            {
                "tool": "agent_reflection",
                "summary": "；".join(reflection_notes),
            },
        )
        yield _sse("plan", plan)

        yield _sse("status", {"step": "generate", "session_id": sid, "message": "正在生成带溯源引用的行程解读..."})

        day_lines = []
        for d in plan["days"]:
            names = " → ".join(f"{st['name']}（¥{st['price']} / {st['duration_hours']}h）" for st in d["stops"])
            day_lines.append(f"- **{d['day']}**（约 {d['total_hours']} 小时）：{names}")
        cite_note = (
            f"> **站内攻略避坑参考（{citations[0]['section_title']}）**：{citations[0]['content'][:90]}… [1]"
            if citations
            else ""
        )
        ctx_prefix = f"已结合第 {len(history_turns) // 2} 轮对话偏好更新方案：\n\n" if history_turns else ""
        pace_badge = "轻松慢游节奏（≤6h/天）" if intent["pace"] == "relaxed" else "标准游览节奏"
        origin_note = f"（从 **{top_stop['city']}** 出发）" if start_spot_id and top_stop else ""
        narrative = (
            ctx_prefix
            + f"### {intent['days']} 日确定性行程方案{origin_note}\n\n"
            + f"共计门票 **¥{plan['total_ticket_cost']}**，2-opt 优化后跨站距离 **{plan['optimized_distance_km']} km**"
            + (f"，较贪心基线减少绕行 **{plan['distance_saved_km']} km**" if plan["distance_saved_km"] > 0 else "")
            + f"，采用{pace_badge}：\n\n"
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

    # Persist conversation turns + last plan & citations for refresh/session recovery
    assistant_meta = json.dumps({"plan": plan, "citations": citations}, ensure_ascii=False)
    session.add(ChatTurn(session_id=sid, role="user", content=query, intent_json=json.dumps(intent, ensure_ascii=False)))
    session.add(ChatTurn(session_id=sid, role="assistant", content="".join(full_answer_parts), intent_json=assistant_meta))
    await session.commit()

    total_ms = int((time.perf_counter() - t0) * 1000)
    yield _sse(
        "done",
        {
            "session_id": sid,
            "ttft_ms": ttft_ms or total_ms,
            "total_ms": total_ms,
            "mode": mode,
            "model": model_name if mode == "llm_tool_calling" else "deterministic-engine",
            "fallback_reason": fallback_reason,
            "usage": usage_summary,
        },
    )
