import { fetchT } from '../lib/http';
import db from '../db';
import { dfsAuth } from '../lib/auth';
import { resolveStateName } from '../services/gbp';
import { placesTextSearch, placeWebsite, placeRatingCount, type PlaceResult } from '../lib/places';
import { scrapeMapsPack } from './gmaps';

// Neutral Google experiment-params token for Maps fallback searches.
const MAPS_G_EP = 'Egdnd3Mtd2l6IgFoKgIIAEgAUABYAHAAeACQAQCYAQCgAQCqAQC4AQPIAQCYAgCgAgCYAwCSBwCgBwCyBwC4BwDCBwDIBwCACAE';

// Builds the Google Search verification URL — short form matches what users actually type.
export function buildSearchUrl(vertical: string, city: string): string {
  const q = encodeURIComponent(`${vertical.toLowerCase()} in ${city.toLowerCase()}`).replace(/%20/g, '+');
  return `https://www.google.com/search?q=${q}&udm=1`;
}

// Builds the Google Maps URL for the Maps scrape — includes state in query.
function buildMapsUrl(vertical: string, city: string, state: string, lat: number, lng: number): string {
  const q = encodeURIComponent(`${vertical.toLowerCase()} in ${city.toLowerCase()} ${state.toLowerCase()}`).replace(/%20/g, '+');
  return `https://www.google.com/maps/search/${q}/@${lat},${lng},11z/data=!3m1!4b1?entry=ttu&g_ep=${MAPS_G_EP}`;
}

