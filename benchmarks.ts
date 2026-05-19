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