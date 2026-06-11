import Anthropic from "@anthropic-ai/sdk";
import { calculateRevenueLoss, INDUSTRY_BENCHMARKS } from '../benchmarks';
import type { GBPReviewInsights } from '../services/gbp';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

export async function extractLeadInsights(
  pageText: string,
  city: string,
  state: string,
): Promise<{ owner: string; serviceArea: string }> {
  if (!pageText) return { owner: '', serviceArea: 'Not clearly specified' };
  const prompt = `From this website text, extract:
1. Owner or founder name (look for "owner", "founder", "president", "I'm [Name]", "My name is [Name]", "founded by [Name]". Return empty string if not clearly found.)
2. Service areas (cities, counties, or regions explicitly mentioned as places the business serves. Return comma-separated list. If not clearly listed, return "Not clearly specified".)

Business context: located in ${city}, ${state}
Website text:
${pageText.substring(0, 3000)}

Respond ONLY with valid JSON: {"owner":"name or empty string","serviceArea":"City1, City2, ... or Not clearly specified"}`;

  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (r.content[0] as any).text.trim();
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s !== -1 && e !== -1) {
      const parsed = JSON.parse(raw.substring(s, e + 1));
      return {
        owner: parsed.owner ?? '',
        serviceArea: parsed.serviceArea ?? 'Not clearly specified',
      };
    }
  } catch (err: any) {
    console.warn('[extractLeadInsights] Claude failed:', err.message);
  }
  return { owner: '', serviceArea: 'Not clearly specified' };
}

export async function classifyNiche(text: string, title: string, provided?: string): Promise<string> {
  if (provided) return provided;
  try {
    const niches = Object.keys(INDUSTRY_BENCHMARKS).join(', ');
    const r = await anthropic.messages.create({
      model: "claude-sonnet-4-5", max_tokens: 50,
      messages: [{ role: "user", content: `Return ONLY the single best matching niche from: ${niches}\n\nTitle: ${title}\nText: ${text.substring(0, 800)}\n\nOne niche name only.` }]
    });
    return (r.content[0] as any).text.trim();
  } catch (err: any) {
    console.warn('[classifyNiche] Claude failed, defaulting to Home Services:', err.message);
    return 'Home Services';
  }
}

export async function generateColdEmail(p: {
  leadName: string;
  city: string;
  state: string;
  vertical: string;
  leadPosition: number;
  leadReviews: number;
  leadRating: number;
  competitorName: string;
  competitorPosition: number;
  competitorReviews: number;
  monthlyLoss: number;
  reviewInsights: GBPReviewInsights | null;
  gbpPostsPerWeek: number | null;
}): Promise<{ subject: string; body: string }> {
  const { leadName, city, state, vertical, leadPosition, leadReviews, leadRating,
          competitorName, competitorPosition, competitorReviews, monthlyLoss } = p;

  const prompt = `Write a short cold email from a local marketing agency (ARMA) to a business owner.
Goal: make them want a full 6-page audit report.

AUDIT FINDINGS (use verbatim — no rounding):
- Business: ${leadName} · ${city}, ${state} · ${vertical}
- Their Google Maps position: #${leadPosition}
- Top competitor outranking them: ${competitorName} at #${competitorPosition}
- Their reviews: ${leadReviews} reviews at ${leadRating}★ | Competitor: ${competitorReviews} reviews
- Estimated monthly revenue gap: $${monthlyLoss.toLocaleString()}

RULES:
1. Subject line: under 10 words, specific, name the business or city.
2. Body: exactly 3 sentences.
   - Sentence 1: state the specific gap (their position vs competitor's, with dollar figure).
   - Sentence 2: tell them we put together a quick audit brief and attached it.
   - Sentence 3: soft CTA — reply to get the full detailed audit with specific fix steps.
3. No SEO jargon. No "I hope this finds you well." No bullet points.
4. Output ONLY valid JSON: {"subject":"...","body":"..."}`;

  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (r.content[0] as any).text.trim();
    try { return JSON.parse(raw); } catch {}
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s !== -1 && e !== -1) return JSON.parse(raw.substring(s, e + 1));
  } catch (err: any) {
    console.warn('[ColdEmail] Claude failed, using fallback:', err.message);
  }

  return {
    subject: `${leadName} — quick visibility check for ${city}`,
    body: `I ran a quick Google Maps check on ${leadName} and found you at #${leadPosition} while ${competitorName} holds #${competitorPosition} — a gap worth roughly $${monthlyLoss.toLocaleString()}/month in missed calls. I put together a short brief with the numbers (attached). If you'd like the full audit with the exact steps to close that gap, just reply and I'll send it over.`,
  };
}

