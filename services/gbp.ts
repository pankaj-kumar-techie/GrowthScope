import { fetchT } from '../lib/http';
import { dfsAuth } from '../lib/auth';
import { placesTextSearch, placeDetails, placePhone, placeCoords } from '../lib/places';

export async function getLeadGBP(name: string, city: string, state: string, domain = "") {
  const cleanDomain = domain.replace(/^www\./, '').toLowerCase();

  const siteMatchesDomain = (website: string): boolean => {
    if (!cleanDomain || !website) return false;
    const host = website.toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
    return host === cleanDomain;
  };

  const trySearch = async (query: string): Promise<{
    rating: number; review_count: number; place_id: string; real_name: string;
    gbp_city: string; gbp_state: string; phone: string; address: string;
  } | null> => {
    try {
      const { results } = await placesTextSearch(query);
      if (!results.length) return null;

      for (const place of results.slice(0, 3)) {
        const details = await placeDetails(place.place_id);
        if (siteMatchesDomain(details.website)) {
          console.log(`[GBP] ✓ "${place.name}" phone="${details.phone}" city="${details.city}" state="${details.state}"`);
          return {
            rating:       place.rating,
            review_count: place.user_ratings_total,
            place_id:     place.place_id,
            real_name:    place.name,
            gbp_city:     details.city,
            gbp_state:    details.state,
            phone:        details.phone,
            address:      details.address,
          };
        }
        console.log(`[GBP]   skip "${place.name}" website="${details.website}"`);
      }
      return null;
    } catch (e: any) { console.warn('[GBP] search error:', e.message); return null; }
  };

  const empty = { rating: 0, review_count: 0, place_id: "", real_name: "", gbp_city: "", gbp_state: "", phone: "", address: "" };

  if (cleanDomain) {
    const r = await trySearch(`${cleanDomain} ${city} ${state}`);
    if (r) return r;
    console.warn(`[GBP] Domain search no match for "${cleanDomain}" — trying name`);

    const r2 = await trySearch(`${name} ${city} ${state}`);
    if (r2) return r2;
    console.warn(`[GBP] No verified GBP match for "${cleanDomain}" — business may not have website in Google`);
    return empty;
  }

  try {
    const { results } = await placesTextSearch(`${name} ${city} ${state}`);
    if (!results.length) return empty;
    const p = results[0];
    const details = await placeDetails(p.place_id);
    return {
      rating:       p.rating,
      review_count: p.user_ratings_total,
      place_id:     p.place_id,
      real_name:    p.name,
      gbp_city:     '',
      gbp_state:    '',
      phone:        details.phone,
      address:      details.address,
    };
  } catch { return empty; }
}

// Resolve a 2-letter state abbreviation to a full name using the Geocoding API.
// The Geocoding API (maps.googleapis.com/maps/api/geocode) is NOT the Places API —
// it has no v1 migration; keep the existing endpoint.
export async function resolveStateName(city: string, state: string): Promise<string> {
  if (!/^[A-Z]{2}$/i.test(state.trim())) return state;
  try {
    const q = encodeURIComponent(`${city}, ${state}, United States`);
    const r = await fetchT(`https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${process.env.GOOGLE_PLACES_API_KEY}`);
    const j = await r.json();
    const comps: any[] = j.results?.[0]?.address_components ?? [];
    const full = comps.find((c: any) => c.types.includes('administrative_area_level_1'))?.long_name;
    if (full) {
      console.log(`[GBP] State "${state}" resolved to "${full}" via Geocoding API`);
      return full;
    }
  } catch (e: any) {
    console.warn('[GBP] State name resolution failed:', e.message);
  }
  return state;
}

/** Fetch phone number for any place_id. */
export async function getPlacePhone(place_id: string): Promise<string> {
  return placePhone(place_id);
}

export interface GBPReviewInsights {
  replyRate: number | null;
  repliedCount: number;
  unansweredCount: number;
  totalChecked: number;
  avgRecentRating: number;
  hasUnansweredRecent: boolean;
  replyDataAvailable: boolean;
  snippets: string[];
}

