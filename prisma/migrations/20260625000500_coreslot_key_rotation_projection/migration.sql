CREATE TABLE "CoreSlotConsensusKeyRotation" (
  "id" BIGSERIAL NOT NULL,
  "slotId" BIGINT NOT NULL,
  "operatorAddress" TEXT,
  "oldConsensusAddress" TEXT,
  "newConsensusAddress" TEXT,
  "status" TEXT NOT NULL,
  "requestedHeight" BIGINT,
  "effectiveHeight" BIGINT,
  "appliedHeight" BIGINT,
  "cancelledHeight" BIGINT,
  "power" BIGINT,
  "reason" TEXT,
  "sourceMessageId" BIGINT,
  "sourceRequestEventId" BIGINT,
  "sourceAppliedEventId" BIGINT,
  "sourceCancelledEventId" BIGINT,
  "requestTxHash" TEXT,
  "requestMsgIndex" INTEGER,
  "appliedTxHash" TEXT,
  "appliedMsgIndex" INTEGER,
  "cancelledTxHash" TEXT,
  "cancelledMsgIndex" INTEGER,
  "rawMessageJson" JSONB,
  "rawRequestEventJson" JSONB,
  "rawAppliedEventJson" JSONB,
  "rawCancelledEventJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAtDb" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoreSlotConsensusKeyRotation_pkey" PRIMARY KEY ("id")
);

-- Unique indexes on nullable source-event ids. In PostgreSQL multiple NULLs are
-- permitted, so these behave as partial uniques over non-null event ids and give
-- idempotent upserts keyed by the originating event.
CREATE UNIQUE INDEX "CoreSlotConsensusKeyRotation_sourceRequestEventId_key" ON "CoreSlotConsensusKeyRotation"("sourceRequestEventId");
CREATE UNIQUE INDEX "CoreSlotConsensusKeyRotation_sourceAppliedEventId_key" ON "CoreSlotConsensusKeyRotation"("sourceAppliedEventId");
CREATE UNIQUE INDEX "CoreSlotConsensusKeyRotation_sourceCancelledEventId_key" ON "CoreSlotConsensusKeyRotation"("sourceCancelledEventId");

CREATE INDEX "CoreSlotConsensusKeyRotation_slotId_idx" ON "CoreSlotConsensusKeyRotation"("slotId");
CREATE INDEX "CoreSlotConsensusKeyRotation_operatorAddress_idx" ON "CoreSlotConsensusKeyRotation"("operatorAddress");
CREATE INDEX "CoreSlotConsensusKeyRotation_oldConsensusAddress_idx" ON "CoreSlotConsensusKeyRotation"("oldConsensusAddress");
CREATE INDEX "CoreSlotConsensusKeyRotation_newConsensusAddress_idx" ON "CoreSlotConsensusKeyRotation"("newConsensusAddress");
CREATE INDEX "CoreSlotConsensusKeyRotation_status_idx" ON "CoreSlotConsensusKeyRotation"("status");
CREATE INDEX "CoreSlotConsensusKeyRotation_effectiveHeight_idx" ON "CoreSlotConsensusKeyRotation"("effectiveHeight");
CREATE INDEX "CoreSlotConsensusKeyRotation_requestedHeight_idx" ON "CoreSlotConsensusKeyRotation"("requestedHeight");
CREATE INDEX "CoreSlotConsensusKeyRotation_appliedHeight_idx" ON "CoreSlotConsensusKeyRotation"("appliedHeight");
CREATE INDEX "CoreSlotConsensusKeyRotation_cancelledHeight_idx" ON "CoreSlotConsensusKeyRotation"("cancelledHeight");
CREATE INDEX "CoreSlotConsensusKeyRotation_sourceMessageId_idx" ON "CoreSlotConsensusKeyRotation"("sourceMessageId");
