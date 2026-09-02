// Minimal operational alerting. On an unattended catalog nobody is tailing logs, so a
// pipeline failure that only prints to stdout is, in practice, invisible. Two complementary
// mechanisms, both optional and best-effort (never throw — an alerting failure must not
// crash the job it's trying to report on):
//
// - sendAlert(): push notification on a *specific* problem (fatal crash, invalid token,
//   high per-repo failure rate) to a self-hosted-friendly webhook (ntfy, Slack-compatible,
//   Discord, or a generic JSON receiver).
// - pingHeartbeat(): a dead-man's-switch ping on every *successful* run, for the failure
//   mode alerts can't cover — the host/container stops entirely, so nothing ever runs to
//   report an error in the first place. Pair with healthchecks.io, Uptime Kuma's push
//   monitor, or Cronitor: silence past their grace period is itself the alert.

type AlertLevel = 'info' | 'warning' | 'error';

export interface AlertEvent {
  title: string;
  message: string;
  level: AlertLevel;
}

const FETCH_TIMEOUT_MS = 10_000;

export async function sendAlert(event: AlertEvent): Promise<void> {
  const logFn = event.level === 'error' ? console.error : event.level === 'warning' ? console.warn : console.log;
  logFn(`[alert:${event.level}] ${event.title} — ${event.message}`);

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    const { body, headers } = buildPayload((process.env.ALERT_WEBHOOK_FORMAT ?? 'generic').toLowerCase(), event);
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`[alerts] webhook responded ${res.status}`);
    }
  } catch (err) {
    console.error('[alerts] failed to deliver webhook alert', err);
  }
}

function buildPayload(format: string, event: AlertEvent): { body: string; headers: Record<string, string> } {
  const text = `[${event.level.toUpperCase()}] ${event.title}\n${event.message}`;

  switch (format) {
    case 'slack':
      // Also works for Slack-compatible receivers (Mattermost, Rocket.Chat incoming webhooks).
      return { body: JSON.stringify({ text }), headers: { 'Content-Type': 'application/json' } };
    case 'discord':
      return {
        body: JSON.stringify({ content: text.slice(0, 1900) }),
        headers: { 'Content-Type': 'application/json' },
      };
    case 'ntfy':
      // ntfy.sh (or a self-hosted ntfy instance) expects a plain-text body, with metadata in headers.
      return {
        body: event.message,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          Title: event.title,
          Priority: event.level === 'error' ? 'urgent' : event.level === 'warning' ? 'high' : 'default',
          Tags: event.level === 'error' ? 'rotating_light' : 'warning',
        },
      };
    case 'generic':
    default:
      return {
        body: JSON.stringify({ ...event, source: 'selfhostfind', timestamp: new Date().toISOString() }),
        headers: { 'Content-Type': 'application/json' },
      };
  }
}

export async function pingHeartbeat(): Promise<void> {
  const url = process.env.HEARTBEAT_URL;
  if (!url) return;
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    console.error('[alerts] failed to ping heartbeat URL', err);
  }
}
