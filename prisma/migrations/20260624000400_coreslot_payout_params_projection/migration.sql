ALTER TABLE "ProjectionFailure" ADD COLUMN "failureKey" TEXT;

CREATE UNIQUE INDEX "ProjectionFailure_failureKey_key" ON "ProjectionFailure"("failureKey");

CREATE TABLE "CoreSlotPayoutChange" (
  "id" BIGSERIAL NOT NULL,
  "slotId" BIGINT NOT NULL,
  "operatorAddress" TEXT NOT NULL,
  "newPayoutAddress" TEXT NOT NULL,
  "height" BIGINT NOT NULL,
  "txHash" TEXT NOT NULL,
  "msgIndex" INTEGER NOT NULL,
  "sourceMessageId" BIGINT NOT NULL,
  "sourceEventId" BIGINT,
  "rawMessageJson" JSONB NOT NULL,
  "rawEventJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoreSlotPayoutChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoreSlotPayoutChange_sourceMessageId_key" ON "CoreSlotPayoutChange"("sourceMessageId");
CREATE INDEX "CoreSlotPayoutChange_slotId_height_idx" ON "CoreSlotPayoutChange"("slotId", "height");
CREATE INDEX "CoreSlotPayoutChange_operatorAddress_idx" ON "CoreSlotPayoutChange"("operatorAddress");
CREATE INDEX "CoreSlotPayoutChange_newPayoutAddress_idx" ON "CoreSlotPayoutChange"("newPayoutAddress");
CREATE INDEX "CoreSlotPayoutChange_txHash_idx" ON "CoreSlotPayoutChange"("txHash");
CREATE INDEX "CoreSlotPayoutChange_sourceEventId_idx" ON "CoreSlotPayoutChange"("sourceEventId");

CREATE TABLE "CoreSlotParameterChange" (
  "id" BIGSERIAL NOT NULL,
  "height" BIGINT NOT NULL,
  "txHash" TEXT NOT NULL,
  "msgIndex" INTEGER NOT NULL,
  "authority" TEXT NOT NULL,
  "paramsJson" JSONB NOT NULL,
  "sourceMessageId" BIGINT NOT NULL,
  "sourceEventId" BIGINT,
  "rawMessageJson" JSONB NOT NULL,
  "rawEventJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoreSlotParameterChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoreSlotParameterChange_sourceMessageId_key" ON "CoreSlotParameterChange"("sourceMessageId");
CREATE INDEX "CoreSlotParameterChange_height_idx" ON "CoreSlotParameterChange"("height");
CREATE INDEX "CoreSlotParameterChange_authority_idx" ON "CoreSlotParameterChange"("authority");
CREATE INDEX "CoreSlotParameterChange_txHash_idx" ON "CoreSlotParameterChange"("txHash");
CREATE INDEX "CoreSlotParameterChange_sourceEventId_idx" ON "CoreSlotParameterChange"("sourceEventId");
