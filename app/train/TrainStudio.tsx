"use client";

import { useEffect, useRef, useState } from "react";

/**
 * T-STUDIO เฟส ก — UI ห้องซ้อม: แชทจำลอง + แผง X-ray (มือถือ = ปุ่มพับ)
 * เฟส ข จะเพิ่ม "แตะบอลลูนเพื่อแก้" · เฟส ง polish มือถือเต็ม — ตอนนี้ responsive พื้นฐาน
 */

interface Bubble {
  role: "user" | "bot" | "system";
  text: string;
  image?: boolean;
}

interface TurnResult {
  bubbles: { via: string; messages: { type: string; text?: string; originalContentUrl?: string }[] }[];
  adminPushes: { to: string; text?: string }[];
  orderRows: Record<string, string>[];
  xray: Record<string, unknown> | null;
  error?: string;
}

function sessionIdFromStorage(): string {
  const KEY = "train-session-id";
  let id = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

const S: Record<string, React.CSSProperties> = {
  page: { display: "flex", height: "100dvh", fontFamily: "system-ui, sans-serif", background: "#f0f2f5" },
  chatCol: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  header: { padding: "10px 14px", background: "#06c755", color: "#fff", fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  chat: { flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  userB: { alignSelf: "flex-end", background: "#a5e87f", borderRadius: "16px 16px 2px 16px", padding: "8px 12px", maxWidth: "80%", whiteSpace: "pre-wrap", fontSize: 15 },
  botB: { alignSelf: "flex-start", background: "#fff", borderRadius: "16px 16px 16px 2px", padding: "8px 12px", maxWidth: "80%", whiteSpace: "pre-wrap", fontSize: 15, boxShadow: "0 1px 1px rgba(0,0,0,.08)" },
  sysB: { alignSelf: "center", background: "#e3e6ea", borderRadius: 10, padding: "4px 10px", fontSize: 12, color: "#555", whiteSpace: "pre-wrap" },
  inputRow: { display: "flex", gap: 6, padding: 10, background: "#fff", borderTop: "1px solid #ddd" },
  input: { flex: 1, padding: "12px 14px", borderRadius: 22, border: "1px solid #ccc", fontSize: 16, outline: "none" },
  btn: { padding: "12px 16px", borderRadius: 22, border: "none", background: "#06c755", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  toolRow: { display: "flex", gap: 6, padding: "6px 10px", background: "#fafafa", borderTop: "1px solid #eee", flexWrap: "wrap" },
  toolBtn: { padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: "#fff", fontSize: 13, cursor: "pointer" },
  xrayCol: { width: 360, borderLeft: "1px solid #ddd", background: "#fff", overflowY: "auto", padding: 12, fontSize: 13 },
  xrayTitle: { fontWeight: 700, margin: "10px 0 4px", color: "#06735c" },
  pre: { background: "#f6f8fa", borderRadius: 8, padding: 8, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 },
  loginBox: { margin: "auto", background: "#fff", padding: 24, borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,.1)", display: "flex", flexDirection: "column", gap: 12, width: 300 },
};

export default function TrainStudio() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [xray, setXray] = useState<Record<string, unknown> | null>(null);
  const [orderRows, setOrderRows] = useState<Record<string, string>[]>([]);
  const [adminPushes, setAdminPushes] = useState<{ to: string; text?: string }[]>([]);
  const [showXray, setShowXray] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSessionId(sessionIdFromStorage());
    const mq = window.matchMedia("(max-width: 800px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    // เช็ค auth ด้วย request เปล่า (400 = ผ่าน auth แล้ว · 401 = ต้องล็อกอิน · 404 = ฟีเจอร์ปิด)
    fetch("/train/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then((r) => setAuthed(r.status !== 401 && r.status !== 404))
      .catch(() => setAuthed(false));
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [bubbles]);

  async function login() {
    const r = await fetch("/train/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (r.ok) setAuthed(true);
    else alert(r.status === 404 ? "ฟีเจอร์ปิดอยู่ (ENV ไม่ครบ)" : "รหัสไม่ถูกต้อง");
  }

  function applyResult(data: TurnResult) {
    const botTexts: Bubble[] = data.bubbles.flatMap((b) =>
      b.messages.map((m) =>
        m.type === "text" ? { role: "bot" as const, text: m.text ?? "" } : { role: "bot" as const, text: `🖼 [รูป] ${m.originalContentUrl ?? ""}`, image: true },
      ),
    );
    setBubbles((prev) => [...prev, ...botTexts]);
    setXray(data.xray);
    setOrderRows(data.orderRows ?? []);
    setAdminPushes(data.adminPushes ?? []);
  }

  async function callApi(path: string, body: Record<string, unknown>, sysLabel?: string): Promise<void> {
    setBusy(true);
    if (sysLabel) setBubbles((prev) => [...prev, { role: "system", text: sysLabel }]);
    try {
      const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, ...body }) });
      const data = (await r.json()) as TurnResult;
      if (!r.ok) {
        setBubbles((prev) => [...prev, { role: "system", text: `⚠️ ${data.error ?? r.status}` }]);
        return;
      }
      applyResult(data);
    } catch (e) {
      setBubbles((prev) => [...prev, { role: "system", text: `⚠️ ${String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBubbles((prev) => [...prev, { role: "user", text }]);
    await callApi("/train/api/turn", { text });
  }

  async function sendImage(file: File) {
    if (busy) return;
    const b64 = Buffer_from(await file.arrayBuffer());
    setBubbles((prev) => [...prev, { role: "user", text: `🖼 [ส่งรูป ${file.name}]` }]);
    await callApi("/train/api/turn", { imageBase64: b64, imageMime: file.type || "image/jpeg" });
  }

  async function sendSampleSlip() {
    if (busy) return;
    const r = await fetch("/train-slip-sample.jpg");
    if (!r.ok) {
      alert("ยังไม่มีรูปตัวอย่าง — วางไฟล์สลิปจริงชื่อ public/train-slip-sample.jpg ใน repo หรือใช้ปุ่มแนบรูปแทน");
      return;
    }
    const b64 = Buffer_from(await r.arrayBuffer());
    setBubbles((prev) => [...prev, { role: "user", text: "🧾 [ส่งสลิปตัวอย่าง]" }]);
    await callApi("/train/api/turn", { imageBase64: b64, imageMime: "image/jpeg" });
  }

  async function cronSim() {
    if (busy) return;
    await callApi("/train/api/cron", {}, "⚙️ จำลอง: แอดมินติ๊ก M + cron แจกเลข");
  }

  async function reset() {
    if (busy) return;
    setBusy(true);
    await fetch("/train/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }) });
    setBubbles([{ role: "system", text: "🔄 ล้างความจำลูกค้าจำลองแล้ว (เหมือน /reset)" }]);
    setXray(null);
    setOrderRows([]);
    setAdminPushes([]);
    setBusy(false);
  }

  if (authed === null) return <main style={S.page} />;
  if (!authed) {
    return (
      <main style={S.page}>
        <div style={S.loginBox}>
          <b>🔒 T-STUDIO · ห้องซ้อมเทรนปลาทู</b>
          <input
            style={S.input}
            type="password"
            placeholder="รหัสผ่าน"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
          />
          <button style={S.btn} onClick={login}>เข้าห้องซ้อม</button>
        </div>
      </main>
    );
  }

  const xrayVisible = !isMobile || showXray;
  return (
    <main style={S.page}>
      <div style={{ ...S.chatCol, display: isMobile && showXray ? "none" : "flex" }}>
        <header style={S.header}>
          <span>🐟 ปลาทู (ห้องซ้อม)</span>
          <span style={{ fontSize: 12, fontWeight: 400 }}>{busy ? "กำลังพิมพ์…" : "sandbox"}</span>
        </header>
        <div ref={chatRef} style={S.chat}>
          {bubbles.length === 0 && <div style={S.sysB}>พิมพ์ทักปลาทูได้เลย — ทุกอย่างจำลอง ไม่แตะลูกค้า/ชีต/LINE จริง</div>}
          {bubbles.map((b, i) => (
            <div key={i} style={b.role === "user" ? S.userB : b.role === "bot" ? S.botB : S.sysB}>{b.text}</div>
          ))}
        </div>
        <div style={S.toolRow}>
          <button style={S.toolBtn} onClick={() => fileRef.current?.click()} disabled={busy}>📎 แนบรูป</button>
          <button style={S.toolBtn} onClick={sendSampleSlip} disabled={busy}>🧾 สลิปตัวอย่าง</button>
          <button style={S.toolBtn} onClick={cronSim} disabled={busy}>⚙️ ติ๊ก M + cron แจกเลข</button>
          <button style={S.toolBtn} onClick={reset} disabled={busy}>🔄 reset</button>
          {isMobile && <button style={S.toolBtn} onClick={() => setShowXray(true)}>🔬 X-ray</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && sendImage(e.target.files[0])} />
        </div>
        <div style={S.inputRow}>
          <input
            style={S.input}
            placeholder="พิมพ์ข้อความลูกค้า…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            disabled={busy}
          />
          <button style={S.btn} onClick={send} disabled={busy}>ส่ง</button>
        </div>
      </div>

      {xrayVisible && (
        <aside style={{ ...S.xrayCol, ...(isMobile ? { width: "100%", borderLeft: "none" } : {}) }}>
          {isMobile && <button style={{ ...S.toolBtn, width: "100%" }} onClick={() => setShowXray(false)}>← กลับแชท</button>}
          <div style={S.xrayTitle}>🔬 X-ray เทิร์นล่าสุด</div>
          {!xray && <div>ยังไม่มีเทิร์น</div>}
          {xray && (
            <>
              <div style={S.xrayTitle}>ประตู (stage)</div>
              <pre style={S.pre}>{`${xray.stage ?? "-"} · ${xray.stageName ?? ""}\nfunnel: ${xray.funnel ?? "-"}\nhuman_mode: ${xray.humanMode}`}</pre>
              <div style={S.xrayTitle}>pending order</div>
              <pre style={S.pre}>{JSON.stringify(xray.pendingOrder ?? {}, null, 1)}</pre>
              <div style={S.xrayTitle}>ธง delivered_steps</div>
              <pre style={S.pre}>{JSON.stringify(xray.deliveredSteps ?? [])}</pre>
              <div style={S.xrayTitle}>ผล gate</div>
              <pre style={S.pre}>{JSON.stringify(xray.gate ?? "-", null, 1)}</pre>
              <div style={S.xrayTitle}>verbatim / FAQ / OBJ เทิร์นนี้</div>
              <pre style={S.pre}>{JSON.stringify(xray.verbatim ?? [], null, 1)}</pre>
              {Array.isArray(xray.precheck) && xray.precheck.length > 0 && (
                <>
                  <div style={S.xrayTitle}>payment pre-check</div>
                  <pre style={S.pre}>{JSON.stringify(xray.precheck, null, 1)}</pre>
                </>
              )}
              {Array.isArray(xray.blocked) && xray.blocked.length > 0 && (
                <>
                  <div style={S.xrayTitle}>⚠️ blocked / extraction</div>
                  <pre style={S.pre}>{JSON.stringify({ blocked: xray.blocked, extraction: xray.extraction, degraded: xray.degraded }, null, 1)}</pre>
                </>
              )}
              {xray.lastOrder != null && (
                <>
                  <div style={S.xrayTitle}>last_order (บันทึกแล้ว)</div>
                  <pre style={S.pre}>{JSON.stringify(xray.lastOrder, null, 1)}{xray.lastOrderLocked ? "\n🔒 ล็อกแล้ว (M=TRUE)" : ""}</pre>
                </>
              )}
            </>
          )}
          {orderRows.length > 0 && (
            <>
              <div style={S.xrayTitle}>🧾 แถวชีต Orders ที่ &quot;จะถูกเขียน&quot; (ไม่เขียนจริง)</div>
              {orderRows.map((r, i) => (
                <pre key={i} style={S.pre}>{Object.entries(r).filter(([, v]) => v !== "").map(([k, v]) => `${k}: ${v}`).join("\n")}</pre>
              ))}
            </>
          )}
          {adminPushes.length > 0 && (
            <>
              <div style={S.xrayTitle}>📣 ข้อความที่ &quot;จะยิงกลุ่มแอดมิน&quot; (ไม่ยิงจริง)</div>
              {adminPushes.map((p, i) => (
                <pre key={i} style={S.pre}>{p.text ?? "[มีรูปแนบ]"}</pre>
              ))}
            </>
          )}
        </aside>
      )}
    </main>
  );
}

/** arraybuffer → base64 (ฝั่ง browser ไม่มี Buffer) */
function Buffer_from(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
