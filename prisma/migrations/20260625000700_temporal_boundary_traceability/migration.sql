ALTER TABLE "CoreSlotConsensusWindow"
ADD COLUMN "validatorUpdateHeight" BIGINT;

CREATE INDEX "CoreSlotConsensusWindow_validatorUpdateHeight_idx"
ON "CoreSlotConsensusWindow"("validatorUpdateHeight");
