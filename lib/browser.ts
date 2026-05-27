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
  if (isProd) return {
    args: [...(chromium as any).args, ...BASE_ARGS],
    executablePath: await (chromium as any).executablePath(),
    headless: true as const,
  };
  const exec = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
  if (!exec) throw new Error("Chrome not found locally. Set NODE_ENV=production.");
  return {
    args: BASE_ARGS,
    executablePath: exec,
    headless: true as const,
  };
};
