// ─── SCOPE: Google Places API Lead Generation ─────────────────────────────────
// Client Plan: Email Marketing Lead Database via Google Places API
//
// Business Need:
//   Pull targeted lead databases for email marketing campaigns.
//   Search by keyword + niche + city → return maximum businesses per location.
//   Output formatted to match the client's spreadsheet template.
//
// Spreadsheet Template:
//   https://docs.google.com/spreadsheets/d/1sczUYMGMrPtml6OmA-9YK4nDZ-uiGf-FoZshu-KCAek
//
// Template Structure:
//   • Top-level tabs: US States
//   • Per state:      Cities (each city has its own table)
//   • Per city:       Sub-tables per niche (e.g. HVAC, Plumbing, Roofing…)
//
// Status: SCOPED — not yet implemented.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Search Parameters ────────────────────────────────────────────────────────

export interface LeadSearchParams {
  keyword: string;        // buyer-intent term, e.g. "electrician", "plumber near me"
  niche: string;          // maps to a key in INDUSTRY_BENCHMARKS
  city: string;
  state: string;
  maxResults?: number;    // default: 60 (Google Places paginates in sets of 20)
}

// ─── Output Record ────────────────────────────────────────────────────────────
// Columns align with the client spreadsheet template.
// Final column list to be confirmed once template is fully reviewed.

export interface LeadRecord {
  businessName: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  website: string;
  rating: number;
  reviewCount: number;
  placeId: string;
  googleMapsUrl: string;
  niche: string;
  keyword: string;
}

// ─── Export Job ───────────────────────────────────────────────────────────────

export type ExportJobStatus = 'pending' | 'running' | 'done' | 'error';

export interface LeadExportJob {
  id: string;
  params: LeadSearchParams;
  status: ExportJobStatus;
  results: LeadRecord[];
  totalFound: number;
  createdAt: Date;
  completedAt?: Date;
  errorMessage?: string;
}

// ─── Planned API Endpoints ────────────────────────────────────────────────────
//
//   POST /leads/search
//     Body: LeadSearchParams
//     Returns: LeadRecord[]
//     Notes:
//       - Uses Google Places Text Search API (same key as existing GBP lookups)
//       - Paginates via next_page_token to approach 60-result cap
//       - Rate-limits requests to stay within Places API quota
//
//   POST /leads/export
//     Body: { jobId: string; format: 'csv' | 'json' }
//     Returns: file download (CSV) or JSON
//     Notes:
//       - Maps LeadRecord fields to spreadsheet column order
//       - Supports per-city, per-niche grouping to match template structure
//
//   GET /leads/jobs/:id
//     Returns: LeadExportJob (status + partial results while running)
//
// ─── Database Table (planned) ─────────────────────────────────────────────────
//
//   CREATE TABLE IF NOT EXISTS lead_export_jobs (
//     id           TEXT PRIMARY KEY,
//     params_json  TEXT NOT NULL,
//     status       TEXT NOT NULL DEFAULT 'pending',
//     results_json TEXT,
//     total_found  INTEGER DEFAULT 0,
//     created_at   DATETIME DEFAULT (datetime('now')),
//     completed_at DATETIME
//   );
//
// ─── Implementation Notes ─────────────────────────────────────────────────────
//
//   1. Reuse GOOGLE_PLACES_API_KEY already in .env
//   2. Places Text Search returns max 20 results per page; use next_page_token
//      with a 2-second delay between paginated calls (Google requirement)
//   3. Map niche inputs through findBenchmark() for consistent keyword resolution
//   4. Persist jobs in SQLite so large exports survive server restarts
//   5. Confirm exact spreadsheet column mapping before implementing LeadRecord
