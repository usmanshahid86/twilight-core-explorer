-- Phase 8c-2 prerequisite: record the exact committed height on a ProjectionFailure so summary
-- coverage checks can map height-level failures precisely (additive, nullable, reusable).
ALTER TABLE "ProjectionFailure" ADD COLUMN "committedHeight" BIGINT;
CREATE INDEX "ProjectionFailure_committedHeight_idx" ON "ProjectionFailure"("committedHeight");
