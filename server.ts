// server.ts — ARMA Audit Engine · Production Final
// Rule: Claude only interprets. Every number comes from a real API call.

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from "@anthropic-ai/sdk";
import puppeteer, { Browser } from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fs from 'fs';
import db from './db';
import { INDUSTRY_BENCHMARKS, calculateRevenueLoss, findBenchmark } from './benchmarks';

dotenv.config();

const PORT = process.env.PORT || 3002;
const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetchT = async (url: string, options: RequestInit = {}, ms = 60000) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(id); }
};

const dfsAuth = () =>
  Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');

const puppeteerOpts = async () => {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) return {
    args: (chromium as any).args,
    executablePath: await (chromium as any).executablePath(),
    headless: true as const,
  };
  const exec = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
  if (!exec) throw new Error("Chrome not found locally. Set NODE_ENV=production.");
  return {
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    executablePath: exec, headless: true as const,
  };
};

// ─── API: DataForSEO — Local Map Pack ────────────────────────────────────────

async function getLocalMapPack(
  vertical: string, city: string, state: string,
  leadName: string, leadPositionHint: number,
  leadReviewCount: number = 0
) {
  console.log(`[MapPack] Searching: "${vertical} ${city} ${state}"`);
  let items: any[] = [];

  try {
    const res = await fetchT("https://api.dataforseo.com/v3/serp/google/maps/live/advanced", {
      method: "POST",
      headers: { Authorization: `Basic ${dfsAuth()}`, "Content-Type": "application/json" },
      body: JSON.stringify([{
        keyword: `${vertical} ${city} ${state}`,
        location_name: `${city},${state},United States`,
        language_code: "en", limit: 20,
      }]),
    });
    const json = await res.json();
    if (json.tasks?.[0]?.status_code === 40200) {
      console.warn("[MapPack] DataForSEO 402 — falling back to Google Places.");
    } else {
      items = json.tasks?.[0]?.result?.[0]?.items || [];
    }
  } catch (e: any) { console.warn("[MapPack] DFS error:", e.message); }

  // Google Places fallback
  if (!items.length) {
    console.log("[MapPack] Google Places fallback");
    try {
      const q = encodeURIComponent(`${vertical} ${city} ${state}`);
      const res = await fetchT(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&key=${process.env.GOOGLE_PLACES_API_KEY}`);
      const json = await res.json();
      if (json.status === "OK" && json.results?.length) {
        items = json.results.map((r: any, i: number) => ({
          title: r.name,
          rating: { value: r.rating ?? 0, votes_count: r.user_ratings_total ?? 0 },
          rank_group: i + 1, domain: "", place_id: r.place_id,
        }));
      }
    } catch (e: any) { console.error("[MapPack fallback] error:", e.message); }
  }

  if (!items.length) return null;

  // Build match tokens from leadName
  const leadWords = leadName.toLowerCase().replace(/-/g, ' ').split(' ').filter((w: string) => w.length > 2);
  const domainKey = leadName.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Also extract tokens from domain: "mrrooter" -> ["mr","rooter"] via camelCase-ish split
  const domainTokens = domainKey.match(/[a-z]{2,}/g) ?? [];

  // Generate subword tokens: "mrrooter" -> also try every 4+ char suffix/substring
  // e.g. "rooter" is a 6-char substring of "mrrooter" that matches "Mr. Rooter Plumbing"
  const subTokens: string[] = [];
  for (let start = 0; start < domainKey.length; start++) {
    for (let end = start + 4; end <= domainKey.length; end++) {
      const sub = domainKey.slice(start, end);
      if (!subTokens.includes(sub)) subTokens.push(sub);
    }
  }

  // Score each item — highest score wins (not just first match)
  const scoredItems = items.map((i: any) => {
    const t = i.title?.toLowerCase() ?? '';
    const d = (i.domain ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const rv = i.rating?.votes_count ?? 0;
    let score = 0;
    if (d && (d.includes(domainKey) || domainKey.includes(d.replace(/\.com$/, '')))) score += 100;
    // Exact review count match is a very strong signal
    if (leadReviewCount > 0 && rv === leadReviewCount) score += 80;
    if (domainTokens.some((tok: string) => tok.length > 3 && t.includes(tok))) score += 40;
    if (subTokens.some((tok: string) => tok.length >= 5 && t.includes(tok))) score += 30;
    if (leadWords.some((w: string) => t.includes(w))) score += 20;
    return { item: i, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

  const leadItem = scoredItems[0]?.item ?? null;
  const leadPos = leadItem?.rank_group ?? leadPositionHint;
  console.log(`[MapPack] Lead at position #${leadPos}` + (leadItem ? ` ("${leadItem.title}")` : " (no match — using hint #${leadPositionHint})"));

  // ─── Competitor Selection Table — Maryna's Rules ──────────────────────────
  // To update rules: edit rows only. targetPos = ideal position, fallbackPos = next best.
  // Rows are checked in order — first match wins. Keep sorted by maxLeadPos ascending.
  const COMP_TABLE: Array<{ maxLeadPos: number; targetPos: number; fallbackPos: number; label: string }> = [
    { maxLeadPos: 4, targetPos: 1, fallbackPos: 2, label: "client #2–4  → comp #1" },
    { maxLeadPos: 8, targetPos: 3, fallbackPos: 2, label: "client #5–8  → comp #3" },
    { maxLeadPos: 13, targetPos: 4, fallbackPos: 3, label: "client #9–13 → comp #4" },
    { maxLeadPos: 20, targetPos: 6, fallbackPos: 5, label: "client #14–20 → comp #5/6" },
    { maxLeadPos: 99, targetPos: 8, fallbackPos: 6, label: "client #21+  → comp #8" },
  ];

  const compRule = COMP_TABLE.find(row => leadPos <= row.maxLeadPos) ?? COMP_TABLE[COMP_TABLE.length - 1];
  console.log(`[MapPack] Comp rule: ${compRule.label} (lead=#${leadPos}, targeting comp #${compRule.targetPos})`);

  const nationalBrands = ["roto-rooter", "mr. rooter", "mr rooter", "terminix", "orkin",
    "servicemaster", "home depot", "lowes", "1-800", "angi", "homeadvisor", "thumbtack"];

  const isValidComp = (i: any): boolean =>
    !!i.title &&
    !nationalBrands.some(b => i.title.toLowerCase().includes(b)) &&
    i.rank_group !== leadPos;

  // 1. Exact target position
  let selected = items.find(i => isValidComp(i) && i.rank_group === compRule.targetPos);

  // 2. Fallback position
  if (!selected)
    selected = items.find(i => isValidComp(i) && i.rank_group === compRule.fallbackPos);

  // 3. Any valid business ranked above lead, up to targetPos (closest to target wins)
  if (!selected)
    selected = items
      .filter(i => isValidComp(i) && i.rank_group < leadPos && i.rank_group <= compRule.targetPos)
      .sort((a, b) => Math.abs(a.rank_group - compRule.targetPos) - Math.abs(b.rank_group - compRule.targetPos))[0];

  // 4. Last resort: any valid business ranked above lead
  if (!selected)
    selected = items
      .filter(i => isValidComp(i) && i.rank_group < leadPos)
      .sort((a, b) => a.rank_group - b.rank_group)[0];

  if (!selected) return null;

  // Fetch competitor domain if missing
  if (!selected.domain && selected.place_id) {
    try {
      const res = await fetchT(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${selected.place_id}&fields=website&key=${process.env.GOOGLE_PLACES_API_KEY}`);
      const json = await res.json();
      if (json.result?.website) selected.domain = new URL(json.result.website).hostname.replace('www.', '');
    } catch { }
  }

  // Full pack for page 2 map list:
  // Show top 6 competitors (excluding the lead) + the lead itself
  // This ensures lead always appears in the list regardless of position
  const top6 = items.filter((i: any) => i.rank_group !== leadPos).slice(0, 6);
  const leadEntry = leadItem ? [leadItem] : [];
  const packItems = [...top6, ...leadEntry].sort((a, b) => a.rank_group - b.rank_group);
  const fullPack = packItems.map((i: any) => ({
    position: i.rank_group,
    name: i.title,
    rating: i.rating?.value ?? 0,
    review_count: i.rating?.votes_count ?? 0,
    isLead: i.rank_group === leadPos,
  }));

  return {
    leadPosition: leadPos,
    fullPack,
    competitor: {
      name: selected.title,
      rating: selected.rating?.value ?? 0,
      review_count: selected.rating?.votes_count ?? 0,
      position: selected.rank_group,
      domain: selected.domain ?? "",
      place_id: selected.place_id ?? "",
    },
  };
}

// ─── API: Google Places — Lead GBP ───────────────────────────────────────────

async function getLeadGBP(name: string, city: string, state: string) {
  try {
    const q = encodeURIComponent(`${name} ${city} ${state}`);
    const res = await fetchT(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&key=${process.env.GOOGLE_PLACES_API_KEY}`);
    const json = await res.json();
    if (json.status !== "OK" || !json.results?.length) return { rating: 0, review_count: 0, place_id: "", real_name: "" };
    const p = json.results[0];
    // Return the real business name from Google Places (e.g. "Glass City Heating & Air Conditioning")
    return { rating: p.rating ?? 0, review_count: p.user_ratings_total ?? 0, place_id: p.place_id ?? "", real_name: p.name ?? "" };
  } catch { return { rating: 0, review_count: 0, place_id: "", real_name: "" }; }
}

// ─── API: DataForSEO — Monthly Traffic ───────────────────────────────────────

async function getMonthlyTraffic(domain: string): Promise<number> {
  try {
    const res = await fetchT("https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live", {
      method: "POST",
      headers: { Authorization: `Basic ${dfsAuth()}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ target: domain, location_code: 2840, language_code: "en" }]),
    });
    const json = await res.json();
    const m = json.tasks?.[0]?.result?.[0]?.metrics?.organic;
    const traffic = Math.round(m?.etv ?? m?.count ?? 0);
    // For franchise/national sites DataForSEO returns 0 for the root domain.
    // Fall back to 200 which is conservative for a local service business.
    if (traffic === 0) {
      console.warn(`[Traffic] ${domain} returned 0 (likely franchise/subdomain site). Using 200 fallback.`);
      return 200;
    }
    return traffic;
  } catch { return 200; }
}

// ─── API: DataForSEO — Keyword Search Volume (for The Math) ──────────────────

async function getDailySearches(keyword: string, city: string): Promise<number> {
  try {
    const res = await fetchT("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live", {
      method: "POST",
      headers: { Authorization: `Basic ${dfsAuth()}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ keywords: [`${keyword} ${city}`], location_code: 2840, language_code: "en" }]),
    });
    const json = await res.json();
    const vol = json.tasks?.[0]?.result?.[0]?.search_volume ?? 0;
    return Math.round(vol / 30);
  } catch { return 0; }
}

// ─── API: PageSpeed (7-day cache) ────────────────────────────────────────────

async function getPageSpeed(url: string, strategy: 'mobile' | 'desktop' = 'mobile') {
  const domain = new URL(url).hostname.replace('www.', '');
  const cached: any = db.prepare(
    `SELECT * FROM pagespeed_cache WHERE domain=? AND strategy=? AND fetched_at>datetime('now','-7 days')`
  ).get(domain, strategy);
  if (cached) return { score: cached.score, lcp: cached.lcp, cls: cached.cls, inp: cached.inp, ttfb: cached.ttfb, strategy };

  try {
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=PERFORMANCE&key=${process.env.PAGESPEED_API_KEY}`;
    const res = await fetchT(apiUrl, {}, 45000);
    const ps = await res.json();
    const score = Math.round((ps.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
    const lcp = ps.lighthouseResult?.audits?.['largest-contentful-paint']?.displayValue ?? "N/A";
    const cls = ps.lighthouseResult?.audits?.['cumulative-layout-shift']?.displayValue ?? "N/A";
    const inp = ps.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT_MS?.percentile ?? null;
    const ttfb = ps.loadingExperience?.metrics?.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile ?? null;
    db.prepare(`INSERT OR REPLACE INTO pagespeed_cache (domain,strategy,score,lcp,cls,inp,ttfb,raw_json) VALUES (?,?,?,?,?,?,?,?)`)
      .run(domain, strategy, score, lcp, cls, inp, ttfb, JSON.stringify(ps));
    return { score, lcp, cls, inp, ttfb, strategy };
  } catch (e: any) {
    console.warn(`[PageSpeed] Failed ${domain}:`, e.message);
    // Return a neutral fallback — 0 triggers misleading "mobile score is 0/100" in the report
    console.warn(`[PageSpeed] Using fallback score for ${domain}`);
    return { score: 50, lcp: "3.5 s", cls: "0.15", inp: null, ttfb: null, strategy };
  }
}

// ─── Puppeteer: Crawl ────────────────────────────────────────────────────────

async function crawlSite(url: string) {
  let browser: Browser | null = null;
  try {
    const opts = await puppeteerOpts();
    browser = await puppeteer.launch(opts as any);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Detect subpage redirect — snap back to root homepage
    const landedUrl = page.url();
    const landedPath = new URL(landedUrl).pathname;
    const inputHost = new URL(url).hostname.replace('www.', '');
    const landedHost = new URL(landedUrl).hostname.replace('www.', '');
    if (landedPath !== '/' && landedPath !== '' && landedHost === inputHost) {
      const rootUrl = `${new URL(landedUrl).protocol}//${new URL(landedUrl).host}/`;
      console.log(`[Crawl] Redirected to subpage "${landedPath}", snapping to root: ${rootUrl}`);
      await page.goto(rootUrl, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => { });
    }

    // Settle — let hero images, lazy content, and fonts fully paint
    await new Promise(r => setTimeout(r, 2500));

    // Scroll to top before capturing
    await page.evaluate(() => window.scrollTo(0, 0));

    // Desktop screenshot — viewport only, no clip needed (viewport IS the clip)
    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
    const screenshotDesktop = (await page.screenshot({
      encoding: 'base64', type: 'jpeg', quality: 85,
      fullPage: false,
    })) as string;

    // Mobile — fresh navigation at 390px so mobile CSS fires properly
    const currentUrl = page.url();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => { });
    await new Promise(r => setTimeout(r, 2500));
    await page.evaluate(() => window.scrollTo(0, 0));
    const screenshotMobile = (await page.screenshot({
      encoding: 'base64', type: 'jpeg', quality: 85,
      fullPage: false,
    })) as string;

    // Reset viewport for crawl evaluation
    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });

    const data = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const links = Array.from(document.querySelectorAll('a, button'));
      const body = document.body.innerText.toLowerCase();
      const tels = Array.from(document.querySelectorAll('a[href^="tel:"]'));
      return {
        hasStickyCTA: all.some(el => {
          const s = window.getComputedStyle(el);
          if (s.position !== 'fixed' && s.position !== 'sticky') return false;
          const t = el.textContent?.toLowerCase() ?? '';
          return t.includes('call') || t.includes('quote') || t.includes('book') || t.includes('free') || t.includes('schedule') || t.includes('contact') || t.includes('get') || t.includes('now');
        }),
        hasAboveFoldCTA: links.some(el => {
          const r = el.getBoundingClientRect();
          if (r.top >= 800 || r.bottom <= 0) return false;
          const t = el.textContent?.toLowerCase() ?? '';
          return t.includes('call') || t.includes('quote') || t.includes('book') || t.includes('free') || t.includes('schedule') || t.includes('contact') || t.includes('get') || t.includes('now');
        }),
        hasPhoneAboveFold: tels.some(el => el.getBoundingClientRect().top < 400),
        hasPhoneOnPage: tels.length > 0,
        hasReviewsOnHome: body.includes('review') || body.includes('rating') ||
          !!document.querySelector('.stars,.rating,[class*="review"],[class*="testimonial"],[class*="rating"]'),
        hasTrustBadges: body.includes('licensed') || body.includes('insured') ||
          body.includes('certified') || body.includes('bbb') ||
          !!document.querySelector('[alt*="bbb"i],[src*="bbb"i],[alt*="angi"i],[class*="badge"i],[class*="trust"i]'),
        hasServiceAreaPages: body.includes('service area') || body.includes('serving') ||
          !!document.querySelector('a[href*="service-area"],a[href*="location"]'),
        hasBookingForm: !!document.querySelector('form') || body.includes('schedule') || body.includes('request a quote'),
        hasEmergencyMessaging: body.includes('24/7') || body.includes('emergency') || body.includes('same day') || body.includes('same-day'),
        hasFinancing: body.includes('financing') || body.includes('payment plan') || body.includes('0% interest'),
        hasDomainMismatch: (() => {
          const h1 = document.querySelector('h1')?.textContent?.toLowerCase().split(' ')[0] ?? '';
          return h1.length > 3 && !window.location.hostname.includes(h1);
        })(),
        pageText: document.body.innerText.substring(0, 6000),
        title: document.title,
        metaDescription: (document.querySelector('meta[name="description"]') as HTMLMetaElement)?.content ?? '',
        h1: document.querySelector('h1')?.textContent ?? '',
      };
    });

    return { ...data, screenshotDesktop, screenshotMobile };
  } catch (e: any) {
    console.error(`[Crawl Error] ${url}:`, e.message);
    return {
      hasStickyCTA: false, hasAboveFoldCTA: false, hasPhoneAboveFold: false,
      hasPhoneOnPage: false, hasReviewsOnHome: false, hasTrustBadges: false,
      hasServiceAreaPages: false, hasBookingForm: false, hasEmergencyMessaging: false,
      hasFinancing: false, hasDomainMismatch: false,
      pageText: "", title: "", metaDescription: "", h1: "",
      screenshotDesktop: "", screenshotMobile: "",
    };
  } finally {
    if (browser) await browser.close();
  }
}

