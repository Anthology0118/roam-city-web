import asyncio
from datetime import date, timezone
import datetime as dt
import json
import re
import time
from typing import Literal
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
import httpx
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.planner_agent import load_saved_llm_settings, stream_travel_agent
from app.algo.route_planner import SpotNode, build_itinerary
from app.core.config import get_settings
from app.core.security import validate_llm_base_url
from app.db.models import AppSetting, BookingOrder, ChatTurn, FavoriteSpot, GuideChunk, Spot
from app.db.seed import compute_char_ngram_embedding
from app.db.session import get_db
from app.rag.retriever import hybrid_search_guides

router = APIRouter(prefix="/api")


def _serialize_spot(s: Spot) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "en_name": s.en_name,
        "city": s.city,
        "category": s.category,
        "rating": s.rating,
        "price": s.price,
        "days_label": s.days_label,
        "duration_hours": s.duration_hours,
        "views": s.views,
        "scene": s.scene,
        "description": s.description,
        "tags": json.loads(s.tags_json or "[]"),
        "lat": s.lat,
        "lng": s.lng,
        "daily_stock": s.daily_stock,
    }


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "roam-city-ai"}


@router.get("/spots")
async def list_spots(
    cat: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    rows = (await db.execute(select(Spot))).scalars().all()
    items = []
    kw = (keyword or "").strip().lower()
    for s in rows:
        if cat and cat != "全部" and s.category != cat:
            continue
        if kw:
            hay = f"{s.name} {s.city} {s.category} {s.description} {s.tags_json}".lower()
            if kw not in hay:
                continue
        items.append(_serialize_spot(s))
    return {"total": len(items), "items": items}


@router.get("/spots/{spot_id}")
async def get_spot(spot_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    spot = await db.get(Spot, spot_id)
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    return _serialize_spot(spot)


@router.get("/guides/search")
async def search_guides(
    q: str = Query(..., min_length=1),
    cat: str | None = Query(default=None),
    top_k: int = Query(default=3, ge=1, le=10),
    mode: Literal["hybrid", "bm25", "vector"] = Query(default="hybrid"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    chunks = await hybrid_search_guides(db, query=q, category=cat, top_k=top_k, mode=mode)
    return {
        "query": q,
        "mode": mode,
        "items": [
            {
                "id": c.id,
                "guide_id": c.guide_id,
                "guide_title": c.guide_title,
                "category": c.category,
                "section_title": c.section_title,
                "content": c.content,
                "bm25_score": c.bm25_score,
                "vector_score": c.vector_score,
                "rrf_score": c.rrf_score,
            }
            for c in chunks
        ],
    }


class IngestGuideRequest(BaseModel):
    title: str = Field(min_length=2, max_length=100)
    category: str = Field(default="攻略", min_length=1, max_length=24)
    content: str = Field(min_length=10, max_length=8000)
    tags: list[str] = Field(default_factory=list)


def _split_guide_sections(raw_text: str, max_chars: int = 320) -> list[tuple[str, str]]:
    """Split user-supplied guide text into titled chunks for RAG indexing."""
    blocks = [b.strip() for b in re.split(r"\n\s*\n+", raw_text.strip()) if b.strip()]
    sections: list[tuple[str, str]] = []
    cur_title = "核心要点"
    for b in blocks:
        lines = b.splitlines()
        if lines and lines[0].startswith("#"):
            cur_title = lines[0].lstrip("#").strip()[:40] or cur_title
            body = "\n".join(lines[1:]).strip()
            if not body:
                continue
        else:
            body = b
        for i in range(0, len(body), max_chars):
            part = body[i : i + max_chars].strip()
            if part:
                sec_name = cur_title if i == 0 else f"{cur_title}（续）"
                sections.append((sec_name, part))
    return sections or [("核心要点", raw_text.strip()[:max_chars])]


@router.post("/guides/ingest", status_code=201)
async def ingest_guide(req: IngestGuideRequest, db: AsyncSession = Depends(get_db)) -> dict:
    guide_id = f"custom-{uuid.uuid4().hex[:8]}"
    sections = _split_guide_sections(req.content)
    tags_text = " ".join(req.tags)
    created_ids: list[str] = []

    for idx, (sec_title, text) in enumerate(sections, start=1):
        chunk_id = f"{guide_id}-{idx}"
        full_text = f"{req.title} {sec_title} {tags_text} {text}"
        emb_json = json.dumps(compute_char_ngram_embedding(full_text))
        db.add(
            GuideChunk(
                id=chunk_id,
                guide_id=guide_id,
                guide_title=req.title.strip(),
                category=req.category.strip(),
                section_title=sec_title,
                content=text,
                metadata_json=json.dumps({"tags": req.tags, "source": "user_ingest"}, ensure_ascii=False),
                embedding_json=emb_json,
            )
        )
        created_ids.append(chunk_id)

    await db.commit()
    return {
        "guide_id": guide_id,
        "title": req.title.strip(),
        "chunks_created": len(created_ids),
        "chunk_ids": created_ids,
    }


@router.get("/guides")
async def list_guides(db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(GuideChunk))).scalars().all()
    grouped: dict[str, dict] = {}
    for r in rows:
        if r.guide_id not in grouped:
            grouped[r.guide_id] = {
                "id": r.guide_id,
                "title": r.guide_title,
                "category": r.category,
                "sections": [],
            }
        grouped[r.guide_id]["sections"].append(
            {"chunk_id": r.id, "section_title": r.section_title, "content": r.content}
        )
    return {"items": list(grouped.values())}


class OptimizeRouteRequest(BaseModel):
    spot_ids: list[str] | None = None
    days: int = Field(default=3, ge=1, le=7)
    budget: int | None = Field(default=None, ge=0)
    category: str | None = None
    start_spot_id: str | None = None


@router.post("/planner/optimize")
async def optimize_route(req: OptimizeRouteRequest, db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(Spot))).scalars().all()
    if req.spot_ids:
        id_set = set(req.spot_ids)
        candidates = [s for s in rows if s.id in id_set]
    elif req.category and req.category != "全部":
        candidates = [s for s in rows if s.category == req.category]
    else:
        candidates = list(rows)

    if not candidates:
        raise HTTPException(status_code=400, detail="No candidate spots matched")

    nodes = [
        SpotNode(
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
        for s in candidates
    ]
    return build_itinerary(nodes, days=req.days, budget=req.budget, start_spot_id=req.start_spot_id)


class CreateBookingRequest(BaseModel):
    spot_id: str
    visit_date: str
    session_slot: str
    ticket_type: str = Field(pattern="^(成人票|学生票)$")
    count: int = Field(ge=1, le=9)
    visitor_name: str = Field(min_length=2, max_length=20)
    phone: str
    id_card: str = ""
    email: str = ""

    @field_validator("visit_date")
    @classmethod
    def check_date(cls, v: str) -> str:
        parsed = date.fromisoformat(v)
        if parsed < date.today():
            raise ValueError("不能预约过去的日期")
        return v

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v: str) -> str:
        if not re.match(r"^1[3-9]\d{9}$", v.strip()):
            raise ValueError("手机号格式不正确")
        return v.strip()

    @field_validator("id_card")
    @classmethod
    def check_id_card(cls, v: str) -> str:
        v = v.strip()
        if v and not re.match(r"^\d{17}[\dXx]$", v):
            raise ValueError("身份证应为 18 位")
        return v


def _mask_id_card(raw: str) -> str:
    raw = (raw or "").strip()
    if len(raw) >= 10:
        return f"{raw[:4]}**********{raw[-4:]}"
    return raw


@router.get("/bookings")
async def list_bookings(db: AsyncSession = Depends(get_db)) -> dict:
    rows = (
        await db.execute(select(BookingOrder).order_by(BookingOrder.created_at.desc()))
    ).scalars().all()
    return {
        "items": [
            {
                "id": o.id,
                "spot_id": o.spot_id,
                "spot_name": o.spot_name,
                "visit_date": o.visit_date,
                "session_slot": o.session_slot,
                "ticket_type": o.ticket_type,
                "count": o.count,
                "visitor_name": o.visitor_name,
                "phone": o.phone,
                "id_card_masked": _mask_id_card(o.id_card),
                "email": o.email,
                "total_price": o.total_price,
                "status": o.status,
                "created_at": o.created_at.isoformat(),
            }
            for o in rows
        ]
    }


@router.post("/bookings", status_code=201)
async def create_booking(req: CreateBookingRequest, db: AsyncSession = Depends(get_db)) -> dict:
    spot = await db.get(Spot, req.spot_id)
    if not spot:
        raise HTTPException(status_code=404, detail="景区不存在")
    if spot.daily_stock < req.count:
        raise HTTPException(status_code=409, detail="余票不足")

    remaining_stock = spot.daily_stock - req.count

    # Optimistic locking stock deduction
    res = await db.execute(
        update(Spot)
        .where(Spot.id == spot.id, Spot.version == spot.version, Spot.daily_stock >= req.count)
        .values(daily_stock=Spot.daily_stock - req.count, version=Spot.version + 1)
    )
    if res.rowcount != 1:
        await db.rollback()
        raise HTTPException(status_code=409, detail="并发抢票冲突，请重试")

    rate = 0.5 if req.ticket_type == "学生票" else 1.0
    total_price = round(spot.price * rate) * req.count
    order = BookingOrder(
        id="RC" + uuid.uuid4().hex[:8].upper(),
        spot_id=spot.id,
        spot_name=spot.name,
        visit_date=req.visit_date,
        session_slot=req.session_slot,
        ticket_type=req.ticket_type,
        count=req.count,
        visitor_name=req.visitor_name.strip(),
        phone=req.phone,
        id_card=req.id_card,
        email=req.email.strip(),
        total_price=total_price,
        status="CONFIRMED",
    )
    db.add(order)
    await db.commit()
    await db.refresh(order)

    return {
        "id": order.id,
        "spot_id": order.spot_id,
        "spot_name": order.spot_name,
        "visit_date": order.visit_date,
        "session_slot": order.session_slot,
        "ticket_type": order.ticket_type,
        "count": order.count,
        "visitor_name": order.visitor_name,
        "phone": order.phone,
        "id_card_masked": _mask_id_card(order.id_card),
        "email": order.email,
        "total_price": order.total_price,
        "status": order.status,
        "remaining_stock": remaining_stock,
    }


@router.post("/bookings/{order_id}/cancel")
async def cancel_booking(order_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    order = await db.get(BookingOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    if order.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="订单已取消")

    order.status = "CANCELLED"
    await db.execute(
        update(Spot)
        .where(Spot.id == order.spot_id)
        .values(daily_stock=Spot.daily_stock + order.count, version=Spot.version + 1)
    )
    await db.commit()
    return {"id": order.id, "status": order.status}


class TestLlmRequest(BaseModel):
    api_key: str | None = Field(default=None, max_length=256)
    base_url: str | None = Field(default=None, max_length=256)
    model: str | None = Field(default=None, max_length=128)


@router.post("/agent/test-llm")
async def test_llm_connection(req: TestLlmRequest, db: AsyncSession = Depends(get_db)) -> dict:
    """Probe OpenAI-compatible endpoint connectivity, latency, and available models."""
    settings = get_settings()
    saved = await load_saved_llm_settings(db)
    api_key = (req.api_key or saved.get("llm_api_key") or settings.llm_api_key or "").strip()
    base_url = (req.base_url or saved.get("llm_base_url") or settings.llm_base_url or "https://api.deepseek.com/v1").strip().rstrip("/")
    model = (req.model or saved.get("llm_model") or settings.llm_model or "deepseek-chat").strip()

    if not api_key:
        return {"ok": False, "latency_ms": 0, "model": model, "error": "请先填写 API Key 再测试连通性"}
    url_ok, url_err = validate_llm_base_url(base_url)
    if not url_ok:
        return {"ok": False, "latency_ms": 0, "model": model, "error": url_err}

    t0 = time.perf_counter()
    available_models: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            # Optional best-effort /models discovery
            try:
                m_resp = await client.get(f"{base_url}/models", headers={"Authorization": f"Bearer {api_key}"})
                if m_resp.status_code == 200:
                    data = m_resp.json().get("data") or []
                    available_models = [str(item.get("id")) for item in data if item.get("id")][:25]
            except Exception:
                pass

            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "请回复 OK"}],
                    "max_tokens": 12,
                    "temperature": 0,
                },
            )
            latency_ms = int((time.perf_counter() - t0) * 1000)
            if resp.status_code >= 400:
                err_detail = resp.text[:240]
                return {
                    "ok": False,
                    "latency_ms": latency_ms,
                    "model": model,
                    "available_models": available_models,
                    "error": f"HTTP {resp.status_code}: {err_detail}",
                }
            body = resp.json()
            reply = ((body.get("choices") or [{}])[0].get("message") or {}).get("content", "")
            return {
                "ok": True,
                "latency_ms": latency_ms,
                "model": body.get("model") or model,
                "reply_preview": str(reply).strip()[:60] or "OK",
                "available_models": available_models,
            }
    except Exception as exc:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        return {
            "ok": False,
            "latency_ms": latency_ms,
            "model": model,
            "available_models": available_models,
            "error": str(exc) or exc.__class__.__name__,
        }


