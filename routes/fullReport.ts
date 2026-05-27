import { Router, Request, Response } from 'express';
import { asyncHandler, normalizeUrl } from '../lib/http';
import { getPageSpeed } from '../services/pagespeed';
import { getDailySearches } from '../services/traffic';
import { crawlSite } from '../services/crawl';
import { getGBPReviewInsights, getGBPPostsPerWeek } from '../services/gbp';
import { classifyNiche, analyzeWithClaude } from '../analysis/claude';
import { computeTrustAngle } from '../analysis/trust';
import { calculateRevenueLoss } from '../benchmarks';
import { generateReportHTML } from '../report/html';
import { renderPDF } from '../report/pdf';
import db from '../db';

const router = Router();

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { url: rawUrl } = req.body;
  if (!rawUrl) return res.status(400).json({ error: "url required" });
  const url = normalizeUrl(rawUrl);

  const domain = new URL(url).hostname.replace('www.', '');
  const saved: any = db.prepare('SELECT * FROM leads WHERE domain=?').get(domain);
  if (!saved) return res.status(400).json({ error: "No Lite Report found. Call POST /lite-report first." });

  console.log(`[Full Report] Competitor locked: ${saved.competitor_name}`);
  const liteData = JSON.parse(saved.lite_report_data);
  const lead = { name: saved.business_name, rating: saved.lead_gbp_rating, review_count: saved.lead_review_count, position: saved.lead_map_position, domain };
  const competitor = { name: saved.competitor_name, rating: saved.competitor_rating, review_count: saved.competitor_review_count, position: saved.competitor_position, domain: saved.competitor_domain, place_id: saved.competitor_gbp_id };
  const traffic = saved.traffic_monthly || 200;
  const city = saved.city, state = saved.state, vertical = saved.vertical;
  const fullPack: any[] = liteData.fullPack || [];
  const compUrl = competitor.domain ? `https://${competitor.domain}` : null;
  const leadPlaceId: string = saved.lead_gbp_place_id || '';

  // PageSpeed — all four calls run in parallel
  const [speedLead, speedLeadDesktop, speedComp, speedCompDesktop, dailySearches, reviewInsights, gbpPostsPerWeek] = await Promise.all([
    getPageSpeed(url, 'mobile'),
    getPageSpeed(url, 'desktop'),
    compUrl ? getPageSpeed(compUrl, 'mobile').catch(() => null) : Promise.resolve(null),
    compUrl ? getPageSpeed(compUrl, 'desktop').catch(() => null) : Promise.resolve(null),
    getDailySearches(vertical, city),
    getGBPReviewInsights(leadPlaceId, lead.name, city, state).catch(() => null),
    getGBPPostsPerWeek(lead.name, city, state, leadPlaceId).catch(() => null),
  ]);
  console.log(`[Full Report] Lead   mobile:${speedLead.score} desktop:${speedLeadDesktop.score}`);
  console.log(`[Full Report] Comp   mobile:${speedComp?.score ?? 'N/A'} desktop:${speedCompDesktop?.score ?? 'N/A'}`);

  // Crawls — sequential to avoid OOM
  console.log(`[Full Report] Crawling lead: ${url}`);
  const crawl = await crawlSite(url);

  let crawlComp: any = null;
  if (compUrl) {
    console.log(`[Full Report] Crawling competitor: ${compUrl}`);
    crawlComp = await crawlSite(compUrl).catch((e: any) => {
      console.warn(`[Full Report] Competitor crawl failed: ${e.message}`);
      return null;
    });
  }

  const nicheResolved = await classifyNiche(crawl.pageText, crawl.title, vertical);
  const revenue = calculateRevenueLoss(traffic, nicheResolved);
  const trust = computeTrustAngle(lead, competitor, crawl);

  const analysis = await analyzeWithClaude({
    lead, competitor, city, state, vertical: nicheResolved,
    speed: speedLead, speed_desktop: speedLeadDesktop,
    speed_comp: speedComp, speed_comp_desktop: speedCompDesktop,
    crawl, crawl_comp: crawlComp, traffic, revenue,
    dailySearches, fullPack,
    reviewInsights, gbpPostsPerWeek,
  });

  const html = generateReportHTML({
    lead, competitor, city, state, vertical: nicheResolved,
    speed: speedLead, crawl, revenue, analysis, trust, fullPack,
    screenshotDesktop: crawl.screenshotDesktop,
    screenshotMobile: crawl.screenshotMobile,
    gbpReviewResponseRate: reviewInsights?.replyRate ?? null,
    reviewInsights: reviewInsights ? { repliedCount: reviewInsights.repliedCount, unansweredCount: reviewInsights.unansweredCount, totalChecked: reviewInsights.totalChecked, replyRate: reviewInsights.replyRate, replyDataAvailable: reviewInsights.replyDataAvailable, snippets: reviewInsights.snippets } : null,
  });

  const pdf = await renderPDF(html);
  db.prepare(`UPDATE leads SET full_report_generated_at=datetime('now') WHERE domain=?`).run(domain);
  res.contentType('application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ARMA_Audit_${domain}.pdf"`);
  res.send(pdf);
}));

export default router;