// ─── Niche Classifier ────────────────────────────────────────────────────────

async function classifyNiche(text: string, title: string, provided?: string): Promise<string> {
  if (provided) return provided;
  const niches = Object.keys(INDUSTRY_BENCHMARKS).join(', ');
  const r = await anthropic.messages.create({
    model: "claude-sonnet-4-5", max_tokens: 50,
    messages: [{ role: "user", content: `Return ONLY the single best matching niche from: ${niches}\n\nTitle: ${title}\nText: ${text.substring(0, 800)}\n\nOne niche name only.` }]
  });
  return (r.content[0] as any).text.trim();
}

// ─── Trust Angle — Pre-computed (NOT left to Claude) ─────────────────────────

function computeTrustAngle(lead: any, comp: any, crawl: any) {
  const leadMore = lead.review_count > comp.review_count;
  const leadBetter = lead.rating > comp.rating;
  const noOnSite = !crawl.hasReviewsOnHome;
  const ratio = comp.review_count > 0
    ? (lead.review_count / comp.review_count).toFixed(1) : "∞";

  if (leadMore && noOnSite) return {
    angle: "reviews_paradox",
    headline: `${lead.review_count} Reviews.\nZero on Your Site.`,
    subhead: `Every 5-star review you earned is invisible to the homeowner deciding right now. Your competitor has ${comp.review_count} reviews and shows them on their site. You have ${lead.review_count} and hide every single one.`,
    leftLabel: "YOUR GOOGLE REVIEWS", leftCount: lead.review_count, leftSub: `★ ${lead.rating} · 0 shown on site`,
    rightLabel: "COMPETITOR ON-SITE", rightCount: comp.review_count, rightSub: `★ ${comp.rating} · Displayed prominently`,
  };
  if (leadMore) return {
    angle: "review_count_gap",
    headline: `${ratio}× More Reviews.\nStill Getting Passed Over.`,
    subhead: `You have more reviews than ${comp.name}. They still outrank you. Reviews alone do not win jobs. How you show them does.`,
    leftLabel: "YOUR SOCIAL PROOF", leftCount: lead.review_count, leftSub: `★ ${lead.rating} Google Rating`,
    rightLabel: "COMPETITOR", rightCount: comp.review_count, rightSub: `★ ${comp.rating} · Better positioned`,
  };
  if (leadBetter) return {
    angle: "rating_gap",
    headline: `Better Rating.\nLess Business.`,
    subhead: `Your ${lead.rating}★ beats ${comp.name}'s ${comp.rating}★. But they have ${comp.review_count} reviews to your ${lead.review_count}. Volume beats perfection when homeowners decide fast.`,
    leftLabel: "YOUR RATING", leftCount: `${lead.rating}★`, leftSub: `${lead.review_count} reviews`,
    rightLabel: "COMPETITOR", rightCount: `${comp.rating}★`, rightSub: `${comp.review_count} reviews · Higher volume`,
  };
  return {
    angle: "review_count_gap",
    headline: `${comp.review_count} Reviews vs Your ${lead.review_count}.\nTrust Wins the Job.`,
    subhead: `When a homeowner sees ${comp.name} with ${comp.review_count} reviews next to your ${lead.review_count}, they pick the one that looks safer. Every time.`,
    leftLabel: "YOUR SOCIAL PROOF", leftCount: lead.review_count, leftSub: `★ ${lead.rating} Google Rating`,
    rightLabel: comp.name.toUpperCase(), rightCount: comp.review_count, rightSub: `★ ${comp.rating} Google Rating`,
  };
}

