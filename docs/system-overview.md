# ARMA Audit Engine — System Overview

> This document shows exactly where every piece of data comes from and how it flows
> through the system to produce the final PDF reports.

---

## Two Checkers, Two Endpoints

```
CLIENT / AUTOMATION
       |
       |  POST /lite-report { url, city, state, vertical }
       |─────────────────────────────────────────────────────────────► LITE CHECKER
       |                                                                (~38 sec per lead)
       |                                                                    │
       |                                                                    ▼
       |                                                             PDF returned in
       |                                                             HTTP response
       |                                                             (or JSON if ?format=json)
       |
       |  POST /full-report { url }          ← requires Lite first
       |─────────────────────────────────────────────────────────────► FULL CHECKER
                                                                       (1–2 min per lead)
                                                                           │
                                                                           ▼
                                                                    PDF returned in
                                                                    HTTP response
```

**Important:** Full Checker reads the competitor data locked in by the Lite Checker.
You must run Lite first, then Full, for the same domain.

---

## Lite Checker — Where Every Data Point Comes From

```
INPUT: { url: "https://acmeplumbing.com", city: "Dallas", state: "TX", vertical: "Plumbing" }
  │
  ├─── STEP 1: Run in PARALLEL ─────────────────────────────────────────────────────────────┐
  │                                                                                          │
  │   Google Places API (Text Search)           DataForSEO Labs API                         │
  │   ─────────────────────────────────         ─────────────────────                       │
  │   Query: "acmeplumbing.com Dallas TX"       Query: domain rank overview                 │
  │   Returns:                                  Returns:                                    │
  │   • Business real name                      • Monthly organic traffic estimate          │
  │   • Google rating (★)                                                                   │
  │   • Review count                                                                        │
  │   • place_id (Google's internal ID)                                                     │
  │   • Phone number                                                                        │
  │   • Full address                                                                        │
  │   • City / State (verified from GBP)                                                   │
  │                                                                                         │
  └─── STEP 2: Map Pack Rankings ───────────────────────────────────────────────────────────┤
                                                                                            │
  PRIMARY source: DataForSEO SERP Maps (live/advanced)                                     │
  ─────────────────────────────────────────────────────                                    │
  Searches 3 keywords for the vertical, e.g. for Plumbing:                                 │
    • "plumber in Dallas"                                                                   │
    • "plumbing service in Dallas"                                                          │
    • "emergency plumber in Dallas"                                                         │
  Returns: exact Google Maps ranking positions as a user in that city would see them        │
  Data: position #, name, rating, review count, place_id for ALL businesses in results     │
                                                                                            │
  FALLBACK (if DataForSEO unavailable): Google Places Text Search API                      │
  ──────────────────────────────────────────────────────────────────                       │
  Same queries, geocoded to city center (20km radius bias)                                 │
  Returns: same fields — prominence order = map ranking approximation                      │
                                                                                            │
  OUTPUT FROM STEP 2:                                                                       │
  • Lead map pack position (e.g. #5)                                                        │
  • Competitor selected (smart logic: if lead=#5, compare to #3)                            │
  • Competitor: name, rating, review_count, position, place_id, domain                     │
  • Full map pack: top 5 businesses with positions, ratings, reviews                       │
  • Organic search position (separate DataForSEO SERP Organic call)                        │
                                                                                            │
  └─── STEP 3: Run in PARALLEL ─────────────────────────────────────────────────────────────┘
                │
                ├── DataForSEO Business Data: Google Reviews (task_post → poll → task_get)
                │   Returns: up to 100 reviews with text, star rating, owner reply status
                │   → reply rate, unanswered count, review snippets (up to 20)
                │
                ├── DataForSEO Business Data: Google My Business Posts (live/advanced)
                │   Returns: recent GBP posts → posts per week (last 28 days)
                │
                ├── Fetch Lead Homepage Text (HTTP GET → strip HTML)
                │   Returns: raw visible text from the lead's homepage
                │
                ├── Google Places Details API (competitor place_id)
                │   Returns: competitor phone number
                │
                ├── Fetch Competitor Homepage Text (HTTP GET → strip HTML)
                │   Returns: raw visible text from competitor's homepage
                │
                └── DataForSEO SERP Organic (live/advanced)
                    Returns: organic Google search ranking for primary keyword
                │
                ▼
  STEP 4: Claude AI Processing (run in PARALLEL)
  ───────────────────────────────────────────────
  Claude Haiku ── Lead homepage text ──────► owner name + service area list
  Claude Haiku ── Competitor homepage text ► owner name + service area list
                │
                ▼
  Claude Haiku ── All data above ──────────► Cold outreach email (subject + 3-sentence body)
                │
                ▼
  STEP 5: Internal Calculations (no API — instant)
  ─────────────────────────────────────────────────
  Industry benchmarks table × monthly traffic
  → current_revenue / potential_revenue / monthly_loss ($)
  → revenue gap range (low / high estimate)
                │
                ▼
  STEP 6: Save to Local SQLite Database
  ──────────────────────────────────────
  Table: leads
  Saves: all lead + competitor fields, traffic, raw report JSON
  Purpose: Full Checker reads competitor data from here (so both reports are consistent)
                │
                ▼
  STEP 7: Generate Output
  ────────────────────────
  HTML template → Puppeteer (headless Chrome) → PDF
  Or: return raw JSON if ?format=json
```

