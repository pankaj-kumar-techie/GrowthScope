// db.ts
import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(__dirname, 'audits.db'));

db.exec(`
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
`);

export default db;