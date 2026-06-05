# API Reference

Base URL: `http://localhost:3002` (or your deployed host)

---

## POST /lite-report

Runs the Lite Checker for a lead. Returns a PDF audit report (or JSON if requested).

### Request

```http
POST /lite-report
Content-Type: application/json

{
  "url":      "https://acmeplumbing.com",  // required: lead website URL
  "city":     "Dallas",                    // required: city name
  "state":    "TX",                        // required: state name or 2-letter code
  "vertical": "Plumbing",                  // optional: industry niche
  "format":   "json"                       // optional: "json" to get raw data instead of PDF
}
```

**Supported verticals:** Plumbing, HVAC, Electrical, Roofing Replacement, Pest Control,
Tree Service, Painting, Flooring, Concrete, Siding, Foundation Repair, Drywall,
Junk Removal / Demolition, Garage Door Repair / Install, Window & Door Replacement,
Fences & Decks, Handyman, Carpet Installation, Kitchen Remodeling, Bathroom Remodeling,
Window Cleaning, Solar Installation, Pool Installation, Insulation,
Fire & Water Damage Restoration, Garage Conversion / ADU

If `vertical` is omitted, defaults to "Home Services" with Plumbing benchmarks.

### Response — PDF (default)

```http
HTTP 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="ARMA_LiteCheck_acmeplumbing.com.pdf"

[binary PDF content]
```

### Response — JSON (`?format=json` or `"format":"json"` in body)

```http
HTTP 200 OK
Content-Type: application/json

{
  "domain": "acmeplumbing.com",
  "city": "Dallas",
  "state": "TX",
  "vertical": "Plumbing",
  "niche_matched": "Plumbing",
  "lead": {
    "name": "Acme Plumbing Co.",
    "rating": 4.7,
    "review_count": 134,
    "position": 5,
    "organic_position": 8,
    "phone": "(214) 555-0100",
    "address": "123 Main St, Dallas, TX 75201",
    "owner": "John Smith",
    "service_area": "Dallas, Plano, Frisco"
  },
  "competitor": {
    "name": "Dallas Pro Plumbing",
    "position": 3,
    "rating": 4.9,
    "review_count": 312,
    "domain": "dallasproplumbing.com",
    "phone": "(214) 555-0200"
  },
  "fullPack": [ ... ],
  "traffic_monthly": 420,
  "revenue": {
    "monthly_loss": 9072,
    "loss_low_usd": 6350,
    "loss_high_usd": 11793,
    "current_revenue": 15876,
    "potential_revenue": 24948
  },
  "review_insights": {
    "replyRate": 0.23,
    "repliedCount": 7,
    "unansweredCount": 23,
    "totalChecked": 30,
    "snippets": ["...", "...", "..."]
  },
  "ranking_keywords": [
    {"keyword": "plumber", "position": 5}
  ],
  "cold_email": {
    "subject": "...",
    "body": "..."
  }
}
```

### Error Responses

```http
HTTP 400
{ "error": "url, city, state required" }

HTTP 502
{
  "error": "Could not fetch map pack rankings. Check DATAFORSEO_LOGIN/PASSWORD (primary) and GOOGLE_PLACES_API_KEY (fallback).",
  "keywords_tried": ["plumber", "plumbing service", "emergency plumber"],
  "search_location": "Dallas, TX"
}
```

---

## POST /full-report

Runs the Full Checker. **Requires Lite Checker to have been run first for the same domain.**

### Request

```http
POST /full-report
Content-Type: application/json

{
  "url": "https://acmeplumbing.com"   // required
}
```

### Response

```http
HTTP 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="ARMA_Audit_acmeplumbing.com.pdf"

[binary PDF content]
```

### Error Responses

```http
HTTP 400
{ "error": "url required" }

HTTP 400
{ "error": "No Lite Report found. Call POST /lite-report first." }
```

---

## Batch Processing Example (200 leads/day)

The API processes one request at a time per connection. To run 200 leads/day,
call the endpoint sequentially from a script:

```python
import requests
import time

leads = [
  {"url": "https://example1.com", "city": "Dallas",  "state": "TX", "vertical": "Plumbing"},
  {"url": "https://example2.com", "city": "Houston", "state": "TX", "vertical": "HVAC"},
  # ...
]

BASE = "http://your-server:3002"

for lead in leads:
    # Step 1: Lite Checker → save PDF
    r = requests.post(f"{BASE}/lite-report", json=lead, timeout=300)
    if r.status_code == 200:
        filename = f"lite_{lead['url'].split('//')[1].split('/')[0]}.pdf"
        open(filename, "wb").write(r.content)
        print(f"Saved: {filename}")
    else:
        print(f"Error: {r.text}")
        continue

    # Optional Step 2: Full Checker
    r2 = requests.post(f"{BASE}/full-report", json={"url": lead["url"]}, timeout=300)
    if r2.status_code == 200:
        filename2 = f"full_{lead['url'].split('//')[1].split('/')[0]}.pdf"
        open(filename2, "wb").write(r2.content)

    time.sleep(2)  # brief pause between leads
```

---

## Timing Expectations

| Endpoint | Typical Time | What Takes the Longest |
|---|---|---|
| POST /lite-report | ~38 seconds (verified) | DataForSEO Reviews async task |
| POST /full-report | 1–2 minutes | Puppeteer crawls + PageSpeed API |

---

## Caching

The system caches certain data to avoid redundant API calls:

| Cache | TTL | Table |
|---|---|---|
| Map pack results | 24 hours | `mappack_cache` |
| PageSpeed scores | 24 hours | `pagespeed_cache` |
| Lead/competitor data | Permanent | `leads` table |

Running the same domain twice within 24h: map pack and PageSpeed are served from cache.
To force fresh data, delete the cache row from the SQLite database.

---

## Quick Test (curl)

```bash
# Lite Checker — PDF
curl -X POST http://localhost:3002/lite-report \
  -H "Content-Type: application/json" \
  -d '{"url":"https://acmeplumbing.com","city":"Dallas","state":"TX","vertical":"Plumbing"}' \
  --output lite_report.pdf

# Lite Checker — JSON (for debugging or downstream processing)
curl -X POST "http://localhost:3002/lite-report?format=json" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://acmeplumbing.com","city":"Dallas","state":"TX","vertical":"Plumbing"}'

# Full Checker — PDF (run after lite)
curl -X POST http://localhost:3002/full-report \
  -H "Content-Type: application/json" \
  -d '{"url":"https://acmeplumbing.com"}' \
  --output full_report.pdf
```
