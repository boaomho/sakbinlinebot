/**
 * lib/train/ui-safety.ts — pure helper ของ EditorBoundary (แยกออกมาให้เทสได้ใน node · ไม่มี JSX)
 */

/** แปลง error → state ของ boundary (ข้อความสั้นให้โชว์ในแผง) */
export function boundaryStateFromError(err: unknown): { hasError: boolean; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  return { hasError: true, message: (raw && raw.trim()) || "ไม่ทราบสาเหตุ (unknown error)" };
}
