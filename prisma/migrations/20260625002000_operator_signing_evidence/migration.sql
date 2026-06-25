-- Phase 8b: derived commit-signature attribution to historical CoreSlot ownership.
CREATE TABLE "OperatorSigningEvidence" (
  "id" BIGSERIAL NOT NULL,
  "signatureKey" TEXT NOT NULL,
  "sourceBlockHeight" BIGINT NOT NULL,
  "committedBlockHeight" BIGINT NOT NULL,
  "signatureIndex" INTEGER NOT NULL,
  "validatorAddress" TEXT,
  "slotId" BIGINT,
  "operatorAddress" TEXT,
  "consensusPower" BIGINT,
  "consensusWindowId" BIGINT,
  "attributionStatus" TEXT NOT NULL,
  "blockIdFlag" TEXT,
  "blockIdFlagCode" INTEGER,
  "signed" BOOLEAN NOT NULL,
  "rawSignatureJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAtDb" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OperatorSigningEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperatorSigningEvidence_signatureKey_key" ON "OperatorSigningEvidence"("signatureKey");
CREATE INDEX "OperatorSigningEvidence_committedBlockHeight_idx" ON "OperatorSigningEvidence"("committedBlockHeight");
CREATE INDEX "OperatorSigningEvidence_sourceBlockHeight_idx" ON "OperatorSigningEvidence"("sourceBlockHeight");
CREATE INDEX "OperatorSigningEvidence_validatorAddress_idx" ON "OperatorSigningEvidence"("validatorAddress");
CREATE INDEX "OperatorSigningEvidence_slotId_idx" ON "OperatorSigningEvidence"("slotId");
CREATE INDEX "OperatorSigningEvidence_operatorAddress_idx" ON "OperatorSigningEvidence"("operatorAddress");
CREATE INDEX "OperatorSigningEvidence_attributionStatus_idx" ON "OperatorSigningEvidence"("attributionStatus");
