"use client";

import { useEffect, useState, useCallback } from "react";
import { channelLabel } from "@/lib/channel/label";
import { STATUS_META, ORDER_STATUS_META, type CustomerStatus, type Channel, type OrderStatus } from "@/lib/train/dashboard";

/**
 * T2-ก · Dashboard "ร้านจริง" (อ่าน PROD อย่างเดียว) — แยกโซนจากห้องซ้อมชัด (แถบแดง = ของจริง)
 */
interface Cust {
  userId: string; channel: Channel; displayName: string | null; stage: string | null;
  funnelStage: string | null; lastSeen: string; turns: number; humanMode: boolean; status: CustomerStatus;
}
interface ChannelState { key: string; label: string; enabled: boolean }
interface Data {
  range: string;
  counts: { newLine: number; newFb: number; returning: number; handoffPending: number };
  sales: { lineTotal: number; lineCount: number; fbTotal: number; fbCount: number };
  customers: Cust[];
  channels: ChannelState[];
  capped: boolean;
}
interface Detail {
  userId: string; channel: Channel; displayName: string | null; stage: string | null; funnelStage: string | null;
  humanMode: boolean; deliveredSteps: string[]; status: CustomerStatus;
  pendingSummary: string[]; lastOrderSummary: string[]; pendingRaw: unknown; lastOrderRaw: unknown;
  messages: { role: string; text: string; at: string }[];
}
interface Ord {
  rowIndex: number; orderNumber: string; orderId: string; channel: Channel; lineUserId: string;
  name: string; productAndQty: string; total: string; paymentMethod: string; trackingNumber: string;
  phone: string; address: string; status: OrderStatus;
}
interface OrdData { orders: Ord[]; counts: Record<OrderStatus, number>; total: number }
/** D-61.C: การ์ดสุขภาพชีต v3 */
interface SchemaTab { tab: string; ok: boolean; missing: string[]; rows: number; live: number; draft: number }
interface SchemaData { mode: string; v3Configured: boolean; tabs: SchemaTab[]; placeholders: string[]; ready?: boolean; error?: string }

