import { useEffect, useState } from "react";
import { cancelBooking, createBooking, fetchBookings, fetchSpots } from "../api/client";
import type { BookingOrder, Spot } from "../types";

interface Props {
  initialSpotId?: string;
  initialCount?: number;
}

export function BookingDesk({ initialSpotId, initialCount = 1 }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [orders, setOrders] = useState<BookingOrder[]>([]);
  const [spotId, setSpotId] = useState(initialSpotId || "gugong");
  const [visitDate, setVisitDate] = useState(today);
  const [sessionSlot, setSessionSlot] = useState("下午场 12:00-17:00");
  const [ticketType, setTicketType] = useState<"成人票" | "学生票">("成人票");
  const [count, setCount] = useState(initialCount);
  const [visitorName, setVisitorName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function reload() {
    const [sp, ord] = await Promise.all([fetchSpots(), fetchBookings()]);
    setSpots(sp);
    setOrders(ord);
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (initialSpotId) setSpotId(initialSpotId);
  }, [initialSpotId]);

  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  const currentSpot = spots.find((s) => s.id === spotId);
  const unitPrice = currentSpot ? Math.round(currentSpot.price * (ticketType === "学生票" ? 0.5 : 1)) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    try {
      const order = await createBooking({
        spot_id: spotId,
        visit_date: visitDate,
        session_slot: sessionSlot,
        ticket_type: ticketType,
        count,
        visitor_name: visitorName,
        phone,
      });
      setMsg(`预约成功！订单号 ${order.id}，剩余库存 ${order.remaining_stock ?? "-"} 张`);
      await reload();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "提交失败");
    }
  }

  async function handleCancel(id: string) {
    await cancelBooking(id);
    await reload();
  }

  return (
    <div className="grid-2">
      <div className="panel">
        <h3 style={{ marginBottom: 12 }}>数据库事务门票预约（乐观锁防超卖）</h3>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label>
            选择景区
            <select value={spotId} onChange={(e) => setSpotId(e.target.value)}>
              {spots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（¥{s.price} · 余票 {s.daily_stock}）
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              游玩日期
              <input type="date" min={today} value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
            </label>
            <label>
              场次
              <select value={sessionSlot} onChange={(e) => setSessionSlot(e.target.value)}>
                <option>上午场 08:00-12:00</option>
                <option>下午场 12:00-17:00</option>
                <option>全天场不限时</option>
              </select>
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              票种
              <select
                value={ticketType}
                onChange={(e) => setTicketType(e.target.value as "成人票" | "学生票")}
              >
                <option value="成人票">成人票</option>
                <option value="学生票">学生票（5 折）</option>
              </select>
            </label>
            <label>
              数量（1-9）
              <input
                type="number"
                min={1}
                max={9}
                value={count}
                onChange={(e) => setCount(Math.min(9, Math.max(1, Number(e.target.value) || 1)))}
              />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              出行人姓名
              <input
                required
                value={visitorName}
                onChange={(e) => setVisitorName(e.target.value)}
                placeholder="至少2个字符"
              />
            </label>
            <label>
              手机号
              <input
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="11位大陆手机号"
              />
            </label>
          </div>

          <div
            style={{
              background: "#fff8ec",
              border: "1px dashed #f2c879",
              borderRadius: 10,
              padding: "10px 14px",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>单价 ¥{unitPrice} × {count} 张</span>
            <strong style={{ color: "var(--orange-600)" }}>总额 ¥{unitPrice * count}</strong>
          </div>

          {err && <div style={{ color: "#c8321e", fontSize: "0.9rem" }}>{err}</div>}
          {msg && <div style={{ color: "var(--teal-700)", fontSize: "0.9rem" }}>{msg}</div>}

          <button className="btn btn-primary" type="submit">
            提交订单并扣减库存
          </button>
        </form>
      </div>

      <div className="panel">
        <h3 style={{ marginBottom: 12 }}>实时订单记录（共 {orders.length} 笔）</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {orders.length === 0 && <p style={{ color: "var(--ink-soft)" }}>暂无订单，提交左侧表单试试。</p>}
          {orders.map((o) => (
            <div
              key={o.id}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 12,
                padding: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>
                  {o.spot_name} · ¥{o.total_price}
                </div>
                <div style={{ fontSize: "0.82rem", color: "var(--ink-soft)" }}>
                  {o.id} · {o.visit_date} · {o.ticket_type}×{o.count} · {o.visitor_name}
                </div>
              </div>
              {o.status === "CONFIRMED" ? (
                <button className="btn btn-outline" type="button" onClick={() => void handleCancel(o.id)}>
                  取消并回滚库存
                </button>
              ) : (
                <span className="badge">已取消</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
