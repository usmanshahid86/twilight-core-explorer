CREATE TABLE "ProjectionCursor" (
  "projectionName" TEXT NOT NULL,
  "chainId" TEXT NOT NULL,
  "lastProjectedHeight" BIGINT NOT NULL,
  "status" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "error" TEXT,
  CONSTRAINT "ProjectionCursor_pkey" PRIMARY KEY ("projectionName", "chainId")
);

CREATE TABLE "ProjectionFailure" (
  "id" BIGSERIAL NOT NULL,
  "projectionName" TEXT NOT NULL,
  "module" TEXT,
  "sourceHeight" BIGINT NOT NULL,
  "sourceTxHash" TEXT,
  "sourceMsgIndex" INTEGER,
  "sourceMessageId" BIGINT,
  "sourceEventId" BIGINT,
  "typeUrl" TEXT,
  "eventType" TEXT,
  "failureKind" TEXT NOT NULL,
  "rawMessageJson" JSONB,
  "rawEventJson" JSONB,
  "error" TEXT NOT NULL,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectionFailure_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoreSlotProjection" (
  "slotId" BIGINT NOT NULL,
  "status" TEXT,
  "operatorAddress" TEXT,
  "payoutAddress" TEXT,
  "consensusAddress" TEXT,
  "consensusPubkeyJson" JSONB,
  "metadataJson" JSONB,
  "rewardWeight" TEXT,
  "consensusPower" BIGINT,
  "createdHeight" BIGINT,
  "updatedHeight" BIGINT NOT NULL,
  "removedHeight" BIGINT,
  "rawSnapshotJson" JSONB,
  "lastSourceHeight" BIGINT NOT NULL,
  "lastSourceTxHash" TEXT,
  "lastSourceMsgIndex" INTEGER,
  "lastSourceMessageId" BIGINT,
  "lastSourceEventId" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAtDb" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoreSlotProjection_pkey" PRIMARY KEY ("slotId")
);

CREATE TABLE "CoreSlotMetadataChange" (
  "id" BIGSERIAL NOT NULL,
  "slotId" BIGINT NOT NULL,
  "operatorAddress" TEXT NOT NULL,
  "height" BIGINT NOT NULL,
  "txHash" TEXT NOT NULL,
  "msgIndex" INTEGER NOT NULL,
  "metadataJson" JSONB NOT NULL,
  "sourceMessageId" BIGINT NOT NULL,
  "sourceEventId" BIGINT,
  "rawMessageJson" JSONB NOT NULL,
  "rawEventJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoreSlotMetadataChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectionCursor_status_idx" ON "ProjectionCursor"("status");
CREATE INDEX "ProjectionCursor_updatedAt_idx" ON "ProjectionCursor"("updatedAt");

CREATE INDEX "ProjectionFailure_projectionName_idx" ON "ProjectionFailure"("projectionName");
CREATE INDEX "ProjectionFailure_module_idx" ON "ProjectionFailure"("module");
CREATE INDEX "ProjectionFailure_sourceHeight_idx" ON "ProjectionFailure"("sourceHeight");
CREATE INDEX "ProjectionFailure_sourceTxHash_idx" ON "ProjectionFailure"("sourceTxHash");
CREATE INDEX "ProjectionFailure_failureKind_idx" ON "ProjectionFailure"("failureKind");
CREATE INDEX "ProjectionFailure_resolved_idx" ON "ProjectionFailure"("resolved");

CREATE INDEX "CoreSlotProjection_status_idx" ON "CoreSlotProjection"("status");
CREATE INDEX "CoreSlotProjection_operatorAddress_idx" ON "CoreSlotProjection"("operatorAddress");
CREATE INDEX "CoreSlotProjection_consensusAddress_idx" ON "CoreSlotProjection"("consensusAddress");
CREATE INDEX "CoreSlotProjection_updatedHeight_idx" ON "CoreSlotProjection"("updatedHeight");

CREATE UNIQUE INDEX "CoreSlotMetadataChange_sourceMessageId_key" ON "CoreSlotMetadataChange"("sourceMessageId");
CREATE INDEX "CoreSlotMetadataChange_slotId_height_idx" ON "CoreSlotMetadataChange"("slotId", "height");
CREATE INDEX "CoreSlotMetadataChange_operatorAddress_idx" ON "CoreSlotMetadataChange"("operatorAddress");
CREATE INDEX "CoreSlotMetadataChange_txHash_idx" ON "CoreSlotMetadataChange"("txHash");
CREATE INDEX "CoreSlotMetadataChange_sourceEventId_idx" ON "CoreSlotMetadataChange"("sourceEventId");
