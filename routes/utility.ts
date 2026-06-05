import { Router, Request, Response } from 'express';
import { asyncHandler, fetchT } from '../lib/http';
import { getPageSpeed } from '../services/pagespeed';
import db from '../db';

const router = Router();

// Live map pack debug — shows Google Places rankings so you can verify against Google Maps manually
// Usage: GET /mappack-debug?vertical=Roofing&city=Anchorage&state=AK
// Optional: &bust=1  (clears the 24h cache and fetches fresh)
router.get('/mappack-debug', asyncHandler(async (req: Request, res: Response) => {
  const { vertical, city, state, bust } = req.query as Record<string, string>;
  if (!vertical || !city || !state) return res.status(400).json({ error: 'vertical, city, state required' });

  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not set' });
  }

  const keyword = vertical;
  const query   = `${keyword} ${city} ${state}`;

  if (bust === '1') {
    db.prepare('DELETE FROM mappack_cache WHERE keyword=? AND city=? AND state=?').run(keyword, city, state);
    console.log(`[Debug] Cache cleared for "${keyword}" @ ${city}`);
  }

  let places: any[] = [];
  let source = 'google_places_cached';

  const cached: any = db.prepare(
    `SELECT items_json, fetched_at FROM mappack_cache WHERE keyword=? AND city=? AND state=? AND fetched_at>datetime('now','-24 hours')`
  ).get(keyword, city, state);

  if (cached) {
    places = JSON.parse(cached.items_json);
    source  = `google_places_cached (fetched ${cached.fetched_at})`;
  } else {
    source = 'google_places_live';
    const allResults: any[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < 3; page++) {
      if (page > 0 && !pageToken) break;
      if (page > 0) await new Promise(r => setTimeout(r, 2000));
      try {
        let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${process.env.GOOGLE_PLACES_API_KEY}`;
        if (pageToken) url += `&pagetoken=${pageToken}`;
        const httpRes  = await fetchT(url, {}, 15000);
        const json     = await httpRes.json();
        if (json.status === 'ZERO_RESULTS') break;
        if (json.status !== 'OK') {
          return res.status(502).json({ error: `Places API status="${json.status}"`, query });
        }
        allResults.push(...(json.results ?? []));
        pageToken = json.next_page_token;
        if (!pageToken) break;
      } catch (e: any) {
        return res.status(502).json({ error: e.message, query });
      }
    }

    places = allResults;
    if (places.length) {
      db.prepare('INSERT OR REPLACE INTO mappack_cache (keyword,city,state,items_json) VALUES (?,?,?,?)')
        .run(keyword, city, state, JSON.stringify(places));
    }
  }

  res.json({
    query,
    source,
    how_to_verify: `Search "${query}" on Google Maps — rank numbers below should match the order shown.`,
    count: places.length,
    positions: places.map((p: any, i: number) => ({
      rank:      i + 1,
      name:      p.name,
      rating:    p.rating ?? 0,
      reviews:   p.user_ratings_total ?? 0,
      place_id:  p.place_id ?? null,
      maps_url:  p.place_id ? `https://www.google.com/maps/place/?q=place_id:${p.place_id}` : null,
    })),
  });
}));

// Live PageSpeed check — bypasses cache
// Usage: GET /pagespeed-check?url=https://example.com
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
    mobile:  { score: mobile.score,  lcp: mobile.lcp,  cls: mobile.cls,  is_fallback: mobile.is_fallback,  cached: mobile.cached  },
    desktop: { score: desktop.score, lcp: desktop.lcp, cls: desktop.cls, is_fallback: desktop.is_fallback, cached: desktop.cached },
    note: mobile.is_fallback || desktop.is_fallback
      ? 'One or more scores could not be fetched from the API. Check server logs for the specific error.'
      : 'Scores are from the Google PageSpeed Insights API — same source as pagespeed.web.dev.',
  });
}));

router.get('/health', (_req: Request, res: Response) => {
  const leads  = (db.prepare('SELECT COUNT(*) as c FROM leads').get() as any).c;
  const cached = (db.prepare(`SELECT COUNT(*) as c FROM mappack_cache WHERE fetched_at>datetime('now','-24 hours')`).get() as any).c;
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
