-- Phase 8c-3: CoreSlot health labels + network halt-risk semantics derived from liveness summaries.
CREATE TABLE "CoreSlotHealthSnapshot" (
  "id" BIGSERIAL NOT NULL,
  "healthKey" TEXT NOT NULL,
  "slotId" BIGINT NOT NULL,
  "operatorAddress" TEXT,
  "consensusAddress" TEXT,
  "consensusWindowId" BIGINT,
  "primaryWindowKind" TEXT NOT NULL,
  "primarySummaryId" BIGINT,
  "lifetimeSummaryId" BIGINT,
  "recent500SummaryId" BIGINT,
  "recent1000SummaryId" BIGINT,
  "expectedCount" INTEGER NOT NULL,
  "signedCount" INTEGER NOT NULL,
  "missedCount" INTEGER NOT NULL,
  "absentMissedCount" INTEGER NOT NULL,
  "nilMissedCount" INTEGER NOT NULL,
  "uptimeBps" INTEGER,
  "currentSignedStreak" INTEGER NOT NULL,
  "currentMissedStreak" INTEGER NOT NULL,
  "latestMissedHeight" BIGINT,
  "summaryStatus" TEXT,
  "invalidHeightCount" INTEGER NOT NULL,
  "firstCommittedHeight" BIGINT,
  "lastCommittedHeight" BIGINT,
  "lifetimeUptimeBps" INTEGER,
  "recent500UptimeBps" INTEGER,
  "recent1000UptimeBps" INTEGER,
  "isActiveAtLatest" BOOLEAN NOT NULL,
  "healthStatus" TEXT NOT NULL,
  "healthReason" TEXT,
  "policyVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAtDb" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CoreSlotHealthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoreSlotHealthSnapshot_healthKey_key" ON "CoreSlotHealthSnapshot"("healthKey");
CREATE INDEX "CoreSlotHealthSnapshot_slotId_idx" ON "CoreSlotHealthSnapshot"("slotId");
CREATE INDEX "CoreSlotHealthSnapshot_healthStatus_idx" ON "CoreSlotHealthSnapshot"("healthStatus");
CREATE INDEX "CoreSlotHealthSnapshot_isActiveAtLatest_idx" ON "CoreSlotHealthSnapshot"("isActiveAtLatest");
CREATE INDEX "CoreSlotHealthSnapshot_operatorAddress_idx" ON "CoreSlotHealthSnapshot"("operatorAddress");

CREATE TABLE "NetworkLivenessRiskSnapshot" (
  "id" BIGSERIAL NOT NULL,
  "riskKey" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "latestCommittedHeight" BIGINT,
  "activeSlotCount" INTEGER NOT NULL,
  "healthySlotCount" INTEGER NOT NULL,
  "degradedSlotCount" INTEGER NOT NULL,
  "downSlotCount" INTEGER NOT NULL,
  "incompleteSlotCount" INTEGER NOT NULL,
  "unknownSlotCount" INTEGER NOT NULL,
  "availableSlotCount" INTEGER NOT NULL,
  "unavailableSlotCount" INTEGER NOT NULL,
  "availablePowerBps" INTEGER,
  "unavailablePowerBps" INTEGER,
  "haltRiskLevel" TEXT NOT NULL,
  "haltRiskReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAtDb" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NetworkLivenessRiskSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NetworkLivenessRiskSnapshot_riskKey_key" ON "NetworkLivenessRiskSnapshot"("riskKey");
CREATE INDEX "NetworkLivenessRiskSnapshot_haltRiskLevel_idx" ON "NetworkLivenessRiskSnapshot"("haltRiskLevel");
