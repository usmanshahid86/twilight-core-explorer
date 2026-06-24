CREATE TABLE "CoreSlotLifecycleEvent" (
  "id" BIGSERIAL NOT NULL,
  "sourceEventId" BIGINT NOT NULL,
  "sourceMessageId" BIGINT,
  "height" BIGINT NOT NULL,
  "txHash" TEXT,
  "msgIndex" INTEGER,
  "slotId" BIGINT,
  "eventType" TEXT NOT NULL,
  "oldStatus" TEXT,
  "newStatus" TEXT,
  "operatorAddress" TEXT,
  "consensusAddress" TEXT,
  "power" BIGINT,
  "reason" TEXT,
  "evidenceReference" TEXT,
  "authority" TEXT,
  "rawEventJson" JSONB NOT NULL,
  "rawMessageJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoreSlotLifecycleEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoreSlotLifecycleEvent_sourceEventId_key" ON "CoreSlotLifecycleEvent"("sourceEventId");
CREATE INDEX "CoreSlotLifecycleEvent_slotId_height_idx" ON "CoreSlotLifecycleEvent"("slotId", "height");
CREATE INDEX "CoreSlotLifecycleEvent_eventType_idx" ON "CoreSlotLifecycleEvent"("eventType");
CREATE INDEX "CoreSlotLifecycleEvent_operatorAddress_idx" ON "CoreSlotLifecycleEvent"("operatorAddress");
CREATE INDEX "CoreSlotLifecycleEvent_consensusAddress_idx" ON "CoreSlotLifecycleEvent"("consensusAddress");
CREATE INDEX "CoreSlotLifecycleEvent_txHash_idx" ON "CoreSlotLifecycleEvent"("txHash");
