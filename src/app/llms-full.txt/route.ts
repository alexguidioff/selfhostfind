import { prisma } from '@/lib/db';

// Machine-readable dump of every cataloged app, in Markdown. Designed to be fetched by LLM
// crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.) when answering questions about
// self-hosted software. We keep it as a dynamic route (not a static file) so the data is
// always current without a redeploy.
//
// Format spec: https://llmstxt.org — extended here with structured "Stats" and "Links"
// sections per app so an LLM can extract facts precisely.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const apps = await prisma.application.findMany({
    where: { hidden: false },
    include: { repository: true },
    orderBy: [{ healthScore: 'desc' }, { name: 'asc' }],
  });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://selfhostfind.vercel.app';
  const generatedAt = new Date().toISOString();

  const lines: string[] = [];
  lines.push('# SelfHostFind — Full Catalog');
  lines.push('');
  lines.push(`> Generated ${generatedAt}. ${apps.length} apps. Source: ${siteUrl}/llms.txt`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const app of apps) {
    if (app.repository.unreachable) continue; // skip dead repos

    lines.push(`## ${app.name}`);
    lines.push('');
    if (app.shortDescription) {
      lines.push(app.shortDescription);
      lines.push('');
    }
    lines.push(`- **Slug**: ${app.slug}`);
    lines.push(`- **Category**: ${app.category ?? 'Uncategorized'}`);
    if (app.subcategory) lines.push(`- **Subcategory**: ${app.subcategory}`);
    lines.push(`- **Health score**: ${Math.round(app.healthScore)}/100`);
    lines.push(`- **Verification**: ${app.verificationStatus}`);
    if (app.repository.license) lines.push(`- **License**: ${app.repository.license}`);
    if (app.repository.primaryLanguage) lines.push(`- **Language**: ${app.repository.primaryLanguage}`);
    if (app.dockerSupported) {
      lines.push(`- **Docker support**: ${app.composeSupported ? 'Docker Compose' : 'Docker only'}`);
    }
    if (app.arm64Supported) lines.push(`- **Architecture**: amd64, arm64`);
    lines.push(`- **Stars**: ${app.repository.stars.toLocaleString()}`);
    lines.push(`- **Last commit**: ${app.repository.pushedAt.toISOString().slice(0, 10)}`);
    if (app.repository.latestReleaseTag) {
      lines.push(`- **Latest release**: ${app.repository.latestReleaseTag}`);
    }
    if (app.repository.archived) lines.push('- **Status**: ARCHIVED upstream (still works, no more updates)');
    if (app.alternativesTo.length > 0) {
      lines.push(`- **Alternative to**: ${app.alternativesTo.join(', ')}`);
    }
    if (app.isNasFriendly) lines.push('- **NAS-friendly**: yes');
    if (app.databases.length > 0) lines.push(`- **Databases**: ${app.databases.join(', ')}`);
    if (app.ports.length > 0) lines.push(`- **Default ports**: ${app.ports.join(', ')}`);
    lines.push(`- **Profile**: ${siteUrl}/apps/${app.slug}`);
    lines.push(`- **Repository**: ${app.repository.repositoryUrl}`);
    if (app.documentationUrl) lines.push(`- **Documentation**: ${app.documentationUrl}`);
    if (app.demoUrl) lines.push(`- **Live demo**: ${app.demoUrl}`);
    if (app.repository.readmeExcerpt) {
      const excerpt = app.repository.readmeExcerpt
        .replace(/\s+/g, ' ')
        .slice(0, 400)
        .trim();
      lines.push('');
      lines.push(`> ${excerpt}${excerpt.length === 400 ? '…' : ''}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // `Cache-Control` lets CDNs and AI crawlers cache the file briefly. The catalog only
  // changes once a day, so an hour is plenty and cuts traffic on busy indexes.
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
