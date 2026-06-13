import puppeteer from 'puppeteer-core';
import { puppeteerOpts, CRAWL_UA } from '../lib/browser';
import type { PlaceResult } from '../lib/places';

// Direct Google Maps scrape — the exact surface a prospect sees when they search
// "hvac in toledo" on Google Maps. No third-party SERP API in between, so the
// report's ranking matches a manual check on the same URL.
//
// google.com/maps does not CAPTCHA headless browsers the way google.com/search
// does, but a failure here must not kill report generation — callers fall back
// to DataForSEO when this returns null.

export interface GmapsPackResult {
  places: PlaceResult[];
  mapsUrl: string;
}

// Zoom 11 ≈ city-wide view. The URL is stored as the verification link, so a
// client opening it sees the same viewport the ranking was scraped from.
export function buildMapsSearchUrl(vertical: string, city: string, lat: number, lng: number): string {
  const q = encodeURIComponent(`${vertical.toLowerCase()} in ${city.toLowerCase()}`).replace(/%20/g, '+');
  return `https://www.google.com/maps/search/${q}/@${lat},${lng},11z?hl=en`;
}

// Bare Maps viewport URL (no search) — starting point for the typed-search flow.
function buildMapsHomeUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/@${lat},${lng},11z?hl=en`;
}

// "1.8K" → 1800, "1,846" → 1846
function parseCount(s: string): number {
  const t = s.replace(/,/g, '').trim();
  if (/k$/i.test(t)) return Math.round(parseFloat(t) * 1000);
  return parseInt(t, 10) || 0;
}

export async function scrapeMapsPack(
  vertical: string,
  city: string,
  coords: { lat: number; lng: number },
  maxResults = 20,
): Promise<GmapsPackResult | null> {
  const query = `${vertical.toLowerCase()} in ${city.toLowerCase()}`;
  let mapsUrl = buildMapsSearchUrl(vertical, city, coords.lat, coords.lng);
  let browser;
  try {
    browser = await puppeteer.launch(await puppeteerOpts());
    const page = await browser.newPage();
    await page.setUserAgent(CRAWL_UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 1280, height: 1000 });

    // Type the query into the Maps search box instead of navigating straight to a
    // /maps/search/ URL. Direct URL navigation returns a server-rendered ranking
    // that real browsers never see (verified Jun 2026: it reordered #2–#7 vs every
    // real browser, signed-in or private). The interactive search hits the same
    // live endpoint a human's keystroke does and matches manual checks.
    let typed = false;
    try {
      await page.goto(buildMapsHomeUrl(coords.lat, coords.lng), { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Google renames the box id periodically (#searchboxinput → #ucc-1); name="q" is stable.
      const box = await page.waitForSelector('input[name="q"], input#searchboxinput', { timeout: 20000 });
      await new Promise(r => setTimeout(r, 1500));
      await box!.click();
      await page.type('input[name="q"], input#searchboxinput', query, { delay: 60 });
      await page.keyboard.press('Enter');
      typed = true;
    } catch (e: any) {
      console.warn(`[Gmaps] typed-search flow failed (${e.message.slice(0, 60)}) — falling back to URL navigation`);
      await page.goto(mapsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForSelector('div[role="feed"]', { timeout: 25000 });
    // The post-search URL carries the real data/g_ep params — store it as the
    // verification link so opening it reproduces this exact ranking.
    if (typed && page.url().includes('/maps/search/')) mapsUrl = page.url();

    // Scroll the results feed until we have enough cards (Maps lazy-loads ~7 at a time).
    for (let i = 0; i < 8; i++) {
      const count = await page.evaluate(() =>
        document.querySelectorAll('div[role="feed"] a[href*="/maps/place/"]').length);
      if (count >= maxResults) break;
      await page.evaluate(() => {
        const f = document.querySelector('div[role="feed"]');
        if (f) f.scrollBy(0, 2500);
      });
      await new Promise(r => setTimeout(r, 1200));
    }

    type RawCard = { name: string; href: string; text: string; ratingAria: string };
    const extractRaw = (): Promise<RawCard[]> => page.evaluate(() => {
      const out: Array<{ name: string; href: string; text: string; ratingAria: string }> = [];
      document.querySelectorAll('div[role="feed"] a[href*="/maps/place/"]').forEach(a => {
        const card = (a.closest('div[jsaction]') ?? a.parentElement) as HTMLElement | null;
        // Rating lives in a span[role=img] aria-label: "4.6 stars" or "4.6 stars 435 Reviews"
        const img = card?.querySelector('span[role="img"]');
        out.push({
          name: a.getAttribute('aria-label') ?? '',
          href: a.getAttribute('href') ?? '',
          text: card?.innerText ?? '',
          ratingAria: img?.getAttribute('aria-label') ?? '',
        });
      });
      return out;
    });

    // Google keeps re-ranking the feed for a few seconds after results first render
    // (transient leaders appear, then settle). Parsing that intermediate order is the
    // main source of the ±1-2 position drift, so poll until the top-8 order is unchanged
    // across two consecutive reads before trusting it. Falls through after maxRounds so a
    // perpetually-churning feed still returns its latest snapshot rather than hanging.
    const topKey = (cards: RawCard[]) => cards.slice(0, 8).map(c => c.name).join('|');
    let raw = await extractRaw();
    let prevKey = topKey(raw);
    for (let round = 0; round < 6; round++) {
      await new Promise(r => setTimeout(r, 1200));
      const next = await extractRaw();
      const nextKey = topKey(next);
      if (nextKey === prevKey && next.length >= 5) { raw = next; break; }
      raw = next;
      prevKey = nextKey;
    }

    const seen = new Set<string>();
    const places: PlaceResult[] = [];
    for (const r of raw) {
      if (!r.name) continue;
      const key = r.name.toLowerCase().trim();
      if (seen.has(key)) continue;
      // Ads are labelled "Sponsored" inside the card — they are not organic rank.
      if (/^sponsored$/im.test(r.text)) continue;
      seen.add(key);
      // Rating from aria-label ("4.6 stars" / "4.6 stars 435 Reviews"); review count
      // from the aria-label when present, else from card text like "4.7(360)".
      // Some layouts omit the count entirely — callers enrich 0-counts via Places API.
      const ra = r.ratingAria.match(/^([\d.]+)\s+stars?(?:\s+([\d.,]+K?)\s+Reviews?)?/i);
      const tm = r.text.match(/(\d\.\d)\(([\d.,]+K?)\)/i);
      // place_id is embedded in the card link: ...!19sChIJ6TmK2rh_PIgRnIOxwnV026o...
      const pm = r.href.match(/!19s([A-Za-z0-9_-]+)/);
      places.push({
        place_id:           pm?.[1] ?? '',
        name:               r.name,
        rating:             ra ? parseFloat(ra[1]) : tm ? parseFloat(tm[1]) : 0,
        user_ratings_total: ra?.[2] ? parseCount(ra[2]) : tm ? parseCount(tm[2]) : 0,
      });
      if (places.length >= maxResults) break;
    }

    if (!places.length) {
      console.warn(`[Gmaps] 0 results parsed for "${vertical} in ${city}" (page: ${page.url().slice(0, 80)})`);
      return null;
    }
    console.log(`[Gmaps] scraped ${places.length} results for "${vertical} in ${city}"`);
    return { places, mapsUrl };
  } catch (e: any) {
    console.warn('[Gmaps] scrape failed:', e.message);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
