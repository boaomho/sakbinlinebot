import { put, issueSignedToken, presignUrl } from "@vercel/blob";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export interface UploadResult {
  pathname: string;
  url: string;
}

/**
 * สลิป = private store (BLOB_SLIPS_TOKEN) — path มี userId+timestamp ไม่ให้เดาได้
 * ไม่เก็บ signed URL ลงชีต (หมดอายุ) เก็บแค่ pathname แล้วค่อยเรียก getSlipSignedUrl()
 * สร้าง signed GET URL ใหม่ทุกครั้งที่ต้องใช้จริง (เช่น ตอน push เข้ากลุ่มแอดมิน)
 */
export async function uploadSlip(userId: string, buffer: Buffer, contentType: string): Promise<UploadResult | null> {
  const token = process.env.BLOB_SLIPS_TOKEN;
  if (!token) return null;

  const now = new Date();
  const pathname = `slips/${now.getFullYear()}-${pad2(now.getMonth() + 1)}/${userId}_${now.getTime()}.jpg`;

  try {
    const result = await put(pathname, buffer, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      token,
    });
    return { pathname: result.pathname, url: result.url };
  } catch (error) {
    console.error(JSON.stringify({ scope: "blob", warning: "uploadSlip failed", error: String(error) }));
    return null;
  }
}

/** สร้าง signed GET URL ของสลิป อายุ validDays วัน (default ใช้ค่าจาก Config `อายุลิงก์สลิป_วัน`) */
export async function getSlipSignedUrl(pathname: string, validDays: number): Promise<string | null> {
  const token = process.env.BLOB_SLIPS_TOKEN;
  if (!token) return null;

  try {
    const signedToken = await issueSignedToken({
      token,
      pathname,
      operations: ["get"],
      validUntil: Date.now() + validDays * 24 * 60 * 60 * 1000,
    });

    const { presignedUrl } = await presignUrl(
      { clientSigningToken: signedToken.clientSigningToken, delegationToken: signedToken.delegationToken },
      { operation: "get", pathname, access: "private" },
    );

    return presignedUrl;
  } catch (error) {
    console.error(JSON.stringify({ scope: "blob", warning: "getSlipSignedUrl failed", pathname, error: String(error) }));
    return null;
  }
}

/** รูปสินค้า = public store เดิม (BLOB_PRODUCTS_TOKEN) ใช้ URL ตรงได้เลย ไม่ต้อง sign */
export async function uploadProductImage(
  productName: string,
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<UploadResult | null> {
  const token = process.env.BLOB_PRODUCTS_TOKEN;
  if (!token) return null;

  const safeProduct = productName.replace(/[\\/]/g, "_");
  const pathname = `products/${safeProduct}/${filename}`;

  try {
    const result = await put(pathname, buffer, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      token,
    });
    return { pathname: result.pathname, url: result.url };
  } catch (error) {
    console.error(JSON.stringify({ scope: "blob", warning: "uploadProductImage failed", error: String(error) }));
    return null;
  }
}
