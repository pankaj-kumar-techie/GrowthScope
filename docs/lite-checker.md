# Lite Checker — Detailed Flow

**Endpoint:** `POST /lite-report`

**Purpose:** Fast lead qualification. Pulls Google Maps ranking, competitor comparison,
review insights, traffic estimate, and revenue gap. Outputs a short PDF (or JSON).

---

## Input

```json
{
  "url":      "https://acmeplumbing.com",   // required
  "city":     "Dallas",                     // required
  "state":    "TX",                         // required
  "vertical": "Plumbing"                    // optional — auto-detected from niche list if omitted
}
```

---

## Step-by-Step Flow

### Step 1 — GBP Lookup + Traffic (parallel, ~4s)

```
POST /lite-report
        │
        ├──► Google Places Text Search API
        │    Query: "acmeplumbing.com Dallas TX"
        │    Fallback: "Acme Plumbing Dallas TX"
        │    Verifies match by comparing website field to submitted domain
        │    ─────────────────────────────────────────────────────────────
        │    Output:
        │      real_name:     "Acme Plumbing Co."
        │      rating:        4.7
        │      review_count:  134
        │      place_id:      "ChIJxxxxxx"
        │      phone:         "(214) 555-0100"
        │      address:       "123 Main St, Dallas, TX 75201"
        │      gbp_city:      "Dallas"   ← may differ from submitted city
        │      gbp_state:     "Texas"
        │
        └──► DataForSEO Labs: Domain Rank Overview
             Target: "acmeplumbing.com"
             ─────────────────────────────────────
             Output:
               traffic_monthly: 420   (estimated organic visits/month)
               Falls back to 200 if API returns 0 or fails
```

### Step 2 — Map Pack Rankings (~5–20s)

```
Using: real_name from Step 1, GBP place_id, review count

3 keyword searches run in parallel:
  "plumber in Dallas"
  "plumbing service in Dallas"
  "emergency plumber in Dallas"

PRIMARY — DataForSEO SERP Maps (live/advanced):
────────────────────────────────────────────────
  Returns: exact ranking as a real user in Dallas would see on Google Maps
  Fields per result: rank_group (#), name, rating, review_count, place_id

FALLBACK — Google Places Text Search:
──────────────────────────────────────
  Used when DataForSEO is unavailable
  Results geocoded to city center (20km radius bias)
  Result order = Google prominence ≈ map ranking

Finding the lead in results:
  Pass 1: exact place_id match  (zero ambiguity)
  Pass 2: name word match + review count score

Competitor selection logic:
  Lead #1        → compare to #2
  Lead #2–4      → compare to #1
  Lead #5–8      → compare to #3
  Lead #9–13     → compare to #4
  Lead #14+      → compare to #5

Output:
  lead.position:          5          (primary keyword rank)
  ranking_keywords:       [{"keyword":"plumber","position":5}, ...]
  competitor.name:        "Dallas Pro Plumbing"
  competitor.position:    3
  competitor.rating:      4.9
  competitor.review_count: 312
  competitor.domain:      "dallasProplumbing.com"
  fullPack:               [top 5 businesses in map pack]
  position_data_source:   "dataforseo_maps"   or "google_places"

Cached: yes — 24-hour SQLite cache per keyword+city+state
```

### Step 3 — Enrichment (parallel, ~20–60s)

```
6 calls run simultaneously:

1. DataForSEO Business Data: Google Reviews
   ─────────────────────────────────────────
   Method: task_post → poll every 5s → task_get  (async job, ~15–60s)
   Depth: 100 reviews, sorted newest first
   Returns per review: text, star rating, owner_answer (replied or not)

   Output:
     replyRate:           0.23  (23% of reviews have owner replies)
     repliedCount:        7
     unansweredCount:     23
     totalChecked:        30
     avgRecentRating:     4.5
     snippets:            up to 20 review excerpts with reply status

   Fallback: Google Places API v1 (if DataForSEO unavailable)
     Note: Places v1 does NOT expose owner reply data
     In this case: replyDataAvailable=false — report won't claim "no replies"

2. DataForSEO Business Data: GBP Posts
   ──────────────────────────────────────
   Returns: posts from last 28 days → gbpPostsPerWeek (e.g. 1.5)

3. Lead Homepage Fetch (HTTP GET)
   ─────────────────────────────────
   Strips HTML → raw visible text
   Passed to Claude for owner name + service area extraction

4. Google Places Details: Competitor Phone
   ─────────────────────────────────────────
   Places Details API call for competitor place_id
   Returns: formatted phone number

5. Competitor Homepage Fetch (HTTP GET)
   ────────────────────────────────────────
   Same as #3 for competitor site

6. DataForSEO SERP Organic (live/advanced)
   ──────────────────────────────────────────
   Query: "plumber in Dallas" (primary keyword)
   Returns: position in organic (non-maps) Google results (top 10)
```

### Step 4 — Claude AI Processing (~5–8s)

```
3 Claude calls run in parallel:

Claude Haiku — Lead insights
  Input:  lead homepage text (~3000 chars)
  Output: { owner: "John Smith", serviceArea: "Dallas, Plano, Frisco" }

Claude Haiku — Competitor insights
  Input:  competitor homepage text
  Output: { owner: "Mike Johnson", serviceArea: "Dallas, Irving" }

Claude Haiku — Cold email
  Input:  lead name, city, position, reviews, competitor name/position, revenue gap
  Output: { subject: "...", body: "3 sentences" }
  Rules:  specific numbers, no SEO jargon, soft CTA to get full report
```

