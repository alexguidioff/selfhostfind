// Weighted keyword classification with explicit reasons for human review.

export interface ClassificationInput {
  name: string;
  description: string;
  readme: string;
  topics: string[];
}

export interface ClassificationOutput {
  isSelfHostedApp: boolean;
  category: string | null;
  subcategory: string | null;
  alternativesTo: string[];
  nasFriendly: boolean;
  confidence: number; // 0..1
  reviewReasons: string[];
}

interface CategoryRule {
  category: string;
  subcategory?: string;
  keywords: RegExp[];
}

const CATEGORY_RULES: CategoryRule[] = [
  { category: 'Gaming', keywords: [/\bgam(?:e|ing) servers?\b/i, /\bmultiplayer\b/i, /\brom manager\b/i, /\bgame (library|collection)\b/i, /\bgaming\b/i] },
  { category: 'Bookmarks', keywords: [/\bbookmarks?\b/i, /\blink (manager|management|warden)\b/i, /\bread.?it.?later\b/i] },
  { category: 'RSS & News', keywords: [/\brss\b/i, /\bfeed (reader|aggregator)\b/i, /\bnews aggregator\b/i] },
  { category: 'Automation', keywords: [/\bworkflow automation\b/i, /\bautomate workflows?\b/i, /\bno.?code automation\b/i, /\bzapier\b/i, /\btask scheduling\b/i] },
  { category: 'Analytics', keywords: [/\banalytics\b/i, /\bweb analytics\b/i, /\bweb statistics\b/i, /\bvisitor tracking\b/i, /\bproduct analytics\b/i] },
  { category: 'AI & LLM', keywords: [/\bllms?\b/i, /\blarge language models?\b/i, /\blocal ai\b/i, /\bai chat\b/i, /\bollama\b/i] },
  { category: 'Finance', keywords: [/expense.?shar/i, /split.?(bill|expense)/i, /\bbudget(ing)?\b/i, /\bfinance\b/i, /\baccounting\b/i] },
  { category: 'Photos', keywords: [/\bphoto\b/i, /\bgallery\b/i, /\bimage library\b/i] },
  { category: 'Media', keywords: [/\bmedia server\b/i, /\bstreaming\b/i, /\bplex\b/i, /\bjellyfin\b/i, /\bmusic\b/i, /\bvideo library\b/i, /\bpodcast\b/i] },
  { category: 'Documents', keywords: [/\bdocument management\b/i, /\bpaperless\b/i, /\barchiv(e|ing)\b/i, /\bocr\b/i] },
  { category: 'Notes', keywords: [/\bnote.?taking\b/i, /\bnotes app\b/i, /\bwiki\b/i, /\bknowledge base\b/i, /\bmarkdown editor\b/i] },
  { category: 'Passwords', keywords: [/password manager/i, /\bvault\b/i, /\bsecrets manager\b/i] },
  { category: 'Productivity', keywords: [/\bto-?do\b/i, /\btask manager\b/i, /\bcalendar\b/i, /\bkanban\b/i, /\bproductivity\b/i] },
  { category: 'Dashboard', keywords: [/\bdashboard\b/i, /\bhomepage\b/i, /\bstart ?page\b/i] },
  { category: 'Monitoring', keywords: [/\bmonitoring\b/i, /\bmetrics\b/i, /\buptime\b/i, /\bobservability\b/i, /\blog aggregat/i] },
  { category: 'Home Automation', keywords: [/\bhome assistant\b/i, /\bhome automation\b/i, /\bsmart home\b/i, /\biot\b/i] },
  { category: 'Backup', keywords: [/\bbackup\b/i, /\bsnapshot\b/i, /\bdisaster recovery\b/i] },
  { category: 'File Sharing', keywords: [/\bfile shar(e|ing)\b/i, /\bcloud storage\b/i, /\bfile sync\b/i, /\bfile manager\b/i] },
  { category: 'Developer Tools', keywords: [/\bci\/cd\b/i, /\bgit server\b/i, /\bcode review\b/i, /\bdeveloper tool\b/i, /\bself-hosted git\b/i] },
  { category: 'Project Management', keywords: [/\bproject management\b/i, /\bissue tracker\b/i, /\bagile board\b/i] },
  { category: 'Communication', keywords: [/\bchat app\b/i, /\bmessaging\b/i, /\bvideo conferenc/i, /\bemail server\b/i, /\bforum\b/i] },
  { category: 'Security', keywords: [/\bvpn\b/i, /\bfirewall\b/i, /\bauthentication\b/i, /\bsso\b/i, /\bidentity provider\b/i] },
];

// Well-known commercial/proprietary products this catalog cares about surfacing as
// "alternative to" — matched against explicit phrasing plus a curated name list so we
// don't need an LLM to catch "Immich is a high performance photo... alternative to Google Photos".
const KNOWN_PRODUCTS = [
  'splitwise', 'tricount', 'google photos', 'google drive', 'dropbox', 'evernote',
  'notion', 'trello', 'asana', 'slack', 'discord', 'zoom', 'lastpass', '1password',
  'onedrive', 'icloud', 'spotify', 'netflix', 'plex', 'gmail', 'google calendar',
  'todoist', 'pocket', 'instapaper', 'airtable', 'google analytics', 'zapier',
  'ifttt', 'bitwarden', 'youtube', 'medium', 'wordpress.com', 'squarespace',
];

const NAS_FRIENDLY_HINTS = [/\bnas\b/i, /\bsynology\b/i, /\bunraid\b/i, /\btruenas\b/i, /\bqnap\b/i, /\bhomelab\b/i, /\blow.?resource\b/i, /\braspberry pi\b/i, /\barm64\b/i];

