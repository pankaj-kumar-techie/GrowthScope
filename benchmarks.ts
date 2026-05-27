// benchmarks.ts — Verified Weighted Averages v2.0 — 2026-05-12

export interface NicheBenchmark {
  cvr: number;
  avg_ticket: number;
  confidence: 'H' | 'M' | 'L';
}

export const INDUSTRY_BENCHMARKS: Record<string, NicheBenchmark> = {
  "Fire & Water Damage Restoration": { cvr: 6.0, avg_ticket: 7300, confidence: "M" },
  "Plumbing": { cvr: 3.5, avg_ticket: 1080, confidence: "H" },
  "Pest Control": { cvr: 3.5, avg_ticket: 390, confidence: "H" },
  "Junk Removal / Demolition": { cvr: 4.0, avg_ticket: 510, confidence: "M" },
  "Tree Service": { cvr: 4.0, avg_ticket: 1120, confidence: "M" },
  "Window Cleaning": { cvr: 4.0, avg_ticket: 320, confidence: "L" },
  "Handyman": { cvr: 3.0, avg_ticket: 382, confidence: "M" },
  "HVAC": { cvr: 3.0, avg_ticket: 1635, confidence: "H" },
  "Electrical": { cvr: 3.0, avg_ticket: 885, confidence: "H" },
  "Garage Door Repair / Install": { cvr: 4.0, avg_ticket: 578, confidence: "M" },
  "Flooring": { cvr: 2.0, avg_ticket: 6300, confidence: "L" },
  "Painting": { cvr: 2.0, avg_ticket: 4650, confidence: "M" },
  "Concrete": { cvr: 2.0, avg_ticket: 5700, confidence: "L" },
  "Fences & Decks": { cvr: 2.0, avg_ticket: 6800, confidence: "L" },
  "Drywall": { cvr: 2.0, avg_ticket: 1830, confidence: "L" },
  "Carpet Installation": { cvr: 2.0, avg_ticket: 2300, confidence: "L" },
  "Roofing Replacement": { cvr: 1.2, avg_ticket: 9540, confidence: "H" },
  "Siding": { cvr: 1.2, avg_ticket: 13250, confidence: "M" },
  "Window & Door Replacement": { cvr: 1.5, avg_ticket: 8400, confidence: "M" },
  "Foundation Repair": { cvr: 2.0, avg_ticket: 9750, confidence: "L" },
  "Kitchen Remodeling": { cvr: 1.2, avg_ticket: 26950, confidence: "H" },
  "Bathroom Remodeling": { cvr: 1.5, avg_ticket: 12135, confidence: "H" },
  "Garage Conversion / ADU": { cvr: 1.2, avg_ticket: 68000, confidence: "L" },
  "Solar Installation": { cvr: 0.9, avg_ticket: 22200, confidence: "H" },
  "Pool Installation": { cvr: 1.2, avg_ticket: 53000, confidence: "L" },
  "Insulation": { cvr: 2.0, avg_ticket: 3200, confidence: "M" },
};

// Buyer-intent search terms per niche — keys must match INDUSTRY_BENCHMARKS exactly.
// getBuyerIntentKeywords() resolves any input through findBenchmark first so fuzzy
// inputs like "Roofing" still reach the "Roofing Replacement" keyword list.
export const NICHE_KEYWORDS: Record<string, string[]> = {
  "Plumbing":                        ["plumber", "plumbing service", "emergency plumber"],
  "HVAC":                            ["hvac contractor", "ac repair", "air conditioning repair"],
  "Electrical":                      ["electrician", "electrical contractor", "electrical repair"],
  "Roofing Replacement":             ["roofing contractor", "roofer", "roof repair"],
  "Pest Control":                    ["pest control", "exterminator", "pest exterminator"],
  "Tree Service":                    ["tree service", "tree removal", "tree trimming"],
  "Painting":                        ["painting contractor", "house painter", "interior painter"],
  "Flooring":                        ["flooring contractor", "flooring installation", "floor installer"],
  "Concrete":                        ["concrete contractor", "concrete company", "concrete repair"],
  "Siding":                          ["siding contractor", "siding installation", "siding company"],
  "Foundation Repair":               ["foundation repair", "foundation contractor", "foundation company"],
  "Drywall":                         ["drywall contractor", "drywall repair", "drywall installation"],
  "Junk Removal / Demolition":       ["junk removal", "junk hauling", "junk pickup"],
  "Garage Door Repair / Install":    ["garage door repair", "garage door installation", "garage door company"],
  "Window & Door Replacement":       ["window replacement", "window contractor", "window installation"],
  "Fences & Decks":                  ["fence contractor", "fence installation", "fencing company"],
  "Handyman":                        ["handyman service", "handyman", "handyman near me"],
  "Carpet Installation":             ["carpet installation", "carpet installer", "carpet company"],
  "Kitchen Remodeling":              ["kitchen remodeling", "kitchen renovation", "kitchen contractor"],
  "Bathroom Remodeling":             ["bathroom remodeling", "bathroom renovation", "bathroom contractor"],
  "Window Cleaning":                 ["window cleaning service", "window cleaner", "commercial window cleaning"],
  "Solar Installation":              ["solar installation", "solar company", "solar panel installer"],
  "Pool Installation":               ["pool installation", "pool builder", "swimming pool contractor"],
  "Insulation":                      ["insulation contractor", "insulation installation", "insulation company"],
  "Fire & Water Damage Restoration": ["water damage restoration", "fire damage restoration", "restoration company"],
  "Garage Conversion / ADU":         ["adu contractor", "garage conversion contractor", "accessory dwelling unit"],
};

