CREATE TABLE "RewardEpochProjection" (
  "id" BIGSERIAL NOT NULL,
  "epochNumber" BIGINT NOT NULL,
  "height" BIGINT NOT NULL,
  "blockTime" TIMESTAMP(3),
  "totalReward" TEXT,
  "denom" TEXT,
  "activeSlotCount" INTEGER,
  "sourceEventId" BIGINT,
  "rawEventJson" JSONB,
  "rawSnapshotJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAtDb" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RewardEpochProjection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RewardEpochProjection_epochNumber_key" ON "RewardEpochProjection"("epochNumber");
CREATE UNIQUE INDEX "RewardEpochProjection_sourceEventId_key" ON "RewardEpochProjection"("sourceEventId");
CREATE INDEX "RewardEpochProjection_height_idx" ON "RewardEpochProjection"("height");

CREATE TABLE "SlotRewardProjection" (
  "id" BIGSERIAL NOT NULL,
  "slotId" BIGINT NOT NULL,
  "epochNumber" BIGINT NOT NULL,
  "amount" TEXT NOT NULL,
  "denom" TEXT NOT NULL,
  "claimed" BOOLEAN NOT NULL DEFAULT false,
  "claimedAtHeight" BIGINT,
  "claimTxHash" TEXT,
  "claimMsgIndex" INTEGER,
  "claimEventId" BIGINT,
  "sampledAtHeight" BIGINT,
  "rawSnapshotJson" JSONB,
  "rawClaimJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAtDb" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SlotRewardProjection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SlotRewardProjection_slotId_epochNumber_key" ON "SlotRewardProjection"("slotId", "epochNumber");
CREATE INDEX "SlotRewardProjection_slotId_idx" ON "SlotRewardProjection"("slotId");
CREATE INDEX "SlotRewardProjection_epochNumber_idx" ON "SlotRewardProjection"("epochNumber");
CREATE INDEX "SlotRewardProjection_claimed_idx" ON "SlotRewardProjection"("claimed");
CREATE INDEX "SlotRewardProjection_claimTxHash_idx" ON "SlotRewardProjection"("claimTxHash");
CREATE INDEX "SlotRewardProjection_sampledAtHeight_idx" ON "SlotRewardProjection"("sampledAtHeight");

CREATE TABLE "RewardClaimEvent" (
  "id" BIGSERIAL NOT NULL,
  "slotId" BIGINT NOT NULL,
  "claimant" TEXT,
  "payoutAddress" TEXT,
  "startEpoch" BIGINT,
  "endEpoch" BIGINT,
  "amount" TEXT,
  "denom" TEXT,
  "height" BIGINT NOT NULL,
  "txHash" TEXT NOT NULL,
  "msgIndex" INTEGER,
  "sourceMessageId" BIGINT,
  "sourceEventId" BIGINT,
  "rawMessageJson" JSONB,
  "rawEventJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardClaimEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RewardClaimEvent_sourceEventId_key" ON "RewardClaimEvent"("sourceEventId");
CREATE INDEX "RewardClaimEvent_slotId_idx" ON "RewardClaimEvent"("slotId");
CREATE INDEX "RewardClaimEvent_height_idx" ON "RewardClaimEvent"("height");
CREATE INDEX "RewardClaimEvent_txHash_idx" ON "RewardClaimEvent"("txHash");
CREATE INDEX "RewardClaimEvent_claimant_idx" ON "RewardClaimEvent"("claimant");

CREATE TABLE "RewardsParamsChange" (
  "id" BIGSERIAL NOT NULL,
  "height" BIGINT NOT NULL,
  "txHash" TEXT,
  "msgIndex" INTEGER,
  "authority" TEXT,
  "changeType" TEXT NOT NULL,
  "paramsJson" JSONB,
  "sourceMessageId" BIGINT,
  "sourceEventId" BIGINT,
  "rawMessageJson" JSONB,
  "rawEventJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardsParamsChange_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RewardsParamsChange_sourceMessageId_key" ON "RewardsParamsChange"("sourceMessageId");
CREATE UNIQUE INDEX "RewardsParamsChange_sourceEventId_key" ON "RewardsParamsChange"("sourceEventId");
CREATE INDEX "RewardsParamsChange_height_idx" ON "RewardsParamsChange"("height");
CREATE INDEX "RewardsParamsChange_changeType_idx" ON "RewardsParamsChange"("changeType");
CREATE INDEX "RewardsParamsChange_authority_idx" ON "RewardsParamsChange"("authority");
CREATE INDEX "RewardsParamsChange_txHash_idx" ON "RewardsParamsChange"("txHash");

CREATE TABLE "RewardsTreasuryPayment" (
  "id" BIGSERIAL NOT NULL,
  "height" BIGINT NOT NULL,
  "recipient" TEXT,
  "denom" TEXT,
  "amount" TEXT,
  "purpose" TEXT,
  "sourceEventId" BIGINT,
  "rawEventJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardsTreasuryPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RewardsTreasuryPayment_sourceEventId_key" ON "RewardsTreasuryPayment"("sourceEventId");
CREATE INDEX "RewardsTreasuryPayment_height_idx" ON "RewardsTreasuryPayment"("height");
CREATE INDEX "RewardsTreasuryPayment_recipient_idx" ON "RewardsTreasuryPayment"("recipient");

CREATE TABLE "RewardsBalanceSample" (
  "id" BIGSERIAL NOT NULL,
  "height" BIGINT NOT NULL,
  "address" TEXT,
  "moduleName" TEXT,
  "denom" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "sampleKind" TEXT NOT NULL,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardsBalanceSample_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RewardsBalanceSample_height_sampleKind_address_moduleName_denom_key" ON "RewardsBalanceSample"("height", "sampleKind", "address", "moduleName", "denom");
CREATE INDEX "RewardsBalanceSample_height_idx" ON "RewardsBalanceSample"("height");
CREATE INDEX "RewardsBalanceSample_sampleKind_idx" ON "RewardsBalanceSample"("sampleKind");
