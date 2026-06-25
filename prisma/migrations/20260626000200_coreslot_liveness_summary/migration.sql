-- Phase 8c-2: liveness summaries aggregated from CoreSlotLivenessEvidence, per (slotId, windowKind).
CREATE TABLE "CoreSlotLivenessSummary" (
  "id" BIGSERIAL NOT NULL,
  "summaryKey" TEXT NOT NULL,
  "slotId" BIGINT NOT NULL,
  "windowKind" TEXT NOT NULL,
  "windowSize" INTEGER,
  "operatorAddress" TEXT,
  "consensusAddress" TEXT,
  "consensusWindowId" BIGINT,
  "firstCommittedHeight" BIGINT,
  "lastCommittedHeight" BIGINT,
  "spanHeightCount" BIGINT,
  "evidenceHeightCount" INTEGER NOT NULL,
  "expectedCount" INTEGER NOT NULL,
  "signedCount" INTEGER NOT NULL,
  "missedCount" INTEGER NOT NULL,
  "absentMissedCount" INTEGER NOT NULL,
  "nilMissedCount" INTEGER NOT NULL,
  "uptimeBps" INTEGER,
  "currentSignedStreak" INTEGER NOT NULL,
  "currentMissedStreak" INTEGER NOT NULL,
  "latestMissedHeight" BIGINT,
  "invalidHeightCount" INTEGER NOT NULL,
  "summaryStatus" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAtDb" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CoreSlotLivenessSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoreSlotLivenessSummary_summaryKey_key" ON "CoreSlotLivenessSummary"("summaryKey");
CREATE INDEX "CoreSlotLivenessSummary_slotId_idx" ON "CoreSlotLivenessSummary"("slotId");
CREATE INDEX "CoreSlotLivenessSummary_windowKind_idx" ON "CoreSlotLivenessSummary"("windowKind");
CREATE INDEX "CoreSlotLivenessSummary_operatorAddress_idx" ON "CoreSlotLivenessSummary"("operatorAddress");
CREATE INDEX "CoreSlotLivenessSummary_summaryStatus_idx" ON "CoreSlotLivenessSummary"("summaryStatus");
CREATE INDEX "CoreSlotLivenessSummary_slotId_windowKind_idx" ON "CoreSlotLivenessSummary"("slotId", "windowKind");
