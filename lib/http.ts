import { Request, Response, NextFunction } from 'express';

export const fetchT = async (url: string, options: RequestInit = {}, ms = 60000) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(id); }
};

export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Ensures a URL has a protocol so `new URL()` never throws on plain domains. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Lightweight page text fetch — strips HTML tags, no Puppeteer. Returns empty string on failure. */
export async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetchT(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ARMA-Audit/1.0)' },
    }, 12000);
    if (!res.ok) return '';
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 6000);
  } catch {
    return '';
  }
}
