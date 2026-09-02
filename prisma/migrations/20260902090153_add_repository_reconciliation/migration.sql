-- AlterTable
ALTER TABLE "Repository" ADD COLUMN     "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "unreachable" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Repository_unreachable_idx" ON "Repository"("unreachable");
