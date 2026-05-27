import { fetchT } from '../lib/http';
import { dfsAuth } from '../lib/auth';
import db from '../db';
import { getBuyerIntentKeywords } from '../benchmarks';

// ─── Exported config constants ─────────────────────────────────────────────────
// Override any of these per-call via MapPackConfig, or change the defaults here.

export interface CompRule {
  maxLeadPos: number;
  targetPos: number;
  fallbackPos: number;
  label: string;
}

export const DEFAULT_COMP_RULES: CompRule[] = [
  { maxLeadPos: 4,  targetPos: 1, fallbackPos: 2, label: "client #2–4  → comp #1"  },
  { maxLeadPos: 8,  targetPos: 3, fallbackPos: 2, label: "client #5–8  → comp #3"  },
  { maxLeadPos: 13, targetPos: 4, fallbackPos: 3, label: "client #9–13 → comp #4"  },
  { maxLeadPos: 20, targetPos: 6, fallbackPos: 5, label: "client #14–20 → comp #5/6"},
  { maxLeadPos: 99, targetPos: 8, fallbackPos: 6, label: "client #21+  → comp #8"  },
];

// Brand name fragments to exclude from competitor selection.
// All comparisons are lowercase `.includes()` — partial matches are intentional.
export const DEFAULT_EXCLUDED_BRANDS: string[] = [
  "roto-rooter", "mr. rooter", "mr rooter",
  "mr. electric", "mr electric",
  "mister sparky",
  "one hour heating", "one hour air",
  "benjamin franklin plumbing",
  "comfort systems",
  "terminix", "orkin",
  "servicemaster", "servpro",
  "home depot", "lowes",
  "1-800", "angi", "homeadvisor", "thumbtack",
  "molly maid", "the maids",
];

// ─── Per-call config ────────────────────────────────────────────────────────────

export interface MapPackConfig {
  /** Country appended to location string — e.g. "United States", "Canada". Empty string omits it. */
  country?: string;
  /** DataForSEO language_code. Defaults to "en". */
  languageCode?: string;
  /** Max results to request from DataForSEO. Defaults to 50. */
  resultLimit?: number;
  /** Brand fragments excluded from competitor selection. Defaults to DEFAULT_EXCLUDED_BRANDS. */
  excludedBrands?: string[];
  /** Competitor position selection rules. Defaults to DEFAULT_COMP_RULES. */
  compRules?: CompRule[];
}

const US_STATES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',
  CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',
  IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',
  ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',
  MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',
  NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',
  ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',
  RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',
  UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',
  WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia',
};

function buildLocationName(city: string, state: string, country: string): string {
  const fullState = US_STATES[state.trim().toUpperCase()] ?? state;
  return [city, fullState, country].filter(Boolean).join(',');
}

// ─── Local Map Pack ─────────────────────────────────────────────────────────────

