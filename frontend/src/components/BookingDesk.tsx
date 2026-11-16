import { useEffect, useState } from "react";
import { cancelBooking, createBooking, fetchBookings, fetchSpots } from "../api/client";
import type { BookingOrder, Spot } from "../types";

interface Props {
  initialSpotId?: string;
  initialCount?: number;
}

type OrderFilter = "ALL" | "CONFIRMED" | "CANCELLED";

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
  const [idCard, setIdCard] = useState("");
  const [email, setEmail] = useState("");
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("ALL");
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [voucherOrder, setVoucherOrder] = useState<BookingOrder | null>(null);
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setVoucherOrder(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        id_card: idCard.trim() || undefined,
        email: email.trim() || undefined,
      });
      setMsg(`预约成功！订单号 ${order.id}，剩余库存 ${order.remaining_stock ?? "-"} 张`);
      setVoucherOrder(order);
      await reload();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "提交失败");
    }
  }

  async function handleCancel(id: string) {
    setErr("");
    try {
      await cancelBooking(id);
      setConfirmCancelId(null);
      if (voucherOrder?.id === id) setVoucherOrder(null);
      await reload();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "取消失败");
    }
  }

  const visibleOrders = orders.filter((o) => orderFilter === "ALL" || o.status === orderFilter);

  return (
    <div>
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label>
                身份证号（可选，18位实名核验）
                <input
                  value={idCard}
                  onChange={(e) => setIdCard(e.target.value)}
                  placeholder="留空免填或输入18位证件号"
                />
              </label>
              <label>
                电子邮箱（可选，接收凭证）
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <h3>实时订单记录（共 {orders.length} 笔）</h3>
            <div className="chips" style={{ marginBottom: 0 }}>
              {(
                [
                  { id: "ALL", label: "全部" },
                  { id: "CONFIRMED", label: "已确认" },
                  { id: "CANCELLED", label: "已取消" },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`chip ${orderFilter === f.id ? "active" : ""}`}
                  style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                  onClick={() => setOrderFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visibleOrders.length === 0 && (
              <p style={{ color: "var(--ink-soft)" }}>当前筛选下暂无订单。</p>
            )}
            {visibleOrders.map((o) => (
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
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>
                    {o.spot_name} · ¥{o.total_price}
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "var(--ink-soft)" }}>
                    {o.id} · {o.visit_date} · {o.ticket_type}×{o.count} · {o.visitor_name}
                    {o.id_card_masked ? ` · ${o.id_card_masked}` : ""}
                  </div>
                </div>
                {o.status === "CONFIRMED" ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      className="chip"
                      type="button"
                      style={{ padding: "5px 10px", fontSize: "0.78rem" }}
                      onClick={() => setVoucherOrder(o)}
                    >
                      电子凭证
                    </button>
                    {confirmCancelId === o.id ? (
                      <>
                        <button
                          className="btn btn-primary"
                          type="button"
                          style={{ padding: "5px 12px", fontSize: "0.78rem" }}
                          onClick={() => void handleCancel(o.id)}
                        >
                          确认退票
                        </button>
                        <button
                          className="chip"
                          type="button"
                          style={{ padding: "5px 10px", fontSize: "0.78rem" }}
                          onClick={() => setConfirmCancelId(null)}
                        >
                          保留
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-outline"
                        type="button"
                        style={{ padding: "5px 12px", fontSize: "0.8rem" }}
                        onClick={() => setConfirmCancelId(o.id)}
                      >
                        退票回滚库存
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="badge">已取消</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Electronic Entry Voucher Modal */}
      {voucherOrder && (
        <div className="modal-backdrop" onClick={() => setVoucherOrder(null)}>
          <div className="modal-card" style={{ maxWidth: 440, padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span className="badge">电子入园核销凭证</span>
              <button type="button" className="chip" onClick={() => setVoucherOrder(null)}>
                关闭 (Esc)
              </button>
            </div>
            <h2 style={{ color: "var(--teal-900)", marginBottom: 6 }}>{voucherOrder.spot_name}</h2>
            <p style={{ fontSize: "0.86rem", color: "var(--ink-soft)", marginBottom: 14 }}>
              订单号：{voucherOrder.id} · 订单状态：{voucherOrder.status}
            </p>
            <div
              style={{
                background: "#f4fbfa",
                border: "1px dashed var(--teal-500)",
                borderRadius: 12,
                padding: 14,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div style={{ fontSize: "0.86rem", lineHeight: 1.75 }}>
                <div>游玩日期：<b>{voucherOrder.visit_date}</b></div>
                <div>入园时段：{voucherOrder.session_slot}</div>
                <div>票型人数：{voucherOrder.ticket_type} × {voucherOrder.count} 张</div>
                <div>实名出行人：{voucherOrder.visitor_name}</div>
                {voucherOrder.id_card_masked && <div>证件核验：{voucherOrder.id_card_masked}</div>}
                <div>实付金额：<strong style={{ color: "var(--orange-600)" }}>¥{voucherOrder.total_price}</strong></div>
              </div>
              <svg width="84" height="84" viewBox="0 0 84 84" aria-label="电子核销码" style={{ flexShrink: 0, background: "#fff", padding: 6, borderRadius: 8, border: "1px solid var(--line)" }}>
                <rect x="4" y="4" width="22" height="22" fill="none" stroke="#0c3b3f" strokeWidth="4" />
                <rect x="11" y="11" width="8" height="8" fill="#0c3b3f" />
                <rect x="58" y="4" width="22" height="22" fill="none" stroke="#0c3b3f" strokeWidth="4" />
                <rect x="65" y="11" width="8" height="8" fill="#0c3b3f" />
                <rect x="4" y="58" width="22" height="22" fill="none" stroke="#0c3b3f" strokeWidth="4" />
                <rect x="11" y="65" width="8" height="8" fill="#0c3b3f" />
                <rect x="34" y="8" width="8" height="8" fill="#126e72" />
                <rect x="34" y="24" width="16" height="8" fill="#126e72" />
                <rect x="32" y="38" width="20" height="10" fill="#f2601e" />
                <rect x="8" y="34" width="14" height="8" fill="#0c3b3f" />
                <rect x="56" y="36" width="18" height="10" fill="#0c3b3f" />
                <rect x="36" y="58" width="12" height="18" fill="#0c3b3f" />
                <rect x="58" y="56" width="18" height="18" fill="#126e72" />
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
