import { fetchT } from '../lib/http';
import db from '../db';

export async function getPageSpeed(url: string, strategy: 'mobile' | 'desktop' = 'mobile', bustCache = false) {
  const normalized = url.startsWith('http://') ? url.replace('http://', 'https://') : url;
  const domain = new URL(normalized).hostname.replace('www.', '');

  if (!bustCache) {
    const cached: any = db.prepare(
      `SELECT * FROM pagespeed_cache WHERE domain=? AND strategy=? AND fetched_at>datetime('now','-1 days')`
    ).get(domain, strategy);
    if (cached) {
      console.log(`[PageSpeed] Cache hit: ${domain} (${strategy}) → ${cached.score}/100 LCP:${cached.lcp}`);
      return { score: cached.score, lcp: cached.lcp, cls: cached.cls, inp: cached.inp, ttfb: cached.ttfb, strategy, is_fallback: false, cached: true };
    }
  }

  console.log(`[PageSpeed] Live fetch: ${normalized} (${strategy})`);
  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(normalized)}&strategy=${strategy}&category=PERFORMANCE&key=${process.env.PAGESPEED_API_KEY}`;
    const res = await fetchT(apiUrl, {}, 50000);
    const ps = await res.json();

    if (ps.error) {
      console.error(`[PageSpeed] API error for ${normalized} (${strategy}): [${ps.error.code}] ${ps.error.message}`);
      return { score: null, lcp: "N/A", cls: "N/A", inp: null, ttfb: null, strategy, is_fallback: true, cached: false, error: ps.error.message };
    }

    const rawScore = ps.lighthouseResult?.categories?.performance?.score;
    if (rawScore == null) {
      console.error(`[PageSpeed] No performance score in response for ${normalized} — full response:`, JSON.stringify(ps).slice(0, 300));
      return { score: null, lcp: "N/A", cls: "N/A", inp: null, ttfb: null, strategy, is_fallback: true, cached: false, error: "no_score_in_response" };
    }

    const score = Math.round(rawScore * 100);
    const lcp = ps.lighthouseResult?.audits?.['largest-contentful-paint']?.displayValue ?? "N/A";
    const cls = ps.lighthouseResult?.audits?.['cumulative-layout-shift']?.displayValue ?? "N/A";
    const inp = ps.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT_MS?.percentile ?? null;
    const ttfb = ps.loadingExperience?.metrics?.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile ?? null;

    console.log(`[PageSpeed] ✓ ${domain} (${strategy}): score=${score}/100 LCP=${lcp} CLS=${cls}`);

    // Only cache successful responses — never cache nulls so a retry can get fresh data
    if (score != null) {
      db.prepare(`INSERT OR REPLACE INTO pagespeed_cache (domain,strategy,score,lcp,cls,inp,ttfb,raw_json) VALUES (?,?,?,?,?,?,?,?)`)
        .run(domain, strategy, score, lcp, cls, inp, ttfb, JSON.stringify(ps));
    }
    return { score, lcp, cls, inp, ttfb, strategy, is_fallback: false, cached: false };
  } catch (e: any) {
    console.error(`[PageSpeed] Request failed for ${normalized} (${strategy}):`, e.message);
    return { score: null, lcp: "N/A", cls: "N/A", inp: null, ttfb: null, strategy, is_fallback: true, cached: false, error: e.message };
  }
}
