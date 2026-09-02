// Seed queries for the discovery funnel. These are intentionally targeted (topics,
// description phrases, filenames, recency) rather than a full crawl of GitHub.
// GitHub's search API only accepts one qualifier combination per call, so we build
// an explicit list rather than a cartesian product to keep quota usage predictable.

const RECENT_PUSH = 'pushed:>2023-01-01'; // drop long-abandoned repos at the query level too
const NOT_FORK = 'fork:false';
const MIN_STARS = 'stars:>=5'; // filters out near-empty accounts/test repos, not a popularity gate

const TOPICS = ['self-hosted', 'selfhosted', 'homelab', 'nas', 'docker-compose', 'self-hosting'];

const DESCRIPTION_PHRASES = [
  '"self-hosted" in:description,readme',
  '"self hosted" in:description,readme',
  '"alternative to" in:description',
  '"personal server" in:description,readme',
  '"open source alternative" in:description,readme',
];

const FILENAME_SIGNALS = [
  'filename:docker-compose.yml',
  'filename:docker-compose.yaml',
  'filename:compose.yml',
  'filename:compose.yaml',
];

export function buildDiscoveryQueries(): string[] {
  const queries: string[] = [];

  for (const topic of TOPICS) {
    queries.push(`topic:${topic} ${NOT_FORK} archived:false ${RECENT_PUSH} ${MIN_STARS}`);
  }

  for (const phrase of DESCRIPTION_PHRASES) {
    queries.push(`${phrase} ${NOT_FORK} archived:false ${RECENT_PUSH} ${MIN_STARS} language:*`);
  }

  for (const filename of FILENAME_SIGNALS) {
    queries.push(`${filename} ${NOT_FORK} archived:false ${RECENT_PUSH}`);
  }

  return queries;
}

// Human-readable label per query, stored as provenance on Repository.discoverySource.
export function labelForQuery(query: string): string {
  if (query.startsWith('topic:')) return query.split(' ')[0];
  if (query.startsWith('filename:')) return query.split(' ')[0];
  return 'description-phrase';
}
