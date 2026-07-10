const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  text: string;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

async function fetchCsv(url: string | undefined, label: string): Promise<string | null> {
  if (!url) {
    console.warn(JSON.stringify({ scope: "sheets", label, warning: "url not set" }));
    return null;
  }

  const cached = cache.get(url);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.text;
  }

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
    const text = await res.text();
    cache.set(url, { text, fetchedAt: now });
    return text;
  } catch (error) {
    console.warn(JSON.stringify({ scope: "sheets", label, warning: "fetch failed", error: String(error) }));
    if (cached) {
      return cached.text;
    }
    return null;
  }
}

export function getStepCsv(): Promise<string | null> {
  return fetchCsv(process.env.SHEET_STEP_URL, "step");
}

export function getFaqCsv(): Promise<string | null> {
  return fetchCsv(process.env.SHEET_FAQ_URL, "faq");
}

export function getConfigCsv(): Promise<string | null> {
  return fetchCsv(process.env.SHEET_CONFIG_URL, "config");
}

export function getFollowCsv(): Promise<string | null> {
  return fetchCsv(process.env.SHEET_FOLLOW_URL, "follow");
}

/**
 * Minimal CSV parser: handles quoted fields (with embedded commas/newlines/escaped
 * double-quotes) and both CRLF and LF line endings.
 */
export function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const normalized = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}
