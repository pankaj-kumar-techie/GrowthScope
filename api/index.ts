// api/index.ts — Vercel serverless entry. All routes rewrite here (see vercel.json);
// the function's maxDuration is configured there too. Local dev still runs server.ts.
import app from '../server';

export default app;