---

## Full Checker — Where Every Data Point Comes From

```
INPUT: { url: "https://acmeplumbing.com" }
  │
  │  Reads from DB: competitor name/domain/place_id locked by Lite Checker
  │
  ├─── STEP 1: Run in PARALLEL ─────────────────────────────────────────────────────────────┐
  │                                                                                          │
  │   Google PageSpeed Insights API (×4 calls)                                              │
  │   ────────────────────────────────────────                                              │
  │   • Lead site: mobile score, LCP, CLS, INP, TTFB                                       │
  │   • Lead site: desktop score, LCP, CLS                                                  │
  │   • Competitor site: mobile score, LCP                                                  │
  │   • Competitor site: desktop score, LCP                                                 │
  │                                                                                         │
  │   DataForSEO Keywords Data: Google Ads Search Volume                                    │
  │   ────────────────────────────────────────────────────                                  │
  │   Returns: monthly search volume for primary keyword in city                            │
  │   Used for: daily search estimate → call volume math                                    │
  │                                                                                         │
  │   DataForSEO Business Data: Google Reviews (same as Lite)                               │
  │   DataForSEO Business Data: GBP Posts (same as Lite)                                   │
  │                                                                                         │
  └─── STEP 2: Sequential Website Crawls (Puppeteer headless Chrome) ───────────────────────┤
                                                                                            │
  Crawl Lead Site                                                                           │
  ───────────────                                                                           │
  Detects (true/false):                                                                     │
  • Phone number above fold (mobile + desktop)                                              │
  • Sticky call-to-action bar                                                               │
  • Above-fold CTA button                                                                   │
  • Google reviews embedded on homepage                                                     │
  • Trust badges (BBB, license, insurance logos)                                            │
  • Service area pages                                                                      │
  • Online booking / quote form                                                             │
  • Emergency / 24-7 messaging                                                              │
  • Financing options                                                                       │
  • Domain mismatch (title vs domain)                                                       │
  Screenshots: mobile (390px) + desktop (1280px) as JPEG base64                            │
                                                                                            │
  Crawl Competitor Site (same detection)                                                    │
  ──────────────────────────────────────                                                    │
  Used in: side-by-side comparison table in the report                                      │
                                                                                            │
  └─── STEP 3: Claude AI Analysis ──────────────────────────────────────────────────────────┘
                │
                │   Claude Sonnet receives:
                │   • All speed scores (lead + competitor)
                │   • All crawl booleans (lead + competitor)
                │   • Screenshots (mobile + desktop) for visual verification
                │   • Review data, GBP post frequency
                │   • Revenue math (pre-computed)
                │   • Full map pack data
                │
                ▼
                Claude Sonnet outputs structured JSON:
                • Paradox headline ("Better Rated. Still Losing.")
                • Cover page numbers (position, reviews, revenue gap, fixes count)
                • Page 2: map rank analysis — headline, subhead, math, 3 specific fixes
                • Page 3: website audit — headline, comparison table, 3 specific fixes
                • Page 5: 2 additional issues with dollar impact
                • Cold email hook sentence
                │
                ▼
  STEP 4: Generate Output
  ────────────────────────
  HTML template (6-page report) → Puppeteer PDF → HTTP response download
```

---

## Data Sources Summary

| Data Point | Source | Notes |
|---|---|---|
| Business name (real) | Google Places Text Search | Verified by matching website domain |
| GBP rating | Google Places Text Search | Live from Google |
| Review count | Google Places Text Search | Live from Google |
| Phone number | Google Places Details API | Separate Details call per place_id |
| Address | Google Places Details API | Full formatted address |
| Map pack ranking | DataForSEO SERP Maps | Exact ranking as user in that city sees it |
| Map pack ranking (fallback) | Google Places Text Search | Prominence order ≈ map ranking |
| Competitor selection | Internal logic | Lead #5–8 → compare to #3; Lead #2–4 → compare to #1 |
| Monthly traffic | DataForSEO Labs Domain Rank | Estimated organic traffic |
| Review text + reply rate | DataForSEO Business Data (Reviews) | Up to 100 reviews with owner_answer |
| GBP posts frequency | DataForSEO Business Data (Posts) | Posts in last 28 days → per week |
| Organic search rank | DataForSEO SERP Organic | Top-10 organic results |
| Daily search volume | DataForSEO Keywords (Google Ads) | Monthly volume ÷ 30 |
| Page speed scores | Google PageSpeed Insights API | Mobile + desktop, LCP/CLS/INP |
| Website feature detection | Puppeteer (headless Chrome crawl) | Phone, CTA, reviews, badges, etc. |
| Screenshots | Puppeteer | 390px mobile + 1280px desktop |
| Owner name, service area | Claude Haiku | Extracted from homepage text |
| Cold email | Claude Haiku | Generated from all audit data |
| Full report analysis | Claude Sonnet | With screenshot visual verification |
| Revenue math | Internal benchmarks table | 26 industry verticals with CVR + avg ticket |

