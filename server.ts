// server.ts — ARMA Audit Engine · Entry Point
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';

dotenv.config();

import liteReportRouter from './routes/liteReport';
import fullReportRouter from './routes/fullReport';
import utilityRouter from './routes/utility';

const PORT = process.env.PORT || 3002;
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const swaggerDoc = yaml.load(fs.readFileSync(path.join(__dirname, 'swagger.yaml'), 'utf8')) as object;
// Vercel's serverless bundle omits the swagger-ui-dist static assets, so load
// the UI from a CDN instead of relying on swaggerUi.serve's express.static.
const SWAGGER_CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.6';
app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerDoc, {
    customCssUrl: `${SWAGGER_CDN}/swagger-ui.min.css`,
    customJs: [
      `${SWAGGER_CDN}/swagger-ui-bundle.js`,
      `${SWAGGER_CDN}/swagger-ui-standalone-preset.js`,
    ],
  })
);
app.get('/docs.json', (_req, res) => res.json(swaggerDoc));

app.use('/lite-report', liteReportRouter);
app.use('/full-report', fullReportRouter);
app.use('/', utilityRouter);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// On Vercel, the app is invoked as a serverless function via the default export
// below — app.listen() would bind to a port nothing connects to.
if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`\n🚀 ARMA Audit Engine ready: http://localhost:${PORT}`);
    console.log(`   POST /lite-report  { url, city, state, vertical }`);
    console.log(`   POST /full-report  { url }\n`);
  });
  server.setTimeout(300000);
}

export default app;
