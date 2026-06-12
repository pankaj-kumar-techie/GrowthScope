import fs from 'fs';
import chromium from "@sparticuz/chromium";

const BASE_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--no-first-run",
  "--no-zygote",
  "--hide-scrollbars",
  "--window-size=1280,1000",
  "--force-device-scale-factor=1",
];

export const CRAWL_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

export const puppeteerOpts = async () => {
  const isProd = process.env.NODE_ENV === "production";
  const envExec = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  const exec = [envExec, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/chromium"]
    .find(p => p && fs.existsSync(p));
  // No system Chrome (or explicitly prod/serverless) → use the @sparticuz/chromium
  // binary bundled in node_modules instead of failing.
  if (isProd || !exec) return {
    args: [...(chromium as any).args, ...BASE_ARGS],
    executablePath: await (chromium as any).executablePath(),
    headless: true as const,
  };
  return {
    args: BASE_ARGS,
    executablePath: exec,
    headless: true as const,
  };
};
