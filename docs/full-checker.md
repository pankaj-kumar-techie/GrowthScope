# Full Checker — Detailed Flow

**Endpoint:** `POST /full-report`

**Prerequisite:** Lite Checker must be run first for the same domain.
The Full Checker reads the competitor data locked in by the Lite Checker from the database.

**Purpose:** Deep 6-page audit report. Adds page speed scores, visual website crawl
(screenshots + feature detection), side-by-side competitor comparison, and Claude Sonnet
analysis of the full picture.

---

## Input

```json
{
  "url": "https://acmeplumbing.com"   // required — must match a saved Lite Report
}
```

---

## Step-by-Step Flow

### Prerequisite Check — Read from Database

```
Database: leads table
Query: SELECT * FROM leads WHERE domain = 'acmeplumbing.com'

If no record found → 400 error: "No Lite Report found. Call POST /lite-report first."

Loaded from DB:
  competitor_name, competitor_domain, competitor_gbp_id
  competitor_rating, competitor_review_count, competitor_position
  lead_map_position, lead_gbp_rating, lead_review_count
  traffic_monthly, city, state, vertical, lead_gbp_place_id
  lite_report_data (full JSON from Lite run — includes fullPack)
```

### Step 1 — Speed + GBP Data (all parallel, ~20–40s)

```
7 calls run simultaneously:

1. Google PageSpeed Insights — Lead site, MOBILE
   ────────────────────────────────────────────────
   URL: https://acmeplumbing.com
   Returns:
     score:  62/100          (Lighthouse performance score)
     lcp:    "4.2 s"         (Largest Contentful Paint)
     cls:    "0.12"          (Cumulative Layout Shift)
     inp:    850             (Interaction to Next Paint, ms)
     ttfb:   "1.1 s"         (Time to First Byte)
   Cached: 24h SQLite cache per domain+strategy

2. Google PageSpeed Insights — Lead site, DESKTOP
   Returns same fields for desktop view

3. Google PageSpeed Insights — Competitor site, MOBILE
   Returns same fields for competitor

4. Google PageSpeed Insights — Competitor site, DESKTOP
   Returns same fields for competitor desktop

5. DataForSEO Keywords Data: Google Ads Search Volume
   ────────────────────────────────────────────────────
   Query: "plumber Dallas"
   Returns: monthly search volume → divided by 30 → daily searches (~40/day)
   Used for: call volume math in the report

6. DataForSEO Business Data: Google Reviews
   (same as Lite Checker — fresh fetch for report accuracy)

7. DataForSEO Business Data: GBP Posts
   (same as Lite Checker — fresh fetch)
```

### Step 2 — Website Crawls (sequential to avoid memory issues, ~40–80s)

```
Puppeteer (headless Chrome) crawls each site.
Sequential, not parallel — crawling both at once risks OOM on the server.

LEAD SITE CRAWL: https://acmeplumbing.com
────────────────────────────────────────────
  Browser viewport 1: 390px wide (mobile)
  Browser viewport 2: 1280px wide (desktop)

  Screenshots:
    screenshotMobile:  JPEG base64 of 390px viewport above fold
    screenshotDesktop: JPEG base64 of 1280px viewport above fold
    (These are sent to Claude for visual verification)

  Feature detection (DOM + rendered HTML analysis):
  ┌─────────────────────────────┬──────────────────────────────────────────┐
  │ Boolean                     │ What it checks                           │
  ├─────────────────────────────┼──────────────────────────────────────────┤
  │ hasPhoneAboveFold           │ Phone number visible in top 600px        │
  │ hasPhoneAboveFoldMobile     │ Phone visible on 390px mobile view       │
  │ hasStickyCTA                │ Fixed/sticky CTA button present          │
  │ hasAboveFoldCTA             │ CTA button above fold (not sticky)       │
  │ hasReviewsOnHome            │ Google reviews widget on homepage        │
  │ hasTrustBadges              │ BBB, license, or insurance badge logos   │
  │ hasServiceAreaPages         │ Links to city/neighborhood service pages │
  │ hasBookingForm              │ Quote request or booking form            │
  │ hasEmergencyMessaging       │ "24/7", "emergency", "same day" text     │
  │ hasFinancing                │ "financing", "payment plan", "0% APR"    │
  │ hasDomainMismatch           │ Page title doesn't match domain          │
  └─────────────────────────────┴──────────────────────────────────────────┘
  Also: pageText (visible text), title (page title)

COMPETITOR SITE CRAWL: https://dallasproplumbing.com
──────────────────────────────────────────────────────
  Same detection, no screenshots
  Used for: comparison table in Page 3 of the report
```

