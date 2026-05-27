import { fetchT } from '../lib/http';
import { dfsAuth } from '../lib/auth';

export async function getMonthlyTraffic(domain: string): Promise<number> {
  try {
    const res = await fetchT("https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live", {
      method: "POST",
      headers: { Authorization: `Basic ${dfsAuth()}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ target: domain, location_code: 2840, language_code: "en" }]),
    });
    const json = await res.json();
    const m = json.tasks?.[0]?.result?.[0]?.metrics?.organic;
    const traffic = Math.round(m?.etv ?? m?.count ?? 0);
    if (traffic === 0) {
      console.warn(`[Traffic] ${domain} returned 0 (likely franchise/subdomain site). Using 200 fallback.`);
      return 200;
    }
    return traffic;
  } catch { return 200; }
}

export async function getDailySearches(keyword: string, city: string): Promise<number> {
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
