from datetime import date
import json
import re
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.planner_agent import stream_travel_agent
from app.algo.route_planner import SpotNode, build_itinerary
from app.db.models import BookingOrder, ChatTurn, FavoriteSpot, GuideChunk, Spot
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
    db: AsyncSession = Depends(get_db),
) -> dict:
    chunks = await hybrid_search_guides(db, query=q, category=cat, top_k=top_k)
    return {
        "query": q,
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


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    session_id: str | None = Field(default=None, max_length=64)
    llm_api_key: str | None = Field(default=None, max_length=256)
    llm_base_url: str | None = Field(default=None, max_length=256)
    llm_model: str | None = Field(default=None, max_length=128)


@router.post("/agent/chat")
async def agent_chat(req: ChatRequest, db: AsyncSession = Depends(get_db)) -> StreamingResponse:
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


@router.get("/agent/sessions/{session_id}")
async def get_chat_session(session_id: str, db: AsyncSession = Depends(get_db)) -> dict:
    turns = (
        await db.execute(select(ChatTurn).where(ChatTurn.session_id == session_id).order_by(ChatTurn.id.asc()))
    ).scalars().all()
    return {
        "session_id": session_id,
        "turns": [
            {"role": t.role, "content": t.content, "created_at": t.created_at.isoformat()}
            for t in turns
        ],
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
