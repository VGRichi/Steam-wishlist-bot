import { getDeps } from '../src/app';
import { config } from '../src/config';
import { runPriceCheck } from '../src/jobs/priceCheck';
import { log } from '../src/log';
import { secretsMatch } from '../src/security';

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