### Step 3 — Claude AI Analysis (~15–30s)

```
Model: Claude Sonnet

Input sent to Claude:
  ├── Lead PageSpeed: mobile 62/100 LCP 4.2s | desktop 78/100
  ├── Competitor PageSpeed: mobile 81/100 LCP 2.1s | desktop 88/100
  ├── Lead crawl booleans (all 11 features above)
  ├── Competitor crawl booleans
  ├── Screenshots (mobile + desktop as base64 images)
  │   → Claude visually verifies: "Is the phone really visible above fold?"
  │   → Screenshots override DOM booleans if there's a discrepancy
  ├── Review data (reply rate, unanswered count, snippets)
  ├── GBP post frequency
  ├── Revenue math (pre-computed — Claude must use these exact numbers)
  ├── Map pack data (full pack with all positions)
  └── Daily search volume

Pre-computed math Claude uses verbatim:
  "~56 calls/day go to Dallas Pro Plumbing at #3.
   You capture ~12 at #5. That gap costs ~$9,072/mo."

  bounce_loss: $2,721/mo
  "~126 visitors/month leave Acme Plumbing's site before contacting anyone.
   At $1,080 avg job and 3.5% CVR, that's ~$2,721/month in missed revenue."

Claude output (structured JSON):
  paradox_headline:    "Strong Reviews. Wrong Position. Bleeding Money."

  cover_by_the_numbers:
    position:          "#5"
    reviews:           "134"
    revenue_gap:       "$6k–$12k"
    fixes:             "4"

  page2 (Map Rankings section):
    headline:          "Outranked by Dallas Pro Plumbing in Dallas"
    subhead:           "Being at #5 costs ~$9,072/month in high-intent calls."
    the_math:          "~56 calls/day go to Dallas Pro Plumbing..."
    fixes[3]:          3 specific GBP / map ranking fixes with impact %

  page3 (Website Audit section):
    headline:          "Three Seconds. No Reason to Stay."
    subhead:           "$2,721/month leaving before anyone is contacted."
    comparison_table:  7 rows (mobile speed, desktop speed, LCP, phone, CTA, reviews, badges)
    fixes[3]:          3 specific website fixes

  page5 (Additional Issues):
    issues[2]:         2 issues not covered on pages 2–3, with dollar impact

Review fix logic (enforced — Claude cannot override):
  If reply_rate < 15% AND ≥10 reviews checked:
    → Fix must say: "Reply to every review"
  If some unanswered but generally responds:
    → Fix must say: "Reply to your X unanswered reviews"
  If already responding well:
    → Pick a different GBP fix (Q&A, photos, etc.)

GBP posts logic:
  If posts_per_week ≥ 2:
    → Never recommend "add GBP posts" — pick something else
```

### Step 4 — Output

```
generateReportHTML() → 6-page HTML document

Includes:
  Page 1 (Cover):   paradox headline, 4 key numbers
  Page 2 (Rankings): map pack position analysis, math, 3 fixes
  Page 3 (Website):  speed scores, feature comparison table, 3 fixes
  Page 4 (Reviews):  review snippets, reply rate, GBP activity
  Page 5 (Issues):   2 additional audit findings
  Page 6 (CTA):      next steps, contact

HTML → Puppeteer → PDF

Response:
  HTTP 200
  Content-Type: application/pdf
  Content-Disposition: attachment; filename="ARMA_Audit_acmeplumbing.com.pdf"
```

---

## PageSpeed Metrics Explained

| Metric | Good | Needs Work | What it means |
|---|---|---|---|
| Score | 90–100 | < 70 | Overall Lighthouse performance score |
| LCP | < 2.5s | > 4s | When the main content loads |
| CLS | < 0.1 | > 0.25 | Layout shift (things jumping around) |
| INP | < 200ms | > 500ms | Response time to user interaction |
| TTFB | < 0.8s | > 1.8s | Server response time |

---

## Competitor Selection Carried from Lite

The Full Checker does NOT re-select a competitor. It uses exactly what Lite saved:

```
DB read:
  competitor_name:      "Dallas Pro Plumbing"
  competitor_domain:    "dallasproplumbing.com"
  competitor_gbp_id:    "ChIJyyyyyy"
  competitor_position:  3
  competitor_rating:    4.9
  competitor_review_count: 312
```

This ensures the two reports always tell the same story about the same competitor.
