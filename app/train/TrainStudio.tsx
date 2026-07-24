"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * T-STUDIO — เฟส ก (แชทจำลอง + X-ray) + เฟส ข (แตะบอลลูนเพื่อแก้ · draft overlay · lint สด)
 * เฟส ค (เขียนกลับชีต) ยังไม่ทำ — ปุ่ม copy/เขียน จะมาเฟสหน้า
 */

interface Msg { type: string; text?: string; originalContentUrl?: string }
interface SourceCol { name: string; value: string }
interface ReplySource { tab: string; key: string; keyCol: string; label: string; columns: SourceCol[] }
interface Turn {
  user: string;
  userImage?: boolean;
  bot: { text: string; image?: boolean }[];
  sources: ReplySource[];
  dropped: { text: string; vars: string[] }[];
}
interface TurnResult {
  bubbles: { via: string; messages: Msg[] }[];
  adminPushes: { to: string; text?: string }[];
  orderRows: Record<string, string>[];
  xray: Record<string, unknown> | null;
  sources: ReplySource[];
  droppedBubbles: { text: string; vars: string[] }[];
  error?: string;
}
interface OverlayEntry { tab: string; key: string; column: string; value: string }
interface LintFinding { level: "block" | "warn"; kind: string; message: string; hits: string[] }
interface PreviewResult {
  rawPattern: string;
  segments: { text: string; dropped: boolean; vars: string[] }[];
  vars: { token: string; value: string; resolved: boolean; unknown: boolean }[];
  lint: LintFinding[];
  error?: string;
}
interface Editor { turnIdx: number; srcIdx: number }

const OVERLAY_KEY = "train-overlay-v1";

function sessionIdFromStorage(): string {
  const KEY = "train-session-id";
  let id = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(KEY, id); }
  return id;
}
function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf); let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

