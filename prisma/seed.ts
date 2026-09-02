// Demo data for local development — lets you see the catalog UI (homepage sections,
// filters, detail page, admin panel) without running the real GitHub discovery pipeline.
// Run with `pnpm seed`. Safe to re-run: upserts by githubId/slug.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface DemoApp {
  githubId: number;
  owner: string;
  name: string;
  description: string;
  stars: number;
  forks: number;
  license: string;
  language: string;
  topics: string[];
  pushedDaysAgo: number;
  createdDaysAgo: number;
  latestReleaseDaysAgo: number | null;
  category: string;
  subcategory?: string;
  alternativesTo: string[];
  composeSupported: boolean;
  dockerSupported: boolean;
  arm64Supported: boolean | null;
  databases: string[];
  installMethods: string[];
  ports: number[];
  envVars: string[];
  healthScore: number;
  verificationStatus: 'UNVERIFIED' | 'AUTO_VERIFIED' | 'MANUALLY_VERIFIED';
  confidence: number;
}

const DAY = 1000 * 60 * 60 * 24;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

// NOTE: this is illustrative seed data for local development, modeled on the kind of
// project described in the product brief (a self-hosted Splitwise/Tricount alternative).
// It is not scraped from a real GitHub repository — replace with real discovered data by
// running `pnpm discover` against a live GitHub token.
const DEMO_APPS: DemoApp[] = [
  {
    githubId: 900001,
    owner: 'demo-org',
    name: 'balancia',
    description: 'Self-hosted, open-source expense splitting app. A privacy-friendly alternative to Splitwise and Tricount that you run on your own server.',
    stars: 340,
    forks: 28,
    license: 'AGPL-3.0',
    language: 'TypeScript',
    topics: ['self-hosted', 'expense-sharing', 'finance', 'docker'],
    pushedDaysAgo: 4,
    createdDaysAgo: 210,
    latestReleaseDaysAgo: 12,
    category: 'Finance',
    subcategory: 'Expense Sharing',
    alternativesTo: ['Splitwise', 'Tricount'],
    composeSupported: true,
    dockerSupported: true,
    arm64Supported: true,
    databases: ['PostgreSQL'],
    installMethods: ['Docker Compose'],
    ports: [3000],
    envVars: ['DATABASE_URL', 'JWT_SECRET', 'DEFAULT_CURRENCY'],
    healthScore: 82,
    verificationStatus: 'AUTO_VERIFIED',
    confidence: 0.91,
  },
  {
    githubId: 900002,
    owner: 'demo-org',
    name: 'photonest',
    description: 'High performance self-hosted photo and video backup solution, similar to Google Photos, with AI-powered search.',
    stars: 12500,
    forks: 610,
    license: 'AGPL-3.0',
    language: 'TypeScript',
    topics: ['self-hosted', 'photos', 'backup', 'docker-compose'],
    pushedDaysAgo: 1,
    createdDaysAgo: 900,
    latestReleaseDaysAgo: 6,
    category: 'Photos',
    alternativesTo: ['Google Photos'],
    composeSupported: true,
    dockerSupported: true,
    arm64Supported: true,
    databases: ['PostgreSQL'],
    installMethods: ['Docker Compose'],
    ports: [2283],
    envVars: ['DB_PASSWORD', 'UPLOAD_LOCATION'],
    healthScore: 91,
    verificationStatus: 'MANUALLY_VERIFIED',
    confidence: 0.97,
  },
  {
    githubId: 900003,
    owner: 'demo-org',
    name: 'notewell',
    description: 'Self-hosted markdown notes app with end-to-end encryption. A lightweight, single-binary alternative to Evernote and Notion.',
    stars: 890,
    forks: 54,
    license: 'MIT',
    language: 'Go',
    topics: ['self-hosted', 'notes', 'markdown'],
    pushedDaysAgo: 20,
    createdDaysAgo: 400,
    latestReleaseDaysAgo: 45,
    category: 'Notes',
    alternativesTo: ['Evernote', 'Notion'],
    composeSupported: true,
    dockerSupported: true,
    arm64Supported: true,
    databases: ['SQLite'],
    installMethods: ['Docker Compose', 'Manual/CLI'],
    ports: [8080],
    envVars: ['DATA_DIR'],
    healthScore: 76,
    verificationStatus: 'UNVERIFIED',
    confidence: 0.78,
  },
  {
    githubId: 900004,
    owner: 'demo-org',
    name: 'vaultkeep',
    description: 'Self-hosted password manager with browser extensions. Open source alternative to LastPass and 1Password.',
    stars: 5400,
    forks: 210,
    license: 'GPL-3.0',
    language: 'Rust',
    topics: ['self-hosted', 'security', 'passwords'],
    pushedDaysAgo: 2,
    createdDaysAgo: 1200,
    latestReleaseDaysAgo: 15,
    category: 'Passwords',
    alternativesTo: ['LastPass', '1Password'],
    composeSupported: true,
    dockerSupported: true,
    arm64Supported: true,
    databases: ['PostgreSQL', 'MySQL'],
    installMethods: ['Docker Compose'],
    ports: [8000],
    envVars: ['ADMIN_TOKEN', 'DATABASE_URL'],
    healthScore: 88,
    verificationStatus: 'MANUALLY_VERIFIED',
    confidence: 0.95,
  },
  {
    githubId: 900005,
    owner: 'demo-org',
    name: 'homeboard',
    description: 'A fast, self-hosted startpage/dashboard for your homelab services. Organize links, widgets and status checks in one place.',
    stars: 210,
    forks: 15,
    license: 'MIT',
    language: 'JavaScript',
    topics: ['self-hosted', 'dashboard', 'homelab'],
    pushedDaysAgo: 8,
    createdDaysAgo: 60,
    latestReleaseDaysAgo: null,
    category: 'Dashboard',
    alternativesTo: [],
    composeSupported: true,
    dockerSupported: true,
    arm64Supported: true,
    databases: [],
    installMethods: ['Docker Compose'],
    ports: [4000],
    envVars: [],
    healthScore: 68,
    verificationStatus: 'UNVERIFIED',
    confidence: 0.7,
  },
  {
    githubId: 900006,
    owner: 'demo-org',
    name: 'docflow',
    description: 'Self-hosted document management and archiving system with OCR, tagging and full-text search. Alternative to paper filing and commercial DMS tools.',
    stars: 3100,
    forks: 140,
    license: 'GPL-3.0',
    language: 'Python',
    topics: ['self-hosted', 'documents', 'ocr'],
    pushedDaysAgo: 3,
    createdDaysAgo: 800,
    latestReleaseDaysAgo: 30,
    category: 'Documents',
    alternativesTo: [],
    composeSupported: true,
    dockerSupported: true,
    arm64Supported: true,
    databases: ['PostgreSQL'],
    installMethods: ['Docker Compose'],
    ports: [8010],
    envVars: ['PAPERLESS_SECRET_KEY'],
    healthScore: 85,
    verificationStatus: 'AUTO_VERIFIED',
    confidence: 0.89,
  },
  {
    githubId: 900007,
    owner: 'demo-org',
    name: 'oldrelay',
    description: 'A self-hosted IRC-to-web bridge. No longer actively developed.',
    stars: 980,
    forks: 40,
    license: 'MIT',
    language: 'Python',
    topics: ['self-hosted', 'communication'],
    pushedDaysAgo: 540,
    createdDaysAgo: 2000,
    latestReleaseDaysAgo: 600,
    category: 'Communication',
    alternativesTo: [],
    composeSupported: false,
    dockerSupported: true,
    arm64Supported: null,
    databases: ['SQLite'],
    installMethods: ['Docker'],
    ports: [6667],
    envVars: [],
    healthScore: 34,
    verificationStatus: 'UNVERIFIED',
    confidence: 0.6,
  },
];

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function main() {
  for (const app of DEMO_APPS) {
    const repository = await prisma.repository.upsert({
      where: { githubId: BigInt(app.githubId) },
      create: {
        githubId: BigInt(app.githubId),
        owner: app.owner,
        name: app.name,
        fullName: `${app.owner}/${app.name}`,
        description: app.description,
        repositoryUrl: `https://github.com/${app.owner}/${app.name}`,
        homepageUrl: null,
        stars: app.stars,
        forks: app.forks,
        watchers: app.stars,
        openIssues: Math.round(app.forks / 3),
        license: app.license,
        primaryLanguage: app.language,
        topics: app.topics,
        readmeExcerpt: app.description,
        createdAt: daysAgo(app.createdDaysAgo),
        pushedAt: daysAgo(app.pushedDaysAgo),
        latestReleaseAt: app.latestReleaseDaysAgo != null ? daysAgo(app.latestReleaseDaysAgo) : null,
        latestReleaseTag: app.latestReleaseDaysAgo != null ? 'v1.0.0' : null,
        archived: false,
        fork: false,
        discoverySource: ['seed-data'],
        lastScannedAt: new Date(),
      },
      update: {
        stars: app.stars,
        forks: app.forks,
        pushedAt: daysAgo(app.pushedDaysAgo),
      },
    });

    await prisma.application.upsert({
      where: { repositoryId: repository.id },
      create: {
        repositoryId: repository.id,
        slug: slugify(app.name),
        name: app.name,
        shortDescription: app.description,
        category: app.category,
        subcategory: app.subcategory,
        alternativesTo: app.alternativesTo,
        isSelfHosted: true,
        isNasFriendly: true,
        dockerSupported: app.dockerSupported,
        composeSupported: app.composeSupported,
        arm64Supported: app.arm64Supported,
        amd64Supported: true,
        databases: app.databases,
        installMethods: app.installMethods,
        envVars: app.envVars,
        ports: app.ports,
        classificationConfidence: app.confidence,
        classificationSource: 'keyword-rules',
        verificationStatus: app.verificationStatus,
        healthScore: app.healthScore,
        activityScore: app.healthScore,
        documentationScore: app.healthScore,
        installEaseScore: app.composeSupported ? 100 : 60,
        nasCompatibilityScore: app.healthScore,
        dockerScore: app.composeSupported ? 100 : 60,
        popularityScore: Math.min(100, Math.log10(app.stars + 1) * 20),
        growthScore: 10,
        approved: app.verificationStatus !== 'UNVERIFIED',
        hidden: false,
      },
      update: {
        healthScore: app.healthScore,
      },
    });

    console.log(`seeded ${app.owner}/${app.name}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
