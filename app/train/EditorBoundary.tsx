"use client";

import React, { Component, ReactNode } from "react";
import { boundaryStateFromError } from "@/lib/train/ui-safety";

/**
 * app/train/EditorBoundary.tsx — ครอบเฉพาะแผง editor / bottom sheet
 * 🔴 พังในอนาคต = เด้งเฉพาะแผงนี้ (ข้อความสั้น + ปุ่มปิด) · หน้าแชท (อยู่นอก boundary) ไม่ล้ม ประวัติซ้อมอยู่ครบ
 * เขียนด้วย createElement (ไม่มี JSX) → import ทดสอบใน vitest (node) ได้ตรงๆ
 */

interface Props { children: ReactNode; onClose: () => void }
interface State { hasError: boolean; message: string }

export class EditorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: unknown): State {
    return boundaryStateFromError(err);
  }
  componentDidCatch(err: unknown) {
    console.error(JSON.stringify({ scope: "train-ui", where: "editor-panel", error: String(err).slice(0, 300) }));
  }
  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return React.createElement(
      "div",
      { style: { padding: 14, background: "#fff0f0", border: "1px solid #f0a0a0", borderRadius: 10, color: "#a10000", fontSize: 13 } },
      React.createElement("b", { key: "t" }, "⚠️ แผงแก้ไขมีปัญหา — ปิดแล้วลองใหม่ (แชทยังอยู่)"),
      React.createElement("div", { key: "m", style: { margin: "6px 0", fontSize: 12, wordBreak: "break-word" } }, this.state.message),
      React.createElement(
        "button",
        { key: "b", style: { padding: "10px 16px", borderRadius: 10, border: "1px solid #d08080", background: "#fff", cursor: "pointer", minHeight: 44 }, onClick: () => { this.setState({ hasError: false, message: "" }); this.props.onClose(); } },
        "ปิดแผง",
      ),
    );
  }
}

/** เรียก render() ของ editor "ภายใน" child ของ boundary → error ตอน render ถูก boundary จับ (ไม่ใช่ในสโคป parent) */
export function EditorRenderer({ render }: { render: () => ReactNode }): ReactNode {
  return render();
}
