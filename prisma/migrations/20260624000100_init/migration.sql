CREATE TABLE "Block" (
  "height" BIGINT NOT NULL,
  "hash" TEXT,
  "time" TIMESTAMP(3),
  "chainId" TEXT,
  "proposerAddress" TEXT,
  "appHash" TEXT,
  "validatorsHash" TEXT,
  "nextValidatorsHash" TEXT,
  "lastBlockHash" TEXT,
  "txCount" INTEGER NOT NULL,
  "rawJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Block_pkey" PRIMARY KEY ("height")
);

CREATE TABLE "ExplorerTransaction" (
  "hash" TEXT NOT NULL,
  "height" BIGINT NOT NULL,
  "index" INTEGER NOT NULL,
  "code" INTEGER,
  "codespace" TEXT,
  "status" TEXT NOT NULL,
  "gasWanted" BIGINT,
  "gasUsed" BIGINT,
  "memo" TEXT,
  "feeJson" JSONB,
  "signerAddressesJson" JSONB NOT NULL,
  "messageTypesJson" JSONB NOT NULL,
  "rawTx" JSONB,
  "rawResultJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExplorerTransaction_pkey" PRIMARY KEY ("hash")
);

CREATE TABLE "Message" (
  "id" BIGSERIAL NOT NULL,
  "txHash" TEXT NOT NULL,
  "height" BIGINT NOT NULL,
  "msgIndex" INTEGER NOT NULL,
  "typeUrl" TEXT NOT NULL,
  "module" TEXT,
  "typeName" TEXT,
  "decodedJson" JSONB,
  "rawJson" JSONB,
  "decodeError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Event" (
  "id" BIGSERIAL NOT NULL,
  "eventKey" TEXT NOT NULL,
  "height" BIGINT NOT NULL,
  "txHash" TEXT,
  "txIndex" INTEGER,
  "msgIndex" INTEGER,
  "eventIndex" INTEGER NOT NULL,
  "phase" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "attributesJson" JSONB NOT NULL,
  "module" TEXT,
  "keyFieldsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Account" (
  "address" TEXT NOT NULL,
  "firstSeenHeight" BIGINT,
  "lastSeenHeight" BIGINT,
  "txCount" INTEGER NOT NULL DEFAULT 0,
  "accountKind" TEXT,
  "rawAccountJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("address")
);

CREATE TABLE "IndexerCursor" (
  "chainId" TEXT NOT NULL,
  "lastIndexedHeight" BIGINT NOT NULL,
  "lastIndexedHash" TEXT,
  "latestChainHeight" BIGINT,
  "status" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "error" TEXT,
  CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("chainId")
);

CREATE TABLE "DecodeFailure" (
  "id" BIGSERIAL NOT NULL,
  "height" BIGINT NOT NULL,
  "txHash" TEXT,
  "msgIndex" INTEGER,
  "eventIndex" INTEGER,
  "typeUrl" TEXT,
  "eventType" TEXT,
  "failureKind" TEXT NOT NULL,
  "rawJson" JSONB,
  "rawBase64" TEXT,
  "decodeError" TEXT NOT NULL,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecodeFailure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Block_hash_key" ON "Block"("hash");
CREATE INDEX "Block_time_idx" ON "Block"("time");
CREATE INDEX "Block_proposerAddress_idx" ON "Block"("proposerAddress");
CREATE INDEX "Block_chainId_height_idx" ON "Block"("chainId", "height");

CREATE INDEX "ExplorerTransaction_height_index_idx" ON "ExplorerTransaction"("height", "index");
CREATE INDEX "ExplorerTransaction_status_idx" ON "ExplorerTransaction"("status");
CREATE INDEX "ExplorerTransaction_createdAt_idx" ON "ExplorerTransaction"("createdAt");

CREATE UNIQUE INDEX "Message_txHash_msgIndex_key" ON "Message"("txHash", "msgIndex");
CREATE INDEX "Message_height_idx" ON "Message"("height");
CREATE INDEX "Message_typeUrl_idx" ON "Message"("typeUrl");
CREATE INDEX "Message_module_idx" ON "Message"("module");
CREATE INDEX "Message_decodeError_idx" ON "Message"("decodeError");

CREATE UNIQUE INDEX "Event_eventKey_key" ON "Event"("eventKey");
CREATE INDEX "Event_height_idx" ON "Event"("height");
CREATE INDEX "Event_txHash_idx" ON "Event"("txHash");
CREATE INDEX "Event_type_idx" ON "Event"("type");
CREATE INDEX "Event_module_idx" ON "Event"("module");

CREATE INDEX "Account_lastSeenHeight_idx" ON "Account"("lastSeenHeight");
CREATE INDEX "Account_accountKind_idx" ON "Account"("accountKind");

CREATE INDEX "IndexerCursor_updatedAt_idx" ON "IndexerCursor"("updatedAt");
CREATE INDEX "IndexerCursor_status_idx" ON "IndexerCursor"("status");

CREATE INDEX "DecodeFailure_height_idx" ON "DecodeFailure"("height");
CREATE INDEX "DecodeFailure_txHash_idx" ON "DecodeFailure"("txHash");
CREATE INDEX "DecodeFailure_typeUrl_idx" ON "DecodeFailure"("typeUrl");
CREATE INDEX "DecodeFailure_eventType_idx" ON "DecodeFailure"("eventType");
CREATE INDEX "DecodeFailure_failureKind_idx" ON "DecodeFailure"("failureKind");
CREATE INDEX "DecodeFailure_resolved_idx" ON "DecodeFailure"("resolved");
