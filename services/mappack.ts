import { fetchT } from '../lib/http';
import db from '../db';
import { getBuyerIntentKeywords } from '../benchmarks';
import { dfsAuth } from '../lib/auth';
import { resolveStateName } from '../services/gbp';

// Brand fragments excluded from competitor selection.
// Empty by default — pass your own list via MapPackConfig.excludedBrands.
export const DEFAULT_EXCLUDED_BRANDS: string[] = [];

export interface MapPackConfig {
  excludedBrands?: string[];
  /** Internal: skip competitor lookup for secondary keyword searches. */
  _skipCompetitor?: boolean;
}

//  Lead #2–4  → compare with #1   (within striking distance)
//  Lead #5–8  → compare with #3   (achievable next step)
//  Lead #9–13 → compare with #4
//  Lead #14+  → compare with #5
function pickCompetitorRank(leadPos: number): number {
  if (leadPos <= 1)  return 2;
  if (leadPos <= 4)  return 1;
  if (leadPos <= 8)  return 3;
  if (leadPos <= 13) return 4;
  return 5;
}

// In-memory geocode cache — city+state → lat/lng (persists for process lifetime).
const _geocodeCache = new Map<string, { lat: number; lng: number }>();

async function geocodeCity(city: string, state: string): Promise<{ lat: number; lng: number } | null> {
  const key = `${city.toLowerCase()},${state.toLowerCase()}`;
  if (_geocodeCache.has(key)) return _geocodeCache.get(key)!;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${city}, ${state}`)}&key=${process.env.GOOGLE_PLACES_API_KEY}`;
    const res  = await fetchT(url, {}, 10000);
    const json = await res.json();
    if (json.status !== 'OK' || !json.results?.length) return null;
    const loc    = json.results[0].geometry.location;
    const coords = { lat: loc.lat as number, lng: loc.lng as number };
    _geocodeCache.set(key, coords);
    console.log(`[MapPack] Geocoded "${city}, ${state}" → ${coords.lat},${coords.lng}`);
    return coords;
  } catch (e: any) {
    console.warn('[MapPack] Geocode error:', e.message);
    return null;
  }
}

// Fetch Google Places Text Search results for a query.
// Results are ordered by Google's prominence ranking — position 1 = #1 on Google Maps.
// Fetches up to 3 pages (60 results) to find businesses ranked lower on the map.
async function searchGooglePlaces(query: string, coords?: { lat: number; lng: number }): Promise<any[]> {
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.warn('[MapPack] GOOGLE_PLACES_API_KEY not set — cannot fetch rankings');
    return [];
  }
  const allResults: any[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 3; page++) {
    if (page > 0 && !pageToken) break;
    // Google requires a short pause before using next_page_token
    if (page > 0) await new Promise(r => setTimeout(r, 2000));
    try {
      let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${process.env.GOOGLE_PLACES_API_KEY}`;
      // Bias results to city centre (20 km radius) — brings rankings closer to the
      // Map Pack a user in that city would see, without restricting to the radius only.
      if (coords) url += `&location=${coords.lat},${coords.lng}&radius=20000`;
      if (pageToken) url += `&pagetoken=${pageToken}`;
      const res  = await fetchT(url, {}, 15000);
      const json = await res.json();
      if (json.status === 'ZERO_RESULTS') break;
      if (json.status !== 'OK') {
        console.warn(`[MapPack] Places status="${json.status}" query="${query}"`);
        break;
      }
      allResults.push(...(json.results ?? []));
      pageToken = json.next_page_token;
      if (!pageToken) break;
    } catch (e: any) {
      console.warn('[MapPack] Places search error:', e.message);
      break;
    }
  }
  return allResults;
}

// Fetch Google Maps rankings via DataForSEO SERP — returns results exactly as
// users see them on Google Maps, unlike the Places Text Search API.
async function searchDataForSEOMaps(
  query: string,
  city: string,
  state: string,
): Promise<any[] | null> {
  if (!process.env.DATAFORSEO_LOGIN) return null;
  try {
    const fullState = await resolveStateName(city, state);
    const body = {
      keyword:       query,
      location_name: `${city},${fullState},United States`,
      language_name: 'English',
      depth:         100,
    };
    const res  = await fetchT(
      'https://api.dataforseo.com/v3/serp/google/maps/live/advanced',
      {
        method:  'POST',
        headers: { Authorization: `Basic ${dfsAuth()}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify([body]),
      },
      30000,
    );
    const json     = await res.json();
    const task0    = json.tasks?.[0];
    const taskCode = task0?.status_code;
    if (taskCode && taskCode !== 20000) {
      console.warn(`[MapPack] DFS Maps status ${taskCode}: ${task0?.status_message} for "${query}"`);
      return null;
    }
    const items: any[] = (task0?.result?.[0]?.items ?? [])
      .filter((i: any) => i.type === 'maps_search' && i.title)
      // Sort by rank_group so sponsored/mixed results don't shift organic positions.
      .sort((a: any, b: any) => (a.rank_group ?? 999) - (b.rank_group ?? 999));
    console.log(`[MapPack] DFS Maps: ${items.length} results for "${query}"`);
    if (!items.length) return null;
    items.forEach((p: any) =>
      console.log(`  #${p.rank_group ?? '?'} "${p.title}" reviews:${p.rating?.votes_count ?? 0} place_id:${p.place_id ?? 'none'}`)
    );
    return items.map((i: any) => ({
      name:               i.title ?? '',
      rating:             i.rating?.value ?? 0,
      user_ratings_total: i.rating?.votes_count ?? 0,
      place_id:           i.place_id ?? null,
      rank_group:         typeof i.rank_group === 'number' ? i.rank_group : null,
    }));
  } catch (e: any) {
    console.warn('[MapPack] DFS Maps error:', e.message);
    return null;
  }
}

