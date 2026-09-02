import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendAlert, pingHeartbeat } from '@/lib/alerts';

describe('sendAlert', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.ALERT_WEBHOOK_URL;
    delete process.env.ALERT_WEBHOOK_FORMAT;
  });

  it('never calls fetch when no webhook URL is configured', async () => {
    await sendAlert({ level: 'error', title: 'x', message: 'y' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not throw when the webhook itself fails', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    await expect(sendAlert({ level: 'error', title: 'x', message: 'y' })).resolves.toBeUndefined();
  });

  it('sends a Slack-compatible {text} payload for format=slack', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';
    process.env.ALERT_WEBHOOK_FORMAT = 'slack';

    await sendAlert({ level: 'error', title: 'Pipeline crashed', message: 'boom' });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain('Pipeline crashed');
    expect(body.text).toContain('boom');
  });

  it('sends a Discord-compatible {content} payload for format=discord', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';
    process.env.ALERT_WEBHOOK_FORMAT = 'discord';

    await sendAlert({ level: 'warning', title: 'High failure rate', message: '12 of 30 failed' });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.content).toContain('High failure rate');
  });

  it('sends a plain-text body with Title/Priority headers for format=ntfy', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';
    process.env.ALERT_WEBHOOK_FORMAT = 'ntfy';

    await sendAlert({ level: 'error', title: 'Token expired', message: 'GitHub returned 401' });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body).toBe('GitHub returned 401');
    expect(init.headers.Title).toBe('Token expired');
    expect(init.headers.Priority).toBe('urgent');
  });

  it('defaults to a generic JSON payload', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://example.invalid/webhook';

    await sendAlert({ level: 'info', title: 'x', message: 'y' });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ title: 'x', message: 'y', level: 'info', source: 'selfhostfind' });
  });
});

describe('pingHeartbeat', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.HEARTBEAT_URL;
  });

  it('does nothing when HEARTBEAT_URL is not set', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    await pingHeartbeat();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('pings the configured URL and swallows failures', async () => {
    process.env.HEARTBEAT_URL = 'https://example.invalid/ping';
    global.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await expect(pingHeartbeat()).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith('https://example.invalid/ping', expect.objectContaining({ method: 'GET' }));
  });
});
