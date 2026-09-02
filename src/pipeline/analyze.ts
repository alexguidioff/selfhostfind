import { getRootContents, getReadme, getLatestRelease, getLanguages } from '@/lib/github';

export interface AnalysisResult {
  dockerfilePresent: boolean;
  composePresent: boolean;
  readmeExcerpt: string | null;
  readmeFull: string | null;
  screenshotUrls: string[];
  databases: string[];
  envVars: string[];
  ports: number[];
  containerImage: string | null;
  arm64Supported: boolean | null;
  amd64Supported: boolean | null;
  installMethods: string[];
  documentationUrl: string | null;
  demoUrl: string | null;
  latestReleaseTag: string | null;
  latestReleaseAt: Date | null;
  languages: Record<string, number> | null;
}

const COMPOSE_FILENAMES = new Set(['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']);
const DOCKERFILE_FILENAMES = new Set(['dockerfile', 'dockerfile.prod']);

const DB_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'PostgreSQL', re: /\bpostgres(ql)?\b/i },
  { name: 'MySQL', re: /\bmysql\b/i },
  { name: 'MariaDB', re: /\bmariadb\b/i },
  { name: 'SQLite', re: /\bsqlite\b/i },
  { name: 'MongoDB', re: /\bmongo(db)?\b/i },
  { name: 'Redis', re: /\bredis\b/i },
];

function extractDatabases(text: string): string[] {
  const found = new Set<string>();
  for (const { name, re } of DB_PATTERNS) {
    if (re.test(text)) found.add(name);
  }
  return [...found];
}

function extractEnvVars(text: string): string[] {
  // Matches ALL_CAPS_WITH_UNDERSCORES tokens that look like env vars, e.g. from
  // `.env.example` blocks or docker-compose `environment:` sections pasted in README.
  const matches = text.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,6}\b/g) ?? [];
  const blocklist = new Set(['README', 'LICENSE', 'HTTP', 'HTTPS', 'URL', 'API', 'TODO', 'FIXME']);
  const found = new Set(matches.filter((m) => !blocklist.has(m)));
  return [...found].slice(0, 40);
}

function extractPorts(text: string): number[] {
  // Looks for docker-compose style "HOST:CONTAINER" or "- 8080:80" port mappings.
  const matches = text.match(/["\s-]?(\d{2,5}):(\d{2,5})["\s]/g) ?? [];
  const ports = new Set<number>();
  for (const m of matches) {
    const [, host] = m.match(/(\d{2,5}):(\d{2,5})/) ?? [];
    const n = Number(host);
    if (n && n > 0 && n < 65536) ports.add(n);
  }
  return [...ports].slice(0, 10);
}

function extractScreenshots(readme: string, owner: string, repo: string, branch: string): string[] {
  const urls = new Set<string>();
  const mdImg = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  const htmlImg = /<img[^>]+src=["']([^"'\s]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = mdImg.exec(readme))) urls.add(resolveUrl(m[1], owner, repo, branch));
  while ((m = htmlImg.exec(readme))) urls.add(resolveUrl(m[1], owner, repo, branch));
  return [...urls]
    .filter((u) => /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(u))
    .filter((u) => !/badge|shield\.io|coverage|ci\.yml|workflow/i.test(u))
    .slice(0, 6);
}

function resolveUrl(src: string, owner: string, repo: string, branch: string): string {
  if (src.startsWith('http')) return src;
  const clean = src.replace(/^\.?\//, '');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${clean}`;
}

function extractDocLink(readme: string): string | null {
  const m = readme.match(/\[[^\]]*(?:docs|documentation)[^\]]*\]\((https?:\/\/[^)]+)\)/i);
  return m ? m[1] : null;
}

function extractDemoLink(readme: string): string | null {
  const m = readme.match(/\[[^\]]*(?:demo|live demo|try it)[^\]]*\]\((https?:\/\/[^)]+)\)/i);
  return m ? m[1] : null;
}

export async function analyzeRepository(
  owner: string,
  repo: string,
  defaultBranch: string
): Promise<AnalysisResult> {
  const [contents, readme, release, languages] = await Promise.all([
    getRootContents(owner, repo),
    getReadme(owner, repo),
    getLatestRelease(owner, repo),
    getLanguages(owner, repo),
  ]);

  const filenames = (contents ?? []).filter((f) => f.type === 'file').map((f) => f.name.toLowerCase());
  const dockerfilePresent = filenames.some((f) => DOCKERFILE_FILENAMES.has(f) || f === 'dockerfile');
  const composePresent = filenames.some((f) => COMPOSE_FILENAMES.has(f));

  const readmeFull = readme ?? '';
  const readmeExcerpt = readmeFull ? readmeFull.slice(0, 4000) : null;

  const combinedText = readmeFull; // README is the richest signal source
  const databases = extractDatabases(combinedText);
  const envVars = extractEnvVars(combinedText);
  const ports = extractPorts(combinedText);
  const screenshotUrls = readmeFull ? extractScreenshots(readmeFull, owner, repo, defaultBranch) : [];

  const armMentioned = /\barm64\b|\baarch64\b|\bmulti-?arch\b/i.test(combinedText);
  const amdMentioned = /\bamd64\b|\bx86[_-]?64\b/i.test(combinedText);
  const containerImageMatch = combinedText.match(
    /\b((?:ghcr\.io|docker\.io|quay\.io|registry\.hub\.docker\.com)\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)/i
  );

  const installMethods: string[] = [];
  if (composePresent) installMethods.push('Docker Compose');
  else if (dockerfilePresent) installMethods.push('Docker');
  if (containerImageMatch) installMethods.push('Container image');
  if (/\bhelm chart\b|\bkubernetes\b/i.test(combinedText)) installMethods.push('Kubernetes/Helm');
  if (/\bnpm install\b|\byarn add\b|\bpip install\b|\bgo install\b/i.test(combinedText)) {
    installMethods.push('Manual/CLI');
  }

  return {
    dockerfilePresent,
    composePresent,
    readmeExcerpt,
    readmeFull: readmeFull || null,
    screenshotUrls,
    databases,
    envVars,
    ports,
    containerImage: containerImageMatch ? containerImageMatch[1] : null,
    arm64Supported: armMentioned ? true : composePresent || dockerfilePresent ? null : false,
    amd64Supported: amdMentioned ? true : composePresent || dockerfilePresent ? true : null,
    installMethods: [...new Set(installMethods)],
    documentationUrl: readmeFull ? extractDocLink(readmeFull) : null,
    demoUrl: readmeFull ? extractDemoLink(readmeFull) : null,
    latestReleaseTag: release?.tag_name ?? null,
    latestReleaseAt: release?.published_at ? new Date(release.published_at) : null,
    languages,
  };
}