### Step 5 — Revenue Calculation (instant, no API)

```
Industry benchmarks lookup (26 verticals):
  Plumbing → CVR: 3.5% | Avg ticket: $1,080

Formula:
  current_revenue  = traffic × CVR × avg_ticket
  potential_revenue = traffic × (CVR × 2) × avg_ticket
  monthly_loss     = potential_revenue - current_revenue   (capped at $60k)

Output:
  monthly_loss:     $9,072
  current_revenue:  $15,876
  potential_revenue:$24,948
  loss_low_usd:     $6,350   (70% of monthly_loss)
  loss_high_usd:    $11,793  (130% of monthly_loss)
```

### Step 6 — Database Save

```
SQLite table: leads
Saved fields: domain, real_name, city, state, vertical, map position,
              competitor (name/domain/place_id/rating/reviews/position),
              traffic, full lite_report_data as JSON

Purpose: Full Checker reads competitor fields from this row.
         Ensures both reports use the SAME competitor — no inconsistency.
```

### Step 7 — Output

```
Default:
  HTML → Puppeteer (headless Chrome) → PDF
  Response: binary PDF, Content-Disposition attachment

JSON mode (?format=json or "format":"json" in body):
  Returns complete liteReport JSON object (all fields above)
```

---

## Complete Field List (JSON output)

```json
{
  "domain":           "acmeplumbing.com",
  "city":             "Dallas",
  "state":            "TX",
  "vertical":         "Plumbing",
  "niche_matched":    "Plumbing",
  "search_location":  "Dallas, TX",

  "lead": {
    "name":                "Acme Plumbing Co.",
    "rating":              4.7,
    "review_count":        134,
    "place_id":            "ChIJxxxxxx",
    "gbp_url":             "https://www.google.com/maps/place/?q=place_id:ChIJxxxxxx",
    "position":            5,
    "organic_position":    8,
    "position_by_keyword": [
      { "keyword": "plumber",          "position": 5 },
      { "keyword": "plumbing service", "position": 6 },
      { "keyword": "emergency plumber","position": 4 }
    ],
    "phone":        "(214) 555-0100",
    "address":      "123 Main St, Dallas, TX 75201",
    "owner":        "John Smith",
    "service_area": "Dallas, Plano, Frisco, McKinney"
  },

  "competitor": {
    "name":         "Dallas Pro Plumbing",
    "rating":       4.9,
    "review_count": 312,
    "position":     3,
    "domain":       "dallasproplumbing.com",
    "place_id":     "ChIJyyyyyy",
    "gbp_url":      "https://www.google.com/maps/place/?q=place_id:ChIJyyyyyy",
    "phone":        "(214) 555-0200",
    "owner":        "Mike Johnson",
    "service_area": "Dallas, Irving, Garland"
  },

  "fullPack": [
    { "position":1, "name":"Best Plumbing LLC",   "rating":4.8, "review_count":520, "isLead":false, "isCompetitor":false },
    { "position":2, "name":"Dallas Drain Pros",   "rating":4.6, "review_count":210, "isLead":false, "isCompetitor":false },
    { "position":3, "name":"Dallas Pro Plumbing", "rating":4.9, "review_count":312, "isLead":false, "isCompetitor":true  },
    { "position":4, "name":"Quick Fix Plumbing",  "rating":4.5, "review_count": 89, "isLead":false, "isCompetitor":false },
    { "position":5, "name":"Acme Plumbing Co.",   "rating":4.7, "review_count":134, "isLead":true,  "isCompetitor":false }
  ],

  "traffic_monthly": 420,

  "revenue": {
    "niche_matched":    "Plumbing",
    "cvr_typical":      3.5,
    "avg_ticket":       1080,
    "current_revenue":  15876,
    "potential_revenue":24948,
    "monthly_loss":     9072,
    "loss_low_usd":     6350,
    "loss_high_usd":    11793,
    "confidence":       "H"
  },

  "review_insights": {
    "replyRate":           0.23,
    "repliedCount":        7,
    "unansweredCount":     23,
    "totalChecked":        30,
    "avgRecentRating":     4.5,
    "hasUnansweredRecent": true,
    "replyDataAvailable":  true,
    "snippets": [
      "\"Great service, fast response\" (5★ NO REPLY — MISSED OPPORTUNITY)",
      "\"Fixed our leak same day\" (4★ [Owner replied])",
      "\"Professional and fair pricing\" (5★ NO REPLY — MISSED OPPORTUNITY)"
    ]
  },

  "position_data_source": "dataforseo_maps",
  "ranking_method":       "exact_google_maps",
  "ranking_keywords": [
    { "keyword": "plumber",           "position": 5 },
    { "keyword": "plumbing service",  "position": 6 },
    { "keyword": "emergency plumber", "position": 4 }
  ],

  "gap_summary": "Acme Plumbing Co. at #5 vs Dallas Pro Plumbing at #3 in Dallas (exact Google Maps ranking).",

  "cold_email": {
    "subject": "Acme Plumbing — 5th on Google Maps while a competitor holds 3rd",
    "body": "I ran a Google Maps check on Acme Plumbing and found you at #5 while Dallas Pro Plumbing holds #3 — a gap worth roughly $9,072/month in missed calls. I put together a short brief with the numbers (attached). If you'd like the full audit with the exact steps to close that gap, just reply and I'll send it over."
  }
}
```