---

## Output Formats

### Lite Checker

**Default (PDF):**
```
HTTP 200
Content-Type: application/pdf
Content-Disposition: attachment; filename="ARMA_LiteCheck_acmeplumbing.com.pdf"
[binary PDF data]
```

**JSON mode** (add `?format=json` to URL or `"format": "json"` in body):
```json
{
  "domain": "acmeplumbing.com",
  "city": "Dallas",
  "state": "TX",
  "vertical": "Plumbing",
  "lead": {
    "name": "Acme Plumbing",
    "rating": 4.7,
    "review_count": 134,
    "position": 5,
    "organic_position": 8,
    "phone": "(214) 555-0100",
    "address": "123 Main St, Dallas, TX 75201",
    "owner": "John Smith",
    "service_area": "Dallas, Plano, Frisco, McKinney"
  },
  "competitor": {
    "name": "Dallas Pro Plumbing",
    "position": 3,
    "rating": 4.9,
    "review_count": 312,
    "domain": "dallasproPlumbing.com",
    "phone": "(214) 555-0200",
    "owner": "Mike Johnson",
    "service_area": "Dallas, Irving, Garland"
  },
  "fullPack": [ ...top 5 businesses with positions/ratings/reviews... ],
  "traffic_monthly": 420,
  "revenue": {
    "monthly_loss": 9072,
    "current_revenue": 15876,
    "potential_revenue": 24948,
    "loss_low_usd": 6350,
    "loss_high_usd": 11793
  },
  "cold_email": {
    "subject": "Acme Plumbing — quick visibility check for Dallas",
    "body": "..."
  },
  "review_insights": {
    "replyRate": 0.23,
    "repliedCount": 7,
    "unansweredCount": 23,
    "totalChecked": 30,
    "avgRecentRating": 4.5,
    "snippets": [ "...", "...", "..." ]
  },
  "position_data_source": "dataforseo_maps",
  "ranking_keywords": [
    { "keyword": "plumber", "position": 5 },
    { "keyword": "plumbing service", "position": 6 },
    { "keyword": "emergency plumber", "position": 4 }
  ],
  "gap_summary": "Acme Plumbing at #5 vs Dallas Pro Plumbing at #3 in Dallas (exact Google Maps ranking).",
  "cold_email": { "subject": "...", "body": "..." }
}
```

### Full Checker
**PDF only** — same binary PDF response, filename `ARMA_Audit_<domain>.pdf`.

---

## Throughput & Timing

```
Lite Checker per lead:
  ├── GBP lookup (Google Places)         ~2–4s
  ├── Traffic lookup (DataForSEO)        ~2–3s
  ├── Map pack ranking (DataForSEO)      ~5–15s
  ├── Review fetch (DataForSEO, async)   ~10–20s ← main variable
  ├── GBP posts (DataForSEO)             ~3–5s
  ├── Homepage text fetch (×2)           ~3–8s
  ├── Organic position (DataForSEO)      ~5–10s
  ├── Claude Haiku (×3 calls)            ~3–6s
  └── PDF generation (Puppeteer)         ~5–10s
  TOTAL: ~38 seconds per lead  ← verified

Full Checker per lead (after Lite):
  ├── PageSpeed API (×4 calls, parallel) ~15–30s
  ├── Puppeteer crawl lead site          ~20–40s
  ├── Puppeteer crawl competitor site    ~20–40s
  ├── Claude Sonnet (with screenshots)   ~15–30s
  └── PDF generation                     ~5–10s
  TOTAL: 1–2 minutes per lead

200 leads/day:
  Lite only:      ~38s × 200 = ~2 hours
  Lite + Full:    ~2 min × 200 = ~7 hours
  → Batching requires a queue (currently no built-in queue; requests are processed one at a time)
```

**Rate limits to watch:**
- Google Places API: 1,000 req/day (free tier) — upgrade for scale
- Google PageSpeed API: 25,000 req/day (free tier)
- DataForSEO: billed per request, no hard cap — monitor spend
- Claude API: rate limits by tier, expandable

---

## API Key Requirements

| Key | Used For | Required For |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | GBP lookup, map pack fallback, geocoding | Both checkers |
| `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` | Map rankings, reviews, posts, traffic, organic | Both checkers (primary source) |
| `PAGESPEED_API_KEY` | Website speed scores | Full Checker only |
| `ANTHROPIC_API_KEY` | AI analysis, cold email, niche classification | Both checkers |
