import puppeteer, { Browser } from "puppeteer-core";
import { puppeteerOpts, CRAWL_UA } from '../lib/browser';

export async function crawlSite(url: string) {
  let browser: Browser | null = null;
  try {
    const opts = await puppeteerOpts();
    browser = await puppeteer.launch(opts as any);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(CRAWL_UA);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Detect subpage redirect — snap back to root homepage
    const landedUrl = page.url();
    const landedPath = new URL(landedUrl).pathname;
    const inputHost = new URL(url).hostname.replace('www.', '');
    const landedHost = new URL(landedUrl).hostname.replace('www.', '');
    if (landedPath !== '/' && landedPath !== '' && landedHost === inputHost) {
      const rootUrl = `${new URL(landedUrl).protocol}//${new URL(landedUrl).host}/`;
      console.log(`[Crawl] Redirected to subpage "${landedPath}", snapping to root: ${rootUrl}`);
      await page.goto(rootUrl, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => { });
    }

    await new Promise(r => setTimeout(r, 2500));

    let screenshotDesktop = '';
    try {
      await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise(r => setTimeout(r, 500));
      const raw = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
      screenshotDesktop = Buffer.from(raw).toString('base64');
      console.log(`[Crawl] Desktop screenshot: ${screenshotDesktop.length} chars`);
    } catch (e: any) {
      console.warn('[Crawl] Desktop screenshot failed:', e.message);
    }

    let screenshotMobile = '';
    let hasPhoneAboveFoldMobile = false;
    try {
      const currentUrl = page.url();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => { });
      await new Promise(r => setTimeout(r, 2500));
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise(r => setTimeout(r, 500));
      const raw = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
      screenshotMobile = Buffer.from(raw).toString('base64');
      // Evaluate phone visibility at mobile viewport (390px) before switching back to desktop
      hasPhoneAboveFoldMobile = await page.evaluate(() => {
        // Pass 1: click-to-call tel: link above fold
        if (Array.from(document.querySelectorAll('a[href^="tel:"]'))
            .some(el => el.getBoundingClientRect().top < 400)) return true;
        // Pass 2: visible phone number text in common above-fold containers
        // Catches phone numbers displayed as plain text/images in header/banner
        const phoneRe = /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/;
        const containers = document.querySelectorAll(
          'header, nav, [class*="header"], [class*="hero"], [class*="banner"], [class*="top-bar"], [class*="topbar"], [id*="header"], [id*="hero"]'
        );
        return Array.from(containers).some(el => {
          const rect = el.getBoundingClientRect();
          return rect.top < 400 && rect.height > 0
            && phoneRe.test((el as HTMLElement).innerText ?? '');
        });
      });
      console.log(`[Crawl] Mobile screenshot: ${screenshotMobile.length} chars, phoneAboveFold:${hasPhoneAboveFoldMobile}`);
    } catch (e: any) {
      console.warn('[Crawl] Mobile screenshot failed:', e.message);
    }

    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });

    const data = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const links = Array.from(document.querySelectorAll('a, button'));
      const body = document.body.innerText.toLowerCase();
      const tels = Array.from(document.querySelectorAll('a[href^="tel:"]'));
      return {
        hasStickyCTA: all.some(el => {
          const s = window.getComputedStyle(el);
          if (s.position !== 'fixed' && s.position !== 'sticky') return false;
          const t = el.textContent?.toLowerCase() ?? '';
          return t.includes('call') || t.includes('quote') || t.includes('book') || t.includes('free') || t.includes('schedule') || t.includes('contact') || t.includes('get') || t.includes('now');
        }),
        hasAboveFoldCTA: links.some(el => {
          const r = el.getBoundingClientRect();
          if (r.top >= 800 || r.bottom <= 0) return false;
          const t = el.textContent?.toLowerCase() ?? '';
          return t.includes('call') || t.includes('quote') || t.includes('book') || t.includes('free') || t.includes('schedule') || t.includes('contact') || t.includes('get') || t.includes('now');
        }),
        hasPhoneAboveFold: tels.some(el => el.getBoundingClientRect().top < 400),
        hasPhoneOnPage: tels.length > 0,
        hasReviewsOnHome: body.includes('review') || body.includes('rating') ||
          !!document.querySelector('.stars,.rating,[class*="review"],[class*="testimonial"],[class*="rating"]'),
        hasTrustBadges: body.includes('licensed') || body.includes('insured') ||
          body.includes('certified') || body.includes('bbb') ||
          !!document.querySelector('[alt*="bbb"i],[src*="bbb"i],[alt*="angi"i],[class*="badge"i],[class*="trust"i]'),
        hasServiceAreaPages: body.includes('service area') || body.includes('serving') ||
          !!document.querySelector('a[href*="service-area"],a[href*="location"]'),
        hasBookingForm:
          // native form element anywhere on page
          !!document.querySelector('form')
          // common form/contact widget class or id patterns (covers JS-injected forms)
          || !!document.querySelector('[class*="form"],[id*="form"],[class*="contact"],[id*="contact"],[class*="estimate"],[id*="estimate"],[class*="quote"],[id*="quote"]')
          // homepage link to a contact/estimate/quote/schedule page
          || !!document.querySelector('a[href*="contact"],a[href*="estimate"],a[href*="quote"],a[href*="schedule"],a[href*="booking"],a[href*="request"]')
          // text patterns — covers "Estimate Request Form", "Get a Free Estimate", etc.
          || body.includes('schedule')
          || body.includes('request a quote')
          || body.includes('get a quote')
          || body.includes('free estimate')
          || body.includes('estimate request')
          || body.includes('request estimate')
          || body.includes('get estimate')
          || body.includes('estimate form')
          || body.includes('contact form')
          || body.includes('book now')
          || body.includes('book a ')
          || body.includes('request service')
          || body.includes('request an appointment'),
        hasEmergencyMessaging: body.includes('24/7') || body.includes('emergency') || body.includes('same day') || body.includes('same-day'),
        hasFinancing: body.includes('financing') || body.includes('payment plan') || body.includes('0% interest'),
        hasDomainMismatch: (() => {
          const h1 = document.querySelector('h1')?.textContent?.toLowerCase().split(' ')[0] ?? '';
          return h1.length > 3 && !window.location.hostname.includes(h1);
        })(),
        pageText: document.body.innerText.substring(0, 6000),
        title: document.title,
        metaDescription: (document.querySelector('meta[name="description"]') as HTMLMetaElement)?.content ?? '',
        h1: document.querySelector('h1')?.textContent ?? '',
      };
    });

    return { ...data, hasPhoneAboveFoldMobile, screenshotDesktop, screenshotMobile };
  } catch (e: any) {
    console.error(`[Crawl Error] ${url}:`, e.message);
    return {
      hasStickyCTA: false, hasAboveFoldCTA: false, hasPhoneAboveFold: false,
      hasPhoneAboveFoldMobile: false,
      hasPhoneOnPage: false, hasReviewsOnHome: false, hasTrustBadges: false,
      hasServiceAreaPages: false, hasBookingForm: false, hasEmergencyMessaging: false,
      hasFinancing: false, hasDomainMismatch: false,
      pageText: "", title: "", metaDescription: "", h1: "",
      screenshotDesktop: "", screenshotMobile: "",
    };
  } finally {
    if (browser) await browser.close();
  }
}