export function findBenchmark(input: string): { key: string; bm: NicheBenchmark } {
  const i = input.toLowerCase().trim();
  for (const key of Object.keys(INDUSTRY_BENCHMARKS)) {
    if (key.toLowerCase() === i) return { key, bm: INDUSTRY_BENCHMARKS[key] };
  }
  const map: Record<string, string> = {
    plumb: "Plumbing", hvac: "HVAC", heat: "HVAC", cool: "HVAC", "air con": "HVAC",
    roof: "Roofing Replacement", electric: "Electrical", paint: "Painting",
    insulat: "Insulation", pest: "Pest Control", tree: "Tree Service",
    junk: "Junk Removal / Demolition", garage: "Garage Door Repair / Install",
    floor: "Flooring", carpet: "Carpet Installation",
    window: "Window & Door Replacement", door: "Window & Door Replacement",
    kitchen: "Kitchen Remodeling", bath: "Bathroom Remodeling",
    solar: "Solar Installation", pool: "Pool Installation",
    foundation: "Foundation Repair", handyman: "Handyman",
    concrete: "Concrete", fence: "Fences & Decks", deck: "Fences & Decks",
    siding: "Siding", drywall: "Drywall",
    water: "Fire & Water Damage Restoration", fire: "Fire & Water Damage Restoration",
  };
  for (const [kw, nk] of Object.entries(map)) {
    if (i.includes(kw)) return { key: nk, bm: INDUSTRY_BENCHMARKS[nk] };
  }
  console.warn(`[Benchmarks] No match for "${input}", using Plumbing`);
  return { key: "Plumbing", bm: INDUSTRY_BENCHMARKS["Plumbing"] };
}

export function calculateRevenueLoss(monthlyTraffic: number, nicheInput: string) {
  const { key, bm } = findBenchmark(nicheInput);
  const cvr_typical = bm.cvr / 100;
  const cvr_potential = cvr_typical * 2.0;
  const avg_ticket = bm.avg_ticket;

  let traffic = monthlyTraffic;
  if (avg_ticket * cvr_typical > 5000) traffic = Math.min(traffic, 200);

  const current_revenue = traffic * cvr_typical * avg_ticket;
  const potential_revenue = traffic * cvr_potential * avg_ticket;
  let loss = potential_revenue - current_revenue;
  if (loss > 60000) loss = 60000;

  return {
    niche_matched: key, cvr_typical: bm.cvr, avg_ticket,
    current_revenue: Math.round(current_revenue),
    potential_revenue: Math.round(potential_revenue),
    monthly_loss: Math.round(loss),
    loss_low_usd: Math.round(loss * 0.7),
    loss_high_usd: Math.round(loss * 1.3),
    confidence: bm.confidence,
  };
}

// Returns 2–3 real buyer-intent search terms for a niche.
// Uses findBenchmark() to resolve fuzzy inputs ("Roofing" → "Roofing Replacement")
// so the correct keyword list is always returned regardless of how vertical was submitted.
export function getBuyerIntentKeywords(vertical: string): string[] {
  const { key } = findBenchmark(vertical);
  return (NICHE_KEYWORDS[key] ?? [vertical.toLowerCase()]).slice(0, 3);
}