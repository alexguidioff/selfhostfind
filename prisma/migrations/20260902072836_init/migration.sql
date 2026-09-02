-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'AUTO_VERIFIED', 'MANUALLY_VERIFIED');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'github',
    "githubId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "description" TEXT,
    "repositoryUrl" TEXT NOT NULL,
    "homepageUrl" TEXT,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "forks" INTEGER NOT NULL DEFAULT 0,
    "watchers" INTEGER NOT NULL DEFAULT 0,
    "openIssues" INTEGER NOT NULL DEFAULT 0,
    "license" TEXT,
    "primaryLanguage" TEXT,
    "languages" JSONB,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "readmeExcerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "pushedAt" TIMESTAMP(3) NOT NULL,
    "latestReleaseAt" TIMESTAMP(3),
    "latestReleaseTag" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "fork" BOOLEAN NOT NULL DEFAULT false,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScannedAt" TIMESTAMP(3),
    "discoverySource" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAtRow" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAtRow" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT,
    "category" TEXT,
    "subcategory" TEXT,
    "alternativesTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSelfHosted" BOOLEAN NOT NULL DEFAULT false,
    "isNasFriendly" BOOLEAN NOT NULL DEFAULT false,
    "dockerSupported" BOOLEAN NOT NULL DEFAULT false,
    "composeSupported" BOOLEAN NOT NULL DEFAULT false,
    "arm64Supported" BOOLEAN,
    "amd64Supported" BOOLEAN,
    "databases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "installMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "envVars" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ports" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "containerImage" TEXT,
    "documentationUrl" TEXT,
    "demoUrl" TEXT,
    "logoUrl" TEXT,
    "screenshotUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "classificationConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "classificationSource" TEXT NOT NULL DEFAULT 'keyword-rules',
    "fieldSources" JSONB,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "healthScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "documentationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "installEaseScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nasCompatibilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dockerScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "popularityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "growthScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "classificationTrustScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "manualOverrides" JSONB,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "forks" INTEGER NOT NULL,
    "openIssues" INTEGER NOT NULL DEFAULT 0,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT,
    "githubFullName" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "stage" TEXT,
    "included" BOOLEAN,
    "reason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "extractedData" JSONB,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubId_key" ON "Repository"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_fullName_key" ON "Repository"("fullName");

-- CreateIndex
CREATE INDEX "Repository_stars_idx" ON "Repository"("stars");

-- CreateIndex
CREATE INDEX "Repository_pushedAt_idx" ON "Repository"("pushedAt");

-- CreateIndex
CREATE INDEX "Repository_archived_fork_idx" ON "Repository"("archived", "fork");

-- CreateIndex
CREATE UNIQUE INDEX "Application_repositoryId_key" ON "Application"("repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_slug_key" ON "Application"("slug");

-- CreateIndex
CREATE INDEX "Application_category_idx" ON "Application"("category");

-- CreateIndex
CREATE INDEX "Application_healthScore_idx" ON "Application"("healthScore");

-- CreateIndex
CREATE INDEX "Application_approved_hidden_idx" ON "Application"("approved", "hidden");

-- CreateIndex
CREATE INDEX "MetricSnapshot_repositoryId_recordedAt_idx" ON "MetricSnapshot"("repositoryId", "recordedAt");

-- CreateIndex
CREATE INDEX "Scan_githubFullName_idx" ON "Scan"("githubFullName");

-- CreateIndex
CREATE INDEX "Scan_status_idx" ON "Scan"("status");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