const S: Record<string, React.CSSProperties> = {
  page: { display: "flex", height: "100dvh", fontFamily: "system-ui, sans-serif", background: "#f0f2f5" },
  chatCol: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  header: { padding: "10px 14px", background: "#06c755", color: "#fff", fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  chat: { flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  userB: { alignSelf: "flex-end", background: "#a5e87f", borderRadius: "16px 16px 2px 16px", padding: "8px 12px", maxWidth: "80%", whiteSpace: "pre-wrap", fontSize: 15 },
  botB: { alignSelf: "flex-start", background: "#fff", borderRadius: "16px 16px 16px 2px", padding: "8px 12px", maxWidth: "80%", whiteSpace: "pre-wrap", fontSize: 15, boxShadow: "0 1px 1px rgba(0,0,0,.08)", cursor: "pointer", border: "1px solid transparent" },
  botEditable: { borderColor: "#cfe9d8" },
  dropB: { alignSelf: "flex-start", background: "#fff0f0", borderRadius: 12, padding: "6px 10px", maxWidth: "80%", fontSize: 13, color: "#b00", textDecoration: "line-through", border: "1px dashed #f0a0a0" },
  sysB: { alignSelf: "center", background: "#e3e6ea", borderRadius: 10, padding: "4px 10px", fontSize: 12, color: "#555", whiteSpace: "pre-wrap" },
  inputRow: { display: "flex", gap: 6, padding: 10, background: "#fff", borderTop: "1px solid #ddd" },
  input: { flex: 1, padding: "12px 14px", borderRadius: 22, border: "1px solid #ccc", fontSize: 16, outline: "none" },
  btn: { padding: "12px 16px", borderRadius: 22, border: "none", background: "#06c755", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  toolRow: { display: "flex", gap: 6, padding: "6px 10px", background: "#fafafa", borderTop: "1px solid #eee", flexWrap: "wrap" },
  toolBtn: { padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: "#fff", fontSize: 13, cursor: "pointer" },
  side: { width: 400, borderLeft: "1px solid #ddd", background: "#fff", overflowY: "auto", padding: 12, fontSize: 13 },
  title: { fontWeight: 700, margin: "10px 0 4px", color: "#06735c" },
  pre: { background: "#f6f8fa", borderRadius: 8, padding: 8, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 },
  ta: { width: "100%", boxSizing: "border-box", minHeight: 70, padding: 8, borderRadius: 8, border: "1px solid #bbb", fontSize: 14, fontFamily: "inherit", resize: "vertical" },
  segOk: { background: "#eef7f0", borderRadius: 8, padding: "6px 10px", fontSize: 14, margin: "3px 0", whiteSpace: "pre-wrap" },
  segDrop: { background: "#fff0f0", borderRadius: 8, padding: "6px 10px", fontSize: 13, margin: "3px 0", color: "#b00", textDecoration: "line-through" },
  lintBlock: { background: "#ffe3e3", color: "#a10000", borderRadius: 8, padding: "6px 10px", fontSize: 12, margin: "3px 0" },
  lintWarn: { background: "#fff4d6", color: "#8a6d00", borderRadius: 8, padding: "6px 10px", fontSize: 12, margin: "3px 0" },
  loginBox: { margin: "auto", background: "#fff", padding: 24, borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,.1)", display: "flex", flexDirection: "column", gap: 12, width: 300 },
  sheet: { position: "fixed", left: 0, right: 0, bottom: 0, maxHeight: "88dvh", background: "#fff", borderRadius: "16px 16px 0 0", boxShadow: "0 -4px 20px rgba(0,0,0,.2)", overflowY: "auto", WebkitOverflowScrolling: "touch", padding: 14, paddingBottom: "calc(20px + env(safe-area-inset-bottom))", scrollPaddingBottom: 100, zIndex: 20 },
  chip: { display: "inline-block", padding: "2px 8px", borderRadius: 12, background: "#eef", fontSize: 11, marginRight: 4 },
};

export default function TrainStudio() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sys, setSys] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [xray, setXray] = useState<Record<string, unknown> | null>(null);
  const [orderRows, setOrderRows] = useState<Record<string, string>[]>([]);
  const [adminPushes, setAdminPushes] = useState<{ to: string; text?: string }[]>([]);
  const [overlay, setOverlay] = useState<OverlayEntry[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draftCols, setDraftCols] = useState<SourceCol[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirm, setConfirm] = useState<{ column: string; old: string; next: string } | null>(null);
  const [toast, setToast] = useState("");
  const [sheetChanged, setSheetChanged] = useState(false);
  const [sheetDragY, setSheetDragY] = useState(0);
  const dragStart = useRef(0);
  const [showX, setShowX] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSessionId(sessionIdFromStorage());
    try { setOverlay(JSON.parse(localStorage.getItem(OVERLAY_KEY) || "[]")); } catch { /* noop */ }
    const mq = window.matchMedia("(max-width: 820px)");
    setIsMobile(mq.matches);
    const onCh = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onCh);
    fetch("/train/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then((r) => setAuthed(r.status !== 401 && r.status !== 404)).catch(() => setAuthed(false));
    return () => mq.removeEventListener("change", onCh);
  }, []);
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }); }, [turns, sys]);
  useEffect(() => { localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay)); }, [overlay]);

  async function login() {
    const r = await fetch("/train/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    if (r.ok) setAuthed(true);
    else alert(r.status === 404 ? "ฟีเจอร์ปิดอยู่ (ENV ไม่ครบ)" : "รหัสไม่ถูกต้อง");
  }

  function applyResult(data: TurnResult, user: string, userImage?: boolean) {
    const bot = data.bubbles.flatMap((b) => b.messages.map((m) => m.type === "text" ? { text: m.text ?? "" } : { text: `🖼 [รูป] ${m.originalContentUrl ?? ""}`, image: true }));
    setTurns((prev) => [...prev, { user, userImage, bot, sources: data.sources ?? [], dropped: data.droppedBubbles ?? [] }]);
    setXray(data.xray); setOrderRows(data.orderRows ?? []); setAdminPushes(data.adminPushes ?? []);
  }

  const callTurn = useCallback(async (body: Record<string, unknown>, user: string, userImage?: boolean) => {
    setBusy(true);
    try {
      const r = await fetch("/train/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, overlay, ...body }) });
      const data = (await r.json()) as TurnResult;
      if (!r.ok) { setSys((p) => [...p, `⚠️ ${data.error ?? r.status}`]); return; }
      applyResult(data, user, userImage);
    } catch (e) { setSys((p) => [...p, `⚠️ ${String(e)}`]); }
    finally { setBusy(false); }
  }, [sessionId, overlay]);

  async function send() {
    const text = input.trim(); if (!text || busy) return;
    setInput(""); await callTurn({ text }, text);
  }
  async function sendImage(file: File) {
    if (busy) return;
    const b64 = bufToB64(await file.arrayBuffer());
    await callTurn({ imageBase64: b64, imageMime: file.type || "image/jpeg" }, `🖼 [ส่งรูป ${file.name}]`, true);
  }
  async function sendSampleSlip() {
    if (busy) return;
    const r = await fetch("/train-slip-sample.jpg");
    if (!r.ok) { alert("ยังไม่มีรูปตัวอย่าง — วาง public/train-slip-sample.jpg หรือใช้ปุ่มแนบรูป"); return; }
    const b64 = bufToB64(await r.arrayBuffer());
    await callTurn({ imageBase64: b64, imageMime: "image/jpeg" }, "🧾 [ส่งสลิปตัวอย่าง]", true);
  }
  async function cronSim() {
    if (busy) return; setBusy(true); setSys((p) => [...p, "⚙️ จำลอง: ติ๊ก M + cron แจกเลข"]);
    try {
      const r = await fetch("/train/api/cron", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }) });
      const data = (await r.json()) as TurnResult;
      if (r.ok) { setXray(data.xray); setOrderRows(data.orderRows ?? []); setAdminPushes(data.adminPushes ?? []); }
    } finally { setBusy(false); }
  }
  async function reset() {
    if (busy) return; setBusy(true);
    await fetch("/train/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }) });
    setTurns([]); setSys(["🔄 ล้างความจำลูกค้าจำลองแล้ว"]); setXray(null); setOrderRows([]); setAdminPushes([]); setEditor(null); setPreview(null); setBusy(false);
  }

  // ---- เฟส ข: editor ----
  // 🔴 เฟส ง (bug fix เฟส ค): fetch "ข้อความดิบ" สดจากชีตเสมอตอนเปิด (ไม่ใช้ค่าที่ติดมากับเทิร์นเก่า
  //    ซึ่งอาจ stale หลังเขียนลงชีต) · ต่างจากค่าตอนเทิร์น → badge "ชีตถูกแก้แล้วหลังเทิร์นนี้"
  async function openEditor(turnIdx: number, srcIdx = 0) {
    const src = turns[turnIdx]?.sources[srcIdx];
    if (!src) return;
    setEditor({ turnIdx, srcIdx }); setPreview(null); setSheetChanged(false); setSheetDragY(0);
    setDraftCols(src.columns.map((c) => ({ name: c.name, value: c.value }))); // ค่าชั่วคราวระหว่างโหลดสด
    const fresh = await Promise.all(src.columns.map(async (c) => {
      try {
        const r = await fetch("/train/api/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "diff", tab: src.tab, key: src.key, column: c.name }) });
        const d = (await r.json()) as { old?: string };
        return { name: c.name, sheet: r.ok ? (d.old ?? "") : c.value, turnVal: c.value };
      } catch { return { name: c.name, sheet: c.value, turnVal: c.value }; }
    }));
    setSheetChanged(fresh.some((f) => f.sheet !== f.turnVal));
    const cols = fresh.map((f) => {
      const ov = overlay.find((o) => o.tab === src.tab && o.key === src.key && o.column === f.name);
      return { name: f.name, value: ov ? ov.value : f.sheet }; // ฐาน = ชีตสด · overlay draft ชนะ
    });
    setDraftCols(cols);
    schedulePreview(src.tab, src.key, cols);
  }
  function closeEditor() { setEditor(null); setPreview(null); setSheetDragY(0); }
  const schedulePreview = useCallback((tab: string, key: string, cols: SourceCol[]) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      const draft = Object.fromEntries(cols.map((c) => [c.name, c.value]));
      const r = await fetch("/train/api/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, tab, key, draft }) });
      setPreview((await r.json()) as PreviewResult);
    }, 350);
  }, [sessionId]);

  function editCol(name: string, value: string) {
    if (!editor) return;
    const src = turns[editor.turnIdx].sources[editor.srcIdx];
    const cols = draftCols.map((c) => (c.name === name ? { ...c, value } : c));
    setDraftCols(cols);
    setOverlay((prev) => {
      const rest = prev.filter((o) => !(o.tab === src.tab && o.key === src.key && o.column === name));
      return [...rest, { tab: src.tab, key: src.key, column: name, value }];
    });
    schedulePreview(src.tab, src.key, cols);
  }
  function clearThisDraft() {
    if (!editor) return;
    const src = turns[editor.turnIdx].sources[editor.srcIdx];
    setOverlay((prev) => prev.filter((o) => !(o.tab === src.tab && o.key === src.key)));
    setEditor(null); setPreview(null);
  }
  async function replayTurn() {
    if (!editor) return;
    const text = turns[editor.turnIdx].user;
    setEditor(null); setPreview(null);
    await callTurn({ text }, text);
  }

  // ---- เฟส ค: copy + เขียนกลับชีต ----
  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(""), 2600); }
  async function copyCol(value: string) {
    try { await navigator.clipboard.writeText(value); flash("📋 คัดลอกแล้ว — วางลงเซลล์ชีตได้เลย"); }
    catch { flash("คัดลอกไม่ได้ (เบราว์เซอร์ไม่อนุญาต)"); }
  }
  async function prepareWrite(column: string) {
    if (!editorSrc) return;
    const next = draftCols.find((c) => c.name === column)?.value ?? "";
    const r = await fetch("/train/api/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "diff", tab: editorSrc.tab, key: editorSrc.key, column }) });
    const data = (await r.json()) as { old?: string; error?: string };
    if (!r.ok) { flash(`⚠️ ${data.error ?? r.status}`); return; }
    if ((data.old ?? "") === next) { flash("ค่าตรงกับชีตอยู่แล้ว — ไม่ต้องเขียน"); return; }
    setConfirm({ column, old: data.old ?? "", next });
  }
  async function commitWrite() {
    if (!editorSrc || !confirm) return;
    const { column, old, next } = confirm;
    const r = await fetch("/train/api/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "commit", tab: editorSrc.tab, key: editorSrc.key, column, newValue: next, expectedOld: old }) });
    const data = (await r.json()) as { status?: string; current?: string; error?: string };
    if (r.status === 409) { flash("🔶 ชีตถูกแก้ระหว่างนั้น — รีเฟรช diff ใหม่"); setConfirm({ column, old: data.current ?? "", next }); return; }
    if (!r.ok) { flash(`⚠️ ${data.error ?? "เขียนไม่ได้"}`); setConfirm(null); return; }
    // สำเร็จ → เคลียร์ overlay ของเซลล์นั้น (เทิร์นถัดไปเห็นของจริงใหม่)
    setOverlay((prev) => prev.filter((o) => !(o.tab === editorSrc.tab && o.key === editorSrc.key && o.column === column)));
    setConfirm(null); flash("✅ เขียนลงชีตแล้ว + จด TRAIN_LOG");
  }

  if (authed === null) return <main style={S.page} />;
  if (!authed) {
    return (
      <main style={S.page}>
        <div style={S.loginBox}>
          <b>🔒 T-STUDIO · ห้องซ้อมเทรนปลาทู</b>
          <input style={S.input} type="password" placeholder="รหัสผ่าน" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
          <button style={S.btn} onClick={login}>เข้าห้องซ้อม</button>
        </div>
      </main>
    );
  }

  const editorSrc = editor ? turns[editor.turnIdx]?.sources[editor.srcIdx] : null;
  const editorOpen = Boolean(editorSrc);
  const sidePanel = editorOpen ? renderEditor() : renderXray();
  const tb: React.CSSProperties = isMobile ? { ...S.toolBtn, minHeight: 46, fontSize: 15, padding: "12px 12px", flex: "1 1 40%" } : S.toolBtn;

  return (
    <main style={S.page}>
      {/* มือถือ: แชทเต็มจอเสมอ (bottom sheet editor ลอยทับ · ไม่ซ่อนแชท) — ซ่อนเฉพาะตอนเปิด X-ray เต็มจอ */}
      <div style={{ ...S.chatCol, display: isMobile && showX ? "none" : "flex" }}>
        <header style={S.header}>
          <span>🐟 ปลาทู (ห้องซ้อม)</span>
          <span style={{ fontSize: 12, fontWeight: 400 }}>{busy ? "กำลังคิด…" : overlay.length > 0 ? `draft ${overlay.length}` : "sandbox"}</span>
        </header>
        <div ref={chatRef} style={S.chat}>
          {turns.length === 0 && sys.length === 0 && <div style={S.sysB}>ทักปลาทูได้เลย · แตะบอลลูนบอทเพื่อดูที่มา + แก้ (draft)</div>}
          {turns.map((t, ti) => (
            <div key={ti} style={{ display: "contents" }}>
              <div style={S.userB}>{t.user}</div>
              {t.bot.map((b, bi) => (
                <div key={bi} style={{ ...S.botB, ...(t.sources.length ? S.botEditable : {}) }} onClick={() => t.sources.length && openEditor(ti)} title={t.sources.length ? "แตะเพื่อดูที่มา + แก้" : ""}>
                  {b.text}
                  {t.sources.length > 0 && bi === t.bot.length - 1 && <div style={{ fontSize: 10, color: "#8aa", marginTop: 3 }}>✎ {t.sources.map((s) => s.label).join(" + ")}</div>}
                </div>
              ))}
              {t.dropped.map((d, di) => (
                <div key={`d${di}`} style={S.dropB} title={`บอลลูนนี้ถูกทิ้ง เพราะตัวแปร ${d.vars.join(" ")} resolve ไม่ได้`}>
                  {d.text}<div style={{ fontSize: 10, textDecoration: "none", color: "#b00", marginTop: 2 }}>⚠︎ ทิ้งบอลลูน: {d.vars.join(" ")} resolve ไม่ได้</div>
                </div>
              ))}
            </div>
          ))}
          {sys.map((s, i) => <div key={`s${i}`} style={S.sysB}>{s}</div>)}
        </div>
        <div style={S.toolRow}>
          <button style={tb} onClick={() => fileRef.current?.click()} disabled={busy}>📎 แนบรูป</button>
          <button style={tb} onClick={sendSampleSlip} disabled={busy}>🧾 สลิปตัวอย่าง</button>
          <button style={tb} onClick={cronSim} disabled={busy}>⚙️ ติ๊ก M + cron</button>
          <button style={tb} onClick={reset} disabled={busy}>🔄 reset</button>
          {isMobile && <button style={{ ...tb, background: "#eef3ff", borderColor: "#b9cdf0" }} onClick={() => setShowX(true)}>🔬 X-ray</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && sendImage(e.target.files[0])} />
        </div>
        <div style={S.inputRow}>
          <input style={S.input} placeholder="พิมพ์ข้อความลูกค้า…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()} disabled={busy} />
          <button style={S.btn} onClick={send} disabled={busy}>ส่ง</button>
        </div>
      </div>

      {/* Desktop = side panel · Mobile = bottom sheet (editor) / full (x-ray) */}
      {!isMobile && <aside style={S.side}>{sidePanel}</aside>}
      {isMobile && editorOpen && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 19 }} onClick={closeEditor} />
          <div style={{ ...S.sheet, transform: `translateY(${sheetDragY}px)`, transition: sheetDragY === 0 ? "transform .2s" : "none" }}>
            <div
              style={{ padding: "2px 0 10px", cursor: "grab", touchAction: "none" }}
              onTouchStart={(e) => { dragStart.current = e.touches[0].clientY; }}
              onTouchMove={(e) => setSheetDragY(Math.max(0, e.touches[0].clientY - dragStart.current))}
              onTouchEnd={() => { if (sheetDragY > 110) closeEditor(); else setSheetDragY(0); }}
            >
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "#ccc", margin: "0 auto" }} />
            </div>
            {renderEditor()}
          </div>
        </>
      )}
      {isMobile && showX && !editorOpen && <aside style={{ ...S.side, width: "100%", borderLeft: "none" }}><button style={{ ...tb, width: "100%", marginBottom: 8 }} onClick={() => setShowX(false)}>← กลับแชท</button>{renderXray()}</aside>}

      {confirm && editorSrc && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 16 }} onClick={() => setConfirm(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 18, maxWidth: 520, width: "100%", maxHeight: "85dvh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <b style={{ color: "#06735c" }}>ยืนยันเขียนกลับชีตจริง</b>
            <div style={{ fontSize: 12, color: "#666", margin: "6px 0" }}><span style={S.chip}>{editorSrc.tab}</span><span style={S.chip}>{editorSrc.keyCol} = {editorSrc.key}</span><span style={S.chip}>{confirm.column}</span></div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>ค่าเก่าในชีตตอนนี้</div>
            <pre style={{ ...S.pre, background: "#fff0f0" }}>{confirm.old || "(ว่าง)"}</pre>
            <div style={{ fontSize: 12, fontWeight: 600 }}>ค่าใหม่ (draft)</div>
            <pre style={{ ...S.pre, background: "#eef7f0" }}>{confirm.next || "(ว่าง)"}</pre>
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button style={S.toolBtn} onClick={() => setConfirm(null)}>ยกเลิก</button>
              <button style={{ ...S.btn, padding: "10px 16px" }} onClick={commitWrite}>ยืนยันเขียน</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#333", color: "#fff", padding: "10px 18px", borderRadius: 22, fontSize: 14, zIndex: 50, boxShadow: "0 2px 10px rgba(0,0,0,.3)" }}>{toast}</div>}
    </main>
  );

  function renderEditor() {
    if (!editorSrc) return null;
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b style={{ color: "#06735c" }}>✎ แก้ที่มาของบอลลูน</b>
          <button style={{ ...S.toolBtn, ...(isMobile ? { minHeight: 44, fontSize: 20, padding: "6px 16px" } : {}) }} onClick={closeEditor}>✕</button>
        </div>
        {sheetChanged && (
          <div style={{ background: "#fff4d6", color: "#8a6d00", borderRadius: 8, padding: "6px 10px", fontSize: 12, margin: "6px 0" }}>
            ⚠︎ ชีตถูกแก้แล้วหลังเทิร์นนี้ — ช่องด้านล่างคือ &quot;ค่าสดจากชีต&quot; ไม่ใช่ค่าตอนบอทตอบ
          </div>
        )}
        {turns[editor!.turnIdx].sources.length > 1 && (
          <div style={{ margin: "6px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {turns[editor!.turnIdx].sources.map((s, i) => (
              <button key={i} style={{ ...tb, ...(i === editor!.srcIdx ? { background: "#d5f0e0", fontWeight: 700 } : {}) }} onClick={() => openEditor(editor!.turnIdx, i)}>{s.label}</button>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: "#666", margin: "6px 0" }}>
          <span style={S.chip}>{editorSrc.tab}</span>
          <span style={S.chip}>{editorSrc.keyCol} = {editorSrc.key}</span>
        </div>
        {draftCols.map((c) => {
          const hasBlock = (preview?.lint ?? []).some((f) => f.level === "block");
          return (
            <div key={c.name} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{c.name} <span style={{ color: "#999", fontWeight: 400 }}>(ดิบ ก่อน resolve)</span></div>
              <textarea style={{ ...S.ta, ...(isMobile ? { minHeight: 90, fontSize: 16 } : {}) }} value={c.value} onChange={(e) => editCol(c.name, e.target.value)} />
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button style={tb} onClick={() => copyCol(c.value)}>📋 Copy</button>
                <button
                  style={{ ...tb, ...(hasBlock ? { opacity: 0.4, cursor: "not-allowed" } : { background: "#e7f6ec", borderColor: "#9dd6b3" }) }}
                  onClick={() => !hasBlock && prepareWrite(c.name)}
                  disabled={hasBlock}
                  title={hasBlock ? "lint แดง — แก้ให้ผ่านก่อนเขียน (copy ยังได้)" : "เขียนค่านี้กลับชีตจริง"}
                >💾 เขียนลงชีต</button>
              </div>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 6, margin: "6px 0", flexWrap: "wrap" }}>
          <button style={{ ...S.btn, ...(isMobile ? { flex: "1 1 100%", minHeight: 48 } : { padding: "10px 14px" }) }} onClick={replayTurn} disabled={busy}>▶ เล่นข้อความนี้ใหม่</button>
          <button style={tb} onClick={clearThisDraft}>ล้าง draft แถวนี้</button>
        </div>
        {preview && renderPreview(preview)}
        <div style={{ fontSize: 11, color: "#999", marginTop: 10 }}>draft ทับเฉพาะในห้องซ้อม · กด 💾 เพื่อเขียนกลับชีตจริง</div>
      </div>
    );
  }

  function renderPreview(pv: PreviewResult) {
    if (pv.error) return <div style={S.lintBlock}>{pv.error}</div>;
    return (
      <div>
        {pv.lint.length > 0 && (
          <div style={{ margin: "6px 0" }}>
            {pv.lint.map((f, i) => <div key={i} style={f.level === "block" ? S.lintBlock : S.lintWarn}>{f.level === "block" ? "🔴 " : "⚠︎ "}{f.message}</div>)}
          </div>
        )}
        <div style={S.title}>พรีวิวบอลลูน (ลูกค้าจะเห็น)</div>
        {pv.segments.length === 0 && <div style={{ fontSize: 12, color: "#999" }}>(ว่าง)</div>}
        {pv.segments.map((s, i) => (
          <div key={i} style={s.dropped ? S.segDrop : S.segOk}>
            {s.text}{s.dropped && <div style={{ fontSize: 10, textDecoration: "none", color: "#b00" }}>⚠︎ ถูกทิ้ง: {s.vars.join(" ")} resolve ไม่ได้</div>}
          </div>
        ))}
        {pv.vars.length > 0 && (
          <>
            <div style={S.title}>ตัวแปรที่ใช้</div>
            {pv.vars.map((v, i) => (
              <div key={i} style={{ fontSize: 12, padding: "2px 0" }}>
                <code>{v.token}</code> → {v.unknown ? <span style={{ color: "#a10000" }}>ไม่รู้จัก (พิมพ์ผิด?)</span> : v.resolved ? <b>{v.value || "(ว่าง)"}</b> : <span style={{ color: "#b00" }}>resolve ไม่ได้ในสถานะนี้</span>}
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  function renderXray() {
    return (
      <div>
        <div style={S.title}>🔬 X-ray เทิร์นล่าสุด</div>
        {!xray && <div>ยังไม่มีเทิร์น</div>}
        {xray && (
          <>
            <div style={S.title}>ประตู</div>
            <pre style={S.pre}>{`${xray.stage ?? "-"} · ${xray.stageName ?? ""}\nfunnel: ${xray.funnel ?? "-"} · human_mode: ${xray.humanMode}`}</pre>
            <div style={S.title}>pending order</div>
            <pre style={S.pre}>{JSON.stringify(xray.pendingOrder ?? {}, null, 1)}</pre>
            <div style={S.title}>ธง delivered_steps</div>
            <pre style={S.pre}>{JSON.stringify(xray.deliveredSteps ?? [])}</pre>
            <div style={S.title}>ผล gate</div>
            <pre style={S.pre}>{JSON.stringify(xray.gate ?? "-", null, 1)}</pre>
            <div style={S.title}>verbatim / FAQ / OBJ</div>
            <pre style={S.pre}>{JSON.stringify(xray.verbatim ?? [], null, 1)}</pre>
            {Array.isArray(xray.blocked) && (xray.blocked as unknown[]).length > 0 && (
              <><div style={S.title}>⚠️ blocked / extraction</div><pre style={S.pre}>{JSON.stringify({ blocked: xray.blocked, extraction: xray.extraction, degraded: xray.degraded }, null, 1)}</pre></>
            )}
          </>
        )}
        {orderRows.length > 0 && (
          <>
            <div style={S.title}>🧾 แถว &quot;จะถูกเขียน&quot; (ไม่เขียนจริง)</div>
            {orderRows.map((r, i) => <pre key={i} style={S.pre}>{Object.entries(r).filter(([, v]) => v !== "").map(([k, v]) => `${k}: ${v}`).join("\n")}</pre>)}
          </>
        )}
        {adminPushes.length > 0 && (
          <>
            <div style={S.title}>📣 &quot;จะยิงกลุ่ม&quot; (ไม่ยิงจริง)</div>
            {adminPushes.map((p, i) => <pre key={i} style={S.pre}>{p.text ?? "[มีรูปแนบ]"}</pre>)}
          </>
        )}
      </div>
    );
  }
}