// DataForSEO local_finder scrapes google.com/search (the same page a prospect sees).
// Falls back to Maps endpoint, then to Google Places API.
async function getMapsPackFromDFS(
  vertical: string,
  city: string,
  state: string,
): Promise<{ places: PlaceResult[]; source: string; checkUrl: string } | null> {
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) return null;
  const fullState = await resolveStateName(city, state);
  const locationName = `${city},${fullState},United States`;

  // Geocode once — used by Maps fallback URL.
  const coords = await geocodeCity(city, state);

  // Primary: local_finder scrapes Google Search Places tab (matches manual verification on udm=1).
  // Use "vertical in city" WITHOUT state — matches exactly what a user types when searching.
  // location_name: 'United States' (country-level, no coordinate) makes Google return the broad
  // relevance-ranked "Places" page for the named city — the same results a non-local searcher
  // (e.g. the agency, checking from outside the lead's city) sees. A city-specific
  // location_coordinate/location_name instead returns a proximity-anchored "near me" pack, which
  // doesn't match manual verification checks.
  // Secondary: Maps endpoint URL scrape — reliable, returns place_ids, but different surface.
  const shortQuery  = `${vertical.toLowerCase()} in ${city.toLowerCase()}`;
  const searchQuery = `${vertical.toLowerCase()} in ${city.toLowerCase()} ${fullState.toLowerCase()}`;
  const attempts: Array<{ endpoint: string; body: Record<string, any>; label: string; timeout: number }> = [
    {
      endpoint: 'serp/google/local_finder/live/advanced',
      body: {
        keyword: shortQuery,
        location_name: 'United States',
        language_name: 'English',
        depth: 20,
      },
      label: 'dataforseo_local_finder',
      timeout: 90000,
    },
    {
      endpoint: 'serp/google/maps/live/advanced',
      body: coords
        ? { url: buildMapsUrl(vertical, city, fullState, coords.lat, coords.lng), depth: 100, language_name: 'English' }
        : { keyword: searchQuery, location_name: locationName, language_name: 'English', depth: 100 },
      label: 'dataforseo_maps',
      timeout: 60000,
    },
  ];

  for (const { endpoint, body, label, timeout } of attempts) {
    const queryDesc = (body as any).url ?? (body as any).keyword ?? label;
    try {
      const res = await fetchT(
        `https://api.dataforseo.com/v3/${endpoint}`,
        {
          method:  'POST',
          headers: { Authorization: `Basic ${dfsAuth()}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify([body]),
        },
        timeout,
      );
      const json  = await res.json();
      const task0 = json.tasks?.[0];
      if (task0?.status_code !== 20000) {
        console.warn(`[MapPack] DFS ${label} status ${task0?.status_code}: ${task0?.status_message}`);
        continue;
      }
      // check_url is the exact Google URL DFS scraped (location pinned via uule) —
      // opening it reproduces this snapshot far better than a plain search URL.
      const checkUrl: string = task0?.result?.[0]?.check_url ?? '';
      const rawItems: any[] = task0?.result?.[0]?.items ?? [];
      const typeCounts = rawItems.reduce((m: any, i: any) => { m[i.type] = (m[i.type] ?? 0) + 1; return m; }, {});
      console.log(`[MapPack] ${label} raw ${rawItems.length} items, types:`, JSON.stringify(typeCounts));
      // maps endpoint items have type='maps_search'.
      // local_finder endpoint items have type='local_pack' (confirmed from live API response).
      // Filter to the right type so ads/featured-snippets don't inflate rankings.
      const typeFilter = endpoint.includes('local_finder') ? 'local_pack' : 'maps_search';
      const typed = rawItems.filter((i: any) => i.type === typeFilter);
      const items = (typed.length > 0 ? typed : rawItems)
        .sort((a: any, b: any) => (a.rank_group ?? 999) - (b.rank_group ?? 999));

      // Some businesses appear twice (once without place_id as a featured card, once with place_id
      // as a map pin). Deduplicate by name: keep the first-seen rank, but use the place_id from
      // whichever instance has one.
      const placeIdByName = new Map<string, string>();
      for (const i of items) {
        if (!i.title || !i.place_id) continue;
        const key = i.title.toLowerCase().trim();
        if (!placeIdByName.has(key)) placeIdByName.set(key, i.place_id);
      }

      const seen = new Set<string>();
      const places: PlaceResult[] = [];
      for (const i of items) {
        if (!i.title || i.is_paid) continue;
        const key = i.title.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        places.push({
          place_id:           placeIdByName.get(key) ?? i.place_id ?? '',
          name:               i.title,
          rating:             i.rating?.value ?? 0,
          user_ratings_total: i.rating?.votes_count ?? 0,
        });
      }

      if (!places.length) {
        console.warn(`[MapPack] DFS ${label}: 0 results for "${queryDesc}"`);
        continue;
      }
      console.log(`[MapPack] DFS ${label}: ${places.length} unique results for "${queryDesc}"`);
      places.forEach((p, i) =>
        console.log(`  #${i + 1} "${p.name}" reviews:${p.user_ratings_total} place_id:${p.place_id || 'none'}`)
      );
      return { places, source: label, checkUrl };
    } catch (e: any) {
      console.warn(`[MapPack] DFS ${label} error:`, e.message);
    }
  }
  return null;
}

export const DEFAULT_EXCLUDED_BRANDS: string[] = [];

export interface MapPackConfig {
  excludedBrands?: string[];
}

//  Lead #1    → compare with #2 (closest challenger)
//  Lead #2–4  → compare with #1
//  Lead #5–8  → compare with #3
//  Lead #9–13 → compare with #4
//  Lead #14+  → compare with #5
// Returned rank counts NON-LEAD entries: when the lead is #1, the 1st non-lead
// entry is overall #2 — so leads #1–4 all target rank 1. (Returning 2 here used
// to skip past the real #2 and pick the overall #3 as "closest challenger".)
function pickCompetitorRank(leadPos: number): number {
  if (leadPos <= 4)  return 1;
  if (leadPos <= 8)  return 3;
  if (leadPos <= 13) return 4;
  return 5;
}

// Geocoding API — city centre lat/lng for Places location bias.
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

// Google Places API v1 text search — up to 40 results (2 pages × 20).
// Uses locationRestriction (hard boundary) at 15 km radius around city centre so the ranked
// list matches what a user sees when manually searching on Google Maps from that city.
async function searchPlaces(query: string, coords?: { lat: number; lng: number }): Promise<PlaceResult[]> {
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.warn('[MapPack] GOOGLE_PLACES_API_KEY not set');
    return [];
  }
  // 15 km strict boundary — covers the city proper while excluding the next city over.
  const locationBias = coords ? { lat: coords.lat, lng: coords.lng, radius: 15000 } : undefined;
  const all: PlaceResult[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < 2; page++) {
    if (page > 0 && !nextToken) break;
    // strictToArea=true → locationRestriction, giving rankings closest to Google Maps local pack.
    const { results, nextPageToken } = await placesTextSearch(query, locationBias, nextToken, true);
    if (!results.length) break;
    all.push(...results);
    nextToken = nextPageToken;
    if (!nextToken) break;
  }
  return all;
}