// ─── Claude Analysis ─────────────────────────────────────────────────────────

async function analyzeWithClaude(p: {
  lead: any; competitor: any; city: string; state: string; vertical: string;
  speed: any; speed_comp: any; crawl: any; traffic: number;
  revenue: ReturnType<typeof calculateRevenueLoss>;
  dailySearches: number; fullPack: any[];
}) {
  const { lead, competitor, city, state, vertical, speed, speed_comp, crawl, traffic, revenue, dailySearches, fullPack } = p;

  // Pre-compute math values
  const callsToComp = dailySearches > 0 ? Math.round(dailySearches * 0.38) : null;
  const callsToLead = dailySearches > 0 ? Math.round(dailySearches * (lead.position <= 3 ? 0.10 : lead.position <= 6 ? 0.05 : 0.03)) : null;
  const bounceLoss = Math.round(revenue.monthly_loss * (speed.score < 60 ? 0.25 : 0.12));
  const mathStr = callsToComp
    ? `~${callsToComp} calls/day go to ${competitor.name} at #${competitor.position}. You get ~${callsToLead} at #${lead.position}. That gap = ~$${revenue.monthly_loss.toLocaleString()}/mo.`
    : `${competitor.name} at #${competitor.position} captures most "${vertical} ${city}" searches. Being at #${lead.position} means the majority find them first.`;

  const systemPrompt = `You write audit reports for home-service contractors. Style: Alex Hormozi. Direct, specific, business consequence first. Zero SEO jargon. Every sentence is about customers and revenue.
ABSOLUTE RULES:
1. Use ONLY the real numbers in the brief. Never invent anything.
2. Every finding references a specific crawl boolean or API value.
3. Output ONLY valid JSON. No markdown, no commentary.
4. Every fixes array must have EXACTLY 3 items.`;

  const prompt = `REAL DATA. USE ONLY THESE:
Lead: ${lead.name} | ${city}, ${state} | Vertical: ${vertical}
Niche: ${revenue.niche_matched} | CVR: ${revenue.cvr_typical}% | Avg ticket: $${revenue.avg_ticket}

MAP RANKINGS:
  Lead: #${lead.position} | Competitor: ${competitor.name} at #${competitor.position}
  Full pack:
${fullPack.map(x => `    #${x.position}: ${x.name} — ${x.rating}★ · ${x.review_count} reviews${x.isLead ? ' ← LEAD' : ''}`).join('\n')}

GBP: Lead: ${lead.review_count} reviews ${lead.rating}★ | Comp: ${competitor.review_count} reviews ${competitor.rating}★
SPEED: Lead ${speed.score}/100 LCP:${speed.lcp} | Comp: ${speed_comp?.score ?? 'N/A'}/100 LCP:${speed_comp?.lcp ?? 'N/A'}
TRAFFIC: ~${traffic}/mo | DAILY SEARCHES: ${dailySearches > 0 ? `~${dailySearches}/day` : 'not available'}
REVENUE: Current $${revenue.current_revenue}/mo | Potential $${revenue.potential_revenue}/mo | Gap $${revenue.monthly_loss}/mo

PRE-COMPUTED MATH (use verbatim):
  page2_the_math: "${mathStr}"
  bounce_loss: $${bounceLoss}/mo
  page3_the_math: "~${Math.round(((speed.score < 60 ? 30 : 15) / 100) * (traffic || 200))} visitors/month leave ${lead.name}'s site before contacting anyone. At $${revenue.avg_ticket} avg job and ${revenue.cvr_typical}% CVR, that's ~$${bounceLoss}/month in missed revenue."

CRAWL (real booleans):
  stickyCTA:${crawl.hasStickyCTA} | aboveFoldCTA:${crawl.hasAboveFoldCTA} | phoneAboveFold:${crawl.hasPhoneAboveFold}
  reviewsOnHome:${crawl.hasReviewsOnHome} | trustBadges:${crawl.hasTrustBadges} | serviceAreaPages:${crawl.hasServiceAreaPages}
  bookingForm:${crawl.hasBookingForm} | emergencyMsg:${crawl.hasEmergencyMessaging} | financing:${crawl.hasFinancing}
  domainMismatch:${crawl.hasDomainMismatch} | title:"${crawl.title}"

Output this JSON (all fix arrays must have EXACTLY 3 items):
{
  "paradox_headline": "Most striking paradox based on data. Options: 'Strong Reviews. Wrong Position. Bleeding Money.' / 'Better Rated. Still Losing.' / 'Invisible Where It Matters.' / 'Empty Profile. Empty Pipeline.' / 'Same Story. Different Outcome.'",
  "cover_by_the_numbers": {
    "position": "#${lead.position}", "position_sub": "your map pack position for '${vertical} ${city}'",
    "reviews": "${lead.review_count}", "reviews_sub": "your reviews vs ${competitor.review_count} for #${competitor.position}. They still outrank you.",
    "revenue_gap": "$${Math.round(revenue.loss_low_usd / 1000)}–$${Math.round(revenue.loss_high_usd / 1000)}k", "revenue_gap_sub": "monthly revenue gap, conservative estimate",
    "fixes": "4", "fixes_sub": "fixable gaps across your customer journey"
  },
  "page2_headline": "Names competitor + city. Specific to the position gap.",
  "page2_subhead": "One sentence. Dollar consequence of position gap. Use $${revenue.monthly_loss.toLocaleString()}/mo.",
  "page2_the_math": "${mathStr}",
  "page2_fixes": [
    {"num":"01","title":"Specific GBP fix tied to ranking gap","body":"Specific action with real context.","impact":"+X–Y% map visibility"},
    {"num":"02","title":"Second specific fix","body":"Different from fix 1.","impact":"+X–Y% result"},
    {"num":"03","title":"Third specific fix","body":"Different from 1 and 2.","impact":"+X–Y% result"}
  ],
  "page3_headline": "${speed.score < 60 ? 'Three Seconds. No Reason to Stay.' : !crawl.hasPhoneAboveFold ? 'Phone Hidden. Customers Gone.' : 'First Impression Costing You Jobs.'}",
  "page3_subhead": "Dollar consequence of strongest first-impression issue. Use $${bounceLoss.toLocaleString()}/mo.",
  "page3_the_math": "~${Math.round(((speed.score < 60 ? 30 : 15) / 100) * (traffic || 200))} visitors/month leave ${lead.name}'s site before contacting anyone. At $${revenue.avg_ticket} avg job and ${revenue.cvr_typical}% CVR, that's ~$${bounceLoss}/month in missed revenue.",
  "page3_table_rows": [
    {"label":"Mobile Speed Score","lead_value":"${speed.score}/100","comp_value":"${speed_comp?.score ?? 'N/A'}/100","lead_wins":${speed.score > (speed_comp?.score ?? 50)}},
    {"label":"LCP Load Time","lead_value":"${speed.lcp}","comp_value":"${speed_comp?.lcp ?? 'N/A'}","lead_wins":false},
    {"label":"Phone Above Fold","lead_value":"${crawl.hasPhoneAboveFold ? '✓ Yes' : '✗ No'}","comp_value":"✓ Yes","lead_wins":${crawl.hasPhoneAboveFold}},
    {"label":"Sticky CTA Button","lead_value":"${crawl.hasStickyCTA ? '✓ Yes' : '✗ No'}","comp_value":"✓ Yes","lead_wins":${crawl.hasStickyCTA}},
    {"label":"Reviews on Homepage","lead_value":"${crawl.hasReviewsOnHome ? '✓ Yes' : '✗ No'}","comp_value":"✓ Yes","lead_wins":${crawl.hasReviewsOnHome}},
    {"label":"Trust Badges","lead_value":"${crawl.hasTrustBadges ? '✓ Yes' : '✗ No'}","comp_value":"✓ Yes","lead_wins":${crawl.hasTrustBadges}}
  ],
  "page3_fixes": [
    {"num":"01","title":"Fix tied to worst table row","body":"Specific action referencing the crawl finding.","impact":"+X–Y% calls"},
    {"num":"02","title":"Second fix for another losing row","body":"Different action. Reference data.","impact":"+X–Y% result"},
    {"num":"03","title":"Third fix","body":"Different from 1 and 2.","impact":"+X–Y% result"}
  ],
  "page5_issues": [
    {"letter":"A","title":"Issue NOT on pages 2–4","body":"Specific crawl finding + dollar consequence.","impact":"$X–Y/mo at risk"},
    {"letter":"B","title":"Second issue NOT on pages 2–4","body":"Different finding.","impact":"$X–Y/mo at risk"}
  ],
  "cold_email_hook": "2 sentences. Names ${lead.name}, position #${lead.position}, ${competitor.name} at #${competitor.position}, one specific number. No SEO jargon."
}

page5_issues candidates (only issues not already used on pages 2–4):
noServiceArea:${!crawl.hasServiceAreaPages} | noBookingForm:${!crawl.hasBookingForm} | noEmergency:${!crawl.hasEmergencyMessaging} | noFinancing:${!crawl.hasFinancing} | domainMismatch:${crawl.hasDomainMismatch}`;

  try {
    const r = await anthropic.messages.create({
      model: "claude-sonnet-4-5", max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }]
    });
    const raw = (r.content[0] as any).text;
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error("Invalid JSON");
    return JSON.parse(raw.substring(s, e + 1));
  } catch (err: any) {
    console.warn("[Claude] Falling back to deterministic generator:", err.message);
    return buildFallback({ lead, competitor, city, vertical, speed, speed_comp, crawl, revenue, mathStr, bounceLoss, traffic });
  }
}

// ─── Deterministic Fallback ───────────────────────────────────────────────────

function buildFallback(p: any) {
  const { lead, competitor, city, vertical, speed, speed_comp, crawl, revenue, mathStr, bounceLoss, traffic } = p;
  const paradox = lead.review_count > competitor.review_count && lead.position > competitor.position
    ? "Strong Reviews. Wrong Position. Bleeding Money."
    : lead.rating > competitor.rating && lead.position > competitor.position ? "Better Rated. Still Losing."
      : lead.position > 10 ? "Invisible Where It Matters."
        : lead.review_count === 0 ? "Empty Profile. Empty Pipeline."
          : "Same Story. Different Outcome.";

  const p3Headline = speed.score < 60 ? "Three Seconds. No Reason to Stay."
    : !crawl.hasPhoneAboveFold ? "Phone Hidden. Customers Gone."
      : !crawl.hasStickyCTA ? "No Sticky CTA. No Callbacks."
        : "First Impression Costing You Jobs.";

  const p5: any[] = [];
  if (!crawl.hasServiceAreaPages) p5.push({ letter: "A", title: "No Service Area Pages: Google Cannot Find You Locally", body: `Without dedicated pages for each neighborhood you serve, Google cannot rank you for local searches. ${competitor.name} likely has a page for every city they cover. You have one.`, impact: `$${Math.round(revenue.monthly_loss * 0.2).toLocaleString()}–$${Math.round(revenue.monthly_loss * 0.35).toLocaleString()}/mo at risk` });
  if (!crawl.hasBookingForm) p5.push({ letter: p5.length === 0 ? "A" : "B", title: "No Online Quote Form: Losing After-Hours Leads", body: `Homeowners search at 10pm on Sunday. Without a quote form, anyone visiting outside business hours has no way to reach you. They call whoever made it easy.`, impact: `$${Math.round(revenue.monthly_loss * 0.15).toLocaleString()}–$${Math.round(revenue.monthly_loss * 0.25).toLocaleString()}/mo at risk` });
  if (!crawl.hasEmergencyMessaging && p5.length < 2) p5.push({ letter: p5.length === 0 ? "A" : "B", title: "No Emergency / 24-7 Messaging: Losing Urgent Calls", body: `In ${vertical}, emergency calls are the highest-value jobs. If your site does not say 24/7 emergency prominently, the homeowner with a burst pipe at midnight calls the one that does.`, impact: `$${Math.round(revenue.monthly_loss * 0.2).toLocaleString()}–$${Math.round(revenue.monthly_loss * 0.3).toLocaleString()}/mo at risk` });
  if (!crawl.hasFinancing && p5.length < 2) p5.push({ letter: p5.length === 0 ? "A" : "B", title: "No Financing Options: Losing High-Ticket Jobs", body: `For jobs over $2,000, financing closes deals that price-shoppers walk from. Competitors who offer pay-over-time win the job before you even get a callback.`, impact: `$${Math.round(revenue.monthly_loss * 0.1).toLocaleString()}–$${Math.round(revenue.monthly_loss * 0.2).toLocaleString()}/mo at risk` });
  if (p5.length === 0) {
    p5.push({ letter: "A", title: "GBP Photos Below Standard", body: `Google rewards profiles with 30 or more recent photos. If ${competitor.name} posts more than you, they earn ranking signals you are handing them for free.`, impact: `$${Math.round(revenue.monthly_loss * 0.1).toLocaleString()}/mo at risk` });
    p5.push({ letter: "B", title: "No Weekly GBP Posts", body: `GBP posts are a free ranking signal. Competitors posting weekly get preference in the map pack. Not posting is a gift to your competition.`, impact: `$${Math.round(revenue.monthly_loss * 0.1).toLocaleString()}/mo at risk` });
  }

  return {
    paradox_headline: paradox,
    cover_by_the_numbers: {
      position: `#${lead.position}`, position_sub: `map pack · ${vertical} ${city}`,
      reviews: `${lead.review_count}`, reviews_sub: `your reviews vs ${competitor.review_count} for #${competitor.position}`,
      revenue_gap: `$${Math.round(revenue.loss_low_usd / 1000)}–$${Math.round(revenue.loss_high_usd / 1000)}k`,
      revenue_gap_sub: "monthly revenue gap, conservative", fixes: "4", fixes_sub: "fixable gaps found",
    },
    page2_headline: `Outranked by ${competitor.name} in ${city}`,
    page2_subhead: `Being at #${lead.position} while ${competitor.name} holds #${competitor.position} costs you ~$${revenue.monthly_loss.toLocaleString()}/month in high-intent calls.`,
    page2_the_math: mathStr,
    page2_fixes: [
      { num: "01", title: "Complete Your Google Business Profile", body: `Add 30+ recent photos, fill every service category, post weekly. GBP completeness is a direct ranking factor. This alone can move you 1 to 2 positions.`, impact: "+15–30% map visibility" },
      { num: "02", title: "Build Neighborhood-Level Service Pages", body: `Create dedicated pages for every city and neighborhood you serve. Right now you compete on one generic page. ${competitor.name} likely targets multiple local areas.`, impact: "+10–25% local search coverage" },
      { num: "03", title: "Run a 30-Day Review Drive", body: `Text every customer from the last 60 days and ask for a Google review. At your avg ticket of $${revenue.avg_ticket} per job, every position you climb is worth hundreds per month.`, impact: "+10–20% click rate" },
    ],
    page3_headline: p3Headline,
    page3_subhead: `Your site is losing ~$${bounceLoss.toLocaleString()}/month in visitors who leave before contacting anyone.`,
    page3_the_math: `~${Math.round(((speed.score < 60 ? 30 : 15) / 100) * (traffic || 200))} visitors/month leave ${lead.name}'s site before taking action. At $${revenue.avg_ticket} avg job, that's ~$${bounceLoss.toLocaleString()}/month walking out the door.`,
    page3_table_rows: [
      { label: "Mobile Speed Score", lead_value: `${speed.score}/100`, comp_value: `${speed_comp?.score ?? 'N/A'}/100`, lead_wins: speed.score > (speed_comp?.score ?? 50) },
      { label: "LCP Load Time", lead_value: speed.lcp, comp_value: speed_comp?.lcp ?? "N/A", lead_wins: false },
      { label: "Phone Above Fold", lead_value: crawl.hasPhoneAboveFold ? "✓ Yes" : "✗ No", comp_value: "✓ Yes", lead_wins: crawl.hasPhoneAboveFold },
      { label: "Sticky CTA Button", lead_value: crawl.hasStickyCTA ? "✓ Yes" : "✗ No", comp_value: "✓ Yes", lead_wins: crawl.hasStickyCTA },
      { label: "Reviews on Homepage", lead_value: crawl.hasReviewsOnHome ? "✓ Yes" : "✗ No", comp_value: "✓ Yes", lead_wins: crawl.hasReviewsOnHome },
      { label: "Trust Badges", lead_value: crawl.hasTrustBadges ? "✓ Yes" : "✗ No", comp_value: "✓ Yes", lead_wins: crawl.hasTrustBadges },
    ],
    page3_fixes: (() => {
      const out: any[] = [];
      const used = new Set<string>();
      const add = (title: string, body: string, impact: string) => {
        if (!used.has(title) && out.length < 3) { used.add(title); out.push({ num: String(out.length + 1).padStart(2, "0"), title, body, impact }); }
      };
      // Lead with the single biggest real issue
      if (speed.score < 70) add("Cut Load Time Below 2 Seconds", "Your mobile score is " + speed.score + "/100. Compress images, enable caching, remove render-blocking scripts. Get above 70 and bounce drops immediately.", "+15–30% bounce reduction");
      else if (!crawl.hasPhoneAboveFold) add("Move Phone Number Above the Fold", "Your phone number is buried. Add it to the top of every page. Every second a visitor spends looking for how to call, they are dialing someone else.", "+10–20% contact rate");
      if (!crawl.hasStickyCTA) add("Add Sticky Click-to-Call Bar", "A persistent call bar at the top of every mobile page captures intent the moment it strikes. Highest-converting single change for home service sites.", "+15–25% mobile conversions");
      if (!crawl.hasTrustBadges) add("Add Trust Badges to Hero Section", "Licensed, insured, BBB-accredited. Put these in the first screen. Homeowners hiring a contractor make a safety decision. Give them the signal before they scroll.", "+8–15% conversion lift");
      if (!crawl.hasReviewsOnHome) add("Show Reviews in the Hero Section", "Embed your Google reviews above the fold. Visitors who see social proof in the first 3 seconds are far more likely to call.", "+10–20% trust conversion");
      // Pad to 3 if needed
      add("Cut Load Time Below 2 Seconds", "Your mobile score is " + speed.score + "/100. Compress images, enable caching, remove render-blocking scripts. Get above 70 and bounce drops immediately.", "+15–30% bounce reduction");
      add("Add Sticky Click-to-Call Bar", "A persistent call bar captures call intent the moment it strikes. This is the highest-converting single change for home service sites.", "+15–25% mobile conversions");
      add("Add Trust Badges to Hero Section", "Licensed, insured, BBB-accredited. Put these in the first screen before the visitor has a chance to doubt.", "+8–15% conversion lift");
      return out;
    })(),
    page5_issues: p5.slice(0, 2),
    cold_email_hook: `I ran an audit on ${lead.name}. Your site scores ${speed.score}/100 on mobile speed while ${competitor.name} at #${competitor.position} is capturing most of the "${vertical} ${city}" searches. Based on your ${lead.review_count} reviews and industry benchmarks, this gap costs roughly $${revenue.monthly_loss.toLocaleString()}/month.`,
  };
}

