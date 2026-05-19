# 📊 ARMA Audit Engine & GrowthScope API

> **Production Final Edition**  
> A premium, high-fidelity lead audit engine built to generate conversion-focused website and local search (GBP) audits. Every metric is backed by actual API responses; no hallucinations.

---

## 🎯 Purpose & Core Value
The ARMA Audit Engine is designed to analyze home-service contractors (plumbing, roofing, HVAC, etc.) and generate high-impact, Hormozi-style revenue opportunity reports. It exposes structural conversion gaps, Google Business Profile (GBP) optimization failures, and speed bottlenecks, mapping these issues directly to lost revenue based on industry-validated niche benchmarks.

---

## 🚀 Key Features

*   **📍 Local Map Pack Position Tracker**: Fetches the exact Google Maps SERP rankings for the client and their competitors via **DataForSEO** with a robust fallback to **Google Places Text Search**.
*   **⚡ PageSpeed Audits (Cached)**: Analyzes Core Web Vitals (LCP, CLS, INP, TTFB, Performance Score) on mobile/desktop using the official **Google PageSpeed Insights API**. Employs a local SQLite-backed 7-day cache to prevent API rate limits.
*   **🕸️ Headless Puppeteer Crawler**: Crawls the client's website in real-time, executing responsive layouts, checking for conversion-focused indicators:
    *   Sticky click-to-call bars
    *   Above-the-fold CTA buttons
    *   Visible phone numbers (above-the-fold)
    *   On-site review displays & trust badges
    *   Emergency (24/7) messaging and financing packages
*   **📊 Automatic Financial Modeling**: Matches classified verticals against industry-standard benchmarks (conversion rates, average ticket values, margins) to compute the actual **Monthly Revenue Gap** between the client and their top competitor.
*   **🤖 AI Coprocessor Integration**: Feeds structured findings into **Claude (Sonnet/Haiku)** to write direct, business-focused copy. Includes deterministic fail-safes in case of API outages.

---

## 🛠️ Tech Stack & Database Schema

*   **Runtime**: Node.js & TypeScript (`ts-node`)
*   **Framework**: Express.js
*   **Database**: SQLite (`better-sqlite3`) for audit logs and Pagespeed caching.
*   **Automation/Scraping**: Puppeteer Core / Chromium

### Schema Overview (`db.ts`)

#### 1. `leads` Table
Stores leads, scrapers results, competitors' metadata, organic traffic, and fully generated JSON briefs.
```sql
CREATE TABLE IF NOT EXISTS leads (
  lead_id                  TEXT PRIMARY KEY,
  business_name            TEXT,
  domain                   TEXT,
  city                     TEXT,
  state                    TEXT,
  vertical                 TEXT,
  niche_matched            TEXT,
  primary_keyword          TEXT,
  lead_gbp_rating          REAL,
  lead_review_count        INTEGER,
  lead_map_position        INTEGER,
  lead_gbp_place_id        TEXT,
  competitor_name          TEXT,
  competitor_domain        TEXT,
  competitor_gbp_id        TEXT,
  competitor_rating        REAL,
  competitor_review_count  INTEGER,
  competitor_position      INTEGER,
  traffic_monthly          INTEGER,
  lite_report_data         TEXT,
  lite_report_generated_at DATETIME,
  full_report_generated_at DATETIME
);
```

#### 2. `pagespeed_cache` Table
Caches 7 days of Google PageSpeed audit results per domain/strategy combo.
```sql
CREATE TABLE IF NOT EXISTS pagespeed_cache (
  domain        TEXT NOT NULL,
  strategy      TEXT NOT NULL CHECK(strategy IN ('mobile','desktop')),
  score         INTEGER,
  lcp           TEXT,
  cls           TEXT,
  inp           INTEGER,
  ttfb          INTEGER,
  raw_json      TEXT,
  fetched_at    DATETIME DEFAULT (datetime('now')),
  PRIMARY KEY (domain, strategy)
);
```

---

## 🛠️ Setup & Local Installation

### 1. Clone & Configure Environments
Copy the example environment file and update your API credentials:
```bash
cp .env.example .env
```
Fill in the API keys in your newly created `.env` file:
*   `ANTHROPIC_API_KEY` (Claude sonnet/haiku API)
*   `PAGESPEED_API_KEY` (Google developer page speed console)
*   `GOOGLE_PLACES_API_KEY` (Google Developer console with Places API enabled)
*   `DATAFORSEO_LOGIN` & `DATAFORSEO_PASSWORD` (DataForSEO developer credentials)

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Development Server
Starts the API server locally on port `3002`:
```bash
npm run dev
```

---

## 🔌 API Endpoints

### 🩺 1. Health Check
*   **Endpoint**: `GET /health`
*   **Description**: Ensures database connectivity and API server health.
*   **Response**:
    ```json
    { "status": "healthy", "database": "connected" }
    ```

### ⚡ 2. Generate Lite Report
*   **Endpoint**: `POST /lite-report`
*   **Payload**:
    ```json
    {
      "businessName": "Example Plumbing",
      "city": "Toledo",
      "state": "OH",
      "vertical": "plumbing"
    }
    ```
*   **Description**: Quickly fetches basic local GBP details and prepares high-level statistics.

### 🛡️ 3. Run Full Audit Report
*   **Endpoint**: `POST /full-report`
*   **Payload**:
    ```json
    {
      "businessName": "Example Plumbing",
      "url": "https://exampleplumbing.com",
      "city": "Toledo",
      "state": "OH",
      "vertical": "plumbing",
      "keyword": "plumber",
      "positionHint": 5,
      "reviewCountHint": 15
    }
    ```
*   **Description**: Runs deep website crawl (above-fold checks, trust badges, speeds), looks up competitors on Google Maps, does financial mathematical calculations, and triggers AI analysis for copy generation.

---

## 🛡️ License & Attributions
Created and maintained by the GrowthScope engineering team.
All rights reserved. 2026.