const C = { prod: "#c0392b", prodBg: "#fdecea", card: "#fff", border: "#e2e2e2", ink: "#1a1a1a", sub: "#666" };
const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui, sans-serif", color: C.ink, background: "#f5f6f8", minHeight: "100dvh" },
  banner: { background: C.prod, color: "#fff", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", position: "sticky", top: 0, zIndex: 5 },
  nav: { color: "#fff", textDecoration: "none", background: "rgba(255,255,255,.2)", padding: "6px 12px", borderRadius: 8, fontSize: 14 },
  wrap: { maxWidth: 1000, margin: "0 auto", padding: 14 },
  controls: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "6px 0 14px" },
  btn: { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", fontSize: 14 },
  btnOn: { background: C.prod, color: "#fff", borderColor: C.prod },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" },
  cardLabel: { fontSize: 12, color: C.sub, marginBottom: 4 },
  cardBig: { fontSize: 24, fontWeight: 700 },
  cardSub: { fontSize: 12, color: C.sub, marginTop: 2 },
  table: { width: "100%", background: "#fff", borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` },
  row: { display: "flex", gap: 8, padding: "10px 12px", borderTop: `1px solid ${C.border}`, cursor: "pointer", alignItems: "center", fontSize: 14 },
  chip: { fontSize: 11, padding: "1px 6px", borderRadius: 10, background: "#eef", whiteSpace: "nowrap" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 20, display: "flex", justifyContent: "flex-end" },
  panel: { width: "min(520px, 100%)", background: "#fff", height: "100dvh", overflowY: "auto", padding: 16 },
  bubbleU: { alignSelf: "flex-end", background: "#a5e87f", borderRadius: 12, padding: "6px 10px", maxWidth: "85%", whiteSpace: "pre-wrap", fontSize: 14 },
  bubbleB: { alignSelf: "flex-start", background: "#f0f0f0", borderRadius: 12, padding: "6px 10px", maxWidth: "85%", whiteSpace: "pre-wrap", fontSize: 14 },
  pre: { background: "#f6f8fa", borderRadius: 8, padding: 8, overflowX: "auto", fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  login: { margin: "80px auto", background: "#fff", padding: 24, borderRadius: 12, width: 300, display: "flex", flexDirection: "column", gap: 12 },
  switchBox: { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  swBtn: { padding: "6px 12px", borderRadius: 999, border: "1px solid", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  rowBotBtn: { fontSize: 11, padding: "2px 8px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", whiteSpace: "nowrap" },
};

function thaiTime(iso: string): string {
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "เมื่อกี้";
  if (mins < 60) return `${mins} นาทีก่อน`;
  if (mins < 1440) return `${Math.floor(mins / 60)} ชม.ก่อน`;
  return `${Math.floor(mins / 1440)} วันก่อน`;
}

export default function DashboardView() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [range, setRange] = useState<"today" | "7d">("today");
  const [includeTrain, setIncludeTrain] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusF, setStatusF] = useState<CustomerStatus | "all">("all");
  const [channelF, setChannelF] = useState<Channel | "all">("all");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<"customers" | "orders">("customers");
  const [schema, setSchema] = useState<SchemaData | null>(null); // D-61.C
  const [ordData, setOrdData] = useState<OrdData | null>(null);
  const [ordStatusF, setOrdStatusF] = useState<OrderStatus | "all">("all");
  const [ordDetail, setOrdDetail] = useState<Ord | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/train/api/dashboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ range, includeTrain }) });
      if (r.status === 401) { setAuthed(false); return; }
      if (r.status === 404) { setAuthed(false); return; }
      setAuthed(true);
      if (r.ok) setData((await r.json()) as Data);
    } finally { setBusy(false); }
  }, [range, includeTrain]);

  useEffect(() => { load(); }, [load]);

  // D-61.C: การ์ดสุขภาพชีต v3 (โหลดครั้งเดียวตอนเข้า · เช็คก่อน cutover)
  useEffect(() => {
    if (authed !== true) return;
    fetch("/train/api/dashboard/schema", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSchema(d as SchemaData))
      .catch(() => { /* การ์ดเสริม — ล้มไม่กระทบ dashboard */ });
  }, [authed]);

  const loadOrders = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/train/api/dashboard/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ includeTrain }) });
      if (r.status === 401 || r.status === 404) { setAuthed(false); return; }
      if (r.ok) setOrdData((await r.json()) as OrdData);
    } finally { setBusy(false); }
  }, [includeTrain]);

  useEffect(() => { if (tab === "orders") loadOrders(); }, [tab, loadOrders]);

  async function login() {
    const r = await fetch("/train/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    if (r.ok) { setAuthed(true); load(); } else alert(r.status === 404 ? "ฟีเจอร์ปิด (ENV ไม่ครบ)" : "รหัสไม่ถูกต้อง");
  }
  async function openDetail(userId: string) {
    const r = await fetch("/train/api/dashboard/customer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId }) });
    if (r.ok) setDetail((await r.json()) as Detail);
  }

  // T2-ข · เปิด/ปิดบอทรายช่องทาง — confirm ภาษาผลลัพธ์ → เขียน → refresh → แจ้งกลุ่ม (จาก Dashboard)
  async function toggleChannel(ch: ChannelState) {
    const willEnable = !ch.enabled;
    const msg = willEnable
      ? `เปิดบอทช่อง ${ch.label} — ลูกค้าที่ทักช่องนี้จะได้รับการตอบอัตโนมัติอีกครั้ง ยืนยัน?`
      : `ปิดบอทช่อง ${ch.label} — ลูกค้าที่ทักช่องนี้จะไม่ได้รับการตอบจนกว่าจะเปิดคืน ยืนยัน?`;
    if (!window.confirm(msg)) return;
    const r = await fetch("/train/api/dashboard/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: "channel", key: ch.key, enabled: willEnable }) });
    if (r.ok) load(); else alert("สั่งไม่สำเร็จ ลองใหม่อีกครั้ง");
  }

  // T2-ข · ปิดบอทรายคน (human_mode เดิม · fn เดียวกับคำสั่ง เปิด/ปิดบอท <ชื่อ>) · currentlyHuman = บอทปิดอยู่
  async function toggleCustomer(userId: string, name: string, currentlyHuman: boolean) {
    const willClose = !currentlyHuman;
    const msg = willClose
      ? `ปิดบอทให้ "${name}" — ปลาทูจะหยุดตอบแชทนี้จนกว่าจะเปิดคืน (หรือลูกค้าเงียบครบเวลา) ยืนยัน?`
      : `เปิดบอทให้ "${name}" — ปลาทูจะกลับมาดูแลแชทนี้อีกครั้ง ยืนยัน?`;
    if (!window.confirm(msg)) return;
    const r = await fetch("/train/api/dashboard/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: "customer", userId, close: willClose }) });
    if (!r.ok) { alert("สั่งไม่สำเร็จ ลองใหม่อีกครั้ง"); return; }
    if (detail?.userId === userId) setDetail({ ...detail, humanMode: willClose });
    load();
  }

  if (authed === null) return <main style={S.page} />;
  if (!authed) {
    return (
      <main style={S.page}>
        <div style={S.login}>
          <b>🔒 T-STUDIO — เข้าสู่ระบบ</b>
          <input style={S.btn} type="password" placeholder="รหัสผ่าน" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
          <button style={{ ...S.btn, ...S.btnOn }} onClick={login}>เข้า</button>
        </div>
      </main>
    );
  }

  const shown = (data?.customers ?? []).filter((c) => (statusF === "all" || c.status === statusF) && (channelF === "all" || c.channel === channelF));

  return (
    <main style={S.page}>
      <div style={S.banner}>
        <span style={{ fontWeight: 700 }}>🔴 ร้านจริง · Dashboard <span style={{ fontWeight: 400, fontSize: 12 }}>(ข้อมูล production — อ่านอย่างเดียว)</span></span>
        <a style={S.nav} href="/train">🧪 ไปห้องซ้อม →</a>
      </div>

      <div style={S.wrap}>
        {schema && schema.v3Configured && (
          <div style={{ ...S.card, marginBottom: 12, borderColor: schema.ready ? "#9dd6b3" : "#e0b400", background: schema.ready ? "#f2fbf5" : "#fffbe6" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ fontSize: 13 }}>{schema.ready ? "✅" : "⚠️"} ชีต v3 (D-61)</b>
              <span style={{ ...S.chip, background: schema.mode === "v3" ? "#ffe3e3" : "#eef" }}>โหมดที่ระบบใช้จริง: {schema.mode}</span>
              {schema.error && <span style={{ fontSize: 12, color: C.prod }}>{schema.error}</span>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {schema.tabs.map((t) => (
                <span key={t.tab} style={{ ...S.chip, background: t.ok ? "#e7f6ec" : "#fbe6e6", color: t.ok ? "#1e7e42" : "#b00" }}
                  title={t.missing.length ? `header ขาด: ${t.missing.join(", ")}` : `${t.rows} แถว`}>
                  {t.ok ? "✅" : "⚠️"} {t.tab} · live {t.live}/draft {t.draft}{t.missing.length ? ` · ขาด ${t.missing.join(",")}` : ""}
                </span>
              ))}
            </div>
            {schema.placeholders.length > 0 && (
              <div style={{ fontSize: 12, color: C.prod, marginTop: 6 }}>🔴 ยังเป็น placeholder ต้องกรอกก่อน cutover: {schema.placeholders.join(" · ")}</div>
            )}
          </div>
        )}
        <div style={S.controls}>
          <button style={{ ...S.btn, ...(tab === "customers" ? S.btnOn : {}) }} onClick={() => setTab("customers")}>👥 ลูกค้า</button>
          <button style={{ ...S.btn, ...(tab === "orders" ? S.btnOn : {}) }} onClick={() => setTab("orders")}>🧾 ออเดอร์</button>
          <span style={{ flex: 1 }} />
          {busy && <span style={{ fontSize: 12, color: C.sub }}>กำลังโหลด…</span>}
          <button style={S.btn} onClick={() => (tab === "orders" ? loadOrders() : load())}>↻ รีเฟรช</button>
        </div>

        {tab === "customers" && (
        <>
        <div style={S.controls}>
          <button style={{ ...S.btn, ...(range === "today" ? S.btnOn : {}) }} onClick={() => setRange("today")}>วันนี้</button>
          <button style={{ ...S.btn, ...(range === "7d" ? S.btnOn : {}) }} onClick={() => setRange("7d")}>7 วัน</button>
        </div>

        {data && (
          <div style={S.cards}>
            <div style={S.card}><div style={S.cardLabel}>ลูกค้าทักใหม่</div><div style={S.cardBig}>{data.counts.newLine + data.counts.newFb}</div><div style={S.cardSub}>[LINE] {data.counts.newLine} · [FB] {data.counts.newFb}</div></div>
            <div style={S.card}><div style={S.cardLabel}>กลับมาคุย</div><div style={S.cardBig}>{data.counts.returning}</div></div>
            <div style={S.card}><div style={S.cardLabel}>ยอดขาย (บาท)</div><div style={S.cardBig}>{(data.sales.lineTotal + data.sales.fbTotal).toLocaleString()}</div><div style={S.cardSub}>[LINE] {data.sales.lineTotal.toLocaleString()} ({data.sales.lineCount}) · [FB] {data.sales.fbTotal.toLocaleString()} ({data.sales.fbCount})</div></div>
            <div style={{ ...S.card, ...(data.counts.handoffPending > 0 ? { borderColor: C.prod, background: C.prodBg } : {}) }}><div style={S.cardLabel}>🔴 handoff ค้าง (รอแอดมิน)</div><div style={S.cardBig}>{data.counts.handoffPending}</div></div>
          </div>
        )}

        {data && data.channels.length > 0 && (
          <div style={S.switchBox}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>สวิตช์บอทรายช่องทาง</span>
            {data.channels.map((ch) => (
              <button
                key={ch.key}
                style={{ ...S.swBtn, ...(ch.enabled ? { borderColor: "#1e9e50", background: "#eafaf0", color: "#1e7e42" } : { borderColor: C.prod, background: C.prodBg, color: C.prod }) }}
                onClick={() => toggleChannel(ch)}
                title={ch.enabled ? "กดเพื่อปิดบอทช่องนี้" : "กดเพื่อเปิดบอทช่องนี้"}
              >
                {ch.enabled ? "🟢" : "🔴"} {ch.label} · บอท{ch.enabled ? "เปิด" : "ปิด"}
              </button>
            ))}
            <span style={{ fontSize: 11, color: C.sub }}>กด = สลับสถานะ (มีถามยืนยัน)</span>
          </div>
        )}

        <div style={S.controls}>
          {(["all", "active", "stuck", "handoff", "won", "idle"] as const).map((s) => (
            <button key={s} style={{ ...S.btn, ...(statusF === s ? S.btnOn : {}) }} onClick={() => setStatusF(s)}>{s === "all" ? "ทุกสถานะ" : `${STATUS_META[s].icon} ${STATUS_META[s].label}`}</button>
          ))}
          <span style={{ flex: 1 }} />
          {(["all", "line", "fb"] as const).map((c) => (
            <button key={c} style={{ ...S.btn, ...(channelF === c ? S.btnOn : {}) }} onClick={() => setChannelF(c)}>{c === "all" ? "ทุกช่อง" : c === "line" ? "[LINE]" : "[FB]"}</button>
          ))}
          <label style={{ ...S.btn, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={includeTrain} onChange={(e) => setIncludeTrain(e.target.checked)} /> แสดงห้องซ้อม
          </label>
        </div>

        <div style={S.table}>
          <div style={{ padding: "8px 12px", fontSize: 12, color: C.sub }}>{shown.length} รายการ{data?.capped ? " (แสดง 300 แรก)" : ""}</div>
          {shown.map((c) => (
            <div key={c.userId} style={S.row} onClick={() => openDetail(c.userId)}>
              <span style={S.chip}>{channelLabel(c.userId)}</span>
              <b style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.displayName || "(ไม่มีชื่อ)"}</b>
              <span title={c.funnelStage ?? ""} style={{ fontSize: 12, color: C.sub }}>{c.stage ?? "-"}</span>
              <span style={{ fontSize: 12, color: C.sub, width: 70, textAlign: "right" }}>{c.turns} เทิร์น</span>
              <span style={{ fontSize: 12, color: C.sub, width: 90, textAlign: "right" }}>{thaiTime(c.lastSeen)}</span>
              <span title={STATUS_META[c.status].label}>{STATUS_META[c.status].icon}</span>
              <button
                style={{ ...S.rowBotBtn, ...(c.humanMode ? { borderColor: C.prod, color: C.prod } : {}) }}
                onClick={(e) => { e.stopPropagation(); toggleCustomer(c.userId, c.displayName || "(ไม่มีชื่อ)", c.humanMode); }}
                title={c.humanMode ? "บอทปิดอยู่ — กดเพื่อเปิด" : "บอทดูแลอยู่ — กดเพื่อปิด"}
              >
                {c.humanMode ? "🔴 เปิดบอท" : "ปิดบอท"}
              </button>
            </div>
          ))}
          {shown.length === 0 && <div style={{ padding: 20, textAlign: "center", color: C.sub }}>ไม่มีลูกค้าตามตัวกรอง</div>}
        </div>
        </>
        )}

        {tab === "orders" && (
        <>
          <div style={S.cards}>
            {(["awaiting_confirm", "awaiting_pack", "awaiting_number", "shipped_pending_notify"] as const).map((k) => (
              <div key={k} style={{ ...S.card, ...(ordData && ordData.counts[k] > 0 && ORDER_STATUS_META[k].human ? { borderColor: C.prod, background: C.prodBg } : {}) }}>
                <div style={S.cardLabel}>{ORDER_STATUS_META[k].icon} {ORDER_STATUS_META[k].label}</div>
                <div style={S.cardBig}>{ordData ? ordData.counts[k] : "–"}</div>
                {ORDER_STATUS_META[k].human && <div style={S.cardSub}>งานที่ทีมต้องทำ</div>}
              </div>
            ))}
          </div>

          <div style={S.controls}>
            {(["all", "awaiting_confirm", "awaiting_number", "awaiting_pack", "shipped_pending_notify", "shipped_notified", "cancelled"] as const).map((s) => (
              <button key={s} style={{ ...S.btn, ...(ordStatusF === s ? S.btnOn : {}) }} onClick={() => setOrdStatusF(s)}>{s === "all" ? "ทุกสถานะ" : `${ORDER_STATUS_META[s].icon} ${ORDER_STATUS_META[s].label}`}</button>
            ))}
            <span style={{ flex: 1 }} />
            {(["all", "line", "fb"] as const).map((c) => (
              <button key={c} style={{ ...S.btn, ...(channelF === c ? S.btnOn : {}) }} onClick={() => setChannelF(c)}>{c === "all" ? "ทุกช่อง" : c === "line" ? "[LINE]" : "[FB]"}</button>
            ))}
            <label style={{ ...S.btn, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={includeTrain} onChange={(e) => setIncludeTrain(e.target.checked)} /> แสดงห้องซ้อม
            </label>
          </div>

          {(() => {
            const shownOrd = (ordData?.orders ?? []).filter((o) => (ordStatusF === "all" || o.status === ordStatusF) && (channelF === "all" || o.channel === channelF));
            return (
              <div style={S.table}>
                <div style={{ padding: "8px 12px", fontSize: 12, color: C.sub }}>{shownOrd.length} ออเดอร์ · เรียงใหม่สุดก่อน · อ่านอย่างเดียว (การกระทำจริงทำในชีต)</div>
                {shownOrd.map((o) => (
                  <div key={o.rowIndex} style={S.row} onClick={() => setOrdDetail(o)}>
                    <span style={S.chip}>{channelLabel(o.lineUserId)}</span>
                    <span style={{ fontSize: 12, color: C.sub, width: 46 }}>{o.orderNumber || "—"}</span>
                    <b style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</b>
                    <span style={{ fontSize: 12, color: C.sub, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.productAndQty}</span>
                    <span style={{ fontSize: 12, width: 64, textAlign: "right" }}>{o.total || "-"}</span>
                    <span style={{ fontSize: 12, whiteSpace: "nowrap" }} title={ORDER_STATUS_META[o.status].label}>{ORDER_STATUS_META[o.status].icon} {ORDER_STATUS_META[o.status].label}</span>
                  </div>
                ))}
                {shownOrd.length === 0 && <div style={{ padding: 20, textAlign: "center", color: C.sub }}>ไม่มีออเดอร์ตามตัวกรอง</div>}
              </div>
            );
          })()}
        </>
        )}
      </div>

      {ordDetail && (
        <div style={S.overlay} onClick={() => setOrdDetail(null)}>
          <div style={S.panel} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b>{channelLabel(ordDetail.lineUserId)} ออเดอร์ {ordDetail.orderNumber || ordDetail.orderId || "(ยังไม่แจกเลข)"}</b>
              <button style={S.btn} onClick={() => setOrdDetail(null)}>ปิด</button>
            </div>
            <div style={{ fontSize: 13, margin: "8px 0", color: C.sub }}>{ORDER_STATUS_META[ordDetail.status].icon} {ORDER_STATUS_META[ordDetail.status].label}</div>
            <div style={{ fontSize: 14, display: "flex", flexDirection: "column", gap: 4 }}>
              <div><b>ลูกค้า:</b> {ordDetail.name}{ordDetail.phone ? ` · ${ordDetail.phone}` : ""}</div>
              {ordDetail.address && <div><b>ที่อยู่:</b> {ordDetail.address}</div>}
              <div><b>รายการ:</b> {ordDetail.productAndQty || "-"}</div>
              <div><b>ยอดเงิน:</b> {ordDetail.total || "-"} บาท · <b>ชำระ:</b> {ordDetail.paymentMethod || "-"}</div>
              {ordDetail.trackingNumber && <div><b>เลขแทรค:</b> {ordDetail.trackingNumber}</div>}
              <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>order_id: {ordDetail.orderId || "-"} · แถวชีต {ordDetail.rowIndex}</div>
            </div>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 12, padding: 8, background: "#f6f8fa", borderRadius: 8 }}>อ่านอย่างเดียว — คอนเฟิร์ม/กรอกเลข/ยกเลิก ทำในชีต Orders (แท็บนี้เป็นกระจกสะท้อนสถานะ)</div>
          </div>
        </div>
      )}

      {detail && (
        <div style={S.overlay} onClick={() => setDetail(null)}>
          <div style={S.panel} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b>{channelLabel(detail.userId)} {detail.displayName || "(ไม่มีชื่อ)"}</b>
              <button style={S.btn} onClick={() => setDetail(null)}>ปิด</button>
            </div>
            <div style={{ fontSize: 13, color: C.sub, margin: "8px 0" }}>
              {STATUS_META[detail.status].icon} {STATUS_META[detail.status].label} · step {detail.stage ?? "-"} ({detail.funnelStage ?? "-"}) {detail.humanMode ? "· 🔴 human_mode" : ""}
            </div>
            <button
              style={{ ...S.btn, ...(detail.humanMode ? {} : { ...S.btnOn }), marginBottom: 6 }}
              onClick={() => toggleCustomer(detail.userId, detail.displayName || "(ไม่มีชื่อ)", detail.humanMode)}
            >
              {detail.humanMode ? "🟢 เปิดบอทให้ลูกค้าคนนี้" : "🔴 ปิดบอทให้ลูกค้าคนนี้"}
            </button>

            {detail.pendingSummary.length > 0 && <><div style={{ fontWeight: 700, marginTop: 10 }}>ออเดอร์ที่กำลังคุย (pending)</div><div style={{ fontSize: 14 }}>{detail.pendingSummary.map((l, i) => <div key={i}>{l}</div>)}</div></>}
            {detail.lastOrderSummary.length > 0 && <><div style={{ fontWeight: 700, marginTop: 10 }}>ออเดอร์ล่าสุดที่ปิด</div><div style={{ fontSize: 14 }}>{detail.lastOrderSummary.map((l, i) => <div key={i}>{l}</div>)}</div></>}

            <details style={{ margin: "10px 0", fontSize: 12 }}>
              <summary style={{ cursor: "pointer", color: C.sub }}>ข้อมูลดิบ (JSON)</summary>
              <div style={{ marginTop: 6 }}>pending:<pre style={S.pre}>{JSON.stringify(detail.pendingRaw ?? {}, null, 1)}</pre></div>
              <div>last_order:<pre style={S.pre}>{JSON.stringify(detail.lastOrderRaw ?? null, null, 1)}</pre>delivered_steps: {JSON.stringify(detail.deliveredSteps)}</div>
            </details>

            <div style={{ fontWeight: 700, marginTop: 10, marginBottom: 6 }}>ประวัติแชท (อ่านอย่างเดียว)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {detail.messages.map((m, i) => <div key={i} style={m.role === "user" ? S.bubbleU : S.bubbleB}>{m.text}</div>)}
              {detail.messages.length === 0 && <div style={{ color: C.sub, fontSize: 13 }}>ไม่มีประวัติ</div>}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