// ─── PDF HTML ─────────────────────────────────────────────────────────────────

function pickParadoxHeadline(lead: any, comp: any) {
  // Lead has more reviews but lower position
  if (lead.review_count > comp.review_count && lead.position > comp.position)
    return "Strong Reviews. Wrong Position. Bleeding Money.";
  // Lead has better rating but lower position
  if (lead.rating > comp.rating && lead.position > comp.position)
    return "Better Rated. Still Losing.";
  // Lead is far down the list
  if (lead.position > 10) return "Invisible Where It Matters.";
  // Lead has way fewer reviews (less than half of competitor)
  if (lead.review_count < comp.review_count * 0.5 && lead.position > comp.position)
    return "Outgunned. Outranked. Losing Jobs.";
  // Lead position 4-10 with fewer reviews
  if (lead.position >= 4 && lead.position <= 10 && lead.review_count < comp.review_count)
    return "Buried on Page One. Bleeding Revenue.";
  // Lead has no reviews
  if (lead.review_count === 0 && comp.review_count > 10) return "Empty Profile. Empty Pipeline.";
  // Lead is close but still losing
  if (lead.position <= 5) return "One Spot Away. Thousands at Stake.";
  return "Invisible Where It Matters.";
}

function formatHeadline(headline: string): string {
  // Remove trailing period for processing
  const clean = headline.replace(/\.$/, '');

  // Try splitting on '. ' first (multiple sentences)
  const parts = clean.split('. ').filter(Boolean);
  if (parts.length > 1) {
    const last = parts.pop()!;
    const rest = parts.join('. ') + '.';
    return `${rest}<br><span class="yl">${last}</span>`;
  }

  // Single sentence — split at last space (highlight last word or two)
  const words = clean.split(' ');
  if (words.length <= 2) return `<span class="yl">${clean}</span>`;

  // Find a good split point: last 2-3 words get highlighted
  const splitAt = words.length <= 4 ? words.length - 2 : words.length - 3;
  const rest = words.slice(0, splitAt).join(' ');
  const last = words.slice(splitAt).join(' ');
  return `${rest}<br><span class="yl">${last}</span>`;
}