function buildInsights(
  reviews: { text: string; rating: number; replied: boolean }[],
  replyDataAvailable = true,
): GBPReviewInsights {
  const repliedCount    = replyDataAvailable ? reviews.filter(r => r.replied).length : 0;
  const unansweredCount = replyDataAvailable ? reviews.length - repliedCount : 0;
  const replyRate       = !replyDataAvailable ? null : reviews.length > 0 ? repliedCount / reviews.length : 0;
  const avgRating       = reviews.reduce((s, r) => s + r.rating, 0) / Math.max(reviews.length, 1);
  const hasUnanswered   = replyDataAvailable && unansweredCount > 0;

  const unanswered = replyDataAvailable ? reviews.filter(r => !r.replied && r.text.trim().length > 20) : [];
  const replied    = replyDataAvailable ? reviews.filter(r =>  r.replied && r.text.trim().length > 20) : [];
  const allText    = reviews.filter(r => r.text.trim().length > 20);
  const ordered    = replyDataAvailable ? [...unanswered, ...replied].slice(0, 20) : allText.slice(0, 20);
  const snippets   = ordered.map(r => {
    const t = r.text.trim();
    const prefix = `"${t.substring(0, 160)}${t.length > 160 ? '…' : ''}" (${r.rating}★`;
    if (!replyDataAvailable) return `${prefix})`;
    return `${prefix} ${r.replied ? '[Owner replied]' : 'NO REPLY — MISSED OPPORTUNITY'})`;
  });

  if (replyDataAvailable) {
    console.log(`[GBP] Reviews: ${repliedCount}/${reviews.length} replied (${replyRate !== null ? (replyRate * 100).toFixed(0) : '?'}%) avg ${avgRating.toFixed(1)}★ unanswered:${unansweredCount}`);
  } else {
    console.log(`[GBP] Reviews: ${reviews.length} reviews avg ${avgRating.toFixed(1)}★ — reply data unavailable (owner_answer null across all DFS items)`);
  }
  return {
    replyRate, repliedCount, unansweredCount,
    totalChecked: reviews.length,
    avgRecentRating: Math.round(avgRating * 10) / 10,
    hasUnansweredRecent: hasUnanswered,
    replyDataAvailable,
    snippets,
  };
}

