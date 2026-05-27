import { Router, Request, Response } from 'express';
import { asyncHandler, fetchT } from '../lib/http';
import { dfsAuth } from '../lib/auth';
import { getPageSpeed } from '../services/pagespeed';
import { buildLocationName } from '../services/mappack';
import db from '../db';

const router = Router();

// Live map pack debug — verify DataForSEO positions against Google Maps manually
// Usage: GET /mappack-debug?vertical=Roofing&city=Anchorage&state=Alaska
// Optional: &country=Canada  &language=en  &bust=1
router.get('/mappack-debug', asyncHandler(async (req: Request, res: Response) => {
  const { vertical, city, state, country = "United States", language = "en", bust } = req.query as Record<string, string>;
  if (!vertical || !city || !state) return res.status(400).json({ error: 'vertical, city, state required' });

  const keyword      = vertical;
  const locationName = buildLocationName(city, state, country);

  if (bust === '1') {
    db.prepare('DELETE FROM mappack_cache WHERE keyword=? AND city=? AND state=?').run(keyword, city, state);
    console.log(`[Debug] Cache cleared for keyword="${keyword}" location="${locationName}"`);
  }

  let items: any[] = [];
  let source = 'cache';

  const cached: any = db.prepare(
    `SELECT items_json, fetched_at FROM mappack_cache WHERE keyword=? AND city=? AND state=? AND fetched_at>datetime('now','-24 hours')`
  ).get(keyword, city, state);

  if (cached) {
    items = JSON.parse(cached.items_json);
    source = `dataforseo_cached (fetched ${cached.fetched_at})`;
  } else {
    source = 'dataforseo_live';
    const r = await fetchT("https://api.dataforseo.com/v3/serp/google/maps/live/advanced", {
      method: "POST",
      headers: { Authorization: `Basic ${dfsAuth()}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ keyword, location_name: locationName, language_code: language, limit: 20 }]),
    });
    const json = await r.json();
    const statusCode = json.tasks?.[0]?.status_code;
    if (statusCode === 40200) return res.status(402).json({ error: 'DataForSEO balance is zero — top up at app.dataforseo.com', keyword, location: locationName });
    if (statusCode !== 20000) return res.status(502).json({ error: `DataForSEO error ${statusCode}: ${json.tasks?.[0]?.status_message}`, keyword, location: locationName });
    const allItems = json.tasks?.[0]?.result?.[0]?.items || [];
    items = allItems.filter((i: any) => i.type === "maps_search");
    if (items.length) db.prepare('INSERT OR REPLACE INTO mappack_cache (keyword,city,state,items_json) VALUES (?,?,?,?)').run(keyword, city, state, JSON.stringify(items));
  }

  res.json({
    keyword,
    location: locationName,
    source,
    how_to_verify: `Open Google Maps, set location to ${city} ${state}, search "${keyword}" — rank numbers should match.`,
    count: items.length,
    positions: items.map((i: any) => ({
      rank: i.rank_group,
      name: i.title,
      rating: i.rating?.value ?? 0,
      reviews: i.rating?.votes_count ?? 0,
      place_id: i.place_id ?? null,
      domain: i.domain ?? null,
    })),
  });
}));

// Live PageSpeed check — bypasses cache
// Usage: GET /pagespeed-check?url=https://example.com
// Optional: &strategy=desktop &bust=1
router.get('/pagespeed-check', asyncHandler(async (req: Request, res: Response) => {
  const { url, strategy = 'mobile', bust } = req.query as Record<string, string>;
  if (!url) return res.status(400).json({ error: 'url required. Example: /pagespeed-check?url=https://example.com' });
  if (strategy !== 'mobile' && strategy !== 'desktop') return res.status(400).json({ error: 'strategy must be mobile or desktop' });

  const bustCache = bust === '1' || bust === 'true';
  const [mobile, desktop] = await Promise.all([
    getPageSpeed(url, 'mobile', bustCache),
    getPageSpeed(url, 'desktop', bustCache),
  ]);
  res.json({
    url,
    tested_at: new Date().toISOString(),
    mobile: { score: mobile.score, lcp: mobile.lcp, cls: mobile.cls, is_fallback: mobile.is_fallback, cached: mobile.cached },
    desktop: { score: desktop.score, lcp: desktop.lcp, cls: desktop.cls, is_fallback: desktop.is_fallback, cached: desktop.cached },
    note: mobile.is_fallback || desktop.is_fallback
      ? 'One or more scores could not be fetched from the API. Check server logs for the specific error.'
      : 'Scores are from the Google PageSpeed Insights API — same source as pagespeed.web.dev.',
  });
}));

router.get('/health', (_req: Request, res: Response) => {
  const leads = (db.prepare('SELECT COUNT(*) as c FROM leads').get() as any).c;
  const cached = (db.prepare('SELECT COUNT(*) as c FROM mappack_cache WHERE fetched_at>datetime(\'now\',\'-24 hours\')').get() as any).c;
  res.json({ status: 'ok', leads_in_db: leads, mappack_cache_live: cached });
});

router.get('/cache-status', (_req: Request, res: Response) => {
  const rows = db.prepare(
    `SELECT keyword, city, state, fetched_at,
      ROUND((julianday('now') - julianday(fetched_at)) * 24, 1) as age_hours
     FROM mappack_cache ORDER BY fetched_at DESC`
  ).all();
  res.json({ count: rows.length, entries: rows });
});

router.delete('/cache-clear', (req: Request, res: Response) => {
  const { keyword, city, state } = req.query as Record<string, string>;
  if (keyword && city && state) {
    const { changes } = db.prepare(
      `DELETE FROM mappack_cache WHERE keyword=? AND city=? AND state=?`
    ).run(keyword, city, state);
    return res.json({ cleared: changes, entry: `${keyword} / ${city}, ${state}` });
  }
  const { changes } = db.prepare(`DELETE FROM mappack_cache`).run();
  res.json({ cleared: changes, message: 'All map pack cache entries deleted' });
});

export default router;
