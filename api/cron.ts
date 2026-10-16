import { getDeps } from '../src/app.js';
import { config } from '../src/config.js';
import { runPriceCheck } from '../src/jobs/priceCheck.js';
import { log } from '../src/log.js';
import { secretsMatch } from '../src/security.js';

// Vercel Cron calls this daily (see vercel.json) with "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request): Promise<Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!secretsMatch(token, config.cronSecret)) {
    return new Response('unauthorized', { status: 401 });
  }

  try {
    const stats = await runPriceCheck(getDeps());
    return Response.json(stats);
  } catch (err) {
    log.error('price check failed', { err });
    return Response.json({ error: 'price check failed' }, { status: 500 });
  }
}
