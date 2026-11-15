from datetime import datetime, timezone
from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class Spot(Base):
    __tablename__ = "spots"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    en_name: Mapped[str] = mapped_column(String(128), nullable=False)
    city: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    rating: Mapped[float] = mapped_column(Float, default=4.8)
    price: Mapped[int] = mapped_column(Integer, default=0)
    days_label: Mapped[str] = mapped_column(String(32), default="1天")
    duration_hours: Mapped[float] = mapped_column(Float, default=4.0)
    views: Mapped[int] = mapped_column(Integer, default=0)
    scene: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    tags_json: Mapped[str] = mapped_column(Text, default="[]")
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    daily_stock: Mapped[int] = mapped_column(Integer, default=200)
    version: Mapped[int] = mapped_column(Integer, default=1)


class GuideChunk(Base):
    __tablename__ = "guide_chunks"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    guide_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    guide_title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    section_title: Mapped[str] = mapped_column(String(128), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    embedding_json: Mapped[str] = mapped_column(Text, default="[]")


class BookingOrder(Base):
    __tablename__ = "booking_orders"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    spot_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    spot_name: Mapped[str] = mapped_column(String(128), nullable=False)
    visit_date: Mapped[str] = mapped_column(String(16), nullable=False)
    session_slot: Mapped[str] = mapped_column(String(64), nullable=False)
    ticket_type: Mapped[str] = mapped_column(String(32), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
    visitor_name: Mapped[str] = mapped_column(String(64), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    id_card: Mapped[str] = mapped_column(String(24), default="")
    email: Mapped[str] = mapped_column(String(128), default="")
    total_price: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="CONFIRMED", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class ChatTurn(Base):
    __tablename__ = "chat_turns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    intent_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class FavoriteSpot(Base):
    __tablename__ = "favorite_spots"

    spot_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
