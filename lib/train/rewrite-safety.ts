/**
 * lib/train/rewrite-safety.ts — D-60 โหมดเกลาเสียง: ตรวจว่า rewrite รักษา {ตัวแปร} + ตัวเลขเดิม
 * pure · ไม่มี import (ใช้ได้ทั้ง server=assistant.ts และ client=TrainStudio + เทส · single source)
 */
export function rewriteSafety(oldText: string, newText: string): { droppedVars: string[]; changedNumbers: boolean } {
  const varsOf = (s: string) => new Set(s.match(/\{[^}]+\}/g) ?? []);
  const numsOf = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")).sort();
  const oldVars = varsOf(oldText);
  const newVars = varsOf(newText);
  const droppedVars = [...oldVars].filter((v) => !newVars.has(v));
  return { droppedVars, changedNumbers: numsOf(oldText).join("|") !== numsOf(newText).join("|") };
}
