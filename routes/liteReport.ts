import { Router, Request, Response } from 'express';
import { asyncHandler, normalizeUrl } from '../lib/http';
import { getLeadGBP, getGBPReviewInsights, getGBPPostsPerWeek } from '../services/gbp';
import { getMonthlyTraffic } from '../services/traffic';
import { getWeightedPosition } from '../services/mappack';
import { getBuyerIntentKeywords, findBenchmark, calculateRevenueLoss } from '../benchmarks';
import { generateColdEmail } from '../analysis/claude';
import db from '../db';

const router = Router();

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { url: rawUrl, city, state, vertical } = req.body;
  if (!rawUrl || !city || !state) return res.status(400).json({ error: "url, city, state required" });
  const url = normalizeUrl(rawUrl);

  const domain = new URL(url).hostname.replace('www.', '');
  const bizName = domain.split('.')[0].replace(/-/g, ' ');
  const niche = vertical || "Home Services";

  const [gbp, traffic] = await Promise.all([
    getLeadGBP(bizName, city, state, domain),
    getMonthlyTraffic(domain),
  ]);
  const matchName = gbp.real_name && gbp.real_name.length > 2 ? gbp.real_name : bizName;
  const searchCity  = (gbp as any).gbp_city  && (gbp as any).gbp_city.length  > 1 ? (gbp as any).gbp_city  : city;
  const searchState = (gbp as any).gbp_state && (gbp as any).gbp_state.length > 1 ? (gbp as any).gbp_state : state;
  if (searchCity.toLowerCase() !== city.toLowerCase())
    console.log(`[LiteReport] Using GBP location "${searchCity}, ${searchState}" instead of submitted "${city}, ${state}"`);

  const weighted = await getWeightedPosition(
    niche, searchCity, searchState, matchName, gbp.review_count, gbp.place_id, gbp.rating
  );

  if (!weighted) return res.status(502).json({
    error: "Could not get map pack data from DataForSEO. Possible causes: zero API balance (check app.dataforseo.com), no results for this location, or all competitors filtered out. No fake positions used.",
    keywords_tried: getBuyerIntentKeywords(niche),
    search_location: `${searchCity}, ${searchState}`,
  });

  const { primaryMapData, weightedPosition, rankingKeywords } = weighted;
  const { key: niche_matched } = findBenchmark(niche);
  const revenue = calculateRevenueLoss(traffic || 200, niche);
  const realName = gbp.real_name && gbp.real_name.length > 2 ? gbp.real_name : bizName;

  // Fetch review insights and GBP posts in parallel — both feed the cold email and analysis
  const [reviewInsights, gbpPostsPerWeek] = await Promise.all([
    getGBPReviewInsights(gbp.place_id, matchName, searchCity, searchState).catch(() => null),
    getGBPPostsPerWeek(realName, searchCity, searchState, gbp.place_id).catch(() => null),
  ]);

  const lead = {
    name: realName,
    rating: gbp.rating,
    review_count: gbp.review_count,
    place_id: gbp.place_id,
    gbp_url: gbp.place_id ? `https://www.google.com/maps/place/?q=place_id:${gbp.place_id}` : null,
    position: weightedPosition,
    position_by_keyword: rankingKeywords,
  };

  // Generate the actual cold pitch email using all real audit data
  const coldEmail = await generateColdEmail({
    leadName: realName,
    city: searchCity,
    state: searchState,
    vertical: niche,
    leadPosition: weightedPosition,
    leadReviews: gbp.review_count,
    leadRating: gbp.rating,
    competitorName: primaryMapData.competitor.name,
    competitorPosition: primaryMapData.competitor.position,
    competitorReviews: primaryMapData.competitor.review_count,
    monthlyLoss: revenue.monthly_loss,
    reviewInsights,
    gbpPostsPerWeek,
  }).catch(() => ({
    subject: `${realName} — local ranking gap found`,
    body: `I ran a local map pack audit on ${realName} and found you sitting at #${weightedPosition} while ${primaryMapData.competitor.name} holds #${primaryMapData.competitor.position}. That gap costs roughly $${revenue.monthly_loss.toLocaleString()}/month based on search volume and your average job ticket. Three specific fixes could close most of it within 60 days. Worth a 15-minute call?`,
  }));

  const liteReport = {
    domain, city, state, vertical: niche, niche_matched,
    search_location: `${searchCity}, ${searchState}`,
    lead,
    competitor: primaryMapData.competitor,
    fullPack: primaryMapData.fullPack,
    traffic_monthly: traffic,
    revenue,
    review_insights: reviewInsights
      ? { ...reviewInsights, snippets: reviewInsights.snippets.slice(0, 3) }
      : null,
    position_data_source: primaryMapData.dataSource,
    ranking_method: "weighted_average",
    ranking_keywords: rankingKeywords,
    gap_summary: `${realName} at avg #${weightedPosition} vs ${primaryMapData.competitor.name} at #${primaryMapData.competitor.position} in ${searchCity} across ${rankingKeywords.length} buyer-intent keywords.`,
    cold_email: coldEmail,
  };

  db.prepare(`INSERT OR REPLACE INTO leads
    (lead_id,business_name,domain,city,state,vertical,niche_matched,primary_keyword,
    lead_gbp_rating,lead_review_count,lead_map_position,lead_gbp_place_id,
    competitor_name,competitor_domain,competitor_gbp_id,competitor_rating,competitor_review_count,competitor_position,
    traffic_monthly,lite_report_data,lite_report_generated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`)
    .run(domain, realName, domain, city, state, niche, niche_matched, rankingKeywords.map(k => k.keyword).join(', '),
      gbp.rating, gbp.review_count, weightedPosition, gbp.place_id,
      primaryMapData.competitor.name, primaryMapData.competitor.domain, primaryMapData.competitor.place_id,
      primaryMapData.competitor.rating, primaryMapData.competitor.review_count, primaryMapData.competitor.position,
      traffic, JSON.stringify(liteReport));

  res.json(liteReport);
}));

export default router;