async function getLocalMapPack(
  vertical: string,
  city: string,
  state: string,
  leadName: string,
  leadPositionHint: number,
  leadReviewCount = 0,
  leadPlaceId = "",
  leadRating = 0,
  searchKeyword?: string,
  config: MapPackConfig = {}
) {
  const {
    country       = "United States",
    languageCode  = "en",
    resultLimit   = 50,
    excludedBrands = DEFAULT_EXCLUDED_BRANDS,
    compRules      = DEFAULT_COMP_RULES,
  } = config;

  const keyword      = searchKeyword ?? vertical;
  const locationName = buildLocationName(city, state, country);

  console.log(`[MapPack] keyword:"${keyword}" location:"${locationName}" lead:"${leadName}" placeId:"${leadPlaceId}"`);
  let items: any[] = [];
  let dataSource = "dataforseo";

  // ── SQLite cache (24-hour TTL) ─────────────────────────────────────────────
  const cached: any = db.prepare(
    `SELECT items_json FROM mappack_cache WHERE keyword=? AND city=? AND state=? AND fetched_at>datetime('now','-24 hours')`
  ).get(keyword, city, state);
  if (cached) {
    console.log(`[MapPack] Cache hit: "${keyword}" @ ${city}`);
    items = JSON.parse(cached.items_json);
    dataSource = "dataforseo_cached";
  }

  // ── DataForSEO live/advanced ───────────────────────────────────────────────
  if (!items.length) {
    try {
      const res = await fetchT("https://api.dataforseo.com/v3/serp/google/maps/live/advanced", {
        method: "POST",
        headers: { Authorization: `Basic ${dfsAuth()}`, "Content-Type": "application/json" },
        body: JSON.stringify([{
          keyword,
          location_name: locationName,
          language_code: languageCode,
          limit: resultLimit,
        }]),
      });
      const json = await res.json();
      const statusCode = json.tasks?.[0]?.status_code;
      if (statusCode === 40200) {
        console.error(`[MapPack] DataForSEO balance is zero — add credits at app.dataforseo.com`);
        return null;
      }
      if (statusCode !== 20000) {
        console.error(`[MapPack] DataForSEO error ${statusCode}:`, json.tasks?.[0]?.status_message);
        return null;
      }
      const allItems: any[] = json.tasks?.[0]?.result?.[0]?.items || [];
      items = allItems.filter((i: any) => i.type === "maps_search");
      if (items.length) {
        db.prepare(
          `INSERT OR REPLACE INTO mappack_cache (keyword, city, state, items_json) VALUES (?,?,?,?)`
        ).run(keyword, city, state, JSON.stringify(items));
        console.log(`[MapPack] DataForSEO: ${items.length} organic results for "${keyword}" @ ${city} — cached`);
        items.forEach((i: any) =>
          console.log(`  #${i.rank_group} "${i.title}" reviews:${i.rating?.votes_count ?? 0} place_id:${i.place_id ?? 'none'}`)
        );
      }
    } catch (e: any) {
      console.error("[MapPack] DataForSEO request failed:", e.message);
      return null;
    }
  }

  if (!items.length) {
    console.error(`[MapPack] DataForSEO returned 0 organic results for "${keyword}" @ ${city}`);
    return null;
  }

  // ── Lead matching ──────────────────────────────────────────────────────────
  // Strategy: place_id first — it is globally unique, zero ambiguity.
  // Fallback scoring runs only when DataForSEO omits place_id on a result.
  // Substring/token matching is intentionally absent: fragments of "ElectricMan"
  // ("electr", "ectric" …) would match every other electrical company in the pack
  // and produce false positions.

  let leadItem: any = null;

  // Pass 1 — definitive: exact place_id match
  if (leadPlaceId) {
    leadItem = items.find((i: any) => i.place_id && i.place_id === leadPlaceId) ?? null;
    if (leadItem)
      console.log(`[MapPack] ✓ Lead by place_id: #${leadItem.rank_group} "${leadItem.title}"`);
    else
      console.warn(`[MapPack] ✗ place_id "${leadPlaceId}" not in top-${items.length} results for "${keyword}"`);
  }

  // Pass 2 — fallback scoring (no token/substring matching)
  if (!leadItem) {
    const leadWords = leadName.toLowerCase().replace(/[-.']/g, ' ').split(' ').filter((w: string) => w.length > 3);
    const domainKey = leadName.toLowerCase().replace(/[^a-z0-9]/g, '');

    const scored = items.map((i: any) => {
      const t  = i.title?.toLowerCase() ?? '';
      const d  = (i.domain ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const rv = i.rating?.votes_count ?? 0;
      let score = 0;
      let reason = '';
      // Domain match — specific (full domain slug, not a fragment)
      if (d && (d.includes(domainKey) || domainKey.includes(d.replace(/\.com$/, '')))) { score += 100; reason += 'domain '; }
      // Exact review count — reliable when counts align precisely
      if (leadReviewCount > 0 && rv === leadReviewCount) { score += 80; reason += `reviews(${rv}) `; }
      // Whole business-name word — "electricman" only matches businesses literally named "electricman"
      if (leadWords.some((w: string) => t.includes(w))) { score += 40; reason += 'name '; }
      if (score > 0) console.log(`  [Fallback match] #${i.rank_group} "${i.title}" score=${score} (${reason.trim()})`);
      return { item: i, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

    leadItem = scored[0]?.item ?? null;
    if (leadItem)
      console.log(`[MapPack] ✓ Lead by fallback scoring: #${leadItem.rank_group} "${leadItem.title}" (score=${scored[0].score})`);
    else
      console.warn(`[MapPack] ✗ Lead not found. Not ranked in top ${items.length} for "${keyword}". Pack: ${items.slice(0, 10).map(i => `#${i.rank_group}:${i.title}`).join(', ')}`);
  }

  const leadPos = leadItem?.rank_group ?? leadPositionHint;

  // ── Competitor selection ───────────────────────────────────────────────────
  const compRule = compRules.find(row => leadPos <= row.maxLeadPos) ?? compRules[compRules.length - 1];
  console.log(`[MapPack] Comp rule: ${compRule.label} (lead=#${leadPos})`);

  const isValidComp = (i: any): boolean =>
    !!i.title &&
    !excludedBrands.some(b => i.title.toLowerCase().includes(b)) &&
    i.rank_group !== leadPos;

  // "Strong enough" = has at least 10 reviews — filters out new/inactive listings.
  // Does NOT require more reviews than the lead; just not an empty profile.
  const isStrong = (i: any): boolean => (i.rating?.votes_count ?? 0) >= 10;

  const validAbove = items.filter(i => isValidComp(i) && i.rank_group < leadPos);
  const validBelow = items.filter(i => isValidComp(i) && i.rank_group > leadPos);

  const rev = (i: any): number => i.rating?.votes_count ?? 0;

  let selected: any;
  if (validAbove.length > 0) {
    // Normal: lead is not #1 — apply positional rule then quality check.
    selected =
      validAbove.find(i => i.rank_group === compRule.targetPos   && isStrong(i)) ??
      validAbove.find(i => i.rank_group === compRule.fallbackPos && isStrong(i)) ??
      validAbove.filter(isStrong).sort((a, b) => a.rank_group - b.rank_group)[0] ??
      validAbove.sort((a, b) => a.rank_group - b.rank_group)[0];
  } else {
    // Lead is at #1. Pick the most established competitor in the pack
    // (highest review count from top 10 below) — not just the nearest position.
    // A business with 50 reviews at #2 is less meaningful than one at #4 with 900.
    const nearPack = validBelow.slice(0, 10);
    selected =
      nearPack.filter(isStrong).sort((a, b) => rev(b) - rev(a))[0] ??
      nearPack.sort((a, b) => rev(b) - rev(a))[0];
  }

  if (!selected) return null;

  console.log(`[MapPack] ✓ Competitor: #${selected.rank_group} "${selected.title}" ` +
    `reviews:${selected.rating?.votes_count ?? 0} rating:${selected.rating?.value ?? 0} strong:${isStrong(selected)}`);

  if (!selected.domain && selected.place_id) {
    try {
      const r    = await fetchT(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${selected.place_id}&fields=website&key=${process.env.GOOGLE_PLACES_API_KEY}`);
      const json = await r.json();
      if (json.result?.website) selected.domain = new URL(json.result.website).hostname.replace('www.', '');
    } catch { }
  }

  const selectedRank = selected.rank_group;
  const top3 = items
    .filter((i: any) => i.rank_group !== leadPos && i.rank_group !== selectedRank)
    .slice(0, 3);
  const toGbpUrl = (pid: string | undefined) =>
    pid ? `https://www.google.com/maps/place/?q=place_id:${pid}` : null;

  const fullPack = [...top3, selected, ...(leadItem ? [leadItem] : [])]
    .sort((a, b) => a.rank_group - b.rank_group)
    .map((i: any) => ({
      position:     i.rank_group,
      name:         i.title,
      rating:       i.rating?.value ?? 0,
      review_count: i.rating?.votes_count ?? 0,
      place_id:     i.place_id ?? null,
      gbp_url:      toGbpUrl(i.place_id),
      isLead:       i.rank_group === leadPos,
      isCompetitor: i.rank_group === selectedRank,
    }));

  return {
    leadPosition: leadPos,
    fullPack,
    dataSource,
    competitor: {
      name:         selected.title,
      rating:       selected.rating?.value ?? 0,
      review_count: selected.rating?.votes_count ?? 0,
      position:     selected.rank_group,
      domain:       selected.domain ?? "",
      place_id:     selected.place_id ?? "",
      gbp_url:      toGbpUrl(selected.place_id),
    },
  };
}

// ─── Multi-keyword Weighted Position ──────────────────────────────────────────

export type MapPackResult = NonNullable<Awaited<ReturnType<typeof getLocalMapPack>>>;

export async function getWeightedPosition(
  vertical: string,
  city: string,
  state: string,
  leadName: string,
  leadReviewCount: number,
  leadPlaceId: string,
  leadRating: number,
  config: MapPackConfig = {}
): Promise<{
  primaryMapData: MapPackResult;
  weightedPosition: number;
  rankingKeywords: Array<{ keyword: string; position: number | null }>;
} | null> {
  const keywords = getBuyerIntentKeywords(vertical);
  console.log(`[Weighted] Searching ${keywords.length} keywords for "${vertical}" @ ${city}: ${keywords.join(', ')}`);

  const results = await Promise.all(
    keywords.map(kw =>
      getLocalMapPack(vertical, city, state, leadName, 99, leadReviewCount, leadPlaceId, leadRating, kw, config)
        .then(data => ({ keyword: kw, data }))
        .catch(() => ({ keyword: kw, data: null }))
    )
  );

  const primary = results[0];
  if (!primary?.data) {
    console.warn('[Weighted] Primary keyword returned no data');
    return null;
  }

  const found = results
    .map(r => ({ keyword: r.keyword, position: r.data?.leadPosition ?? null }))
    .filter(x => x.position !== null && x.position < 99);

  const avgPosition = found.length > 0
    ? Math.round(found.reduce((sum, x) => sum + x.position!, 0) / found.length)
    : primary.data.leadPosition;

  const rankingKeywords = results.map(r => ({
    keyword:  r.keyword,
    position: r.data?.leadPosition ?? null,
  }));

  console.log(`[Weighted] Positions: ${rankingKeywords.map(x => `"${x.keyword}":#${x.position ?? 'N/F'}`).join(' | ')} → avg #${avgPosition}`);

  return { primaryMapData: primary.data, weightedPosition: avgPosition, rankingKeywords };
}

export { buildLocationName };