// ─── Local Map Pack ─────────────────────────────────────────────────────────
// Prefers DataForSEO SERP Maps (matches what users see on Google Maps).
// Falls back to Google Places Text Search when DFS is unavailable.

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
  config: MapPackConfig = {},
) {
  const { excludedBrands = DEFAULT_EXCLUDED_BRANDS, _skipCompetitor = false } = config;
  const keyword  = searchKeyword ?? vertical;
  const query    = `${keyword} in ${city}`;
  const cacheKey = keyword;

  // ── Cache (24-hour TTL) ────────────────────────────────────────────────────
  let places: any[];
  let dataSource = 'google_places';

  const cached: any = db.prepare(
    `SELECT items_json FROM mappack_cache WHERE keyword=? AND city=? AND state=? AND fetched_at>datetime('now','-24 hours')`
  ).get(cacheKey, city, state);

  if (cached) {
    places = JSON.parse(cached.items_json);
    dataSource = 'cached';
    console.log(`[MapPack] Cache hit: "${keyword}" @ ${city} (${places.length} results)`);
  } else {
    const dfsResults = await searchDataForSEOMaps(query, city, state);
    if (dfsResults && dfsResults.length > 0) {
      places     = dfsResults;
      dataSource = 'dataforseo_maps';
    } else {
      console.log(`[MapPack] DFS Maps returned no results for "${query}" — falling back to Google Places`);
      const cityCoords = await geocodeCity(city, state);
      places = await searchGooglePlaces(query, cityCoords ?? undefined);
      if (!places.length) {
        console.error(`[MapPack] Google Places also returned 0 results for "${query}" @ ${city},${state}. Check GOOGLE_PLACES_API_KEY quota.`);
        return null;
      }
      dataSource = 'google_places';
      console.log(`[MapPack] Google Places: ${places.length} results for "${query}"`);
      places.forEach((p, i) =>
        console.log(`  #${i + 1} "${p.name}" reviews:${p.user_ratings_total ?? 0} place_id:${p.place_id ?? 'none'}`)
      );
    }
    db.prepare(
      `INSERT OR REPLACE INTO mappack_cache (keyword, city, state, items_json) VALUES (?,?,?,?)`
    ).run(cacheKey, city, state, JSON.stringify(places));
  }

  // ── Find lead ──────────────────────────────────────────────────────────────
  // Pass 1: exact place_id match — zero ambiguity
  let leadIdx = -1;
  if (leadPlaceId) {
    leadIdx = places.findIndex((p: any) => p.place_id === leadPlaceId);
    if (leadIdx !== -1)
      console.log(`[MapPack] ✓ Lead by place_id: #${leadIdx + 1} "${places[leadIdx].name}"`);
    else
      console.warn(`[MapPack] ✗ Lead place_id "${leadPlaceId}" not in top-${places.length} Places results`);
  }

  // Pass 2: fallback scoring (name words + review count)
  if (leadIdx === -1) {
    const leadWords = leadName.toLowerCase().replace(/[-.']/g, ' ').split(' ').filter((w: string) => w.length > 3);
    let bestScore = 0;
    for (let i = 0; i < places.length; i++) {
      const t  = (places[i].name ?? '').toLowerCase();
      const rv = places[i].user_ratings_total ?? 0;
      let score = 0;
      if (leadWords.some((w: string) => t.includes(w)))           score += 40;
      if (leadReviewCount > 0 && rv === leadReviewCount)           score += 80;
      if (score > bestScore) { bestScore = score; leadIdx = i; }
    }
    if (leadIdx !== -1)
      console.log(`[MapPack] ✓ Lead by fallback: #${leadIdx + 1} "${places[leadIdx].name}" score=${bestScore}`);
    else
      console.warn(`[MapPack] ✗ Lead not found for "${keyword}" @ ${city}`);
  }

  const leadPos         = leadIdx !== -1
    ? ((places[leadIdx] as any).rank_group ?? leadIdx + 1)
    : leadPositionHint;
  const leadPlaceResult = leadIdx !== -1 ? places[leadIdx] : null;

  // ── Find competitor ────────────────────────────────────────────────────────
  const targetRank  = pickCompetitorRank(leadPos);
  console.log(`[MapPack] Lead #${leadPos} → competitor target rank #${targetRank}`);

  const isExcluded = (p: any) =>
    excludedBrands.some(b => (p.name ?? '').toLowerCase().includes(b.toLowerCase()));

  let compIdx     = -1;
  let validCount  = 0;
  let lastValidIdx = -1;

  for (let i = 0; i < places.length; i++) {
    if (leadPlaceId && places[i].place_id === leadPlaceId) continue;
    if (!leadPlaceId && leadPlaceResult && places[i] === leadPlaceResult) continue;
    if (isExcluded(places[i])) {
      console.log(`[MapPack]   skip excluded "${places[i].name}"`);
      continue;
    }
    validCount++;
    lastValidIdx = i;
    if (validCount === targetRank) { compIdx = i; break; }
  }

  if (compIdx === -1 && lastValidIdx !== -1) {
    compIdx = lastValidIdx;
    console.log(`[MapPack] Fewer than ${targetRank} valid competitors — using last valid #${compIdx + 1}`);
  }

  if (compIdx === -1) {
    console.error(`[MapPack] No competitor found in Places results for "${query}"`);
    return null;
  }

  const compPlace = places[compIdx];
  const compPos   = (compPlace as any).rank_group ?? compIdx + 1;

  // Get competitor website via Places Details (only for primary keyword)
  let compDomain = '';
  if (!_skipCompetitor && compPlace.place_id) {
    try {
      const dr = await fetchT(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(compPlace.place_id)}&fields=website&key=${process.env.GOOGLE_PLACES_API_KEY}`
      );
      const dj = await dr.json();
      if (dj.result?.website) compDomain = new URL(dj.result.website).hostname.replace('www.', '');
    } catch { }
  }

  const toGbpUrl = (pid: string) => `https://www.google.com/maps/place/?q=place_id:${pid}`;

  console.log(`[MapPack] ✓ Competitor #${compPos}: "${compPlace.name}" reviews:${compPlace.user_ratings_total ?? 0} rating:${compPlace.rating ?? 0}`);

  // ── Build fullPack (exactly 5 entries) ────────────────────────────────────
  // Always include lead + competitor so the report can tag ← YOU and ← THEM.
  // Fill remaining slots from the top of the Places ranked list.
  const mustPids = new Set<string>([
    ...(leadPlaceResult?.place_id ? [leadPlaceResult.place_id as string] : []),
    ...(compPlace.place_id        ? [compPlace.place_id        as string] : []),
  ]);
  const mustItems: any[] = [];
  const seenPid = new Set<string>();
  for (const p of [leadPlaceResult, compPlace]) {
    if (!p || !p.place_id || seenPid.has(p.place_id)) continue;
    seenPid.add(p.place_id);
    mustItems.push(p);
  }
  const fillers = places
    .filter((p: any) => !mustPids.has(p.place_id))
    .slice(0, Math.max(0, 5 - mustItems.length));

  const packPlaces = [...mustItems, ...fillers].sort((a: any, b: any) => {
    return places.indexOf(a) - places.indexOf(b);
  });

  const leadActualPid = leadPlaceResult?.place_id ?? leadPlaceId;

  const fullPack = packPlaces.map((place: any) => {
    const pos = (place as any).rank_group ?? (places.indexOf(place) + 1);
    return {
      position:     pos,
      name:         place.name ?? '',
      rating:       place.rating ?? 0,
      review_count: place.user_ratings_total ?? 0,
      place_id:     place.place_id ?? null,
      gbp_url:      place.place_id ? toGbpUrl(place.place_id) : null,
      isLead:       !!leadActualPid && place.place_id === leadActualPid,
      isCompetitor: !!compPlace.place_id && place.place_id === compPlace.place_id,
    };
  });

  const competitor = {
    name:         compPlace.name ?? '',
    rating:       compPlace.rating ?? 0,
    review_count: compPlace.user_ratings_total ?? 0,
    position:     compPos,
    domain:       compDomain,
    place_id:     compPlace.place_id ?? '',
    gbp_url:      compPlace.place_id ? toGbpUrl(compPlace.place_id) : null,
  };

  return { leadPosition: leadPos, fullPack, dataSource, competitor };
}

// ─── Multi-keyword Position ──────────────────────────────────────────────────

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
  console.log(`[MapPack] Searching ${keywords.length} keywords for "${vertical}" @ ${city}: ${keywords.join(', ')}`);

  const results = await Promise.all(
    keywords.map((kw, idx) =>
      getLocalMapPack(
        vertical, city, state, leadName, 99, leadReviewCount, leadPlaceId, leadRating, kw,
        { ...config, _skipCompetitor: idx > 0 },
      )
        .then(data => ({ keyword: kw, data }))
        .catch((err: any) => {
          console.error(`[MapPack] getLocalMapPack threw for "${kw}":`, err?.message ?? err);
          return { keyword: kw, data: null };
        })
    )
  );

  const primary = results[0];
  if (!primary?.data) {
    console.warn('[MapPack] Primary keyword returned no data');
    return null;
  }

  const weightedPosition = primary.data.leadPosition;

  const rankingKeywords = results.map(r => ({
    keyword:  r.keyword,
    position: r.data?.leadPosition ?? null,
  }));

  console.log(`[MapPack] Position: #${weightedPosition} (Google Places rank) | all: ${rankingKeywords.map(x => `"${x.keyword}":#${x.position ?? 'N/F'}`).join(' | ')}`);

  return { primaryMapData: primary.data, weightedPosition, rankingKeywords };
}

// ─── Organic Search Position ─────────────────────────────────────────────────
// Uses DFS SERP Google Organic to find the lead's position in regular (non-maps)
// Google search results for the primary keyword — e.g. "hvac in Toledo".

export async function getOrganicPosition(
  domain: string,
  keyword: string,
  city: string,
  state: string,
): Promise<number | null> {
  if (!process.env.DATAFORSEO_LOGIN) return null;
  try {
    const fullState = await resolveStateName(city, state);
    const res = await fetchT(
      'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
      {
        method:  'POST',
        headers: { Authorization: `Basic ${dfsAuth()}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify([{
          keyword,
          location_name: `${city},${fullState},United States`,
          language_name: 'English',
          depth: 10,
        }]),
      },
      30000,
    );
    const json  = await res.json();
    const task0 = json.tasks?.[0];
    if (task0?.status_code !== 20000) {
      console.warn(`[Organic] DFS status ${task0?.status_code}: ${task0?.status_message} for "${keyword}"`);
      return null;
    }
    const items: any[] = task0?.result?.[0]?.items ?? [];
    const cleanDomain = domain.replace(/^www\./, '').toLowerCase();
    const hit = items.find((i: any) =>
      (i.domain ?? '').replace(/^www\./, '').toLowerCase() === cleanDomain ||
      (i.url ?? '').toLowerCase().includes(cleanDomain)
    );
    if (hit) {
      console.log(`[Organic] "${cleanDomain}" → organic #${hit.rank_absolute} for "${keyword}"`);
      return hit.rank_absolute ?? null;
    }
    console.log(`[Organic] "${cleanDomain}" not in top-10 organic for "${keyword}"`);
    return null;
  } catch (e: any) {
    console.warn('[Organic] error:', e.message);
    return null;
  }
}
