import puppeteer, { Browser } from "puppeteer-core";
import { puppeteerOpts } from '../lib/browser';

export async function renderPDF(html: string): Promise<Buffer> {
  let browser: Browser | null = null;
  try {
    const opts = await puppeteerOpts();
    browser = await puppeteer.launch(opts as any);
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
    await page.evaluateHandle('document.fonts.ready');
    await page.waitForFunction(
      () => [...document.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0),
      { timeout: 15000 }
    ).catch(() => console.warn('[PDF] Some images did not complete — rendering anyway'));

    await new Promise(r => setTimeout(r, 300));

    const pdf = await page.pdf({ width: '794px', height: '1123px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    return Buffer.from(pdf);
  } finally { if (browser) await browser.close(); }
}
