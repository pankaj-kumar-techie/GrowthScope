export interface TrustAngle {
  angle: string;
  headline: string;
  subhead: string;
  leftLabel: string;
  leftCount: number | string;
  leftSub: string;
  rightLabel: string;
  rightCount: number | string;
  rightSub: string;
}

export function computeTrustAngle(lead: any, comp: any, crawl: any): TrustAngle {
  const leadMore = lead.review_count > comp.review_count;
  const leadBetter = lead.rating > comp.rating;
  const noOnSite = !crawl.hasReviewsOnHome;
  const ratio = comp.review_count > 0
    ? (lead.review_count / comp.review_count).toFixed(1) : "∞";

  if (leadMore && noOnSite) return {
    angle: "reviews_paradox",
    headline: `${lead.review_count} Reviews.\nZero on Your Site.`,
    subhead: `Every 5-star review you earned is invisible to the homeowner deciding right now. Your competitor has ${comp.review_count} reviews and shows them on their site. You have ${lead.review_count} and hide every single one.`,
    leftLabel: "YOUR GOOGLE REVIEWS", leftCount: lead.review_count, leftSub: `★ ${lead.rating} · 0 shown on site`,
    rightLabel: "COMPETITOR ON-SITE", rightCount: comp.review_count, rightSub: `★ ${comp.rating} · Displayed prominently`,
  };
  if (leadMore) return {
    angle: "review_count_gap",
    headline: `${ratio}× More Reviews.\nStill Getting Passed Over.`,
    subhead: `You have more reviews than ${comp.name}. They still outrank you. Reviews alone do not win jobs. How you show them does.`,
    leftLabel: "YOUR SOCIAL PROOF", leftCount: lead.review_count, leftSub: `★ ${lead.rating} Google Rating`,
    rightLabel: "COMPETITOR", rightCount: comp.review_count, rightSub: `★ ${comp.rating} · Better positioned`,
  };
  if (leadBetter) return {
    angle: "rating_gap",
    headline: `Better Rating.\nLess Business.`,
    subhead: `Your ${lead.rating}★ beats ${comp.name}'s ${comp.rating}★. But they have ${comp.review_count} reviews to your ${lead.review_count}. Volume beats perfection when homeowners decide fast.`,
    leftLabel: "YOUR RATING", leftCount: `${lead.rating}★`, leftSub: `${lead.review_count} reviews`,
    rightLabel: "COMPETITOR", rightCount: `${comp.rating}★`, rightSub: `${comp.review_count} reviews · Higher volume`,
  };
  return {
    angle: "review_count_gap",
    headline: `${comp.review_count} Reviews vs Your ${lead.review_count}.\nTrust Wins the Job.`,
    subhead: `When a homeowner sees ${comp.name} with ${comp.review_count} reviews next to your ${lead.review_count}, they pick the one that looks safer. Every time.`,
    leftLabel: "YOUR SOCIAL PROOF", leftCount: lead.review_count, leftSub: `★ ${lead.rating} Google Rating`,
    rightLabel: comp.name.toUpperCase(), rightCount: comp.review_count, rightSub: `★ ${comp.rating} Google Rating`,
  };
}
