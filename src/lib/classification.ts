// Keyword-based classifier (v1 of the classification system described in the spec).
// Produces the same structured shape an LLM-based classifier (v2) would return, so the
// pipeline and DB don't need to change when that's added later — only classificationSource
// on Application flips from "keyword-rules" to "llm".

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
}

interface CategoryRule {
  category: string;
  subcategory?: string;
  keywords: RegExp[];
}

const CATEGORY_RULES: CategoryRule[] = [
  { category: 'Finance', subcategory: 'Expense Sharing', keywords: [/expense.?shar/i, /split.?(bill|expense)/i, /\bbudget(ing)?\b/i, /\bfinance\b/i, /\baccounting\b/i] },
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
      if (lower.includes(product) && /(alternative|replace|instead of|vs\.?\s|similar to)/i.test(lower)) {
        found.add(titleCase(product));
      }
    }
  }

  return [...found].slice(0, 6);
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

const SELF_HOSTED_POSITIVE = [/self-?hosted/i, /host it yourself/i, /own your data/i, /run (it )?on your own server/i, /docker-compose/i, /\bhomelab\b/i];
const SELF_HOSTED_NEGATIVE = [/\bsdk\b/i, /\blibrary\b/i, /\bnpm package\b/i, /\bcli tool\b(?! for)/i, /\bvs ?code extension\b/i, /\bbrowser extension\b/i];

export function classify(input: ClassificationInput): ClassificationOutput {
  const haystack = `${input.name}\n${input.description}\n${input.readme.slice(0, 6000)}\n${input.topics.join(' ')}`;

  let confidence = 0.3;

  const positiveHits = SELF_HOSTED_POSITIVE.filter((re) => re.test(haystack)).length;
  const negativeHits = SELF_HOSTED_NEGATIVE.filter((re) => re.test(haystack)).length;
  const topicHit = input.topics.some((t) => /self-?hosted|selfhosted|homelab/i.test(t));

  const isSelfHostedApp = (positiveHits > 0 || topicHit) && negativeHits === 0;
  if (topicHit) confidence += 0.3;
  if (positiveHits > 0) confidence += Math.min(0.2, positiveHits * 0.05);
  if (negativeHits > 0) confidence -= 0.3;

  let bestCategory: CategoryRule | null = null;
  let bestScore = 0;
  for (const rule of CATEGORY_RULES) {
    const score = rule.keywords.filter((re) => re.test(haystack)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule;
    }
  }
  if (bestCategory) confidence += Math.min(0.2, bestScore * 0.05);

  const alternativesTo = detectAlternativesTo(haystack);
  if (alternativesTo.length > 0) confidence += 0.1;

  const nasFriendly = NAS_FRIENDLY_HINTS.some((re) => re.test(haystack));

  return {
    isSelfHostedApp,
    category: bestCategory?.category ?? null,
    subcategory: bestCategory?.subcategory ?? null,
    alternativesTo,
    nasFriendly,
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
  };
}
