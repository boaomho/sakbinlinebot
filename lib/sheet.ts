const CACHE_TTL_MS = 60_000;

let cache: { csv: string; fetchedAt: number } | null = null;

export async function getFaqCsv(): Promise<string> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.csv;
  }

  const url = process.env.SHEET_CSV_URL;
  if (!url) {
    if (cache) {
      console.warn("[sheet] SHEET_CSV_URL is not set, using stale cache");
      return cache.csv;
    }
    throw new Error("SHEET_CSV_URL is not set and no cache is available");
  }

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Sheet fetch failed with status ${res.status}`);
    }
    const csv = await res.text();
    cache = { csv, fetchedAt: now };
    return csv;
  } catch (error) {
    console.warn("[sheet] failed to fetch FAQ CSV", error);
    if (cache) {
      return cache.csv;
    }
    throw error;
  }
}
