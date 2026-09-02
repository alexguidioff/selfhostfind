import { NextResponse } from 'next/server';
import { runDiscovery } from '@/pipeline/discover';
import { sendAlert } from '@/lib/alerts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Optional HTTP trigger for the discovery pipeline, for setups where cron lives outside
// the container (e.g. an external scheduler pinging the running app). Protected by
// CRON_SECRET as a bearer token. The recommended default is still a scheduled job that
// runs `pnpm discover` directly inside the container (see docker-compose.yml / GH Action).
export const maxDuration = 300;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runDiscovery();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/cron/discover] failed', err);
    await sendAlert({
      level: 'error',
      title: 'Discovery pipeline crashed (HTTP trigger)',
      message: String(err instanceof Error ? err.message : err),
    });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
