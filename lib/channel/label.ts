/**
 * lib/channel/label.ts — D-52 · ป้ายช่องทางสำหรับข้อความฝั่งแอดมิน (แอดมินเห็นปุ๊บรู้ว่ามาจากช่องไหน)
 * วางหน้าชื่อลูกค้าเสมอ ตำแหน่งเดียวกันทุกที่ · ห้ามใช้กับข้อความฝั่งลูกค้า
 * ทะเบียน id (REPO-MAP §5): fb:<pageId>:<psid>=Messenger · TRAIN:<session>=ซ้อม · อื่น(U…)=LINE
 */
export function channelLabel(channelUserId: string, pageName?: string): string {
  if (channelUserId.startsWith("fb:")) {
    // โครงรองรับหลายเพจ: มีชื่อเพจ → "[FB·<ชื่อสั้น>]" · วันนี้เพจเดียว → "[FB]"
    return pageName ? `[FB·${pageName}]` : "[FB]";
  }
  if (channelUserId.startsWith("TRAIN:")) return "[ซ้อม]";
  return "[LINE]";
}