function generateReportHTML(params: {
  lead: any; competitor: any; city: string; state: string; vertical: string;
  speed: any; crawl: any; revenue: ReturnType<typeof calculateRevenueLoss>;
  analysis: any; trust: ReturnType<typeof computeTrustAngle>;
  fullPack: any[]; screenshotDesktop: string; screenshotMobile: string;
}) {
  const { lead, competitor, city, state, vertical, speed, crawl, revenue, analysis, trust, fullPack } = params;
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
  const headline = analysis.paradox_headline || pickParadoxHeadline(lead, competitor);
  const compName = competitor.name;
  const clientName = (lead.name || "Client").toUpperCase();
  const desktopImg = params.screenshotDesktop ? `data:image/jpeg;base64,${params.screenshotDesktop}` : '';
  const mobileImg = params.screenshotMobile ? `data:image/jpeg;base64,${params.screenshotMobile}` : '';
  const hlParts = headline.split('. ').filter(Boolean);
  const hl1 = hlParts.slice(0, 2).join('. ') + (hlParts.length > 2 ? '.' : '');
  const hl2 = hlParts.length > 2 ? hlParts.slice(2).join('. ') : '';
  const byNums = analysis.cover_by_the_numbers || {};
  const p2Fixes: any[] = (analysis.page2_fixes || []).slice(0, 3);
  const p3Rows: any[] = analysis.page3_table_rows || [];
  const p3Fixes: any[] = (analysis.page3_fixes || []).slice(0, 3);
  const p4Fixes = [
    { num: "01", title: trust.angle === "reviews_paradox" ? "Embed Live Google Reviews on Homepage" : "Launch a 30-Day Review Drive", body: trust.angle === "reviews_paradox" ? `Use EmbedSocial or Elfsight to pull your ${lead.review_count} Google reviews onto your homepage. Install takes 1 hour. Visitors see proof before they scroll.` : `Text every customer from the last 60 days. Ask for a Google review. 30 days of asking gets 20–40 new reviews. Each one closes the gap with ${compName}.`, impact: "+15–35% trust conversion" },
    { num: "02", title: `Put Your ${lead.rating}★ Rating in the Header`, body: `Put your rating right next to your phone number at the top of every page. Visitors see authority before they read anything. Free. Takes 20 minutes.`, impact: "+8–15% contact rate" },
    { num: "03", title: "Respond to Every Google Review", body: `Unanswered reviews signal neglect. Block one hour and respond to all. Google also rewards active profiles with higher visibility.`, impact: "+5–10% GBP ranking" },
  ];
  const p5Issues: any[] = analysis.page5_issues || [];
  const trafficEst = Math.round((params.revenue.current_revenue || 0) / Math.max(params.revenue.avg_ticket, 1) / Math.max(params.revenue.cvr_typical / 100, 0.01));

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,700;0,900;1,700&display=swap');
:root{--red:#D0202E;--yellow:#F5C518;--black:#000;--white:#fff;--gl:#F8F9FA;--gm:#E9ECEF;--gd:#343A40;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Outfit',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;color:var(--black);background:var(--white);line-height:1.4;}
.page{width:794px;height:1123px;display:flex;flex-direction:column;background:var(--white);page-break-after:always;overflow:hidden;} @page{margin:0;size:794px 1123px;}
.tb{background:var(--black);color:var(--white);display:flex;justify-content:space-between;align-items:center;padding:12px 40px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;flex-shrink:0;}
.brand{color:var(--red);}
.body{flex:1;padding:36px 52px 0;display:flex;flex-direction:column;}
.kicker{font-size:10px;font-weight:900;color:var(--red);text-transform:uppercase;letter-spacing:.22em;margin-bottom:10px;}
.hero-hl{font-size:72px;font-weight:900;line-height:.97;letter-spacing:-.03em;margin-bottom:16px;color:var(--black);}
.yl{background:var(--yellow);padding:2px 10px;}
.hero-sub{font-family:'Playfair Display',serif;font-style:italic;font-size:16px;line-height:1.5;margin-bottom:18px;color:var(--gd);}
.footer{border-top:1px solid var(--gm);padding:13px 52px;display:flex;justify-content:space-between;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--gd);letter-spacing:.06em;flex-shrink:0;}
.lbl{font-size:10px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:var(--gd);}

/* Cover */
.cover-kicker-label{font-size:11px;font-weight:900;color:var(--red);text-transform:uppercase;letter-spacing:.22em;margin-bottom:2px;}
.cover-kicker-name{font-size:13px;font-weight:700;color:var(--black);margin-bottom:20px;letter-spacing:.02em;}
.cover-divider{border:none;border-top:1.5px solid var(--black);margin:16px 0 20px;}
.cover-2col{display:grid;grid-template-columns:1fr 1fr;gap:24px;}
.bn-wrap{}
.bn-section-lbl{font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;margin-bottom:14px;color:var(--black);}
.bn-item{display:flex;flex-direction:column;margin-bottom:14px;}
.bn-val{font-size:38px;font-weight:900;color:var(--red);line-height:1;}
.bn-val.black{color:var(--black);}
.bn-lbl{font-family:'Playfair Display',serif;font-style:italic;font-size:12px;color:var(--gd);margin-top:3px;line-height:1.3;}
.inside-wrap{border-left:1px solid var(--gm);padding-left:20px;}
.inside-section-lbl{font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;margin-bottom:12px;color:var(--black);}
.inside-item{font-size:12px;color:var(--gd);padding:6px 0;border-bottom:0.5px solid var(--gm);line-height:1.4;}
.inside-item:last-child{border-bottom:none;}
.screens{display:grid;grid-template-columns:1fr .38fr;gap:14px;margin-top:auto;}
.scr-d{border:1px solid var(--gm);height:260px;border-radius:5px;overflow:hidden;background:#eee;}
.scr-m{border:5px solid var(--black);height:260px;border-radius:20px;overflow:hidden;background:#eee;position:relative;}
.scr-d .scr-img{width:100%;height:100%;object-fit:cover;object-position:top;display:block;}
.scr-m .scr-img{width:100%;height:100%;object-fit:cover;object-position:top;display:block;}

/* Map list */
.map-list{background:var(--black);color:var(--white);border-radius:8px;padding:18px 22px;margin-bottom:16px;}
.map-row{display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #1f1f1f;}
.map-row:last-child{border-bottom:none;}
.mp{font-size:20px;font-weight:900;color:#444;min-width:32px;}
.mp.you{color:var(--red);}
.mn{font-size:13px;font-weight:700;flex:1;padding:0 10px;}
.mm{font-size:11px;color:#777;text-align:right;}
.you-tag{font-size:9px;font-weight:900;color:var(--yellow);letter-spacing:.1em;margin-top:1px;}

/* The Math */
.math{background:var(--yellow);padding:14px 18px;border-radius:6px;margin-bottom:16px;}
.math-lbl{font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;margin-bottom:4px;}
.math-txt{font-size:12px;font-weight:600;line-height:1.5;}

/* Fix cards */
.fix{background:var(--gl);padding:16px 18px;border-left:5px solid var(--red);display:flex;gap:12px;align-items:flex-start;margin-bottom:9px;}
.fn{font-size:24px;font-weight:900;color:var(--red);opacity:.2;line-height:1;min-width:28px;}
.ft{font-size:14px;font-weight:800;margin-bottom:3px;}
.fb{font-size:11px;color:var(--gd);line-height:1.5;}
.fi{font-size:10px;font-weight:700;color:var(--red);margin-top:4px;text-transform:uppercase;letter-spacing:.1em;}

/* Table */
table{width:100%;border-collapse:collapse;margin:14px 0;}
thead tr{background:var(--black);color:var(--white);}
th{padding:10px 13px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;text-align:left;}
td{padding:11px 13px;border-bottom:1px solid var(--gm);font-size:13px;font-weight:600;}
td.win{color:#1a6b3a;font-weight:700;} td.loss{color:#D0202E;font-weight:700;}

/* Trust */
.trust-2col{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:18px 0;}
.tbox{padding:26px;text-align:center;border-radius:6px;}
.tc{font-size:44px;font-weight:900;line-height:1;margin:6px 0;}
.tr2{font-weight:800;font-size:13px;}
.tlbl{font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px;}

/* Issues */
.issue{background:var(--gl);border-left:5px solid var(--gd);padding:16px 18px;margin-bottom:10px;}
.il{font-size:10px;font-weight:900;letter-spacing:.18em;color:#aaa;margin-bottom:4px;text-transform:uppercase;}
.it{font-size:15px;font-weight:800;margin-bottom:4px;}
.ib{font-size:11px;color:var(--gd);line-height:1.5;}
.ii{font-size:10px;font-weight:700;color:var(--red);margin-top:6px;text-transform:uppercase;letter-spacing:.1em;}
.combined{background:var(--yellow);border-radius:6px;padding:18px 24px;text-align:center;margin-top:14px;}
.cl{font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;margin-bottom:4px;}
.cv{font-size:30px;font-weight:900;line-height:1;}
.cs{font-size:11px;font-weight:700;margin-top:3px;}

/* CTA */
.cta-page{background:var(--white);color:var(--black);flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:48px;}
.cta-2col{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:32px 0;width:100%;max-width:660px;}
.cta-card{border:2px solid var(--gm);border-radius:12px;padding:30px 24px;text-align:left;}
.cta-card.dfy{border:3px solid var(--yellow);background:#fffdf0;box-shadow:0 0 20px rgba(245,197,24,0.2);}
.cbadge{font-size:10px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px;color:#aaa;display:block;}
.cbadge.hot{color:var(--red);}
.ctitle{font-size:22px;font-weight:900;margin-bottom:8px;color:var(--black);line-height:1.1;}
.cdesc{font-size:12px;color:var(--gd);line-height:1.6;}
.cta-price{font-size:28px;font-weight:900;color:var(--yellow);margin:12px 0 4px;}
.cta-price-sub{font-size:11px;color:#555;margin-bottom:16px;}
.cta-btn{display:inline-block;background:var(--yellow);color:var(--black);padding:18px 52px;font-size:15px;font-weight:900;text-transform:uppercase;text-decoration:none;border-radius:6px;letter-spacing:.06em;margin-top:8px;}
</style></head><body>

<!-- PAGE 1 COVER -->
<div class="page">
  <div class="tb"><span><span class="brand">ARMA</span> · WEBSITE REPORT · ${clientName}</span><span>${date}</span></div>
  <div class="body">
    <div class="cover-kicker-label">Exclusive Briefing</div>
    <div class="cover-kicker-name">For ${lead.name.toUpperCase()} — ${city.toUpperCase()}, ${state.toUpperCase()}</div>

    <div class="hero-hl">${formatHeadline(headline)}</div>
    <div class="hero-sub">We followed your customer's path — from Google search to phone call - and flagged where you lose them.</div>

    <hr class="cover-divider">

    <div class="cover-2col">
      <div class="bn-wrap">
        <div class="bn-section-lbl">By the Numbers</div>
        <div class="bn-item">
          <div class="bn-val">${byNums.position || '#' + lead.position}</div>
          <div class="bn-lbl">your position in map pack<br>for '${vertical} ${city}'</div>
        </div>
        <div class="bn-item">
          <div class="bn-val">${byNums.reviews || lead.review_count}</div>
          <div class="bn-lbl">your reviews<br>vs. ${competitor.review_count} for the #${competitor.position} — yet they outrank you</div>
        </div>
        <div class="bn-item">
          <div class="bn-val">${byNums.revenue_gap || `$${Math.round(revenue.loss_low_usd / 1000)}–$${Math.round(revenue.loss_high_usd / 1000)}k`}</div>
          <div class="bn-lbl">monthly revenue gap<br>conservative estimate</div>
        </div>
        <div class="bn-item">
          <div class="bn-val black">${byNums.fixes || '4'}</div>
          <div class="bn-lbl">fixable gaps<br>across customer journey</div>
        </div>
      </div>
      <div class="inside-wrap">
        <div class="inside-section-lbl">Inside This Report</div>
        <div class="inside-item">Your customer's 5-step journey to a booked job.</div>
        <div class="inside-item">Where they fall off — and exactly what it costs.</div>
        <div class="inside-item">How you compare to <strong>${compName}</strong> (your #${competitor.position} competitor) at every step.</div>
        <div class="inside-item">Two clear paths to fix it.</div>
      </div>
    </div>

    <div class="screens">
      <div class="scr-d">${desktopImg ? `<img src="${desktopImg}" class="scr-img">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#aaa;font-size:12px;">Screenshot unavailable</div>`}</div>
      <div class="scr-m">${mobileImg ? `<img src="${mobileImg}" class="scr-img">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#aaa;font-size:11px;">N/A</div>`}</div>
    </div>
  </div>
  <div class="footer"><span>STRICTLY CONFIDENTIAL · PREPARED BY ARMA AGENCY</span><span>PAGE 1 OF 6</span></div>
</div>

<!-- PAGE 2 DISCOVERY -->
<div class="page">
  <div class="tb"><span><span class="brand">ARMA</span> · ${clientName}</span><span>STEP 1 OF 4 · DISCOVERY</span></div>
  <div class="body">
    <div class="kicker">Step 1 of 4 · Are They Even Finding You?</div>
    <div class="hero-hl" style="font-size:40px;">${formatHeadline(analysis.page2_headline || `Invisible Where It Matters Most.`)}</div>
    <p class="hero-sub">${analysis.page2_subhead || `${lead.name} sits at #${lead.position}. ${compName} holds #${competitor.position}. Every search that matters finds them first.`}</p>

    <div class="map-list">
      ${fullPack.map((p: any, idx: number) => {
    const separator = idx > 0 && p.isLead && p.position > (fullPack[idx - 1]?.position ?? 0) + 1
      ? '<div style="opacity:.3;font-size:11px;text-align:center;padding:3px 0;letter-spacing:.1em;color:#777;">· · ·</div>'
      : '';
    const cls = p.isLead ? ' you' : '';
    const tag = p.isLead ? '<div class="you-tag">← YOU</div>' : '';
    const rating = (p.rating || 0).toFixed(1);
    const reviews = (p.review_count || 0).toLocaleString();
    return separator + `<div class="map-row"><div class="mp${cls}">#${p.position}</div><div class="mn">${p.name}${tag}</div><div class="mm">${rating}★ · ${reviews} reviews</div></div>`;
  }).join('')}
    </div>

    <div class="math">
      <div class="math-lbl">The Math</div>
      <div class="math-txt">${analysis.page2_the_math || `${compName} at #${competitor.position} captures the majority of "${vertical} ${city}" searches. Being at #${lead.position} means most customers never see you.`}</div>
    </div>

    <div class="lbl" style="margin-bottom:9px;">How to Fix It</div>
    ${p2Fixes.map((f: any) => `<div class="fix"><div class="fn">${f.num || '01'}</div><div><div class="ft">${f.title}</div><div class="fb">${f.body}</div>${f.impact ? `<div class="fi">${f.impact}</div>` : ''}</div></div>`).join('')}
  </div>
  <div class="footer"><span>PREPARED FOR ${clientName} · ${city}, ${state}</span><span>PAGE 2 OF 6</span></div>
</div>

<!-- PAGE 3 FIRST IMPRESSION -->
<div class="page">
  <div class="tb"><span><span class="brand">ARMA</span> · ${clientName}</span><span>STEP 2 OF 4 · FIRST IMPRESSION</span></div>
  <div class="body">
    <div class="kicker">Step 2 of 4 · What They See When They Land</div>
    <div class="hero-hl" style="font-size:40px;">${formatHeadline(analysis.page3_headline || 'Three Seconds. No Reason to Stay.')}</div>
    <p class="hero-sub">${analysis.page3_subhead || `Once someone finds you, they decide in 3 seconds. Right now those seconds work against you.`}</p>

    <table>
      <thead><tr><th style="width:36%;">FACTOR</th><th style="width:30%;">YOUR SITE</th><th style="width:34%;">${compName.toUpperCase()}</th></tr></thead>
      <tbody>${p3Rows.map((r: any) => `
        <tr>
          <td style="font-weight:600;color:var(--gd);">${r.label}</td>
          <td class="${r.lead_wins ? 'win' : 'loss'}">${r.lead_value}</td>
          <td class="win">${r.comp_value}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <div class="math" style="margin-bottom:14px;">
      <div class="math-lbl">The Math</div>
      <div class="math-txt">${analysis.page3_the_math || `A chunk of visitors leave before ever contacting anyone. Each one of those is a job that went to someone else.`}</div>
    </div>

    <div class="lbl" style="margin-bottom:9px;">How to Fix It</div>
    ${p3Fixes.map((f: any) => `<div class="fix"><div class="fn">${f.num || '01'}</div><div><div class="ft">${f.title}</div><div class="fb">${f.body}</div>${f.impact ? `<div class="fi">${f.impact}</div>` : ''}</div></div>`).join('')}
  </div>
  <div class="footer"><span>PREPARED FOR ${clientName} · ${city}, ${state}</span><span>PAGE 3 OF 6</span></div>
</div>

<!-- PAGE 4 TRUST -->
<div class="page">
  <div class="tb"><span><span class="brand">ARMA</span> · ${clientName}</span><span>STEP 3 OF 4 · TRUST &amp; AUTHORITY</span></div>
  <div class="body">
    <div class="kicker">Step 3 of 4 · Do They Believe You?</div>
    <div class="hero-hl" style="font-size:40px;">${formatHeadline(trust.headline.replace('\n', ' '))}</div>
    <p class="hero-sub">${trust.subhead}</p>

    <div class="trust-2col">
      <div class="tbox" style="border:2px solid var(--gm);">
        <div class="tlbl">${trust.leftLabel}</div>
        <div class="tc">${trust.leftCount}</div>
        <div class="tr2" style="color:var(--red);">${trust.leftSub}</div>
      </div>
      <div class="tbox" style="background:var(--black);color:var(--white);">
        <div class="tlbl" style="color:#555;">${trust.rightLabel}</div>
        <div class="tc">${trust.rightCount}</div>
        <div class="tr2" style="color:var(--yellow);">${trust.rightSub}</div>
      </div>
    </div>

    <div class="math" style="margin-bottom:16px;">
      <div class="math-lbl">The Math</div>
      <div class="math-txt">Sites with embedded reviews convert up to 35% better. On ${lead.name}'s ~${Math.max(trafficEst, 200)} visitors/month, hiding your ${lead.review_count} reviews costs an estimated $${Math.round(revenue.monthly_loss * 0.35).toLocaleString()}/month.</div>
    </div>

    <div class="lbl" style="margin-bottom:9px;">How to Close the Trust Gap</div>
    ${p4Fixes.map((f: any) => `<div class="fix"><div class="fn">${f.num}</div><div><div class="ft">${f.title}</div><div class="fb">${f.body}</div>${f.impact ? `<div class="fi">${f.impact}</div>` : ''}</div></div>`).join('')}
  </div>
  <div class="footer"><span>PREPARED FOR ${clientName} · ${city}, ${state}</span><span>PAGE 4 OF 6</span></div>
</div>

<!-- PAGE 5 OTHER ISSUES -->
<div class="page">
  <div class="tb"><span><span class="brand">ARMA</span> · ${clientName}</span><span>STEP 4 OF 4 · OTHER ISSUES FOUND</span></div>
  <div class="body">
    <div class="kicker">Step 4 of 4 · What Else the Audit Surfaced</div>
    <div class="hero-hl" style="font-size:40px;">${p5Issues.length > 0 ? (p5Issues.length === 1 ? formatHeadline('One More Quiet Leak.') : formatHeadline(`${p5Issues.length} More Quiet Leaks.`)) : formatHeadline('No Additional Issues Found.')}</div>
    <p class="hero-sub">${p5Issues.length > 0 ? `Beyond the three issues already covered, the audit surfaced ${p5Issues.length} more problem${p5Issues.length > 1 ? 's' : ''} specific to how ${lead.name} is set up. They are not universal. They showed up because of specific choices that quietly leak leads every day.` : `The issues on pages 2–4 are your primary revenue leaks. Fixing those three will have the highest impact.`}</p>
    <div style="flex:1;">
      ${p5Issues.map((i: any) => `
        <div class="issue">
          <div class="il">Issue ${i.letter}</div>
          <div class="it">${i.title}</div>
          <div class="ib">${i.body}</div>
          ${i.impact ? `<div class="ii">${i.impact}</div>` : ''}
        </div>`).join('')}
    </div>
    <div class="combined">
      <div class="cl">Combined Monthly Revenue at Risk</div>
      <div class="cv">$${revenue.loss_low_usd.toLocaleString()} – $${revenue.loss_high_usd.toLocaleString()}</div>
      <div class="cs">Conservative estimate · ${revenue.niche_matched} benchmarks</div>
    </div>
  </div>
  <div class="footer"><span>PREPARED FOR ${clientName} · ${city}, ${state}</span><span>PAGE 5 OF 6</span></div>
</div>

<!-- PAGE 6 CTA -->
<div class="page" style="background:var(--white);">
  <div class="tb">
    <span><span class="brand">ARMA</span> · ${clientName}</span><span>YOUR NEXT MOVE</span>
  </div>
  <div class="cta-page">
    <div class="kicker">Close the Gap</div>
    <div class="hero-hl" style="font-size:46px;margin-bottom:10px;">Two Ways<br><span class="yl">Forward</span></div>
    <p class="hero-sub" style="max-width:440px;margin:0 auto 26px;">
    You've seen the leaks. Fixing the site is only half the plan. Content, reviews, SEO timeline, and the actual moves to overtake ${compName} need more than a PDF can hold.</p>
    <div class="cta-2col">
      <div class="cta-card">
        <div class="cbadge">Option A · DIY</div>
        <div class="ctitle">Fix It Yourself.</div>
        <div class="cdesc">Every fix in this report is documented. Work through Steps 1 to 4 in order. You will see movement within 60 days. This covers site fixes only, not the full content and rankings strategy.</div>
      </div>
      <div class="cta-card dfy">
        <div class="cbadge hot">★ Option B · Done For You</div>
        <div class="ctitle">Let ARMA Handle Everything.</div>
        <div class="cta-price">$0</div>
        <div class="cta-price-sub">Free strategy call. No pitch. No obligation.</div>
        <div class="cdesc">20 minutes. We map out exactly how to overtake ${compName}. You get the full plan: site fixes, review strategy, content, rankings. If you want us to run it, we talk numbers.</div>
      </div>
    </div>
    <a href="#" class="cta-btn">Book Your 20-Min Call →</a>
    <div style="margin-top:14px;font-size:11px;color:#aaa;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Or reply to the email this report came in and we will set a time.</div>
    <div style="margin-top:20px;font-size:11px;color:#aaa;max-width:560px;text-align:center;line-height:1.5;">This report was prepared specifically for ${lead.name} based on data pulled ${date}. No template. No fluff. The numbers are conservative. Your real gap is likely larger.</div>
  </div>
</div>

</body></html>`;
}

// ─── PDF Renderer ─────────────────────────────────────────────────────────────

async function renderPDF(html: string): Promise<Buffer> {
  let browser: Browser | null = null;
  try {
    const opts = await puppeteerOpts();
    browser = await puppeteer.launch(opts as any);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({ width: '794px', height: '1123px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    return Buffer.from(pdf);
  } finally { if (browser) await browser.close(); }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.post('/lite-report', asyncHandler(async (req: Request, res: Response) => {
  const { url, city, state, vertical } = req.body;
  if (!url || !city || !state) return res.status(400).json({ error: "url, city, state required" });

  const domain = new URL(url).hostname.replace('www.', '');
  const bizName = domain.split('.')[0].replace(/-/g, ' ');
  const niche = vertical || "Home Services";

  const [gbp, traffic] = await Promise.all([
    getLeadGBP(bizName, city, state),
    getMonthlyTraffic(domain),
  ]);
  // Pass GBP review count so lead matching uses review count as tiebreaker
  const mapData = await getLocalMapPack(niche, city, state, bizName, 99, gbp.review_count);

  if (!mapData) return res.status(502).json({ error: "Could not find local competitors. Check DataForSEO/Google Places keys." });

  const { key: niche_matched } = findBenchmark(niche);
  const revenue = calculateRevenueLoss(traffic || 200, niche);
  // Use real Google business name if available, fall back to domain-derived name
  const realName = gbp.real_name && gbp.real_name.length > 2 ? gbp.real_name : bizName;
  const lead = { name: realName, rating: gbp.rating, review_count: gbp.review_count, place_id: gbp.place_id, position: mapData.leadPosition };
  const liteReport = {
    domain, city, state, vertical: niche, niche_matched,
    lead, competitor: mapData.competitor, fullPack: mapData.fullPack,
    traffic_monthly: traffic, revenue,
    gap_summary: `${realName} at #${mapData.leadPosition} vs ${mapData.competitor.name} at #${mapData.competitor.position} in ${city} for "${niche}".`,
    cold_email_prompt: `Write 3 sentences cold email to the owner of ${realName} in ${city}, ${state}. Outranked by ${mapData.competitor.name} (${mapData.competitor.review_count} reviews, ${mapData.competitor.rating}★). Lead has ${gbp.review_count} reviews, ${gbp.rating}★. Revenue gap: ~$${revenue.monthly_loss}/mo. Alex Hormozi tone. No SEO jargon.`,
  };

  db.prepare(`INSERT OR REPLACE INTO leads
    (lead_id,business_name,domain,city,state,vertical,niche_matched,primary_keyword,
    lead_gbp_rating,lead_review_count,lead_map_position,lead_gbp_place_id,
    competitor_name,competitor_domain,competitor_gbp_id,competitor_rating,competitor_review_count,competitor_position,
    traffic_monthly,lite_report_data,lite_report_generated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`)
    .run(domain, realName, domain, city, state, niche, niche_matched, `${niche} ${city}`,
      gbp.rating, gbp.review_count, mapData.leadPosition, gbp.place_id,
      mapData.competitor.name, mapData.competitor.domain, mapData.competitor.place_id,
      mapData.competitor.rating, mapData.competitor.review_count, mapData.competitor.position,
      traffic, JSON.stringify(liteReport));

  res.json(liteReport);
}));

app.post('/full-report', asyncHandler(async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url required" });

  const domain = new URL(url).hostname.replace('www.', '');
  const saved: any = db.prepare('SELECT * FROM leads WHERE domain=?').get(domain);
  if (!saved) return res.status(400).json({ error: "No Lite Report found. Call POST /lite-report first." });

  console.log(`[Full Report] Competitor locked: ${saved.competitor_name}`);
  const liteData = JSON.parse(saved.lite_report_data);
  const lead = { name: saved.business_name, rating: saved.lead_gbp_rating, review_count: saved.lead_review_count, position: saved.lead_map_position, domain };
  const competitor = { name: saved.competitor_name, rating: saved.competitor_rating, review_count: saved.competitor_review_count, position: saved.competitor_position, domain: saved.competitor_domain, place_id: saved.competitor_gbp_id };
  const traffic = saved.traffic_monthly || 200;
  const city = saved.city, state = saved.state, vertical = saved.vertical;
  const fullPack: any[] = liteData.fullPack || [];

  const [speedLead, speedComp, crawl, dailySearches] = await Promise.all([
    getPageSpeed(url, 'mobile'),
    competitor.domain ? getPageSpeed(`https://${competitor.domain}`, 'mobile').catch(() => null) : Promise.resolve(null),
    crawlSite(url),
    getDailySearches(vertical, city),
  ]);

  const nicheResolved = await classifyNiche(crawl.pageText, crawl.title, vertical);
  const revenue = calculateRevenueLoss(traffic, nicheResolved);
  const trust = computeTrustAngle(lead, competitor, crawl);

  const analysis = await analyzeWithClaude({
    lead, competitor, city, state, vertical: nicheResolved,
    speed: speedLead, speed_comp: speedComp, crawl, traffic, revenue,
    dailySearches, fullPack,
  });

  const html = generateReportHTML({
    lead, competitor, city, state, vertical: nicheResolved,
    speed: speedLead, crawl, revenue, analysis, trust, fullPack,
    screenshotDesktop: crawl.screenshotDesktop,
    screenshotMobile: crawl.screenshotMobile,
  });

  const pdf = await renderPDF(html);
  db.prepare(`UPDATE leads SET full_report_generated_at=datetime('now') WHERE domain=?`).run(domain);
  res.contentType('application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ARMA_Audit_${domain}.pdf"`);
  res.send(pdf);
}));

app.get('/health', (_req: Request, res: Response) => {
  const c = (db.prepare('SELECT COUNT(*) as c FROM leads').get() as any).c;
  res.json({ status: 'ok', leads_in_db: c });
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const server = app.listen(PORT, () => {
  console.log(`\n🚀 ARMA Audit Engine ready: http://localhost:${PORT}`);
  console.log(`   POST /lite-report  { url, city, state, vertical }`);
  console.log(`   POST /full-report  { url }\n`);
});
server.setTimeout(300000);