export async function analyzeWithClaude(p: {
  lead: any; competitor: any; city: string; state: string; vertical: string;
  speed: any; speed_desktop: any; speed_comp: any; speed_comp_desktop: any;
  crawl: any; crawl_comp: any; traffic: number;
  revenue: ReturnType<typeof calculateRevenueLoss>;
  dailySearches: number; fullPack: any[];
  reviewInsights: GBPReviewInsights | null;
  gbpPostsPerWeek: number | null;
}) {
  const { lead, competitor, city, state, vertical, speed, speed_desktop, speed_comp, speed_comp_desktop, crawl, crawl_comp, traffic, revenue, dailySearches, fullPack, reviewInsights, gbpPostsPerWeek } = p;
  const gbpReviewResponseRate = reviewInsights?.replyRate ?? null;

  const speedScore = (s: any): number => s?.score ?? 50;
  const scoreLabel = (s: any): string => s?.score != null ? `${s.score}/100` : 'N/A';
  const lcpLabel = (s: any): string => s?.lcp ?? 'N/A';

  // CTR by map-pack position (approximate industry averages)
  const posCTR = (pos: number) =>
    pos <= 1 ? 0.38 : pos <= 2 ? 0.17 : pos <= 3 ? 0.11 : pos <= 5 ? 0.07 : pos <= 8 ? 0.05 : 0.03;
  const callsToComp = dailySearches > 0 ? Math.round(dailySearches * posCTR(competitor.position)) : null;
  const callsToLeadRaw = dailySearches > 0 ? Math.round(dailySearches * (lead.position <= 3 ? 0.10 : lead.position <= 6 ? 0.05 : 0.03)) : null;
  const callsToLead = callsToLeadRaw != null && callsToLeadRaw > 0 ? callsToLeadRaw : null;
  const bounceLoss = Math.round(revenue.monthly_loss * (speedScore(speed) < 60 ? 0.25 : 0.12));
  // Only use the calls-per-day format when both numbers are meaningful (lead gets at least 1).
  // "~0 calls/day" reads as broken and undersells the gap — the revenue figure makes it concrete.
  const mathStr = (callsToComp && callsToLead)
    ? `~${callsToComp} calls/day go to ${competitor.name} at #${competitor.position}. You capture ~${callsToLead} at #${lead.position}. That gap costs ~$${revenue.monthly_loss.toLocaleString()}/mo.`
    : `${competitor.name} at #${competitor.position} captures most "${vertical} ${city}" searches. Being at #${lead.position} sends the majority to a competitor — that's ~$${revenue.monthly_loss.toLocaleString()}/mo in missed revenue.`;

  // Three-state reply detection (requires ≥10 sample for "never responds" to fire):
  // clearlyNotRespondingToReviews — 0–14% reply rate across ≥10 reviews → "respond to all reviews"
  // hasUnansweredButGenerallyResponds — ≥50% reply rate but some unanswered → "reply to your X open reviews"
  // alreadyRespondingToReviews — responding well or insufficient data → pick a different fix
  const clearlyNotRespondingToReviews = reviewInsights != null
    && reviewInsights.replyDataAvailable === true
    && reviewInsights.totalChecked >= 10
    && reviewInsights.replyRate !== null
    && reviewInsights.replyRate < 0.15;
  const hasUnansweredButGenerallyResponds = !clearlyNotRespondingToReviews
    && reviewInsights != null
    && reviewInsights.hasUnansweredRecent
    && reviewInsights.replyRate !== null
    && reviewInsights.replyRate >= 0.5;
  const alreadyRespondingToReviews = !clearlyNotRespondingToReviews && !hasUnansweredButGenerallyResponds;
  const alreadyPostingWeekly = gbpPostsPerWeek != null && gbpPostsPerWeek >= 2;
  const phoneAboveFoldMobile = crawl.hasPhoneAboveFoldMobile ?? crawl.hasPhoneAboveFold;

  const systemPrompt = `You write audit reports for home-service contractors. Style: Alex Hormozi. Direct, specific, business consequence first. Zero SEO jargon. Every sentence is about customers and revenue.
ABSOLUTE RULES:
1. Use ONLY the real numbers in the brief. Never invent anything.
2. Every finding references a specific crawl boolean or API value.
3. Output ONLY valid JSON. No markdown, no commentary.
4. Every fixes array must have EXACTLY 3 items.
5. Review response rules — follow exactly: if clearlyNotRespondingToReviews=true → recommend "respond to every review". If hasUnansweredButGenerallyResponds=true → recommend replying to their specific unanswered reviews (use the unansweredCount). If alreadyRespondingToReviews=true (or data unknown) → pick a completely different GBP fix.
8. ONLY reference ${lead.name} and ${competitor.name} by name. Never name any other business from the full pack in fix descriptions or body text.
6. NEVER recommend adding GBP posts if alreadyPostingWeekly=true — pick a different GBP fix.
7. NEVER recommend adding click-to-call or phone visibility improvements if phoneAboveFoldMobile=true — pick a different page3 fix.
9. NEVER recommend adding/creating something the LEAD CRAWL booleans show already exists — if hasServiceAreaPages, hasBookingForm, hasEmergencyMessaging, hasFinancing, hasTrustBadges, hasReviewsOnHome, hasStickyCTA, or hasAboveFoldCTA is true, that thing is already on the site, so do not suggest adding it. Pick a fix for something the data shows is actually missing or weak instead.
10. NO DUPLICATE TOPICS: page5_issues must be about problems NOT already raised in page2_fixes or page3_fixes. If GBP posting frequency, financing visibility, review responses, etc. is already a fix on page 2 or 3, do not raise that same topic again on page 5 under different wording — pick a different gap instead.`;

  const prompt = `REAL DATA. USE ONLY THESE:
Lead: ${lead.name} | ${city}, ${state} | Vertical: ${vertical}
Niche: ${revenue.niche_matched} | CVR: ${revenue.cvr_typical}% | Avg ticket: $${revenue.avg_ticket}

MAP RANKINGS:
  Lead: #${lead.position} | Competitor: ${competitor.name} at #${competitor.position}
  Full pack:
${fullPack.map(x => `    #${x.position}: ${x.name} — ${x.rating}★ · ${x.review_count} reviews${x.isLead ? ' ← LEAD' : ''}`).join('\n')}

GBP: Lead: ${lead.review_count} reviews ${lead.rating}★ | Comp: ${competitor.review_count} reviews ${competitor.rating}★
SPEED (LEAD):    Mobile ${scoreLabel(speed)} LCP:${lcpLabel(speed)} | Desktop ${scoreLabel(speed_desktop)} LCP:${lcpLabel(speed_desktop)}
SPEED (COMP):    Mobile ${scoreLabel(speed_comp)} LCP:${lcpLabel(speed_comp)} | Desktop ${scoreLabel(speed_comp_desktop)} LCP:${lcpLabel(speed_comp_desktop)}
TRAFFIC: ~${traffic}/mo | DAILY SEARCHES: ${dailySearches > 0 ? `~${dailySearches}/day` : 'not available'}
REVENUE: Current $${revenue.current_revenue}/mo | Potential $${revenue.potential_revenue}/mo | Gap $${revenue.monthly_loss}/mo

PRE-COMPUTED MATH (use verbatim):
  page2_the_math: "${mathStr}"
  bounce_loss: $${bounceLoss}/mo
  page3_the_math: "~${Math.round(((speedScore(speed) < 60 ? 30 : 15) / 100) * (traffic || 200))} visitors/month leave ${lead.name}'s site before contacting anyone. At $${revenue.avg_ticket} avg job and ${revenue.cvr_typical}% CVR, that's ~$${bounceLoss}/month in missed revenue."

GBP ACTIVITY (verified — these override your fix choices):
  repliedCount:${reviewInsights?.repliedCount ?? 'unknown'}/${reviewInsights?.totalChecked ?? 'unknown'} sampled | unansweredCount:${reviewInsights?.unansweredCount ?? 0} | replyRate:${reviewInsights && reviewInsights.replyRate != null ? (reviewInsights.replyRate * 100).toFixed(0) + '%' : 'unknown (reply data unavailable)'} | clearlyNotRespondingToReviews:${clearlyNotRespondingToReviews} | hasUnansweredButGenerallyResponds:${hasUnansweredButGenerallyResponds} | alreadyRespondingToReviews:${alreadyRespondingToReviews}
  postsPerWeek:${gbpPostsPerWeek != null ? gbpPostsPerWeek.toFixed(1) : 'unknown'} | alreadyPostingWeekly:${alreadyPostingWeekly}
  avgRecentRating:${reviewInsights?.avgRecentRating ?? 'unknown'}
${reviewInsights?.snippets?.length ? `  RECENT REVIEWS (each marked [Owner replied] or [No reply] — use this to validate review fix eligibility):\n${reviewInsights.snippets.map(s => `    ${s}`).join('\n')}` : '  RECENT REVIEWS: not available — do NOT assume they ignore reviews'}

LEAD CRAWL (real booleans):
  stickyCTA:${crawl.hasStickyCTA} | aboveFoldCTA:${crawl.hasAboveFoldCTA} | phoneAboveFold:${crawl.hasPhoneAboveFold} | phoneAboveFoldMobile:${phoneAboveFoldMobile}
  reviewsOnHome:${crawl.hasReviewsOnHome} | trustBadges:${crawl.hasTrustBadges} | serviceAreaPages:${crawl.hasServiceAreaPages}
  bookingForm:${crawl.hasBookingForm} | emergencyMsg:${crawl.hasEmergencyMessaging} | financing:${crawl.hasFinancing}
  domainMismatch:${crawl.hasDomainMismatch} | title:"${crawl.title}"

COMPETITOR CRAWL (real booleans — use these for comp_value in page3_table_rows):
  crawled:${!!crawl_comp}
  stickyCTA:${crawl_comp?.hasStickyCTA ?? 'N/A'} | phoneAboveFold:${crawl_comp?.hasPhoneAboveFold ?? 'N/A'}
  reviewsOnHome:${crawl_comp?.hasReviewsOnHome ?? 'N/A'} | trustBadges:${crawl_comp?.hasTrustBadges ?? 'N/A'}

Output this JSON (all fix arrays must have EXACTLY 3 items):
{
  "paradox_headline": "Most striking paradox based on data. Options: 'Strong Reviews. Wrong Position. Bleeding Money.' / 'Better Rated. Still Losing.' / 'Invisible Where It Matters.' / 'Empty Profile. Empty Pipeline.' / 'Same Story. Different Outcome.'",
  "cover_by_the_numbers": {
    "position": "#${lead.position}", "position_sub": "your map pack position for '${vertical} ${city}'",
    "reviews": "${lead.review_count}", "reviews_sub": "your reviews vs ${competitor.review_count} for #${competitor.position}. They still outrank you.",
    "revenue_gap": "$${Math.round(revenue.loss_low_usd / 1000)}–$${Math.round(revenue.loss_high_usd / 1000)}k", "revenue_gap_sub": "monthly revenue gap, conservative estimate",
    "fixes": "4", "fixes_sub": "fixable gaps across your customer journey"
  },
  "page2_headline": "Names competitor + city. Specific to the position gap.",
  "page2_subhead": "One sentence. Dollar consequence of position gap. Use $${revenue.monthly_loss.toLocaleString()}/mo.",
  "page2_the_math": "${mathStr}",
  "page2_fixes": [
    {"num":"01","title":"Specific GBP fix tied to ranking gap","body":"Specific action with real context.","impact":"+X–Y% map visibility"},
    {"num":"02","title":"Second specific fix","body":"Different from fix 1.","impact":"+X–Y% result"},
    {"num":"03","title":"Third specific fix","body":"Different from 1 and 2.","impact":"+X–Y% result"}
  ],
  "page3_headline": "${speedScore(speed) < 60 ? 'Three Seconds. No Reason to Stay.' : !phoneAboveFoldMobile ? 'Phone Hidden. Customers Gone.' : 'First Impression Costing You Jobs.'}",
  "page3_subhead": "Dollar consequence of strongest first-impression issue. Use $${bounceLoss.toLocaleString()}/mo.",
  "page3_the_math": "~${Math.round(((speedScore(speed) < 60 ? 30 : 15) / 100) * (traffic || 200))} visitors/month leave ${lead.name}'s site before contacting anyone. At $${revenue.avg_ticket} avg job and ${revenue.cvr_typical}% CVR, that's ~$${bounceLoss}/month in missed revenue.",
  "page3_table_rows": [
    {"label":"Mobile Speed","lead_value":"${scoreLabel(speed)}","comp_value":"${scoreLabel(speed_comp)}","lead_wins":${speedScore(speed) > speedScore(speed_comp)},"comp_wins":${speedScore(speed_comp) >= 60}},
    {"label":"Desktop Speed","lead_value":"${scoreLabel(speed_desktop)}","comp_value":"${scoreLabel(speed_comp_desktop)}","lead_wins":${speedScore(speed_desktop) > speedScore(speed_comp_desktop)},"comp_wins":${speedScore(speed_comp_desktop) >= 60}},
    {"label":"LCP (Mobile)","lead_value":"${lcpLabel(speed)}","comp_value":"${lcpLabel(speed_comp)}","lead_wins":${(() => { const a=parseFloat(lcpLabel(speed)), b=parseFloat(lcpLabel(speed_comp)); return !isNaN(a)&&!isNaN(b)&&a<b; })()},"comp_wins":${(() => { const b=parseFloat(lcpLabel(speed_comp)); return !isNaN(b)&&b<=2.5; })()}},
    {"label":"Phone Above Fold (Mobile)","lead_value":"${phoneAboveFoldMobile ? '✓ Yes' : '✗ No'}","comp_value":"${crawl_comp ? (crawl_comp.hasPhoneAboveFold ? '✓ Yes' : '✗ No') : 'N/A'}","lead_wins":${phoneAboveFoldMobile},"comp_wins":${crawl_comp?.hasPhoneAboveFold ?? true}},
    {"label":"Sticky CTA","lead_value":"${crawl.hasStickyCTA ? '✓ Yes' : '✗ No'}","comp_value":"${crawl_comp ? (crawl_comp.hasStickyCTA ? '✓ Yes' : '✗ No') : 'N/A'}","lead_wins":${crawl.hasStickyCTA},"comp_wins":${crawl_comp?.hasStickyCTA ?? true}},
    {"label":"Reviews on Homepage","lead_value":"${crawl.hasReviewsOnHome ? '✓ Yes' : '✗ No'}","comp_value":"${crawl_comp ? (crawl_comp.hasReviewsOnHome ? '✓ Yes' : '✗ No') : 'N/A'}","lead_wins":${crawl.hasReviewsOnHome},"comp_wins":${crawl_comp?.hasReviewsOnHome ?? true}},
    {"label":"Trust Badges","lead_value":"${crawl.hasTrustBadges ? '✓ Yes' : '✗ No'}","comp_value":"${crawl_comp ? (crawl_comp.hasTrustBadges ? '✓ Yes' : '✗ No') : 'N/A'}","lead_wins":${crawl.hasTrustBadges},"comp_wins":${crawl_comp?.hasTrustBadges ?? true}}
  ],
  "page3_fixes": [
    {"num":"01","title":"Fix tied to worst table row","body":"Specific action referencing the crawl finding.","impact":"+X–Y% calls"},
    {"num":"02","title":"Second fix for another losing row","body":"Different action. Reference data.","impact":"+X–Y% result"},
    {"num":"03","title":"Third fix","body":"Different from 1 and 2.","impact":"+X–Y% result"}
  ],
  "page5_issues": [
    {"letter":"A","title":"Issue NOT on pages 2–4","body":"Specific crawl finding + dollar consequence.","impact":"$X–Y/mo at risk"},
    {"letter":"B","title":"Second issue NOT on pages 2–4","body":"Different finding.","impact":"$X–Y/mo at risk"}
  ],
  "cold_email_hook": "2 sentences. Names ${lead.name}, position #${lead.position}, ${competitor.name} at #${competitor.position}, one specific number. No SEO jargon."
}

page5_issues candidates (only issues not already used on pages 2–4) — use whichever of these are true:
noServiceArea:${!crawl.hasServiceAreaPages} | noBookingForm:${!crawl.hasBookingForm} | noEmergency:${!crawl.hasEmergencyMessaging} | noFinancing:${!crawl.hasFinancing} | domainMismatch:${crawl.hasDomainMismatch}
If fewer than 2 of those are true, the site already covers the content basics — fill the remaining slot(s) with GBP profile gaps instead, which always apply and must not restate any page2/page3 fix: low GBP photo count (recommend 30+ recent geo-tagged job photos), and adding GBP Q&A seeded with the 5 most common buyer questions. Do not propose GBP posting frequency here — that topic belongs on page 2 only.`;

  // Attach screenshots for visual verification — Claude overrides any DOM boolean
  // that contradicts what's actually visible on screen (e.g. phone in banner text).
  const screenshotParts: any[] = [];
  if (crawl.screenshotMobile) {
    screenshotParts.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: crawl.screenshotMobile } });
  }
  if (crawl.screenshotDesktop) {
    screenshotParts.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: crawl.screenshotDesktop } });
  }
  const screenshotNote = screenshotParts.length > 0
    ? `\nSCREENSHOT VERIFICATION (${screenshotParts.length === 2 ? 'image 1 = mobile 390px, image 2 = desktop 1280px' : 'screenshot attached'}): Visually inspect the screenshots BEFORE reading the crawl booleans below. If you can see a phone number in the header/banner, override phoneAboveFoldMobile=true regardless of the DOM value. If a CTA/button is clearly visible above fold, override those booleans too. Screenshots are ground truth for visible UI — DOM checks miss CSS-injected content and images. GBP activity data (reply rate, posts/week) comes from live API — trust those as-is.\n`
    : '';

  try {
    const userContent: any = screenshotParts.length > 0
      ? [...screenshotParts, { type: 'text', text: screenshotNote + prompt }]
      : prompt;
    const r = await anthropic.messages.create({
      model: "claude-sonnet-4-5", max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
    const raw = (r.content[0] as any).text.trim();
    try { return JSON.parse(raw); } catch {}
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error("No JSON found in Claude response");
    return JSON.parse(raw.substring(s, e + 1));
  } catch (err: any) {
    console.warn("[Claude] Falling back to deterministic generator:", err.message);
    return buildFallback({ lead, competitor, city, vertical, speed, speed_desktop, speed_comp, speed_comp_desktop, crawl, crawl_comp, revenue, mathStr, bounceLoss, traffic, alreadyRespondingToReviews, hasUnansweredButGenerallyResponds, unansweredCount: reviewInsights?.unansweredCount ?? 0, alreadyPostingWeekly, phoneAboveFoldMobile });
  }
}

export function buildFallback(p: any) {
  const { lead, competitor, city, vertical, speed, speed_desktop, speed_comp, speed_comp_desktop, crawl, crawl_comp, revenue, mathStr, bounceLoss, traffic, alreadyRespondingToReviews, hasUnansweredButGenerallyResponds, unansweredCount, alreadyPostingWeekly, phoneAboveFoldMobile } = p;
  const sc = (s: any): number => s?.score ?? 50;
  const sl = (s: any): string => s?.score != null ? `${s.score}/100` : 'N/A';
  const ll = (s: any): string => s?.lcp ?? 'N/A';
  const compVal = (flag: boolean | undefined | null) =>
    flag == null ? 'N/A' : flag ? '✓ Yes' : '✗ No';
  const paradox = lead.review_count > competitor.review_count && lead.position > competitor.position
    ? "Strong Reviews. Wrong Position. Bleeding Money."
    : lead.rating > competitor.rating && lead.position > competitor.position ? "Better Rated. Still Losing."
      : lead.position > 10 ? "Invisible Where It Matters."
        : lead.review_count === 0 ? "Empty Profile. Empty Pipeline."
          : "Same Story. Different Outcome.";

  const p3Headline = sc(speed) < 60 ? "Three Seconds. No Reason to Stay."
    : !phoneAboveFoldMobile ? "Phone Hidden. Customers Gone."
      : !crawl.hasStickyCTA ? "No Sticky CTA. No Callbacks."
        : "First Impression Costing You Jobs.";

  const p5: any[] = [];
  if (!crawl.hasServiceAreaPages) p5.push({ letter: "A", title: "No Service Area Pages: Google Cannot Find You Locally", body: `Without dedicated pages for each neighborhood you serve, Google cannot rank you for local searches. ${competitor.name} likely has a page for every city they cover. You have one.`, impact: `$${Math.round(revenue.monthly_loss * 0.2).toLocaleString()}–$${Math.round(revenue.monthly_loss * 0.35).toLocaleString()}/mo at risk` });
  if (!crawl.hasBookingForm) p5.push({ letter: p5.length === 0 ? "A" : "B", title: "No Online Quote Form: Losing After-Hours Leads", body: `Homeowners search at 10pm on Sunday. Without a quote form, anyone visiting outside business hours has no way to reach you. They call whoever made it easy.`, impact: `$${Math.round(revenue.monthly_loss * 0.15).toLocaleString()}–$${Math.round(revenue.monthly_loss * 0.25).toLocaleString()}/mo at risk` });
  if (!crawl.hasEmergencyMessaging && p5.length < 2) p5.push({ letter: p5.length === 0 ? "A" : "B", title: "No Emergency / 24-7 Messaging: Losing Urgent Calls", body: `In ${vertical}, emergency calls are the highest-value jobs. If your site does not say 24/7 emergency prominently, the homeowner with a burst pipe at midnight calls the one that does.`, impact: `$${Math.round(revenue.monthly_loss * 0.2).toLocaleString()}–$${Math.round(revenue.monthly_loss * 0.3).toLocaleString()}/mo at risk` });
  if (!crawl.hasFinancing && p5.length < 2) p5.push({ letter: p5.length === 0 ? "A" : "B", title: "No Financing Options: Losing High-Ticket Jobs", body: `For jobs over $2,000, financing closes deals that price-shoppers walk from. Competitors who offer pay-over-time win the job before you even get a callback.`, impact: `$${Math.round(revenue.monthly_loss * 0.1).toLocaleString()}–$${Math.round(revenue.monthly_loss * 0.2).toLocaleString()}/mo at risk` });
  if (p5.length === 0) {
    p5.push({ letter: "A", title: "GBP Photos Below Standard", body: `Google rewards profiles with 30 or more recent photos. If ${competitor.name} posts more than you, they earn ranking signals you are handing them for free.`, impact: `$${Math.round(revenue.monthly_loss * 0.1).toLocaleString()}/mo at risk` });
    p5.push({ letter: "B", title: "Add GBP Q&A to Capture Buyer Questions", body: `Seed your GBP Q&A with the 5 most common questions homeowners ask before booking. These surface in search results and filter out tire-kickers before they ever reach ${competitor.name}.`, impact: `$${Math.round(revenue.monthly_loss * 0.1).toLocaleString()}/mo at risk` });
  }

  const page3Fixes = (() => {
    const out: any[] = [];
    const used = new Set<string>();
    const add = (title: string, body: string, impact: string) => {
      if (!used.has(title) && out.length < 3) { used.add(title); out.push({ num: String(out.length + 1).padStart(2, "0"), title, body, impact }); }
    };
    if (sc(speed) < 70) add("Cut Load Time Below 2 Seconds", `Your mobile score is ${sl(speed)}. Compress images, enable caching, remove render-blocking scripts. Get above 70 and bounce drops immediately.`, "+15–30% bounce reduction");
    else if (!phoneAboveFoldMobile) add("Move Phone Number Above the Fold", "Your phone number is buried. Add it to the top of every page. Every second a visitor spends looking for how to call, they are dialing someone else.", "+10–20% contact rate");
    if (!crawl.hasStickyCTA && !phoneAboveFoldMobile) add("Add Sticky Click-to-Call Bar", "A persistent call bar at the top of every mobile page captures intent the moment it strikes. Highest-converting single change for home service sites.", "+15–25% mobile conversions");
    if (!crawl.hasTrustBadges) add("Add Trust Badges to Hero Section", "Licensed, insured, BBB-accredited. Put these in the first screen. Homeowners hiring a contractor make a safety decision. Give them the signal before they scroll.", "+8–15% conversion lift");
    if (!crawl.hasReviewsOnHome) add("Show Reviews in the Hero Section", "Embed your Google reviews above the fold. Visitors who see social proof in the first 3 seconds are far more likely to call.", "+10–20% trust conversion");
    // Guaranteed fillers — only suggest what the business doesn't already have
    add("Cut Load Time Below 2 Seconds", `Your mobile score is ${sl(speed)}. Compress images, enable caching, remove render-blocking scripts. Get above 70 and bounce drops immediately.`, "+15–30% bounce reduction");
    if (!crawl.hasStickyCTA) add("Add Sticky Click-to-Call Bar", "A persistent call bar captures call intent the moment it strikes. This is the highest-converting single change for home service sites.", "+15–25% mobile conversions");
    if (!crawl.hasTrustBadges) add("Add Trust Badges to Hero Section", "Licensed, insured, BBB-accredited. Put these in the first screen before the visitor has a chance to doubt.", "+8–15% conversion lift");
    if (!crawl.hasReviewsOnHome) add("Show Reviews in the Hero Section", "Embed your Google reviews above the fold. Visitors who see social proof in the first 3 seconds are far more likely to call.", "+10–20% trust conversion");
    if (!crawl.hasBookingForm) add("Add an Online Quote Request Form", "Let visitors request a quote at 2am. A simple above-fold form routes leads directly to your inbox. Home service leads respond 90% better within 5 minutes.", "+12–20% lead capture");
    add("Compress and Lazy-Load All Images", "Large images are the #1 cause of slow mobile loads. Run every image through TinyPNG and add loading='lazy'. Takes 2 hours and cuts load time 30–40%.", "+10–20% speed improvement");
    return out;
  })();

  return {
    paradox_headline: paradox,
    cover_by_the_numbers: {
      position: `#${lead.position}`, position_sub: `map pack · ${vertical} ${city}`,
      reviews: `${lead.review_count}`, reviews_sub: `your reviews vs ${competitor.review_count} for #${competitor.position}`,
      revenue_gap: `$${Math.round(revenue.loss_low_usd / 1000)}–$${Math.round(revenue.loss_high_usd / 1000)}k`,
      revenue_gap_sub: "monthly revenue gap, conservative", fixes: "4", fixes_sub: "fixable gaps found",
    },
    page2_headline: `Outranked by ${competitor.name} in ${city}`,
    page2_subhead: `Being at #${lead.position} while ${competitor.name} holds #${competitor.position} costs you ~$${revenue.monthly_loss.toLocaleString()}/month in high-intent calls.`,
    page2_the_math: mathStr,
    page2_fixes: (() => {
      const fixes: any[] = [];
      if (!alreadyPostingWeekly) {
        fixes.push({ num: "01", title: "Complete Your Google Business Profile", body: `Add 30+ recent photos, fill every service category, post weekly. GBP completeness is a direct ranking factor. This alone can move you 1 to 2 positions.`, impact: "+15–30% map visibility" });
      } else {
        fixes.push({ num: "01", title: "Add More GBP Photos with Job Sites", body: `Post before/after photos from actual ${city} jobs. Google rewards profiles with 30+ recent, geo-tagged photos. Each new photo batch drives a small ranking boost.`, impact: "+10–20% map visibility" });
      }
      fixes.push({ num: "02", title: "Build Neighborhood-Level Service Pages", body: `Create dedicated pages for every city and neighborhood you serve. Right now you compete on one generic page. ${competitor.name} likely targets multiple local areas.`, impact: "+10–25% local search coverage" });
      if (!alreadyRespondingToReviews) {
        fixes.push({ num: "03", title: "Reply to Every Unanswered Google Review", body: `You're not responding to reviews. Google treats owner replies as an engagement signal — profiles that respond rank higher. Block an hour and reply to every open review.`, impact: "+10–20% GBP visibility" });
      } else if (hasUnansweredButGenerallyResponds) {
        const n = unansweredCount || 'some';
        fixes.push({ num: "03", title: `Reply to Your ${n} Unanswered Review${unansweredCount !== 1 ? 's' : ''}`, body: `You respond to most reviews — a strong habit. But ${n} review${unansweredCount !== 1 ? 's are' : ' is'} still waiting. Homeowners read recent reviews first. A quick reply closes the gap and shows you're active.`, impact: "+3–8% trust signal" });
      } else {
        fixes.push({ num: "03", title: "Add Q&A to Your GBP Profile", body: `Seed your GBP Q&A section with 5 buyer-intent questions and answer them. These appear directly in search results and push competitors lower on the listing.`, impact: "+5–10% click rate" });
      }
      return fixes;
    })(),
    page3_headline: p3Headline,
    page3_subhead: `Your site is losing ~$${bounceLoss.toLocaleString()}/month in visitors who leave before contacting anyone.`,
    page3_the_math: `~${Math.round(((sc(speed) < 60 ? 30 : 15) / 100) * (traffic || 200))} visitors/month leave ${lead.name}'s site before taking action. At $${revenue.avg_ticket} avg job, that's ~$${bounceLoss.toLocaleString()}/month walking out the door.`,
    page3_table_rows: [
      { label: "Mobile Speed", lead_value: sl(speed), comp_value: sl(speed_comp), lead_wins: sc(speed) > sc(speed_comp), comp_wins: sc(speed_comp) >= 60 },
      { label: "Desktop Speed", lead_value: sl(speed_desktop), comp_value: sl(speed_comp_desktop), lead_wins: sc(speed_desktop) > sc(speed_comp_desktop), comp_wins: sc(speed_comp_desktop) >= 60 },
      { label: "LCP (Mobile)", lead_value: ll(speed), comp_value: ll(speed_comp), lead_wins: (() => { const a = parseFloat(ll(speed)), b = parseFloat(ll(speed_comp)); return !isNaN(a) && !isNaN(b) && a < b; })(), comp_wins: (() => { const b = parseFloat(ll(speed_comp)); return !isNaN(b) && b <= 2.5; })() },
      { label: "Phone Above Fold (Mobile)", lead_value: phoneAboveFoldMobile ? "✓ Yes" : "✗ No", comp_value: compVal(crawl_comp?.hasPhoneAboveFold), lead_wins: phoneAboveFoldMobile, comp_wins: crawl_comp?.hasPhoneAboveFold ?? true },
      { label: "Sticky CTA", lead_value: crawl.hasStickyCTA ? "✓ Yes" : "✗ No", comp_value: compVal(crawl_comp?.hasStickyCTA), lead_wins: crawl.hasStickyCTA, comp_wins: crawl_comp?.hasStickyCTA ?? true },
      { label: "Reviews on Homepage", lead_value: crawl.hasReviewsOnHome ? "✓ Yes" : "✗ No", comp_value: compVal(crawl_comp?.hasReviewsOnHome), lead_wins: crawl.hasReviewsOnHome, comp_wins: crawl_comp?.hasReviewsOnHome ?? true },
      { label: "Trust Badges", lead_value: crawl.hasTrustBadges ? "✓ Yes" : "✗ No", comp_value: compVal(crawl_comp?.hasTrustBadges), lead_wins: crawl.hasTrustBadges, comp_wins: crawl_comp?.hasTrustBadges ?? true },
    ],
    page3_fixes: page3Fixes,
    page5_issues: p5.slice(0, 2),
    cold_email_hook: `I ran an audit on ${lead.name}. Your site scores ${sl(speed)} on mobile speed while ${competitor.name} at #${competitor.position} is capturing most of the "${vertical} ${city}" searches. Based on your ${lead.review_count} reviews and industry benchmarks, this gap costs roughly $${revenue.monthly_loss.toLocaleString()}/month.`,
  };
}
