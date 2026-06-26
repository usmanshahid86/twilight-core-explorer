-- Phase 9d-0: current observed account balance per address+denom (sampled live from x/bank).
CREATE TABLE "AccountBalanceCurrent" (
  "id" BIGSERIAL NOT NULL,
  "balanceKey" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "denom" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "sampledAtHeight" BIGINT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'sampled',
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AccountBalanceCurrent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountBalanceCurrent_balanceKey_key" ON "AccountBalanceCurrent"("balanceKey");
CREATE INDEX "AccountBalanceCurrent_address_idx" ON "AccountBalanceCurrent"("address");
CREATE INDEX "AccountBalanceCurrent_sampledAtHeight_idx" ON "AccountBalanceCurrent"("sampledAtHeight");
