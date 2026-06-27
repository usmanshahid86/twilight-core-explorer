-- Phase 7.2: promote two validated emission fields from the live rewards fixture's
-- epoch_finalized event onto RewardEpochProjection as first-class columns. Additive,
-- nullable; existing rows are unaffected and re-projectable from preserved rawEventJson.
-- carryOut / rewardPool intentionally stay in raw until a fixture exercises carry_out != 0
-- (see docs/research/phase-7.2-rewards-fixture-findings.md, decision D2).
ALTER TABLE "RewardEpochProjection" ADD COLUMN "cumulativeEmitted" TEXT;
ALTER TABLE "RewardEpochProjection" ADD COLUMN "distributionMethod" TEXT;
