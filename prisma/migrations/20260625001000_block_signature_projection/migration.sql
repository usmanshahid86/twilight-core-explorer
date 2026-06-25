CREATE TABLE "BlockSignature" (
    "id" BIGSERIAL NOT NULL,
    "signatureKey" TEXT NOT NULL,
    "sourceBlockHeight" BIGINT NOT NULL,
    "committedBlockHeight" BIGINT NOT NULL,
    "signatureIndex" INTEGER NOT NULL,
    "validatorAddress" TEXT,
    "blockIdFlag" TEXT,
    "blockIdFlagCode" INTEGER,
    "timestamp" TIMESTAMP(3),
    "signature" TEXT,
    "signed" BOOLEAN NOT NULL,
    "rawSignatureJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAtDb" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockSignature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlockSignature_signatureKey_key" ON "BlockSignature"("signatureKey");
CREATE INDEX "BlockSignature_sourceBlockHeight_idx" ON "BlockSignature"("sourceBlockHeight");
CREATE INDEX "BlockSignature_committedBlockHeight_idx" ON "BlockSignature"("committedBlockHeight");
CREATE INDEX "BlockSignature_validatorAddress_idx" ON "BlockSignature"("validatorAddress");
CREATE INDEX "BlockSignature_signed_idx" ON "BlockSignature"("signed");
CREATE INDEX "BlockSignature_blockIdFlagCode_idx" ON "BlockSignature"("blockIdFlagCode");
