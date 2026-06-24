CREATE TABLE "CoreSlotConsensusWindow" (
  "id" BIGSERIAL NOT NULL,
  "slotId" BIGINT NOT NULL,
  "operatorAddress" TEXT,
  "consensusAddress" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "consensusPower" BIGINT,
  "effectiveFromHeight" BIGINT NOT NULL,
  "effectiveToHeight" BIGINT,
  "openedByKind" TEXT NOT NULL,
  "openedByEventId" BIGINT,
  "openedByRotationId" BIGINT,
  "openedByLifecycleId" BIGINT,
  "closedByKind" TEXT,
  "closedByEventId" BIGINT,
  "closedByRotationId" BIGINT,
  "closedByLifecycleId" BIGINT,
  "rawOpenJson" JSONB,
  "rawCloseJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAtDb" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoreSlotConsensusWindow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CoreSlotConsensusWindow_slotId_idx" ON "CoreSlotConsensusWindow"("slotId");
CREATE INDEX "CoreSlotConsensusWindow_operatorAddress_idx" ON "CoreSlotConsensusWindow"("operatorAddress");
CREATE INDEX "CoreSlotConsensusWindow_consensusAddress_idx" ON "CoreSlotConsensusWindow"("consensusAddress");
CREATE INDEX "CoreSlotConsensusWindow_effectiveFromHeight_idx" ON "CoreSlotConsensusWindow"("effectiveFromHeight");
CREATE INDEX "CoreSlotConsensusWindow_effectiveToHeight_idx" ON "CoreSlotConsensusWindow"("effectiveToHeight");
CREATE INDEX "CoreSlotConsensusWindow_status_idx" ON "CoreSlotConsensusWindow"("status");
CREATE INDEX "CoreSlotConsensusWindow_slotId_effectiveFromHeight_idx" ON "CoreSlotConsensusWindow"("slotId", "effectiveFromHeight");
CREATE INDEX "CoreSlotConsensusWindow_consensusAddress_effectiveFromHeight_idx" ON "CoreSlotConsensusWindow"("consensusAddress", "effectiveFromHeight");