class DetectModelsRequest(BaseModel):
    api_key: str | None = Field(default=None, max_length=256)
    base_url: str | None = Field(default=None, max_length=256)
    probe: bool = True
    probe_models: list[str] | None = None
    max_probe: int = Field(default=8, ge=1, le=20)


async def _probe_single_model(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    base_url: str,
    api_key: str,
    model_id: str,
) -> dict:
    async with sem:
        t0 = time.perf_counter()
        try:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model_id,
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_tokens": 8,
                    "temperature": 0,
                },
            )
            ms = int((time.perf_counter() - t0) * 1000)
            if resp.status_code < 400:
                return {"model": model_id, "usable": True, "latency_ms": ms, "error": None}
            return {"model": model_id, "usable": False, "latency_ms": ms, "error": f"HTTP {resp.status_code}: {resp.text[:140]}"}
        except Exception as exc:
            ms = int((time.perf_counter() - t0) * 1000)
            return {"model": model_id, "usable": False, "latency_ms": ms, "error": str(exc) or exc.__class__.__name__}


@router.post("/agent/detect-models")
async def detect_llm_models(req: DetectModelsRequest, db: AsyncSession = Depends(get_db)) -> dict:
    """Discover all models exposed by an OpenAI-compatible endpoint and concurrently probe usability."""
    settings = get_settings()
    saved = await load_saved_llm_settings(db)
    api_key = (req.api_key or saved.get("llm_api_key") or settings.llm_api_key or "").strip()
    base_url = (req.base_url or saved.get("llm_base_url") or settings.llm_base_url or "").strip().rstrip("/")

    if not api_key:
        return {"ok": False, "models": [], "probed": [], "usable_models": [], "error": "请先填写 API Key"}
    url_ok, url_err = validate_llm_base_url(base_url)
    if not url_ok:
        return {"ok": False, "models": [], "probed": [], "usable_models": [], "error": url_err}

    discovered: list[str] = []
    fetch_error: str | None = None

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            m_resp = await client.get(f"{base_url}/models", headers={"Authorization": f"Bearer {api_key}"})
            if m_resp.status_code >= 400:
                fetch_error = f"/models 返回 HTTP {m_resp.status_code}: {m_resp.text[:180]}"
            else:
                payload = m_resp.json()
                raw_list = payload.get("data") if isinstance(payload, dict) else payload
                if isinstance(raw_list, list):
                    seen: set[str] = set()
                    for item in raw_list:
                        mid = item.get("id") if isinstance(item, dict) else str(item)
                        if mid and str(mid) not in seen:
                            seen.add(str(mid))
                            discovered.append(str(mid))

            probed: list[dict] = []
            if req.probe:
                targets = (
                    [m.strip() for m in req.probe_models if m.strip()][: req.max_probe]
                    if req.probe_models
                    else discovered[: req.max_probe]
                )
                if targets:
                    sem = asyncio.Semaphore(5)
                    probed = await asyncio.gather(
                        *(_probe_single_model(client, sem, base_url, api_key, mid) for mid in targets)
                    )

            usable_models = [p["model"] for p in probed if p["usable"]]
            return {
                "ok": len(discovered) > 0 or len(usable_models) > 0,
                "total_models": len(discovered),
                "models": discovered,
                "probed": probed,
                "usable_models": usable_models,
                "error": fetch_error if not discovered and not usable_models else None,
            }
    except Exception as exc:
        return {
            "ok": False,
            "total_models": len(discovered),
            "models": discovered,
            "probed": [],
            "usable_models": [],
            "error": str(exc) or exc.__class__.__name__,
        }


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    session_id: str | None = Field(default=None, max_length=64)
    llm_api_key: str | None = Field(default=None, max_length=256)
    llm_base_url: str | None = Field(default=None, max_length=256)
    llm_model: str | None = Field(default=None, max_length=128)


