-- Proposer attribution: join each block's proposerAddress to historical CoreSlot ownership.
CREATE TABLE "BlockProposerAttribution" (
  "id" BIGSERIAL NOT NULL,
  "attributionKey" TEXT NOT NULL,
  "height" BIGINT NOT NULL,
  "proposerAddress" TEXT,
  "rawProposerAddress" TEXT,
  "slotId" BIGINT,
  "operatorAddress" TEXT,
  "consensusWindowId" BIGINT,
  "attributionStatus" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAtDb" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BlockProposerAttribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlockProposerAttribution_attributionKey_key" ON "BlockProposerAttribution"("attributionKey");
CREATE INDEX "BlockProposerAttribution_height_idx" ON "BlockProposerAttribution"("height");
CREATE INDEX "BlockProposerAttribution_proposerAddress_idx" ON "BlockProposerAttribution"("proposerAddress");
CREATE INDEX "BlockProposerAttribution_slotId_idx" ON "BlockProposerAttribution"("slotId");
CREATE INDEX "BlockProposerAttribution_operatorAddress_idx" ON "BlockProposerAttribution"("operatorAddress");
CREATE INDEX "BlockProposerAttribution_attributionStatus_idx" ON "BlockProposerAttribution"("attributionStatus");
