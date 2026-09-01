"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { EditorBoundary, EditorRenderer } from "./EditorBoundary";
import { rewriteSafety } from "@/lib/train/rewrite-safety";

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
  /** UX: echo user ทันทีที่ส่ง · true = รอบอทตอบ (โชว์ typing) */
  pending?: boolean;
  /** X-ray ของเทิร์นนี้ (เก็บใน memory ของ session · ดูย้อนหลังได้ตลอด · ไม่ persist) */
  xray?: Record<string, unknown> | null;
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
interface MgmtRow { key: string; status: string; active: boolean; preview: string }
interface MgmtData { header: string[]; keyCol: string | null; statusCol: string | null; hasStatusCol: boolean; editableCols: string[]; rows: MgmtRow[]; suggestedKey: string | null }
interface AsstCol { name: string; value: string }
interface AsstProposal { id: number; action: "add-row" | "edit-row"; tab: string; key: string; cols: AsstCol[]; note: string; done?: boolean }

const OVERLAY_KEY = "train-overlay-v1";
// 🔴 D-72a: label = ชื่อแท็บในชีตเป๊ะ — เจ้าของเห็นชื่อไหนในหน้านี้ ก็เปิดแท็บนั้นในชีตได้เลย
//    (เดิม label เป็น FAQ/ประตูขาย/ตัวแปร = ชื่อที่หาในชีตไม่เจอ เสียเวลาเปล่า — เจตนาหลักของ D-72)
const MGMT_TABS: { tab: string; label: string }[] = [
  { tab: "Knowledge", label: "Knowledge" },
  { tab: "Steps", label: "Steps" },
  { tab: "Vars", label: "Vars" },
];

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
  const [xrayTurn, setXrayTurn] = useState<number | null>(null); // ปักหมุดดู X-ray เทิร์นย้อนหลัง (null = เทิร์นล่าสุด)
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
  const [tracking, setTracking] = useState("TH1234567890");
  const dragStart = useRef(0);
  const [showX, setShowX] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // T2-ค: จัดการแถวคลังความรู้
  const [mgmtOpen, setMgmtOpen] = useState(false);
  const [mgmtTab, setMgmtTab] = useState("Knowledge");
  const [mgmtData, setMgmtData] = useState<MgmtData | null>(null);
  const [mgmtBusy, setMgmtBusy] = useState(false);
  const [addForm, setAddForm] = useState<Record<string, string> | null>(null);
  const [addLint, setAddLint] = useState<LintFinding[]>([]);
  // D-59: ผู้ช่วยเทรน
  const [asstOpen, setAsstOpen] = useState(false);
  const [asstMsgs, setAsstMsgs] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [asstInput, setAsstInput] = useState("");
  const [asstBusy, setAsstBusy] = useState(false);
  const [proposals, setProposals] = useState<AsstProposal[]>([]);
  const [liveKeys, setLiveKeys] = useState<Record<string, Set<string>>>({});
  const [skipKeys, setSkipKeys] = useState<Set<string>>(new Set()); // D-60: แถวที่จัดการ/ข้าม (ไม่วนเสนอซ้ำ)
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

  // เติมผลลงเทิร์นที่ค้าง (pending) ตัวสุดท้าย — เทิร์นเรียงตามลำดับ + busy กันยิงซ้อน จึงชี้ตัวท้ายได้
  function fillPendingTurn(data: TurnResult) {
    const bot = data.bubbles.flatMap((b) => b.messages.map((m) => m.type === "text" ? { text: m.text ?? "" } : { text: `🖼 [รูป] ${m.originalContentUrl ?? ""}`, image: true }));
    setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, bot, sources: data.sources ?? [], dropped: data.droppedBubbles ?? [], pending: false, xray: data.xray } : t)));
    setXray(data.xray); setXrayTurn(null); setOrderRows(data.orderRows ?? []); setAdminPushes(data.adminPushes ?? []);
  }
  const clearPending = () => setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 && t.pending ? { ...t, pending: false } : t)));

  const callTurn = useCallback(async (body: Record<string, unknown>, user: string, userImage?: boolean) => {
    setBusy(true);
    setTurns((prev) => [...prev, { user, userImage, bot: [], sources: [], dropped: [], pending: true }]); // optimistic: echo ทันที + typing
    try {
      const r = await fetch("/train/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, overlay, ...body }) });
      const data = (await r.json()) as TurnResult;
      if (!r.ok) { setSys((p) => [...p, `⚠️ ${data.error ?? r.status}`]); clearPending(); return; }
      fillPendingTurn(data);
    } catch (e) { setSys((p) => [...p, `⚠️ ${String(e)}`]); clearPending(); }
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
  async function cronSim(tracking?: string) {
    if (busy) return; setBusy(true);
    setSys((p) => [...p, tracking ? `📦 จำลอง: กรอกเลขพัสดุ ${tracking} + cron → แจ้งลูกค้า` : "⚙️ จำลอง: ติ๊ก M + cron แจกเลข"]);
    try {
      const r = await fetch("/train/api/cron", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, tracking }) });
      const data = (await r.json()) as TurnResult;
      if (r.ok) {
        setXray(data.xray); setXrayTurn(null); setOrderRows(data.orderRows ?? []); setAdminPushes(data.adminPushes ?? []);
        // D-50: ข้อความแจ้งพัสดุ push เข้า collector (bubbles) → โชว์ในแชท
        const bot = (data.bubbles ?? []).flatMap((b) => b.messages.map((m) => m.type === "text" ? { text: m.text ?? "" } : { text: `🖼 [รูป]`, image: true }));
        if (bot.length > 0) setTurns((prev) => [...prev, { user: "⚙️ (ระบบ: cron แจ้งพัสดุ)", bot, sources: [], dropped: [], xray: data.xray }]);
      }
    } finally { setBusy(false); }
  }
  async function reset() {
    if (busy) return; setBusy(true);
    await fetch("/train/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }) });
    setTurns([]); setSys(["🔄 ล้างความจำลูกค้าจำลองแล้ว"]); setXray(null); setXrayTurn(null); setOrderRows([]); setAdminPushes([]); setEditor(null); setPreview(null); setBusy(false);
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

  // ---- T2-ค: จัดการแถวคลังความรู้ (list · เพิ่มแถว draft · live↔draft · ทดสอบ draft ในห้องซ้อม) ----
  const loadRows = useCallback(async (tab: string) => {
    setMgmtBusy(true); setAddForm(null); setAddLint([]);
    try {
      const r = await fetch("/train/api/rows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tab }) });
      if (r.ok) setMgmtData((await r.json()) as MgmtData); else setMgmtData(null);
    } finally { setMgmtBusy(false); }
  }, []);
  function openMgmt() { setMgmtOpen(true); loadRows(mgmtTab); }
  function switchMgmtTab(tab: string) { setMgmtTab(tab); loadRows(tab); }

  async function toggleRowStatus(key: string, toStatus: "live" | "draft") {
    const verb = toStatus === "live" ? "เผยแพร่ (live)" : "ปิดชั่วคราว (draft)";
    if (!window.confirm(`${verb} แถว "${key}" ในแท็บ ${mgmtTab}?\n${toStatus === "live" ? "ลูกค้าจริงจะเริ่มเห็นแถวนี้" : "แถวนี้จะถูกซ่อนจากลูกค้าจริง (แต่ยังทดสอบในห้องซ้อมได้)"}`)) return;
    const r = await fetch("/train/api/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "status", tab: mgmtTab, key, toStatus }) });
    if (r.ok) { flash(`✅ ${verb} แล้ว + จด TRAIN_LOG`); loadRows(mgmtTab); }
    else { const d = await r.json().catch(() => ({})); flash(`⚠️ ${d.error ?? "สลับสถานะไม่ได้"}`); }
  }

  function openAddForm() {
    if (!mgmtData) return;
    if (!mgmtData.statusCol) { flash("🔴 แท็บนี้ไม่มีคอลัมน์สถานะ (status/สถานะ) — เพิ่มแถวไม่ได้ (กันแถวใหม่ขึ้นหน้าร้านทันที)"); return; }
    const init: Record<string, string> = {};
    for (const h of mgmtData.header) if (h && h !== mgmtData.statusCol) init[h] = "";
    if (mgmtData.keyCol && mgmtData.suggestedKey) init[mgmtData.keyCol] = mgmtData.suggestedKey;
    setAddForm(init); setAddLint([]);
  }
  async function submitAdd() {
    if (!addForm) return;
    setMgmtBusy(true); setAddLint([]);
    try {
      const r = await fetch("/train/api/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "add-row", tab: mgmtTab, cols: addForm }) });
      const d = (await r.json()) as { status?: string; lint?: LintFinding[]; message?: string; error?: string };
      if (r.ok && d.status === "ok") { flash("✅ เพิ่มแถว (draft) แล้ว — ทดสอบในห้องซ้อมก่อนเผยแพร่"); setAddForm(null); loadRows(mgmtTab); return; }
      if (d.status === "lint") { setAddLint(d.lint ?? []); return; }
      const msg: Record<string, string> = {
        dup: "key นี้มีอยู่แล้ว — เปลี่ยน key ใหม่", no_status_col: "แท็บนี้ไม่มีคอลัมน์ 'สถานะ' — เพิ่มไม่ได้",
        key_invalid: d.message ?? "key ไม่ถูกต้อง", funnel: d.message ?? "funnel_stage ไม่ถูกต้อง", not_found: "โหลดแท็บไม่ได้",
      };
      flash(`⚠️ ${msg[d.status ?? ""] ?? d.error ?? "เพิ่มแถวไม่ได้"}`);
    } finally { setMgmtBusy(false); }
  }

  function testDraftInSandbox(key: string) {
    // overlay สถานะ→live เฉพาะแถวนี้ในห้องซ้อม (prod ยังกรอง draft ทิ้ง) + pre-fill ข้อความลูกค้าที่เกี่ยว
    const sCol = mgmtData?.statusCol; // ชื่อจริง (FAQ="status" · อื่น="สถานะ") — overlay ต้องตรงชื่อชีต
    if (!sCol) { flash("แท็บนี้ไม่มีคอลัมน์สถานะ — ทดสอบ draft ไม่ได้"); return; }
    setOverlay((prev) => {
      const rest = prev.filter((o) => !(o.tab === mgmtTab && o.key === key && o.column === sCol));
      return [...rest, { tab: mgmtTab, key, column: sCol, value: "live" }];
    });
    if (mgmtTab === "Knowledge") setInput(key); // FAQ key = คำถาม → เติมให้เลย
    setMgmtOpen(false);
    flash(mgmtTab === "Knowledge" ? "▶ ใส่คำถามให้แล้ว — กดส่งเพื่อทดสอบ draft (ห้องซ้อมเห็น live)" : "▶ draft พร้อมทดสอบ — พิมพ์ข้อความที่จะกระตุ้นแถวนี้ (ห้องซ้อมเห็น live)");
  }

  // ---- D-59: ผู้ช่วยเทรน (แชท AI → proposal → ยืนยันผ่านเส้นทาง D-57) ----
  const HDRS = { "content-type": "application/json" };
  async function sendAsst() {
    const text = asstInput.trim();
    if (!text || asstBusy) return;
    if (text.includes("เกลา")) flash("⚠️ โหมดเกลาเสียง: แก้แถว live มีผลลูกค้าจริง ~1 นาที — เกลาทีละไม่กี่แถวแล้วดูผลจริงก่อนไล่ทั้งแท็บ");
    const next: { role: "user" | "assistant"; text: string }[] = [...asstMsgs, { role: "user", text }];
    setAsstMsgs(next); setAsstInput(""); setAsstBusy(true); setProposals([]);
    try {
      const r = await fetch("/train/api/assistant", { method: "POST", headers: HDRS, body: JSON.stringify({ messages: next, excludeKeys: [...skipKeys] }) });
      if (r.status === 401 || r.status === 404) { setAuthed(false); return; }
      const d = (await r.json()) as { reply?: string; proposals?: { action: "add-row" | "edit-row"; tab: string; key: string; cols: Record<string, string>; note: string }[]; error?: string };
      setAsstMsgs((m) => [...m, { role: "assistant", text: d.reply ?? d.error ?? "(ไม่มีคำตอบ)" }]);
      const props: AsstProposal[] = (d.proposals ?? []).map((p, i) => ({ id: Date.now() + i, action: p.action, tab: p.tab, key: p.key, note: p.note, cols: Object.entries(p.cols ?? {}).map(([name, value]) => ({ name, value: String(value) })) }));
      setProposals(props);
      for (const tab of [...new Set(props.filter((p) => p.action === "edit-row").map((p) => p.tab))]) {
        const rr = await fetch("/train/api/rows", { method: "POST", headers: HDRS, body: JSON.stringify({ tab }) });
        if (rr.ok) { const rd = (await rr.json()) as { rows: { key: string; active: boolean }[] }; setLiveKeys((lk) => ({ ...lk, [tab]: new Set(rd.rows.filter((x) => x.active).map((x) => x.key)) })); }
      }
    } catch (e) { setAsstMsgs((m) => [...m, { role: "assistant", text: `⚠️ ${String(e)}` }]); }
    finally { setAsstBusy(false); }
  }
  function editProp(id: number, name: string, value: string) {
    setProposals((ps) => ps.map((p) => (p.id === id ? { ...p, cols: p.cols.map((c) => (c.name === name ? { ...c, value } : c)) } : p)));
  }
  function asstErr(d: { status?: string; lint?: LintFinding[]; message?: string; error?: string }) {
    const lint = (d.lint ?? []).filter((f) => f.level === "block").map((f) => f.message).join(" · ");
    const msg = lint || d.message || (d.status === "dup" ? "key นี้มีอยู่แล้ว" : d.error || "เขียนไม่ได้");
    setAsstMsgs((m) => [...m, { role: "assistant", text: `⚠️ เขียนไม่ได้: ${msg}\n(แก้ในการ์ด หรือบอกให้ผู้ช่วยปรับได้เลยค่ะ)` }]);
  }
  const markHandled = (p: AsstProposal) => setSkipKeys((s) => new Set(s).add(`${p.tab}::${p.key}`));
  function skipProp(p: AsstProposal) { markHandled(p); setProposals((ps) => ps.filter((x) => x.id !== p.id)); flash("ข้ามแถวนี้ (ไม่เสนอซ้ำในรอบนี้)"); }
  async function confirmProp(p: AsstProposal) {
    const cols = Object.fromEntries(p.cols.map((c) => [c.name, c.value]));
    if (p.action === "add-row") {
      const r = await fetch("/train/api/write", { method: "POST", headers: HDRS, body: JSON.stringify({ mode: "add-row", tab: p.tab, cols, origin: "ai" }) });
      const d = await r.json();
      if (r.ok && d.status === "ok") { setProposals((ps) => ps.map((x) => (x.id === p.id ? { ...x, done: true } : x))); markHandled(p); flash("✅ เพิ่ม draft แล้ว — ทดสอบก่อนเผยแพร่"); return; }
      asstErr(d);
    } else {
      // D-60: ดึงค่าเก่า → เตือนถ้า rewrite ทำ {ตัวแปร} หาย/ตัวเลขเปลี่ยน (โหมดเกลาเสียงห้ามเปลี่ยนข้อเท็จจริง)
      const diffs: { col: string; old: string; next: string }[] = [];
      for (const c of p.cols) {
        const dr = await fetch("/train/api/write", { method: "POST", headers: HDRS, body: JSON.stringify({ mode: "diff", tab: p.tab, key: p.key, column: c.name }) });
        const dd = await dr.json();
        if (!dr.ok) { asstErr(dd); return; }
        diffs.push({ col: c.name, old: dd.old ?? "", next: c.value });
      }
      const warns = diffs.flatMap((d) => { const s = rewriteSafety(d.old, d.next); return [...(s.droppedVars.length ? [`${d.col}: {ตัวแปร} หาย ${s.droppedVars.join(" ")}`] : []), ...(s.changedNumbers ? [`${d.col}: ตัวเลขเปลี่ยน`] : [])]; });
      if (warns.length > 0 && !window.confirm(`⚠️ รีไรต์นี้อาจเปลี่ยนข้อเท็จจริง:\n${warns.join("\n")}\nยืนยันเขียนต่อ?`)) return;
      for (const d of diffs) {
        const cr = await fetch("/train/api/write", { method: "POST", headers: HDRS, body: JSON.stringify({ mode: "commit", tab: p.tab, key: p.key, column: d.col, newValue: d.next, expectedOld: d.old, origin: "ai" }) });
        const cd = await cr.json();
        if (!cr.ok) { asstErr(cd); return; }
      }
      setProposals((ps) => ps.map((x) => (x.id === p.id ? { ...x, done: true } : x))); markHandled(p); flash("✅ แก้แถวแล้ว + จด TRAIN_LOG");
    }
  }
  async function testProposal(tab: string, key: string) {
    const rr = await fetch("/train/api/rows", { method: "POST", headers: HDRS, body: JSON.stringify({ tab }) });
    if (!rr.ok) return;
    const rd = (await rr.json()) as { statusCol: string | null };
    if (!rd.statusCol) { flash("แท็บนี้ไม่มีคอลัมน์สถานะ — ทดสอบไม่ได้"); return; }
    setOverlay((prev) => [...prev.filter((o) => !(o.tab === tab && o.key === key && o.column === rd.statusCol)), { tab, key, column: rd.statusCol!, value: "live" }]);
    if (tab === "Knowledge") setInput(key);
    setAsstOpen(false);
    flash("▶ draft พร้อมทดสอบ (ห้องซ้อมเห็น live · prod ยังกรอง draft)");
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

  // 🔴 tb ต้องประกาศ "ก่อน" ถูกอ้างใน renderEditor/JSX (TDZ fix — เดิมประกาศหลัง sidePanel ที่เรียก renderEditor
  //    → ตอนเปิด editor เกิด Reference: Cannot access 'tb' before initialization → ล้มทั้งหน้าบนมือถือ)
  const tb: React.CSSProperties = isMobile ? { ...S.toolBtn, minHeight: 46, fontSize: 15, padding: "12px 12px", flex: "1 1 40%" } : S.toolBtn;
  const editorSrc = editor ? turns[editor.turnIdx]?.sources[editor.srcIdx] : null;
  const editorOpen = Boolean(editorSrc);
  // แผง editor ครอบด้วย EditorBoundary + render ผ่าน EditorRenderer (child ของ boundary) → error ตอน render ถูกจับ ไม่ล้มหน้าแชท
  const editorPanel = (
    <EditorBoundary onClose={closeEditor}>
      <EditorRenderer render={renderEditor} />
    </EditorBoundary>
  );

  return (
    <main style={S.page}>
      <style>{"@keyframes tb-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}"}</style>
      {/* มือถือ: แชทเต็มจอเสมอ (bottom sheet editor ลอยทับ · ไม่ซ่อนแชท) — ซ่อนเฉพาะตอนเปิด X-ray เต็มจอ */}
      <div style={{ ...S.chatCol, display: isMobile && showX ? "none" : "flex" }}>
        <header style={S.header}>
          <span>🐟 ปลาทู · 🧪 ห้องซ้อม</span>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={() => setAsstOpen(true)} style={{ color: "#fff", background: "rgba(0,0,0,.18)", border: "none", padding: "5px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>🤖 ผู้ช่วยเทรน</button>
            <button onClick={openMgmt} style={{ color: "#fff", background: "rgba(0,0,0,.18)", border: "none", padding: "5px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>📚 คลังความรู้</button>
            <a href="/train/dashboard" style={{ color: "#fff", textDecoration: "none", background: "rgba(0,0,0,.18)", padding: "4px 10px", borderRadius: 8, fontSize: 12 }}>🔴 ร้านจริง →</a>
            <span style={{ fontSize: 12, fontWeight: 400 }}>{busy ? "กำลังคิด…" : overlay.length > 0 ? `draft ${overlay.length}` : "sandbox"}</span>
          </span>
        </header>
        <div ref={chatRef} style={S.chat}>
          {turns.length === 0 && sys.length === 0 && <div style={S.sysB}>ทักปลาทูได้เลย · แตะบอลลูนบอทเพื่อดูที่มา + แก้ (draft)</div>}
          {turns.map((t, ti) => (
            <div key={ti} style={{ display: "contents" }}>
              <div style={S.userB}>{t.user}</div>
              {t.bot.map((b, bi) => (
                <div key={bi} style={{ ...S.botB, ...(t.sources.length ? S.botEditable : {}) }} onClick={() => t.sources.length && openEditor(ti)} title={t.sources.length ? "แตะเพื่อดูที่มา + แก้" : ""}>
                  {b.text}
                  {bi === t.bot.length - 1 && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
                      {t.sources.length > 0 && <span style={{ fontSize: 10, color: "#8aa" }}>✎ {t.sources.map((s) => s.label).join(" + ")}</span>}
                      {t.xray && (
                        <span
                          style={{ fontSize: 11, color: xrayTurn === ti ? "#06735c" : "#8aa", cursor: "pointer", fontWeight: xrayTurn === ti ? 700 : 400 }}
                          onClick={(e) => { e.stopPropagation(); setXrayTurn(ti); if (isMobile) setShowX(true); }}
                          title="ดู X-ray ของเทิร์นนี้"
                        >🔬 X-ray</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {t.dropped.map((d, di) => (
                <div key={`d${di}`} style={S.dropB} title={`บอลลูนนี้ถูกทิ้ง เพราะตัวแปร ${d.vars.join(" ")} resolve ไม่ได้`}>
                  {d.text}<div style={{ fontSize: 10, textDecoration: "none", color: "#b00", marginTop: 2 }}>⚠︎ ทิ้งบอลลูน: {d.vars.join(" ")} resolve ไม่ได้</div>
                </div>
              ))}
              {t.pending && (
                <div style={{ ...S.botB, cursor: "default", display: "flex", gap: 4, alignItems: "center", padding: "10px 12px" }} aria-label="ปลาทูกำลังพิมพ์">
                  {[0, 1, 2].map((n) => <span key={n} style={{ width: 7, height: 7, borderRadius: "50%", background: "#9aa", display: "inline-block", animation: "tb-blink 1.2s infinite", animationDelay: `${n * 0.2}s` }} />)}
                </div>
              )}
            </div>
          ))}
          {sys.map((s, i) => <div key={`s${i}`} style={S.sysB}>{s}</div>)}
        </div>
        <div style={S.toolRow}>
          <button style={tb} onClick={() => fileRef.current?.click()} disabled={busy}>📎 แนบรูป</button>
          <button style={tb} onClick={sendSampleSlip} disabled={busy}>🧾 สลิปตัวอย่าง</button>
          <button style={tb} onClick={() => cronSim()} disabled={busy}>⚙️ ติ๊ก M + cron</button>
          <input style={{ ...tb, minWidth: 120, padding: "8px 10px" }} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="เลขพัสดุจำลอง" />
          <button style={tb} onClick={() => cronSim(tracking.trim() || "TH0000")} disabled={busy}>📦 กรอกพัสดุ + cron</button>
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
      {!isMobile && <aside style={S.side}>{editorOpen ? editorPanel : renderXray()}</aside>}
      {isMobile && editorOpen && (
        <>
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 19 }} onClick={closeEditor} />
          <div style={{ ...S.sheet, transform: `translateY(${sheetDragY}px)`, transition: sheetDragY === 0 ? "transform .2s" : "none" }}>
            <div
              style={{ padding: "2px 0 10px", cursor: "grab", touchAction: "none" }}
              onTouchStart={(e) => { const t = e.touches[0]; if (t) dragStart.current = t.clientY; }}
              onTouchMove={(e) => { const t = e.touches[0]; if (t) setSheetDragY(Math.max(0, t.clientY - dragStart.current)); }}
              onTouchEnd={() => { if (sheetDragY > 110) closeEditor(); else setSheetDragY(0); }}
            >
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "#ccc", margin: "0 auto" }} />
            </div>
            {editorPanel}
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
      {asstOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 46, padding: isMobile ? 0 : 16 }} onClick={() => setAsstOpen(false)}>
          <div style={{ background: "#fff", borderRadius: isMobile ? 0 : 14, width: isMobile ? "100%" : 640, maxWidth: "100%", height: isMobile ? "100dvh" : "88dvh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "12px 14px", background: "#06735c", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b>🤖 ผู้ช่วยเทรน <span style={{ fontWeight: 400, fontSize: 12 }}>(ช่วยร่าง/แก้คลังความรู้ · เจ้าของยืนยันเอง)</span></b>
              <button style={{ ...S.toolBtn, background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.5)" }} onClick={() => setAsstOpen(false)}>✕ ปิด</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {asstMsgs.length === 0 && <div style={S.sysB}>บอกได้เลยค่ะ เช่น &quot;เพิ่ม FAQ ว่าส่งต่างจังหวัดกี่วัน&quot; หรือ &quot;แก้คำตอบเรื่องการเก็บรักษา&quot; · เรื่องสุขภาพผู้ช่วยจะเสนอเป็นประตูส่งต่อแอดมินให้ค่ะ</div>}
              {asstMsgs.map((m, i) => <div key={i} style={m.role === "user" ? S.userB : { ...S.botB, cursor: "default" }}>{m.text}</div>)}
              {proposals.map((p) => {
                const isLiveEdit = p.action === "edit-row" && liveKeys[p.tab]?.has(p.key);
                return (
                  <div key={p.id} style={{ border: `1px solid ${p.done ? "#9dd6b3" : "#cfe9d8"}`, borderRadius: 10, padding: 12, background: p.done ? "#eef7f0" : "#f7fdf9" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                      <span style={{ ...S.chip, background: p.action === "add-row" ? "#e7f6ec" : "#fff4d6" }}>{p.action === "add-row" ? "＋ แถวใหม่ (draft)" : "✎ แก้แถวเดิม"}</span>
                      <span style={S.chip}>{p.tab}</span><span style={S.chip}>{p.key}</span>
                    </div>
                    {isLiveEdit && <div style={{ ...S.lintWarn, marginBottom: 6 }}>🔴 แก้แถว live — ผลถึงลูกค้าจริง ~1 นาทีหลังยืนยัน (การแก้ไม่พลิกกลับเป็น draft)</div>}
                    {p.cols.map((c) => (
                      <div key={c.name} style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</div>
                        <textarea style={{ ...S.ta, minHeight: 40 }} value={c.value} disabled={p.done} onChange={(e) => editProp(p.id, c.name, e.target.value)} />
                      </div>
                    ))}
                    {p.note && <div style={{ fontSize: 11, color: "#777", margin: "4px 0" }}>💡 {p.note}</div>}
                    {!p.done ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button style={{ ...S.btn, padding: "8px 12px" }} onClick={() => confirmProp(p)}>{p.action === "add-row" ? "ยืนยันเพิ่ม (draft)" : "ยืนยันแก้"}</button>
                        <button style={{ ...S.toolBtn, padding: "8px 12px" }} onClick={() => skipProp(p)}>ข้าม</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ color: "#1e7e42", fontSize: 13 }}>✅ เขียนแล้ว</span>
                        {p.action === "add-row" && <button style={{ ...S.toolBtn, padding: "6px 10px" }} onClick={() => testProposal(p.tab, p.key)}>▶ ทดสอบในห้องซ้อม</button>}
                      </div>
                    )}
                  </div>
                );
              })}
              {asstBusy && (
                <div style={{ ...S.botB, cursor: "default", alignSelf: "flex-start", display: "flex", gap: 4, alignItems: "center", padding: "10px 12px" }} aria-label="ผู้ช่วยกำลังพิมพ์">
                  {[0, 1, 2].map((n) => <span key={n} style={{ width: 7, height: 7, borderRadius: "50%", background: "#9aa", display: "inline-block", animation: "tb-blink 1.2s infinite", animationDelay: `${n * 0.2}s` }} />)}
                </div>
              )}
            </div>
            <div style={S.inputRow}>
              <input style={S.input} placeholder="พิมพ์บอกผู้ช่วย…" value={asstInput} onChange={(e) => setAsstInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendAsst()} disabled={asstBusy} />
              <button style={S.btn} onClick={sendAsst} disabled={asstBusy}>ส่ง</button>
            </div>
          </div>
        </div>
      )}

      {mgmtOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 45, padding: isMobile ? 0 : 16 }} onClick={() => setMgmtOpen(false)}>
          <div style={{ background: "#fff", borderRadius: isMobile ? 0 : 14, width: isMobile ? "100%" : 640, maxWidth: "100%", height: isMobile ? "100dvh" : "86dvh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "12px 14px", background: "#06735c", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b>📚 คลังความรู้ (จัดการแถว)</b>
              <button style={{ ...S.toolBtn, background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.5)" }} onClick={() => setMgmtOpen(false)}>✕ ปิด</button>
            </div>
            <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid #eee", flexWrap: "wrap" }}>
              {MGMT_TABS.map((t) => (
                <button key={t.tab} style={{ ...S.toolBtn, ...(mgmtTab === t.tab ? { background: "#d5f0e0", fontWeight: 700 } : {}) }} onClick={() => switchMgmtTab(t.tab)}>{t.label}</button>
              ))}
              <span style={{ flex: 1 }} />
              <button style={{ ...S.btn, padding: "8px 12px", fontSize: 13 }} onClick={openAddForm} disabled={mgmtBusy || !mgmtData}>＋ เพิ่มแถว</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 12, fontSize: 13 }}>
              {mgmtBusy && <div style={{ color: "#888" }}>กำลังโหลด…</div>}

              {addForm && mgmtData && (
                <div style={{ border: "1px solid #cfe9d8", borderRadius: 10, padding: 12, marginBottom: 12, background: "#f7fdf9" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <b style={{ color: "#06735c" }}>＋ แถวใหม่ · <span style={{ background: "#fff4d6", color: "#8a6d00", padding: "1px 8px", borderRadius: 8, fontSize: 12 }}>สถานะ: draft (บังคับ)</span></b>
                    <button style={S.toolBtn} onClick={() => setAddForm(null)}>ยกเลิก</button>
                  </div>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>แถวใหม่เกิดเป็น draft เสมอ — ทดสอบในห้องซ้อมก่อน แล้วค่อยกดเผยแพร่ (live)</div>
                  {mgmtData.header.filter((h) => h && h !== mgmtData.statusCol).map((h) => (
                    <div key={h} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
                        {h}{h === mgmtData.keyCol && <span style={{ color: "#06735c" }}> (key)</span>}
                        {mgmtTab === "Steps" && h === "funnel_stage" && <span style={{ color: "#a10000", fontWeight: 400 }}> · ต้องเป็นสเตจที่ถูก (บอทใช้เป็นตาข่าย handoff)</span>}
                      </div>
                      <textarea style={{ ...S.ta, minHeight: mgmtData.editableCols.includes(h) ? 70 : 38 }} value={addForm[h] ?? ""} onChange={(e) => setAddForm({ ...addForm, [h]: e.target.value })} />
                    </div>
                  ))}
                  {addLint.length > 0 && <div style={{ margin: "6px 0" }}>{addLint.map((f, i) => <div key={i} style={f.level === "block" ? S.lintBlock : S.lintWarn}>{f.level === "block" ? "🔴 " : "⚠︎ "}{f.message}</div>)}</div>}
                  <button style={{ ...S.btn, padding: "10px 14px", marginTop: 4 }} onClick={submitAdd} disabled={mgmtBusy}>บันทึกเป็น draft</button>
                </div>
              )}

              {mgmtData && !mgmtData.statusCol && <div style={S.lintWarn}>⚠︎ แท็บนี้ไม่มีคอลัมน์สถานะ (status/สถานะ) — เพิ่มแถว/สลับสถานะไม่ได้ (กันแถวใหม่ขึ้นหน้าร้านทันที)</div>}
              {mgmtData && mgmtData.rows.length === 0 && !mgmtBusy && <div style={{ color: "#888" }}>ยังไม่มีแถว</div>}
              {mgmtData?.rows.map((row) => (
                <div key={row.key} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: 10, background: row.active ? "#e7f6ec" : "#fbe6e6", color: row.active ? "#1e7e42" : "#b00", whiteSpace: "nowrap" }}>{row.active ? "🟢 live" : "🔴 draft"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.key}</div>
                    <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.preview}</div>
                  </div>
                  {!row.active && <button style={{ ...S.toolBtn, padding: "6px 8px", fontSize: 12 }} onClick={() => testDraftInSandbox(row.key)} title="ทดสอบ draft นี้ในห้องซ้อม">▶ ทดสอบ</button>}
                  {mgmtData.hasStatusCol && (
                    <button style={{ ...S.toolBtn, padding: "6px 8px", fontSize: 12 }} onClick={() => toggleRowStatus(row.key, row.active ? "draft" : "live")}>
                      {row.active ? "ปิด (draft)" : "เผยแพร่ (live)"}
                    </button>
                  )}
                </div>
              ))}
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
    // ปักหมุดเทิร์นย้อนหลัง (กด 🔬 ท้ายบอลลูน) → โชว์ของเทิร์นนั้น · ไม่ปัก = เทิร์นล่าสุด
    const pinned = xrayTurn !== null ? turns[xrayTurn] : null;
    const xr = pinned?.xray ?? (xrayTurn !== null ? null : xray);
    return (
      <div>
        <div style={{ ...S.title, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span>🔬 X-ray {pinned ? `เทิร์น #${xrayTurn! + 1}` : "เทิร์นล่าสุด"}</span>
          {pinned && <button style={{ ...S.toolBtn, padding: "2px 8px", fontSize: 11 }} onClick={() => setXrayTurn(null)}>→ ล่าสุด</button>}
        </div>
        {pinned && <div style={{ fontSize: 11, color: "#888", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>ลูกค้า: {pinned.user}</div>}
        {!xr && <div>ยังไม่มีเทิร์น</div>}
        {xr && (() => { const xray = xr; return (
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
        ); })()}
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