export async function getGBPReviewInsights(
  place_id: string,
  businessName?: string,
  city?: string,
  state?: string,
): Promise<GBPReviewInsights | null> {
  if (process.env.DATAFORSEO_LOGIN) {
    try {
      const submitTask = async (body: Record<string, any>): Promise<string | null> => {
        const res = await fetchT(
          'https://api.dataforseo.com/v3/business_data/google/reviews/task_post',
          {
            method: 'POST',
            headers: { Authorization: `Basic ${dfsAuth()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify([{ ...body, priority: 2 }]),
          },
          70000,
        );
        const json = await res.json();
        const task0 = json.tasks?.[0];
        const id: string | undefined = task0?.id;
        const sc: number | undefined = task0?.status_code;
        console.log(`[GBP] DFS task_post: top=${json.status_code} task_status=${sc} task_msg="${task0?.status_message}" id=${id ?? 'none'}`);
        if (!id || sc !== 20100) {
          console.warn(`[GBP] DFS task_post rejected or no ID — skipping poll`);
          return null;
        }
        return id;
      };

      const pollTask = async (taskId: string): Promise<any[]> => {
        const deadline = Date.now() + 60000;
        let firstPoll = true;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, firstPoll ? 8000 : 5000));
          firstPoll = false;
          const res = await fetchT(
            `https://api.dataforseo.com/v3/business_data/google/reviews/task_get/${taskId}`,
            { headers: { Authorization: `Basic ${dfsAuth()}` } },
          );
          const json = await res.json();
          const task0 = json.tasks?.[0];
          if (!task0) { console.warn('[GBP] DFS task_get: empty tasks'); break; }
          if (task0.status_code === 20000) {
            const result0 = task0.result?.[0];
            const items: any[] = result0?.items ?? [];
            console.log(`[GBP] DFS task ready: ${items.length} reviews place_id=${result0?.place_id ?? 'none'}`);
            if (items.length > 0) {
              const keys = [...new Set(items.flatMap((i: any) => Object.keys(i)))];
              console.log(`[GBP] Review item keys: ${keys.join(', ')}`);
              const nullCount    = items.filter(i => i.owner_answer === null).length;
              const nonNullCount = items.filter(i => i.owner_answer != null).length;
              const timeAgoCount = items.filter(i => i.owner_time_ago != null).length;
              console.log(`[GBP] owner_answer distribution: null=${nullCount} non-null=${nonNullCount} owner_time_ago_set=${timeAgoCount}`);
              const withReply = items.filter(i => i.owner_answer != null).slice(0, 3);
              withReply.forEach((item, idx) => {
                console.log(`[GBP] replied sample [${idx}]: rating=${item.rating?.value} text="${(item.review_text ?? '').substring(0, 60)}" owner_answer=${JSON.stringify(item.owner_answer)?.substring(0, 150)}`);
              });
            }
            return items;
          }
          if (task0.status_code >= 40000) {
            console.warn(`[GBP] DFS task error: ${task0.status_code} ${task0.status_message}`);
            break;
          }
          console.log(`[GBP] DFS task pending (${task0.status_code}) — retrying in 4s`);
        }
        console.warn(`[GBP] DFS task timeout/error for ${taskId}`);
        return [];
      };

      const hasOwnerReply = (item: any): boolean => {
        const oa = item.owner_answer ?? item.owner_response ?? item.reply ?? item.response;
        if (oa != null) {
          if (typeof oa === 'string') return oa.trim().length > 0;
          if (Array.isArray(oa)) return oa.length > 0 && !!(oa[0]?.text ?? oa[0]?.comment ?? '').trim();
          if (typeof oa === 'object') return !!(oa.text ?? oa.comment ?? oa.response ?? '').toString().trim();
        }
        return !!(item.owner_time_ago ?? item.owner_timestamp);
      };

      const fullState = city && state ? await resolveStateName(city, state) : state;
      const loc = city && fullState ? `${city},${fullState},United States` : null;
      const placeReq = place_id && loc
        ? { language_name: 'English', depth: 100, sort_by: 'newest', place_id, location_name: loc }
        : null;
      const kwReq = businessName && loc
        ? { language_name: 'English', depth: 100, sort_by: 'newest', keyword: businessName, location_name: loc }
        : null;
      const primaryReq  = placeReq ?? kwReq;
      const fallbackReq = placeReq && kwReq ? kwReq : null;

      let allItems: any[] = [];
      if (primaryReq) {
        const taskId = await submitTask(primaryReq);
        allItems = taskId ? await pollTask(taskId) : [];
      }
      if (allItems.length === 0 && fallbackReq) {
        console.log('[GBP] place_id task returned 0 — retrying with keyword+location');
        const fbId = await submitTask(fallbackReq);
        allItems = fbId ? await pollTask(fbId) : [];
      }

      const itemsWithReply = allItems.filter(i => i.owner_answer != null || i.owner_response != null || i.reply != null || i.owner_time_ago != null || i.owner_timestamp != null);
      const replyDataAvailable = itemsWithReply.length > 0;
      if (allItems.length > 0 && !replyDataAvailable) {
        console.warn(`[GBP] DFS: 0/${allItems.length} items have non-null owner_answer — using DFS text/ratings but marking reply data unavailable`);
      }

      const reviews = allItems
        .filter(i => i.review_text && i.review_text.trim().length > 10)
        .map(i => ({
          text:    i.review_text as string,
          rating:  i.rating?.value ?? 5,
          replied: hasOwnerReply(i),
        }));

      console.log(`[GBP] DataForSEO reviews: ${reviews.length} with text, ${reviews.filter(r => r.replied).length} with replies for "${businessName}" (replyData:${replyDataAvailable})`);
      if (reviews.length >= 1) return buildInsights(reviews, replyDataAvailable);
      console.warn(`[GBP] DataForSEO reviews: 0 text reviews — falling back to Places API`);
    } catch (e: any) {
      console.warn('[GBP] DataForSEO reviews failed, falling back to Places API:', e.message);
    }
  }

  // Fallback: Google Places API v1 — up to 5 most relevant reviews.
  // ownerResponse is not exposed in this endpoint; mark replyDataAvailable:false.
  if (!place_id || !process.env.GOOGLE_PLACES_API_KEY) return null;
  try {
    const r = await fetchT(
      `https://places.googleapis.com/v1/places/${place_id}`,
      {
        headers: {
          'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY!,
          'X-Goog-FieldMask': 'reviews,rating',
        },
      }
    );
    const j = await r.json();
    const raw: any[] = j.reviews ?? [];
    if (!raw.length) {
      console.warn('[GBP] Places API v1: no reviews returned for place_id:', place_id, '| response:', JSON.stringify(j).substring(0, 300));
      return null;
    }
    const reviews = raw
      .filter(rv => (rv.text?.text ?? rv.originalText?.text ?? '').trim().length > 10)
      .map(rv => ({
        text:    rv.text?.text ?? rv.originalText?.text ?? '',
        rating:  rv.rating ?? 5,
        replied: false,
      }));
    console.log(`[GBP] Places API v1: ${reviews.length} reviews fetched (reply data unavailable from this endpoint)`);
    return buildInsights(reviews, false);
  } catch (e: any) {
    console.warn('[GBP] Could not fetch review insights:', e.message);
    return null;
  }
}

export async function getGBPPostsPerWeek(
  businessName: string, city: string, state: string, place_id = ""
): Promise<number | null> {
  try {
    const fullState = await resolveStateName(city, state);
    const reqBody: any = {
      keyword: businessName,
      location_name: `${city},${fullState},United States`,
      language_name: 'English',
    };
    if (place_id) reqBody.place_id = place_id;

    const res = await fetchT(
      'https://api.dataforseo.com/v3/business_data/google/my_business_posts/live/advanced',
      {
        method: 'POST',
        headers: { Authorization: `Basic ${dfsAuth()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([reqBody]),
      }
    );
    const json = await res.json();
    const posts: any[] = json.tasks?.[0]?.result?.[0]?.items ?? [];
    if (!posts.length) {
      console.log(`[GBP] No GBP posts found for "${businessName}" @ ${city}`);
      return 0;
    }
    const cutoff = Date.now() - 28 * 24 * 60 * 60 * 1000;
    const recent = posts.filter((p: any) => p.date_posted && new Date(p.date_posted).getTime() > cutoff);
    const perWeek = recent.length / 4;
    console.log(`[GBP] Posts for "${businessName}": ${recent.length} in 28 days = ${perWeek.toFixed(1)}/week`);
    return perWeek;
  } catch (e: any) {
    console.warn('[GBP] Could not fetch GBP posts:', e.message);
    return null;
  }
}

export async function getPlaceCoords(place_id: string): Promise<{ lat: number; lng: number } | null> {
  return placeCoords(place_id);
}