function detectAlternativesTo(text: string): string[] {
  const found = new Set<string>();
  const lower = text.toLowerCase();

  // Explicit phrasing: "alternative to X" / "alternative to X and Y". Stops at the first
  // sentence-continuation word (not just punctuation) so "alternative to X that runs on..."
  // doesn't swallow the rest of the sentence into the captured product name.
  const explicit = [
    ...lower.matchAll(
      /alternative(?:s)? to ([a-z0-9,.\s&]+?)(?:\.|,|\b(?:with|that|which|for|since|while|you|your|running|runs)\b|\n|$)/gi
    ),
  ];
  for (const m of explicit) {
    const candidates = m[1].split(/,|\band\b|&/).map((s) => s.trim()).filter(Boolean);
    for (const c of candidates) {
      if (c.length > 1 && c.length < 40) found.add(titleCase(c));
    }
  }

  // Fallback: known product names mentioned anywhere near "alternative"/"replace"/"instead of"
  if (found.size === 0) {
    for (const product of KNOWN_PRODUCTS) {
      if (lower.split(/[.!?\n]/).some((sentence) => sentence.includes(product) && /(alternative|replace|instead of|similar to)/i.test(sentence))) {
        found.add(titleCase(product));
      }
    }
  }

  return [...found].slice(0, 6);
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

const SELF_HOSTED_POSITIVE = [/self[- ]?host(?:ed|ing)/i, /host it yourself/i, /own your data/i, /run (it )?on your own server/i, /docker[ -]compose/i, /\bdocker containers?\b/i, /\bhomelab\b/i];

// Product identity, not incidental mentions such as "includes an SDK" or "game library".
export function nonApplicationReason(name: string, description: string): string | null {
  if (/^(?:an?\s+)?(?:[\w#+.-]+\s+){0,3}(?:sdk|client library|api wrapper|npm package|python package|utility library|rust crate|go module)\b/i.test(description)) {
    return 'Repository describes a library/SDK rather than a standalone app';
  }
  if (/(?:^|[-_])sdk$|(?:^|[-_])client[-_]library$/i.test(name)) return 'Repository name identifies a library/SDK';
  return null;
}

export function classify(input: ClassificationInput): ClassificationOutput {
  const readme = input.readme.slice(0, 6000);
  const topics = input.topics.join(' ').replace(/-/g, ' ');
  const identity = `${input.name}\n${input.description}\n${topics}`;
  const haystack = `${identity}\n${readme}`;
  const positiveHits = SELF_HOSTED_POSITIVE.filter((re) => re.test(haystack)).length;
  const topicHit = input.topics.some((t) => /^(self-?hosted|self-hosting|homelab)$/.test(t));
  const negative = nonApplicationReason(input.name, input.description);
  const isSelfHostedApp = (positiveHits > 0 || topicHit) && !negative;
  const reviewReasons: string[] = [];
  if (negative) reviewReasons.push(negative);
  if (!positiveHits && !topicHit) reviewReasons.push('No clear self-hosting evidence');

  // Strong identity fields outweigh up to two incidental README keyword hits.
  const matches = (rule: CategoryRule, text: string) => rule.keywords.filter((re) => re.test(text)).length;
  const ranked = CATEGORY_RULES.map((rule) => ({ rule,
    primary: matches(rule, input.description) * 4 + matches(rule, input.name.replace(/-/g, ' ')) * 3 + matches(rule, topics) * 5,
    secondary: Math.min(2, matches(rule, readme)),
  })).map((item) => ({ ...item, score: item.primary + item.secondary }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  const ambiguous = best.score > 0 && runnerUp.score > 0 && best.score - runnerUp.score <= 1;
  if (!best.score) reviewReasons.push('No category matched');
  else if (ambiguous) reviewReasons.push(`Category ambiguous: ${best.rule.category} / ${runnerUp.rule.category}`);
  else if (!best.primary) reviewReasons.push('Category inferred only from README');
  const category = best.score && !ambiguous ? best.rule.category : null;
  let subcategory: string | null = null;
  if (category === 'Gaming') {
    const gamingText = best.primary ? identity : readme;
    const servers = /\bgam(?:e|ing) servers?\b|\bmultiplayer\b/i.test(gamingText);
    const libraries = /\brom manager\b|\bgame (library|collection)\b/i.test(gamingText);
    if (servers !== libraries) subcategory = servers ? 'Game Servers' : 'Game Libraries';
  }
  if (category === 'Finance' && /expense.?shar|split.?(bill|expense)/i.test(identity)) subcategory = 'Expense Sharing';
  const alternativesTo = detectAlternativesTo(haystack);
  let confidence = 0.3 + (topicHit ? 0.3 : 0) + Math.min(0.2, positiveHits * 0.05)
    + (best.primary ? 0.15 : best.score ? 0.05 : 0) + (alternativesTo.length ? 0.1 : 0);
  if (reviewReasons.length) confidence = Math.min(confidence, 0.6);
  if (negative) confidence = Math.min(confidence, 0.2);
  return { isSelfHostedApp, category, subcategory, alternativesTo,
    nasFriendly: NAS_FRIENDLY_HINTS.some((re) => re.test(haystack)),
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))), reviewReasons };
}

export function classificationFields(result: ClassificationOutput) {
  return {
    category: result.category, subcategory: result.subcategory, alternativesTo: result.alternativesTo,
    isNasFriendly: result.nasFriendly, classificationConfidence: result.confidence,
    classificationSource: 'keyword-rules-v2', classificationReviewReasons: result.reviewReasons,
  };
}
