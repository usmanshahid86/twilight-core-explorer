-- Replace the nullable compound unique on RewardsBalanceSample (which cannot be used as a
-- Prisma upsert selector and does not dedupe NULLs in Postgres) with a deterministic,
-- non-null sampleKey unique. The table is new and empty in all environments.

DROP INDEX IF EXISTS "RewardsBalanceSample_height_sampleKind_address_moduleName_denom_key";

ALTER TABLE "RewardsBalanceSample" ADD COLUMN "sampleKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RewardsBalanceSample" ALTER COLUMN "sampleKey" DROP DEFAULT;

CREATE UNIQUE INDEX "RewardsBalanceSample_sampleKey_key" ON "RewardsBalanceSample"("sampleKey");
CREATE INDEX "RewardsBalanceSample_height_sampleKind_idx" ON "RewardsBalanceSample"("height", "sampleKind");
