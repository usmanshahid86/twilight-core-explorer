-- Phase 8c-1: per-(committed height, expected active CoreSlot) liveness evidence (signed + missed).
CREATE TABLE "CoreSlotLivenessEvidence" (
  "id" BIGSERIAL NOT NULL,
  "evidenceKey" TEXT NOT NULL,
  "committedBlockHeight" BIGINT NOT NULL,
  "sourceBlockHeight" BIGINT,
  "slotId" BIGINT NOT NULL,
  "operatorAddress" TEXT,
  "consensusAddress" TEXT,
  "consensusPower" BIGINT,
  "consensusWindowId" BIGINT,
  "status" TEXT NOT NULL,
  "missCause" TEXT,
  "observedSignatureKey" TEXT,
  "observedBlockIdFlag" TEXT,
  "observedBlockIdFlagCode" INTEGER,
  "observedSigned" BOOLEAN,
  "observedAttributionStatus" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAtDb" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CoreSlotLivenessEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoreSlotLivenessEvidence_evidenceKey_key" ON "CoreSlotLivenessEvidence"("evidenceKey");
CREATE INDEX "CoreSlotLivenessEvidence_committedBlockHeight_idx" ON "CoreSlotLivenessEvidence"("committedBlockHeight");
CREATE INDEX "CoreSlotLivenessEvidence_slotId_idx" ON "CoreSlotLivenessEvidence"("slotId");
CREATE INDEX "CoreSlotLivenessEvidence_operatorAddress_idx" ON "CoreSlotLivenessEvidence"("operatorAddress");
CREATE INDEX "CoreSlotLivenessEvidence_consensusAddress_idx" ON "CoreSlotLivenessEvidence"("consensusAddress");
CREATE INDEX "CoreSlotLivenessEvidence_status_idx" ON "CoreSlotLivenessEvidence"("status");
CREATE INDEX "CoreSlotLivenessEvidence_missCause_idx" ON "CoreSlotLivenessEvidence"("missCause");