// ─── Map Pack lookup ─────────────────────────────────────────────────────────

export type MapPackResult = {
  leadPosition: number;
  fullPack: Array<{
    position: number; name: string; rating: number; review_count: number;
    place_id: string | null; gbp_url: string | null; isLead: boolean; isCompetitor: boolean;
  }>;
  dataSource: string;
  verificationUrl: string;
  competitor: {
    name: string; rating: number; review_count: number; position: number;
    domain: string; place_id: string; gbp_url: string | null;
  };
};

export async function getMapPackPosition(
  vertical: string,
  city: string,
  state: string,
  leadName: string,
  leadReviewCount: number,
  leadPlaceId: string,
  leadRating: number,
  config: MapPackConfig = {},
): Promise<{ primaryMapData: MapPackResult; leadPosition: number } | null> {
  const { excludedBrands = DEFAULT_EXCLUDED_BRANDS } = config;

  const cacheKey = vertical.toLowerCase();

  // ── Cache (6-hour TTL — rankings shift intraday; keep snapshots close to what a
  // manual verification check sees) ────────────────────────────────────────────
  let places: PlaceResult[];
  let dataSource: string;
  let checkUrl = '';

  const cached: any = db.prepare(
    `SELECT items_json FROM mappack_cache WHERE keyword=? AND city=? AND state=? AND fetched_at>datetime('now','-6 hours')`
  ).get(cacheKey, city, state);

  if (cached) {
    const parsed = JSON.parse(cached.items_json);
    // Legacy rows stored a bare places array; current rows store { checkUrl, places }.
    places = Array.isArray(parsed) ? parsed : parsed.places;
    checkUrl = Array.isArray(parsed) ? '' : (parsed.checkUrl ?? '');
    dataSource = 'cached';
    console.log(`[MapPack] Cache hit: "${vertical} ${city}" (${places.length} results)`);
  } else {
    // Primary: direct Google Maps scrape — the exact list a prospect sees when they
    // search "hvac in toledo" on Google Maps. The scraped URL doubles as the
    // verification link, so opening it reproduces this ranking.
    const coords = await geocodeCity(city, state);
    const gmaps = coords ? await scrapeMapsPack(vertical, city, coords) : null;
    if (gmaps) {
      places = gmaps.places;
      dataSource = 'google_maps';
      checkUrl = gmaps.mapsUrl;
      places.forEach((p, i) =>
        console.log(`  #${i + 1} "${p.name}" reviews:${p.user_ratings_total} place_id:${p.place_id || 'none'}`)
      );
    } else {
      // Fallback 1: DataForSEO Local Finder (Google Search Places tab — different surface,
      // close but not identical ordering to Maps).
      const dfsResult = await getMapsPackFromDFS(vertical, city, state);
      if (dfsResult) {
        places = dfsResult.places;
        dataSource = dfsResult.source;
        checkUrl = dfsResult.checkUrl;
      } else {
        // Fallback 2: Google Places text search (least accurate — ranks by relevance).
        const query = `${vertical} ${city}`;
        console.log(`[MapPack] Maps scrape + DFS unavailable — falling back to Google Places for "${query}"`);
        places = await searchPlaces(query, coords ?? undefined);
        if (!places.length) {
          console.error(`[MapPack] No results for "${query}" — check GOOGLE_PLACES_API_KEY quota`);
          return null;
        }
        dataSource = 'google_places';
        console.log(`[MapPack] Google Places: ${places.length} results`);
        places.forEach((p, i) =>
          console.log(`  #${i + 1} "${p.name}" reviews:${p.user_ratings_total} place_id:${p.place_id}`)
        );
      }
    }
    db.prepare(
      `INSERT OR REPLACE INTO mappack_cache (keyword,city,state,items_json) VALUES (?,?,?,?)`
    ).run(cacheKey, city, state, JSON.stringify({ checkUrl, places }));
  }

  // ── Find lead ────────────────────────────────────────────────────────────────
  let leadIdx = -1;

  // Pass 1: exact place_id
  if (leadPlaceId) {
    leadIdx = places.findIndex(p => p.place_id === leadPlaceId);
    if (leadIdx !== -1)
      console.log(`[MapPack] ✓ Lead by place_id: #${leadIdx + 1} "${places[leadIdx].name}"`);
    else
      console.warn(`[MapPack] ✗ Lead place_id "${leadPlaceId}" not in top-${places.length} results`);
  }

  // Pass 2: name + review count fuzzy match
  if (leadIdx === -1) {
    const leadWords = leadName.toLowerCase().replace(/[-.']/g, ' ').split(' ').filter(w => w.length > 3);
    let bestScore = 0;
    for (let i = 0; i < places.length; i++) {
      const t = places[i].name.toLowerCase();
      let score = 0;
      if (leadWords.some(w => t.includes(w)))                         score += 40;
      if (leadReviewCount > 0 && places[i].user_ratings_total === leadReviewCount) score += 80;
      if (score > bestScore) { bestScore = score; leadIdx = i; }
    }
    if (leadIdx !== -1)
      console.log(`[MapPack] ✓ Lead by name match: #${leadIdx + 1} "${places[leadIdx].name}"`);
    else
      console.warn(`[MapPack] ✗ Lead not found in results`);
  }

  const leadPos         = leadIdx !== -1 ? leadIdx + 1 : 99;
  const leadPlaceResult = leadIdx !== -1 ? places[leadIdx] : null;

  // ── Find competitor ──────────────────────────────────────────────────────────
  const targetRank = pickCompetitorRank(leadPos);
  console.log(`[MapPack] Lead rank #${leadPos} → competitor target rank #${targetRank}`);

  const isExcluded = (p: PlaceResult) =>
    excludedBrands.some(b => p.name.toLowerCase().includes(b.toLowerCase()));

  let compIdx = -1, validCount = 0, lastValidIdx = -1;
  for (let i = 0; i < places.length; i++) {
    // Exclude lead by index (reliable) AND by place_id when both have one (extra safety).
    // Avoid place_id-only check: local_finder items often have place_id='' which would
    // match every other empty-id item and skip the entire list.
    if (i === leadIdx) continue;
    if (leadPlaceResult?.place_id && places[i].place_id === leadPlaceResult.place_id) continue;
    if (isExcluded(places[i])) continue;
    validCount++;
    lastValidIdx = i;
    if (validCount === targetRank) { compIdx = i; break; }
  }
  if (compIdx === -1) compIdx = lastValidIdx;

  if (compIdx === -1) {
    console.error(`[MapPack] No competitor found for "${vertical} ${city}"`);
    return null;
  }

  const compPlace = places[compIdx];
  const compPos   = compIdx + 1;

  console.log(`[MapPack] ✓ Competitor rank #${compPos}: "${compPlace.name}" reviews:${compPlace.user_ratings_total} rating:${compPlace.rating}`);

  const toGbpUrl = (pid: string) => `https://www.google.com/maps/place/?q=place_id:${pid}`;

  // DFS local_finder (the primary source) frequently returns place_id='' for every
  // entry. The lead's real place_id is already known (passed in as leadPlaceId);
  // resolve a real place_id for the competitor via a Places API name search so the
  // report has a working, verifiable Maps link/domain/phone for them.
  const leadActualPid = leadPlaceResult?.place_id || leadPlaceId;

  let compPlaceId = compPlace.place_id;
  if (!compPlaceId) {
    const coords = await geocodeCity(city, state);
    const found = await searchPlaces(`${compPlace.name} ${city} ${state}`, coords ?? undefined);
    compPlaceId = found.find(p => p.name.toLowerCase() === compPlace.name.toLowerCase())?.place_id
      || found[0]?.place_id || '';
    if (compPlaceId) compPlace.place_id = compPlaceId;
  }

  // Competitor website
  let compDomain = '';
  if (compPlaceId) {
    try {
      const website = await placeWebsite(compPlaceId);
      if (website) compDomain = new URL(website).hostname.replace('www.', '');
    } catch { }
  }

  // fullPack: top-5 slots always including lead + competitor.
  // Identify by object reference, not place_id — DFS results frequently have empty
  // place_id for every entry, which broke both the isLead/isCompetitor flags and the
  // "always include lead + competitor" guarantee whenever they ranked outside top-5.
  const mustItems = [leadPlaceResult, compPlace].filter((p, i, arr) =>
    p && arr.indexOf(p) === i
  ) as PlaceResult[];
  const fillers = places
    .filter(p => !mustItems.includes(p))
    .slice(0, Math.max(0, 5 - mustItems.length));
  const packPlaces = [...mustItems, ...fillers].sort((a, b) => places.indexOf(a) - places.indexOf(b));

  // The scraped Maps list view sometimes omits review counts — enrich the
  // report-visible entries via Places API and write back to the cache so the
  // lookups aren't repeated on the next hit.
  const toEnrich = packPlaces.filter(p => p.place_id && (!p.user_ratings_total || !p.rating));
  if (toEnrich.length) {
    await Promise.all(toEnrich.map(async p => {
      const rc = await placeRatingCount(p.place_id);
      if (rc) { p.rating = rc.rating; p.user_ratings_total = rc.count; }
    }));
    db.prepare(`UPDATE mappack_cache SET items_json=? WHERE keyword=? AND city=? AND state=?`)
      .run(JSON.stringify({ checkUrl, places }), cacheKey, city, state);
  }

  const fullPack = packPlaces.map(place => {
    const pid = place === leadPlaceResult ? leadActualPid
      : place === compPlace ? compPlaceId
      : place.place_id;
    return {
      position:     places.indexOf(place) + 1,
      name:         place.name,
      rating:       place.rating,
      review_count: place.user_ratings_total,
      place_id:     pid || null,
      gbp_url:      pid ? toGbpUrl(pid) : null,
      isLead:       place === leadPlaceResult,
      isCompetitor: place === compPlace,
    };
  });

  const competitor = {
    name:         compPlace.name,
    rating:       compPlace.rating,
    review_count: compPlace.user_ratings_total,
    position:     compPos,
    domain:       compDomain,
    place_id:     compPlaceId,
    gbp_url:      compPlaceId ? toGbpUrl(compPlaceId) : null,
  };

  const inPack = leadPos <= 3 ? ' ✓ IN TOP-3 MAP PACK' : leadPos <= 10 ? ' (top 10)' : '';
  console.log(`[MapPack] Google Maps rank: #${leadPos}${inPack} for "${vertical} ${city}" (source: ${dataSource})`);

  // Prefer the DFS check_url (location-pinned, reproduces the exact scraped SERP);
  // fall back to a plain Google search URL when the data came from Places API.
  const verificationUrl = checkUrl || buildSearchUrl(vertical, city);
  const primaryMapData: MapPackResult = { leadPosition: leadPos, fullPack, dataSource, verificationUrl, competitor };
  return { primaryMapData, leadPosition: leadPos };
}

// Keep getWeightedPosition as a thin wrapper so existing callers don't break.
export async function getWeightedPosition(
  vertical: string,
  city: string,
  state: string,
  leadName: string,
  leadReviewCount: number,
  leadPlaceId: string,
  leadRating: number,
  config: MapPackConfig = {},
): Promise<{
  primaryMapData: MapPackResult;
  weightedPosition: number;
  rankingKeywords: Array<{ keyword: string; position: number | null }>;
} | null> {
  const result = await getMapPackPosition(vertical, city, state, leadName, leadReviewCount, leadPlaceId, leadRating, config);
  if (!result) return null;
  return {
    primaryMapData:  result.primaryMapData,
    weightedPosition: result.leadPosition,
    // Report the query actually sent to Google ("hvac in toledo"), not "HVAC Toledo".
    rankingKeywords: [{ keyword: `${vertical.toLowerCase()} in ${city.toLowerCase()}`, position: result.leadPosition }],
  };
}

// ─── Organic Search Position ─────────────────────────────────────────────────

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
      console.warn(`[Organic] DFS status ${task0?.status_code}: ${task0?.status_message}`);
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
