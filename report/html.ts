import { calculateRevenueLoss } from '../benchmarks';
import { TrustAngle } from '../analysis/trust';

function pickParadoxHeadline(lead: any, comp: any): string {
  if (lead.review_count > comp.review_count && lead.position > comp.position)
    return "Strong Reviews. Wrong Position. Bleeding Money.";
  if (lead.rating > comp.rating && lead.position > comp.position)
    return "Better Rated. Still Losing.";
  if (lead.position > 10) return "Invisible Where It Matters.";
  if (lead.review_count < comp.review_count * 0.5 && lead.position > comp.position)
    return "Outgunned. Outranked. Losing Jobs.";
  if (lead.position >= 4 && lead.position <= 10 && lead.review_count < comp.review_count)
    return "Buried on Page One. Bleeding Revenue.";
  if (lead.review_count === 0 && comp.review_count > 10) return "Empty Profile. Empty Pipeline.";
  if (lead.position <= 5) return "One Spot Away. Thousands at Stake.";
  return "Invisible Where It Matters.";
}

function formatHeadline(headline: string): string {
  const clean = headline.replace(/\.$/, '');
  const parts = clean.split('. ').filter(Boolean);
  if (parts.length > 1) {
    const last = parts.pop()!;
    const rest = parts.join('. ') + '.';
    return `${rest}<br><span class="yl">${last}</span>`;
  }
  const words = clean.split(' ');
  if (words.length <= 2) return `<span class="yl">${clean}</span>`;
  const splitAt = words.length <= 4 ? words.length - 2 : words.length - 3;
  return `${words.slice(0, splitAt).join(' ')}<br><span class="yl">${words.slice(splitAt).join(' ')}</span>`;
}

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function generateReportHTML(params: {
  lead: any; competitor: any; city: string; state: string; vertical: string;
  speed: any; crawl: any; revenue: ReturnType<typeof calculateRevenueLoss>;
  analysis: any; trust: TrustAngle;
  fullPack: any[]; screenshotDesktop: string; screenshotMobile: string;
  gbpReviewResponseRate?: number | null;
  gbpPostsPerWeek?: number | null;
  reviewInsights?: { repliedCount: number; unansweredCount: number; totalChecked: number; replyRate: number | null; replyDataAvailable?: boolean; snippets?: string[] } | null;
}) {
  const { lead, competitor, city, state, vertical, speed, crawl, revenue, analysis, trust, fullPack } = params;
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
  const headline = analysis.paradox_headline || pickParadoxHeadline(lead, competitor);
  const compName    = esc(competitor.name);
  const clientName  = esc((lead.name || "Client").toUpperCase());
  const leadNameEsc = esc(lead.name || "Client");
  const cityEsc     = esc(city);
  const stateEsc    = esc(state);
  const verticalEsc = esc(vertical);
  const desktopImg = params.screenshotDesktop ? `data:image/jpeg;base64,${params.screenshotDesktop}` : '';
  const mobileImg = params.screenshotMobile ? `data:image/jpeg;base64,${params.screenshotMobile}` : '';
  const hlParts = headline.split('. ').filter(Boolean);
  const hl1 = hlParts.slice(0, 2).join('. ') + (hlParts.length > 2 ? '.' : '');
  const hl2 = hlParts.length > 2 ? hlParts.slice(2).join('. ') : '';
  const byNums = analysis.cover_by_the_numbers || {};
  const p2Fixes: any[] = (analysis.page2_fixes || []).slice(0, 3);
  const p3Rows: any[] = analysis.page3_table_rows || [];
  const p3Fixes: any[] = (analysis.page3_fixes || []).slice(0, 3);
  const p4Fixes = [
    { num: "01", title: trust.angle === "reviews_paradox" ? "Embed Live Google Reviews on Homepage" : "Launch a 30-Day Review Drive", body: trust.angle === "reviews_paradox" ? `Use EmbedSocial or Elfsight to pull your ${lead.review_count} Google reviews onto your homepage. Install takes 1 hour. Visitors see proof before they scroll.` : `Text every customer from the last 60 days. Ask for a Google review. 30 days of asking gets 20–40 new reviews. Each one closes the gap with ${compName}.`, metric: trust.angle === "reviews_paradox" ? "reviews_on_home" : "review_gap" },
    { num: "02", title: `Put Your ${lead.rating}★ Rating in the Header`, body: `Put your rating right next to your phone number at the top of every page. Visitors see authority before they read anything. Free. Takes 20 minutes.`, metric: "rating" },
    (() => {
      const ri = params.reviewInsights;
      const clearlyNotResponding = ri != null && ri.replyDataAvailable !== false && ri.totalChecked >= 10 && ri.replyRate !== null && ri.replyRate < 0.15;
      const hasUnansweredButGenerally = !clearlyNotResponding && ri != null && ri.unansweredCount > 0 && ri.replyRate !== null && ri.replyRate >= 0.5;
      if (clearlyNotResponding) {
        return { num: "03", title: "Respond to Every Google Review", body: `Unanswered reviews signal neglect to Google and homeowners reading your profile. Block one hour, respond to every open review. Google rewards active profiles with higher map pack visibility.`, metric: "reply_rate" };
      }
      if (hasUnansweredButGenerally) {
        const n = ri!.unansweredCount;
        return { num: "03", title: `Reply to Your ${n} Unanswered Review${n !== 1 ? 's' : ''}`, body: `You respond to most reviews — a strong signal to Google. But ${n} review${n !== 1 ? 's are' : ' is'} still waiting. Homeowners read the newest reviews first. A quick reply on each one keeps your profile looking active and attentive.`, metric: "reply_rate" };
      }
      return { num: "03", title: "Add 20+ Recent Photos to Your Google Business Profile", body: `Google rewards profiles with recent, geo-tagged job photos. Post before/after shots from real jobs in ${cityEsc}. Profiles with 20+ photos average higher map pack placement and more profile views than those with fewer than 10.`, metric: "gbp_posts" };
    })(),
  ];
  const p5Issues: any[] = analysis.page5_issues || [];

  // Every fix/issue carries a `metric` naming a REAL measured data point (not an invented
  // uplift %). renderImpact turns it into a factual "current state" badge straight from the
  // live API/crawl values already in scope. Unknown/blank metric → no badge (we never print
  // a number we didn't measure). This replaced fabricated "+X–Y%" impact claims.
  const phoneMobile = crawl.hasPhoneAboveFoldMobile ?? crawl.hasPhoneAboveFold;
  const ri4 = params.reviewInsights;
  const impactFromMetric = (metric?: string): string => {
    switch (metric) {
      case 'mobile_speed':    return speed?.score != null ? `Now: mobile speed ${speed.score}/100` : '';
      case 'mobile_lcp':      return speed?.lcp ? `Now: mobile load ${speed.lcp}` : '';
      case 'phone_mobile':    return `Now: phone ${phoneMobile ? 'shown above the fold' : 'not above the fold (mobile)'}`;
      case 'sticky_cta':      return `Now: sticky call bar ${crawl.hasStickyCTA ? 'present' : 'missing'}`;
      case 'reviews_on_home': return `Now: reviews on homepage ${crawl.hasReviewsOnHome ? 'shown' : 'not shown'}`;
      case 'trust_badges':    return `Now: trust badges ${crawl.hasTrustBadges ? 'present' : 'missing'}`;
      case 'service_area':    return `Now: service-area pages ${crawl.hasServiceAreaPages ? 'present' : 'none found'}`;
      case 'booking_form':    return `Now: online quote form ${crawl.hasBookingForm ? 'present' : 'none found'}`;
      case 'financing':       return `Now: financing info ${crawl.hasFinancing ? 'present' : 'none found'}`;
      case 'emergency':       return `Now: 24/7 messaging ${crawl.hasEmergencyMessaging ? 'present' : 'none found'}`;
      case 'review_gap':      return `Now: ${lead.review_count} reviews vs ${competitor.review_count} for ${esc(String(competitor.name || '').split(' ')[0])}`;
      case 'reply_rate':      return ri4?.replyRate != null ? `Now: ${Math.round(ri4.replyRate * 100)}% of reviews answered`
                                   : ri4?.unansweredCount ? `Now: ${ri4.unansweredCount} unanswered review${ri4.unansweredCount !== 1 ? 's' : ''}` : '';
      case 'gbp_posts':       return params.gbpPostsPerWeek != null ? `Now: ${params.gbpPostsPerWeek.toFixed(1)} GBP posts/week` : '';
      case 'map_position':    return `Now: #${lead.position > 20 ? '>20' : lead.position} on the map pack`;
      case 'rating':          return `Now: ${lead.rating}★ rating`;
      default:                return '';
    }
  };
  const renderImpact = (f: any, cls: 'fi' | 'ii' = 'fi'): string => {
    const t = impactFromMetric(f?.metric);
    return t ? `<div class="${cls}">${esc(t)}</div>` : '';
  };

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,700;0,900;1,700&display=swap');
:root{--red:#D0202E;--yellow:#F5C518;--black:#000;--white:#fff;--gl:#F8F9FA;--gm:#E9ECEF;--gd:#343A40;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Outfit',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;color:var(--black);background:var(--white);line-height:1.4;}
.page{width:794px;height:1123px;display:flex;flex-direction:column;background:var(--white);page-break-after:always;overflow:hidden;} @page{margin:0;size:794px 1123px;}
.tb{background:var(--black);color:var(--white);display:flex;justify-content:space-between;align-items:center;padding:12px 40px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;flex-shrink:0;}
.brand{color:var(--red);}
.body{flex:1;padding:36px 52px 0;display:flex;flex-direction:column;}
.kicker{font-size:10px;font-weight:900;color:var(--red);text-transform:uppercase;letter-spacing:.22em;margin-bottom:10px;}
.hero-hl{font-size:72px;font-weight:900;line-height:.97;letter-spacing:-.03em;margin-bottom:16px;color:var(--black);}
.yl{background:var(--yellow);padding:2px 10px;}
.hero-sub{font-family:'Playfair Display',serif;font-style:italic;font-size:16px;line-height:1.5;margin-bottom:18px;color:var(--gd);}
.footer{border-top:1px solid var(--gm);padding:13px 52px;display:flex;justify-content:space-between;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--gd);letter-spacing:.06em;flex-shrink:0;}
.lbl{font-size:10px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:var(--gd);}

/* Cover */
.cover-kicker-label{font-size:11px;font-weight:900;color:var(--red);text-transform:uppercase;letter-spacing:.22em;margin-bottom:2px;}
.cover-kicker-name{font-size:13px;font-weight:700;color:var(--black);margin-bottom:20px;letter-spacing:.02em;}
.cover-divider{border:none;border-top:1.5px solid var(--black);margin:16px 0 20px;}
.cover-2col{display:grid;grid-template-columns:1fr 1fr;gap:24px;}
.bn-wrap{}
.bn-section-lbl{font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;margin-bottom:14px;color:var(--black);}
.bn-item{display:flex;flex-direction:column;margin-bottom:14px;}
.bn-val{font-size:38px;font-weight:900;color:var(--red);line-height:1;}
.bn-val.black{color:var(--black);}
.bn-lbl{font-family:'Playfair Display',serif;font-style:italic;font-size:12px;color:var(--gd);margin-top:3px;line-height:1.3;}
.inside-wrap{border-left:1px solid var(--gm);padding-left:20px;}
.inside-section-lbl{font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;margin-bottom:12px;color:var(--black);}
.inside-item{font-size:12px;color:var(--gd);padding:6px 0;border-bottom:0.5px solid var(--gm);line-height:1.4;}
.inside-item:last-child{border-bottom:none;}
.screens{display:grid;grid-template-columns:1fr .38fr;gap:14px;margin-top:auto;}
.scr-d{border:1px solid var(--gm);height:260px;border-radius:5px;overflow:hidden;background:#eee;}
.scr-m{border:5px solid var(--black);height:260px;border-radius:20px;overflow:hidden;background:#eee;position:relative;}
.scr-d .scr-img{width:100%;height:100%;object-fit:cover;object-position:top;display:block;}
.scr-m .scr-img{width:100%;height:100%;object-fit:cover;object-position:top;display:block;}

/* Map list */
.map-list{background:var(--black);color:var(--white);border-radius:8px;padding:18px 22px;margin-bottom:16px;}
.map-row{display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #1f1f1f;}
.map-row:last-child{border-bottom:none;}
.mp{font-size:20px;font-weight:900;color:#444;min-width:32px;}
.mp.you{color:var(--red);}
.mn{font-size:13px;font-weight:700;flex:1;padding:0 10px;}
.mm{font-size:11px;color:#777;text-align:right;}
.you-tag{font-size:9px;font-weight:900;color:var(--yellow);letter-spacing:.1em;margin-top:1px;}

/* The Math */
.math{background:var(--yellow);padding:14px 18px;border-radius:6px;margin-bottom:16px;}
.math-lbl{font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;margin-bottom:4px;}
.math-txt{font-size:12px;font-weight:600;line-height:1.5;}

/* Fix cards */
.fix{background:var(--gl);padding:16px 18px;border-left:5px solid var(--red);display:flex;gap:12px;align-items:flex-start;margin-bottom:9px;}
.fn{font-size:24px;font-weight:900;color:var(--red);opacity:.2;line-height:1;min-width:28px;}
.ft{font-size:14px;font-weight:800;margin-bottom:3px;}
.fb{font-size:11px;color:var(--gd);line-height:1.5;}
.fi{font-size:10px;font-weight:700;color:var(--red);margin-top:4px;text-transform:uppercase;letter-spacing:.1em;}

/* Table */
table{width:100%;border-collapse:collapse;margin:14px 0;}
thead tr{background:var(--black);color:var(--white);}
th{padding:10px 13px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;text-align:left;}
td{padding:11px 13px;border-bottom:1px solid var(--gm);font-size:13px;font-weight:600;}
td.win{color:#1a6b3a;font-weight:700;} td.loss{color:#D0202E;font-weight:700;}

/* Trust */
.trust-2col{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:18px 0;}
.tbox{padding:26px;text-align:center;border-radius:6px;}
.tc{font-size:44px;font-weight:900;line-height:1;margin:6px 0;}
.tr2{font-weight:800;font-size:13px;}
.tlbl{font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px;}

/* Review quote cards */
.review-row{display:grid;gap:10px;margin:14px 0;}
.review-row.cols-2{grid-template-columns:1fr 1fr;}
.review-row.cols-3{grid-template-columns:1fr 1fr 1fr;}
.rq{background:var(--gl);border-left:4px solid var(--yellow);padding:12px 14px;border-radius:4px;}
.rq-stars{font-size:12px;color:var(--yellow);margin-bottom:4px;letter-spacing:.1em;}
.rq-text{font-size:11px;font-weight:500;color:#333;line-height:1.5;font-style:italic;}
.rq-meta{font-size:10px;font-weight:700;color:#999;margin-top:6px;text-transform:uppercase;letter-spacing:.08em;}
.rq-noreply{border-left-color:var(--red);}
.rq-noreply .rq-meta{color:var(--red);}

/* Issues */
.issue{background:var(--gl);border-left:5px solid var(--gd);padding:16px 18px;margin-bottom:10px;}
.il{font-size:10px;font-weight:900;letter-spacing:.18em;color:#aaa;margin-bottom:4px;text-transform:uppercase;}
.it{font-size:15px;font-weight:800;margin-bottom:4px;}
.ib{font-size:11px;color:var(--gd);line-height:1.5;}
.ii{font-size:10px;font-weight:700;color:var(--red);margin-top:6px;text-transform:uppercase;letter-spacing:.1em;}
.combined{background:var(--yellow);border-radius:6px;padding:18px 24px;text-align:center;margin-top:14px;}
.cl{font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;margin-bottom:4px;}
.cv{font-size:30px;font-weight:900;line-height:1;}
.cs{font-size:11px;font-weight:700;margin-top:3px;}

/* CTA */
.cta-page{background:var(--white);color:var(--black);flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:48px;}
.cta-2col{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:32px 0;width:100%;max-width:660px;}
.cta-card{border:2px solid var(--gm);border-radius:12px;padding:30px 24px;text-align:left;}
.cta-card.dfy{border:3px solid var(--yellow);background:#fffdf0;box-shadow:0 0 20px rgba(245,197,24,0.2);}
.cbadge{font-size:10px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px;color:#aaa;display:block;}
.cbadge.hot{color:var(--red);}
.ctitle{font-size:22px;font-weight:900;margin-bottom:8px;color:var(--black);line-height:1.1;}
.cdesc{font-size:12px;color:var(--gd);line-height:1.6;}
.cta-price{font-size:28px;font-weight:900;color:var(--yellow);margin:12px 0 4px;}
.cta-price-sub{font-size:11px;color:#555;margin-bottom:16px;}
.cta-btn{display:inline-block;background:var(--yellow);color:var(--black);padding:18px 52px;font-size:15px;font-weight:900;text-transform:uppercase;text-decoration:none;border-radius:6px;letter-spacing:.06em;margin-top:8px;}
</style></head><body>

<!-- PAGE 1 COVER -->
<div class="page">
  <div class="tb"><span><span class="brand">ARMA</span> · WEBSITE REPORT · ${clientName}</span><span>${date}</span></div>
  <div class="body">
    <div class="cover-kicker-label">Exclusive Briefing</div>
    <div class="cover-kicker-name">For ${leadNameEsc.toUpperCase()} — ${cityEsc.toUpperCase()}, ${stateEsc.toUpperCase()}</div>

    <div class="hero-hl">${formatHeadline(headline)}</div>
    <div class="hero-sub">We followed your customer's path — from Google search to phone call - and flagged where you lose them.</div>

    <hr class="cover-divider">

    <div class="cover-2col">
      <div class="bn-wrap">
        <div class="bn-section-lbl">By the Numbers</div>
        <div class="bn-item">
          <div class="bn-val">${byNums.position || (lead.position > 20 ? '>20' : '#' + lead.position)}</div>
          <div class="bn-lbl">map pack position<br>for '${verticalEsc}' searches in ${cityEsc}</div>
        </div>
        <div class="bn-item">
          <div class="bn-val">${byNums.reviews || lead.review_count}</div>
          <div class="bn-lbl">your reviews<br>vs. ${competitor.review_count} for #${competitor.position} ${competitor.name.split(' ')[0]}</div>
        </div>
        <div class="bn-item">
          <div class="bn-val">${byNums.revenue_gap || `$${Math.round(revenue.loss_low_usd / 1000)}–$${Math.round(revenue.loss_high_usd / 1000)}k`}</div>
          <div class="bn-lbl">monthly revenue gap<br>conservative estimate</div>
        </div>
        <div class="bn-item">
          <div class="bn-val black">${byNums.fixes || '4'}</div>
          <div class="bn-lbl">fixable gaps<br>across customer journey</div>
        </div>
      </div>
      <div class="inside-wrap">
        <div class="inside-section-lbl">Inside This Report</div>
        <div class="inside-item">Your customer's 5-step journey to a booked job.</div>
        <div class="inside-item">Where they fall off — and exactly what it costs.</div>
        <div class="inside-item">How you compare to <strong>${compName}</strong> (ranked #${competitor.position} in your area) at every step.</div>
        <div class="inside-item">Two clear paths to fix it.</div>
      </div>
    </div>

    <div class="screens">
      <div class="scr-d">${desktopImg ? `<img src="${desktopImg}" class="scr-img">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#aaa;font-size:12px;">Screenshot unavailable</div>`}</div>
      <div class="scr-m">${mobileImg ? `<img src="${mobileImg}" class="scr-img">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#aaa;font-size:11px;">N/A</div>`}</div>
    </div>
  </div>
  <div class="footer"><span>STRICTLY CONFIDENTIAL · PREPARED BY ARMA AGENCY</span><span>PAGE 1 OF 6</span></div>
</div>

<!-- PAGE 2 DISCOVERY -->
<div class="page">
  <div class="tb"><span><span class="brand">ARMA</span> · ${clientName}</span><span>STEP 1 OF 4 · DISCOVERY</span></div>
  <div class="body">
    <div class="kicker">Step 1 of 4 · Are They Even Finding You?</div>
    <div class="hero-hl" style="font-size:40px;">${formatHeadline(analysis.page2_headline || `Invisible Where It Matters Most.`)}</div>
    <p class="hero-sub">${analysis.page2_subhead || `${leadNameEsc} sits at #${lead.position}. ${compName} holds #${competitor.position}. Every search that matters finds them first.`}</p>

    <div class="map-list">
      ${fullPack.slice(0, 5).map((p: any, idx: number, arr: any[]) => {
        const prevPos = arr[idx - 1]?.position ?? 0;
        const separator = idx > 0 && p.position > prevPos + 1
          ? '<div style="opacity:.3;font-size:11px;text-align:center;padding:3px 0;letter-spacing:.1em;color:#777;">· · ·</div>'
          : '';
        const cls = p.isLead ? ' you' : '';
        const tag = p.isLead
          ? '<div class="you-tag">← YOU</div>'
          : p.isCompetitor ? '<div class="you-tag" style="color:var(--yellow);">← THEM</div>' : '';
        const rating = (p.rating || 0).toFixed(1);
        const reviews = (p.review_count || 0).toLocaleString();
        return separator + `<div class="map-row"><div class="mp${cls}">#${p.position}</div><div class="mn">${p.name}${tag}</div><div class="mm">${rating}★ · ${reviews} reviews</div></div>`;
      }).join('')}
    </div>

    <div class="math">
      <div class="math-lbl">The Math</div>
      <div class="math-txt">${analysis.page2_the_math || `${compName} at #${competitor.position} captures the majority of "${verticalEsc} ${cityEsc}" searches. Being at #${lead.position} means most customers never see you.`}</div>
    </div>

    <div class="lbl" style="margin-bottom:9px;">How to Fix It</div>
    ${p2Fixes.map((f: any) => `<div class="fix"><div class="fn">${f.num || '01'}</div><div><div class="ft">${f.title}</div><div class="fb">${f.body}</div>${renderImpact(f)}</div></div>`).join('')}
  </div>
  <div class="footer"><span>PREPARED FOR ${clientName} · ${cityEsc}, ${stateEsc}</span><span>PAGE 2 OF 6</span></div>
</div>

<!-- PAGE 3 FIRST IMPRESSION -->
<div class="page">
  <div class="tb"><span><span class="brand">ARMA</span> · ${clientName}</span><span>STEP 2 OF 4 · FIRST IMPRESSION</span></div>
  <div class="body">
    <div class="kicker">Step 2 of 4 · What They See When They Land</div>
    <div class="hero-hl" style="font-size:40px;">${formatHeadline(analysis.page3_headline || 'Three Seconds. No Reason to Stay.')}</div>
    <p class="hero-sub">${analysis.page3_subhead || `Once someone finds you, they decide in 3 seconds. Right now those seconds work against you.`}</p>

    <table>
      <thead><tr><th style="width:36%;">FACTOR</th><th style="width:30%;">YOUR SITE</th><th style="width:34%;">${compName.toUpperCase()}</th></tr></thead>
      <tbody>${p3Rows.map((r: any) => {
          const leadCls = r.lead_value === 'N/A' ? '' : (r.lead_wins ? 'win' : 'loss');
          const compCls = r.comp_value === 'N/A' ? '' : (r.comp_wins !== false ? 'win' : 'loss');
          return `
        <tr>
          <td style="font-weight:600;color:var(--gd);">${r.label}</td>
          <td class="${leadCls}">${r.lead_value}</td>
          <td class="${compCls}">${r.comp_value}</td>
        </tr>`;
        }).join('')}
      </tbody>
    </table>

    <div class="math" style="margin-bottom:14px;">
      <div class="math-lbl">The Math</div>
      <div class="math-txt">${analysis.page3_the_math || `A chunk of visitors leave before ever contacting anyone. Each one of those is a job that went to someone else.`}</div>
    </div>

    <div class="lbl" style="margin-bottom:9px;">How to Fix It</div>
    ${p3Fixes.map((f: any) => `<div class="fix"><div class="fn">${f.num || '01'}</div><div><div class="ft">${f.title}</div><div class="fb">${f.body}</div>${renderImpact(f)}</div></div>`).join('')}
  </div>
  <div class="footer"><span>PREPARED FOR ${clientName} · ${cityEsc}, ${stateEsc}</span><span>PAGE 3 OF 6</span></div>
</div>

<!-- PAGE 4 TRUST -->
<div class="page">
  <div class="tb"><span><span class="brand">ARMA</span> · ${clientName}</span><span>STEP 3 OF 4 · TRUST &amp; AUTHORITY</span></div>
  <div class="body">
    <div class="kicker">Step 3 of 4 · Do They Believe You?</div>
    <div class="hero-hl" style="font-size:40px;">${formatHeadline(trust.headline.replace('\n', ' '))}</div>
    <p class="hero-sub">${trust.subhead}</p>

    <div class="trust-2col">
      <div class="tbox" style="border:2px solid var(--gm);">
        <div class="tlbl">${trust.leftLabel}</div>
        <div class="tc">${trust.leftCount}</div>
        <div class="tr2" style="color:var(--red);">${trust.leftSub}</div>
      </div>
      <div class="tbox" style="background:var(--black);color:var(--white);">
        <div class="tlbl" style="color:#555;">${trust.rightLabel}</div>
        <div class="tc">${trust.rightCount}</div>
        <div class="tr2" style="color:var(--yellow);">${trust.rightSub}</div>
      </div>
    </div>

    ${(() => {
      const snippets = (params.reviewInsights?.snippets ?? []).slice(0, 3);
      if (!snippets.length) return '';
      // Parse each snippet: "text" (N★ [Owner replied] or [No reply])
      const replyDataAvailable = params.reviewInsights?.replyDataAvailable !== false;
      const cards = snippets.map(s => {
        const textMatch = s.match(/^"(.+?)"/s);
        const starsMatch = s.match(/\((\d)★/);
        const replied = s.includes('[Owner replied]');
        const hasNoReplyMarker = s.includes('NO REPLY');
        const text = textMatch?.[1] ?? s;
        const stars = starsMatch?.[1] ? parseInt(starsMatch[1]) : 5;
        const starStr = '★'.repeat(stars) + '☆'.repeat(5 - stars);
        const metaLabel = replied ? 'Owner replied ✓' : (replyDataAvailable || hasNoReplyMarker) ? 'No reply — missed opportunity' : '';
        const replyClass = replied ? '' : (replyDataAvailable || hasNoReplyMarker) ? 'rq-noreply' : '';
        return `<div class="rq ${replyClass}"><div class="rq-stars">${starStr}</div><div class="rq-text">"${text}"</div>${metaLabel ? `<div class="rq-meta">${metaLabel}</div>` : ''}</div>`;
      });
      const colClass = cards.length >= 3 ? 'cols-3' : 'cols-2';
      return `<div class="lbl" style="margin-bottom:8px;">What Your Customers Are Actually Saying</div><div class="review-row ${colClass}">${cards.join('')}</div>`;
    })()}

    <div class="math" style="margin-bottom:16px;">
      <div class="math-lbl">The Math</div>
      <div class="math-txt">Your homepage doesn't surface your ${lead.review_count} Google reviews or ${lead.rating}★ rating up front, while ${compName} carries ${competitor.review_count} reviews. Visitors who can't see proof before they scroll are more likely to leave for a competitor — part of the estimated revenue gap quantified on page 5.</div>
    </div>

    <div class="lbl" style="margin-bottom:9px;">How to Close the Trust Gap</div>
    ${p4Fixes.map((f: any) => `<div class="fix"><div class="fn">${f.num}</div><div><div class="ft">${f.title}</div><div class="fb">${f.body}</div>${renderImpact(f)}</div></div>`).join('')}
  </div>
  <div class="footer"><span>PREPARED FOR ${clientName} · ${cityEsc}, ${stateEsc}</span><span>PAGE 4 OF 6</span></div>
</div>

<!-- PAGE 5 OTHER ISSUES -->
<div class="page">
  <div class="tb"><span><span class="brand">ARMA</span> · ${clientName}</span><span>STEP 4 OF 4 · OTHER ISSUES FOUND</span></div>
  <div class="body">
    <div class="kicker">Step 4 of 4 · What Else the Audit Surfaced</div>
    <div class="hero-hl" style="font-size:40px;">${p5Issues.length > 0 ? (p5Issues.length === 1 ? formatHeadline('One More Quiet Leak.') : formatHeadline(`${p5Issues.length} More Quiet Leaks.`)) : formatHeadline('No Additional Issues Found.')}</div>
    <p class="hero-sub">${p5Issues.length > 0 ? `Beyond the three issues already covered, the audit surfaced ${p5Issues.length} more problem${p5Issues.length > 1 ? 's' : ''} specific to how ${leadNameEsc} is set up. They are not universal. They showed up because of specific choices that quietly leak leads every day.` : `The issues on pages 2–4 are your primary revenue leaks. Fixing those three will have the highest impact.`}</p>
    <div style="flex:1;">
      ${p5Issues.map((i: any) => `
        <div class="issue">
          <div class="il">Issue ${i.letter}</div>
          <div class="it">${i.title}</div>
          <div class="ib">${i.body}</div>
          ${renderImpact(i, 'ii')}
        </div>`).join('')}
    </div>
    <div class="combined">
      <div class="cl">Combined Monthly Revenue at Risk</div>
      <div class="cv">$${revenue.loss_low_usd.toLocaleString()} – $${revenue.loss_high_usd.toLocaleString()}</div>
      <div class="cs">Conservative estimate · ${revenue.niche_matched} benchmarks</div>
    </div>
  </div>
  <div class="footer"><span>PREPARED FOR ${clientName} · ${cityEsc}, ${stateEsc}</span><span>PAGE 5 OF 6</span></div>
</div>

<!-- PAGE 6 CTA -->
<div class="page" style="background:var(--white);">
  <div class="tb">
    <span><span class="brand">ARMA</span> · ${clientName}</span><span>YOUR NEXT MOVE</span>
  </div>
  <div class="cta-page">
    <div class="kicker">Close the Gap</div>
    <div class="hero-hl" style="font-size:46px;margin-bottom:10px;">Two Ways<br><span class="yl">Forward</span></div>
    <p class="hero-sub" style="max-width:440px;margin:0 auto 26px;">
    You've seen the leaks. Fixing the site is only half the plan. Content, reviews, SEO timeline, and the actual moves to overtake ${compName} need more than a PDF can hold.</p>
    <div class="cta-2col">
      <div class="cta-card">
        <div class="cbadge">Option A · DIY</div>
        <div class="ctitle">Fix It Yourself.</div>
        <div class="cdesc">Every fix in this report is documented. Work through Steps 1 to 4 in order. You will see movement within 60 days. This covers site fixes only, not the full content and rankings strategy.</div>
      </div>
      <div class="cta-card dfy">
        <div class="cbadge hot">★ Option B · Done For You</div>
        <div class="ctitle">Let ARMA Handle Everything.</div>
        <div class="cta-price">$0</div>
        <div class="cta-price-sub">Free strategy call. No pitch. No obligation.</div>
        <div class="cdesc">20 minutes. We map out exactly how to overtake ${compName}. You get the full plan: site fixes, review strategy, content, rankings. If you want us to run it, we talk numbers.</div>
      </div>
    </div>
    <a href="#" class="cta-btn">Book Your 20-Min Call →</a>
    <div style="margin-top:14px;font-size:11px;color:#aaa;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Or reply to the email this report came in and we will set a time.</div>
    <div style="margin-top:20px;font-size:11px;color:#aaa;max-width:560px;text-align:center;line-height:1.5;">This report was prepared specifically for ${leadNameEsc} based on data pulled ${date}. No template. No fluff. The numbers are conservative. Your real gap is likely larger.</div>
  </div>
</div>

</body></html>`;
}