@router.post("/agent/chat")
async def agent_chat(req: ChatRequest, db: AsyncSession = Depends(get_db)) -> StreamingResponse:
    if req.llm_base_url and req.llm_base_url.strip():
        url_ok, url_err = validate_llm_base_url(req.llm_base_url)
        if not url_ok:
            raise HTTPException(status_code=400, detail=url_err)
    overrides = {
        "api_key": req.llm_api_key,
        "base_url": req.llm_base_url,
        "model": req.llm_model,
    }
    return StreamingResponse(
        stream_travel_agent(req.query, db, session_id=req.session_id, llm_overrides=overrides),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/agent/sessions")
async def list_chat_sessions(db: AsyncSession = Depends(get_db)) -> dict:
    rows = (
        await db.execute(select(ChatTurn).order_by(ChatTurn.id.asc()))
    ).scalars().all()
    grouped: dict[str, dict] = {}
    for r in rows:
        entry = grouped.get(r.session_id)
        if not entry:
            entry = {
                "session_id": r.session_id,
                "turns": 0,
                "title": r.content[:40] if r.role == "user" else "AI 行程会话",
                "updated_at": r.created_at.isoformat(),
            }
            grouped[r.session_id] = entry
        entry["turns"] += 1
        entry["updated_at"] = r.created_at.isoformat()
        if r.role == "user" and entry["title"] == "AI 行程会话":
            entry["title"] = r.content[:40]
    items = sorted(grouped.values(), key=lambda x: x["updated_at"], reverse=True)
    return {"items": items[:20]}


class SaveLlmConfigRequest(BaseModel):
    api_key: str = Field(default="", max_length=256)
    base_url: str = Field(default="", max_length=256)
    model: str = Field(default="", max_length=128)


@router.get("/agent/llm-config")
async def get_llm_config(db: AsyncSession = Depends(get_db)) -> dict:
    saved = await load_saved_llm_settings(db)
    settings = get_settings()
    raw_key = saved.get("llm_api_key") or settings.llm_api_key or ""
    masked = f"{raw_key[:5]}***{raw_key[-4:]}" if len(raw_key) > 10 else ("***" if raw_key else "")
    return {
        "has_api_key": bool(raw_key),
        "api_key_masked": masked,
        "base_url": saved.get("llm_base_url") or settings.llm_base_url,
        "model": saved.get("llm_model") or settings.llm_model,
    }


@router.post("/agent/llm-config")
async def save_llm_config(req: SaveLlmConfigRequest, db: AsyncSession = Depends(get_db)) -> dict:
    clean_url = req.base_url.strip()
    if clean_url:
        url_ok, url_err = validate_llm_base_url(clean_url)
        if not url_ok:
            raise HTTPException(status_code=400, detail=url_err)
    pairs: dict[str, str] = {
        "llm_base_url": clean_url,
        "llm_model": req.model.strip(),
    }
    if req.api_key.strip() and "***" not in req.api_key:
        pairs["llm_api_key"] = req.api_key.strip()

    now = dt.datetime.now(timezone.utc)
    for k, v in pairs.items():
        row = await db.get(AppSetting, k)
        if row:
            row.value = v
            row.updated_at = now
        else:
            db.add(AppSetting(key=k, value=v, updated_at=now))
    await db.commit()
    saved = await load_saved_llm_settings(db)
    raw_key = saved.get("llm_api_key") or ""
    masked = f"{raw_key[:5]}***{raw_key[-4:]}" if len(raw_key) > 10 else ("***" if raw_key else "")
    return {
        "saved": True,
        "has_api_key": bool(raw_key),
        "api_key_masked": masked,
        "base_url": saved.get("llm_base_url", ""),
        "model": saved.get("llm_model", ""),
    }


@router.delete("/agent/llm-config")
async def clear_llm_config(db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(delete(AppSetting).where(AppSetting.key.in_(["llm_api_key", "llm_base_url", "llm_model"])))
    await db.commit()
    return {"cleared": True}


@router.get("/agent/sessions/{session_id}")
async def get_chat_session(session_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    turns = (
        await db.execute(select(ChatTurn).where(ChatTurn.session_id == session_id).order_by(ChatTurn.id.asc()))
    ).scalars().all()
    last_plan = None
    last_citations = []
    for t in reversed(turns):
        if t.role == "assistant" and t.intent_json and t.intent_json != "{}":
            try:
                meta = json.loads(t.intent_json)
                if meta.get("plan") or meta.get("citations"):
                    last_plan = meta.get("plan")
                    last_citations = meta.get("citations") or []
                    break
            except Exception:
                pass
    return {
        "session_id": session_id,
        "turns": [
            {"role": t.role, "content": t.content, "created_at": t.created_at.isoformat()}
            for t in turns
        ],
        "last_plan": last_plan,
        "last_citations": last_citations,
    }


@router.delete("/agent/sessions/{session_id}")
async def delete_chat_session(session_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    res = await db.execute(delete(ChatTurn).where(ChatTurn.session_id == session_id))
    await db.commit()
    return {"session_id": session_id, "deleted_turns": res.rowcount or 0}


@router.get("/favorites")
async def list_favorites(db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(FavoriteSpot.spot_id).order_by(FavoriteSpot.created_at.desc()))).scalars().all()
    return {"spot_ids": list(rows)}


@router.post("/favorites/{spot_id}")
async def toggle_favorite(spot_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    spot = await db.get(Spot, spot_id)
    if not spot:
        raise HTTPException(status_code=404, detail="景区不存在")
    existing = await db.get(FavoriteSpot, spot_id)
    if existing:
        await db.delete(existing)
        await db.commit()
        liked = False
    else:
        db.add(FavoriteSpot(spot_id=spot_id))
        await db.commit()
        liked = True
    rows = (await db.execute(select(FavoriteSpot.spot_id).order_by(FavoriteSpot.created_at.desc()))).scalars().all()
    return {"spot_id": spot_id, "liked": liked, "spot_ids": list(rows)}
