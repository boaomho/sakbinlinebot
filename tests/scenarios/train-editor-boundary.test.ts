import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boundaryStateFromError } from "@/lib/train/ui-safety";
import { EditorBoundary, EditorRenderer } from "@/app/train/EditorBoundary";

/**
 * เฟส ง (bug fix) — EditorBoundary: แผง editor พัง = เด้งเฉพาะแผง หน้าแชท (นอก boundary) ไม่ล้ม
 * (repo ไม่มี jsdom/RTL → เทส render logic ผ่าน renderToStaticMarkup ใน node)
 */

describe("EditorBoundary — พังเฉพาะแผง ประวัติแชทอยู่ครบ", () => {
  it("boundaryStateFromError: Error→message · non-Error→String · ว่าง→fallback", () => {
    expect(boundaryStateFromError(new Error("boom"))).toEqual({ hasError: true, message: "boom" });
    expect(boundaryStateFromError("plain")).toEqual({ hasError: true, message: "plain" });
    expect(boundaryStateFromError(new Error("")).message).toContain("ไม่ทราบสาเหตุ");
  });

  it("getDerivedStateFromError → hasError + ข้อความ error (เช่น TDZ ที่เจอจริง)", () => {
    const s = EditorBoundary.getDerivedStateFromError(new Error("Cannot access 'tb' before initialization"));
    expect(s.hasError).toBe(true);
    expect(s.message).toContain("tb");
  });

  it("🔴 error → render fallback (ข้อความสั้น + ปุ่มปิด) · ไม่ render children (แผง editor ที่พัง)", () => {
    const child = React.createElement("span", null, "EDITOR-CHILD-CONTENT");
    const b = new EditorBoundary({ children: child, onClose: () => {} });
    b.state = boundaryStateFromError(new Error("บูมมม"));
    const html = renderToStaticMarkup(b.render() as React.ReactElement);
    expect(html).toContain("บูมมม");
    expect(html).toContain("ปิดแผง");
    expect(html, "children ที่พังไม่ถูก render").not.toContain("EDITOR-CHILD-CONTENT");
  });

  it("ปกติ (ไม่ error) → children ผ่านตามเดิม", () => {
    const child = React.createElement("span", null, "EDITOR-CHILD-CONTENT");
    const b = new EditorBoundary({ children: child, onClose: () => {} });
    b.state = { hasError: false, message: "" };
    expect(renderToStaticMarkup(b.render() as React.ReactElement)).toContain("EDITOR-CHILD-CONTENT");
  });

  it("EditorRenderer เรียก render() ภายใน child ของ boundary (error ตอน render จึงถูกจับ)", () => {
    const el = EditorRenderer({ render: () => React.createElement("i", null, "RENDERED-INSIDE") });
    expect(renderToStaticMarkup(el as React.ReactElement)).toContain("RENDERED-INSIDE");
  });
});
