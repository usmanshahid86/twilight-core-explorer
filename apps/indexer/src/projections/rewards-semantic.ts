import {
  haltProjectionCursorError,
  updateProjectionCursorSuccess,
  type ProjectionCursorPrisma,
} from './cursor.js';
import {
  EPOCH_FINALIZED_EVENT_TYPE,
  PARAMS_ACTIVATED_EVENT_TYPE,
  PARAMS_UPDATE_QUEUED_EVENT_TYPE,
  REWARD_CLAIMED_EVENT_TYPE,
  REWARDS_CLAIM_TYPE_URL,
  REWARDS_EVENT_TYPES,
  REWARDS_MESSAGE_TYPE_URLS,
  REWARDS_PAUSE_TYPE_URL,
  REWARDS_PAUSED_EVENT_TYPE,
  REWARDS_PARAMS_CHANGE_TYPE,
  REWARDS_NATIVE_DENOM,
  REWARDS_RESUME_TYPE_URL,
  REWARDS_RESUMED_EVENT_TYPE,
  REWARDS_SEMANTIC_PROJECTION,
  REWARDS_UPDATE_PARAMS_TYPE_URL,
  TREASURY_PAID_EVENT_TYPE,
  type ProjectionFailureInput,
  type ProjectionFailureKind,
  withProjectionFailureKey,
} from './types.js';

export interface ProjectRewardsSemanticRangeArgs {
  prisma: RewardsSemanticProjectionPrisma;
  chainId: string;
  startHeight: bigint;
  endHeight: bigint;
}

export interface ProjectRewardsSemanticHeightArgs {
  prisma: RewardsSemanticProjectionPrisma;
  chainId: string;
  height: bigint;
}

export interface ProjectRewardsSemanticResult {
  height: bigint;
  rowsWritten: number;
  failuresCreated: number;
}

export interface RewardsSemanticProjectionPrisma extends ProjectionCursorPrisma {
  explorerTransaction: { findMany(args: unknown): Promise<TransactionSource[]> };
  message: { findMany(args: unknown): Promise<MessageSource[]> };
  event: { findMany(args: unknown): Promise<EventSource[]> };
  rewardEpochProjection: { upsert(args: unknown): Promise<unknown> };
  rewardClaimEvent: { upsert(args: unknown): Promise<unknown> };
  slotRewardProjection: {
    findMany(args: unknown): Promise<SlotRewardSource[]>;
    update(args: unknown): Promise<unknown>;
  };
  rewardsParamsChange: { upsert(args: unknown): Promise<unknown> };
  rewardsTreasuryPayment: { upsert(args: unknown): Promise<unknown> };
  projectionFailure: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: RewardsSemanticProjectionPrisma) => Promise<T>): Promise<T>;
}

interface TransactionSource {
  hash: string;
  height: bigint;
  code: number | null;
  status: string;
}

interface MessageSource {
  id: bigint;
  txHash: string;
  height: bigint;
  msgIndex: number;
  typeUrl: string;
  module: string | null;
  decodedJson: unknown | null;
  rawJson: unknown | null;
}

interface EventSource {
  id: bigint;
  height: bigint;
  txHash: string | null;
  msgIndex: number | null;
  type: string;
  attributesJson: unknown;
}

interface SlotRewardSource {
  id: bigint;
  slotId: bigint;
  epochNumber: bigint;
}

interface Counters {
  rowsWritten: number;
  failuresCreated: number;
}

export async function projectRewardsSemanticRange(
  args: ProjectRewardsSemanticRangeArgs,
): Promise<ProjectRewardsSemanticResult[]> {
  const results: ProjectRewardsSemanticResult[] = [];
  for (let height = args.startHeight; height <= args.endHeight; height += 1n) {
    results.push(await projectRewardsSemanticHeight({
      prisma: args.prisma,
      chainId: args.chainId,
      height,
    }));
  }
  return results;
}

export async function projectRewardsSemanticHeight(
  args: ProjectRewardsSemanticHeightArgs,
): Promise<ProjectRewardsSemanticResult> {
  const { prisma, chainId, height } = args;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.projectionFailure.deleteMany({
        where: {
          projectionName: REWARDS_SEMANTIC_PROJECTION,
          sourceHeight: height,
          resolved: false,
        },
      });

      const transactions = await tx.explorerTransaction.findMany({
        where: { height, OR: [{ status: 'success' }, { code: 0 }] },
        select: { hash: true, height: true, code: true, status: true },
      });
      const successfulTxHashes = new Set(transactions.map((t) => t.hash));

      const messages = successfulTxHashes.size === 0
        ? []
        : await tx.message.findMany({
            where: {
              height,
              txHash: { in: [...successfulTxHashes] },
              module: 'rewards',
              typeUrl: { in: [...REWARDS_MESSAGE_TYPE_URLS] },
            },
            orderBy: [{ txHash: 'asc' }, { msgIndex: 'asc' }],
          });

      // Rewards events are not all tx-bound: epoch_finalized, params_activated and
      // treasury_paid are EndBlock/finalize events with no txHash (ingestable since 6b-4).
      const events = await tx.event.findMany({
        where: { height, type: { in: [...REWARDS_EVENT_TYPES] } },
        orderBy: [{ id: 'asc' }],
      });
      const byType = (type: string) => events.filter((e) => e.type === type);
      const messagesByUrl = (url: string) => messages.filter((m) => m.typeUrl === url);

      const counters: Counters = { rowsWritten: 0, failuresCreated: 0 };

      // Deterministic per-height order: epochs -> params/pause/resume -> claims -> treasury.
      for (const event of byType(EPOCH_FINALIZED_EVENT_TYPE)) {
        if (isFailedTxBound(event, successfulTxHashes)) continue;
        await projectEpochFinalized(tx, event, counters);
      }

      await projectParams(tx, {
        updateMessages: messagesByUrl(REWARDS_UPDATE_PARAMS_TYPE_URL),
        pauseMessages: messagesByUrl(REWARDS_PAUSE_TYPE_URL),
        resumeMessages: messagesByUrl(REWARDS_RESUME_TYPE_URL),
        queuedEvents: byType(PARAMS_UPDATE_QUEUED_EVENT_TYPE),
        activatedEvents: byType(PARAMS_ACTIVATED_EVENT_TYPE),
        pausedEvents: byType(REWARDS_PAUSED_EVENT_TYPE),
        resumedEvents: byType(REWARDS_RESUMED_EVENT_TYPE),
        successfulTxHashes,
        counters,
      });

      await projectClaims(tx, {
        claimMessages: messagesByUrl(REWARDS_CLAIM_TYPE_URL),
        claimedEvents: byType(REWARD_CLAIMED_EVENT_TYPE),
        successfulTxHashes,
        counters,
      });

      for (const event of byType(TREASURY_PAID_EVENT_TYPE)) {
        if (isFailedTxBound(event, successfulTxHashes)) continue;
        await projectTreasuryPaid(tx, event, counters);
      }

      // Forward-compat guardrail: tolerate unknown future rewards events. Record them as
      // unknown_semantic_type without crashing; known types above are unaffected.
      const unknownEvents = await tx.event.findMany({
        where: { height, module: 'rewards', NOT: { type: { in: [...REWARDS_EVENT_TYPES] } } },
        orderBy: [{ id: 'asc' }],
      });
      for (const event of unknownEvents) {
        if (isFailedTxBound(event, successfulTxHashes)) continue;
        await createFailure(tx, {
          sourceHeight: event.height,
          sourceEventId: event.id,
          eventType: event.type,
          failureKind: 'unknown_semantic_type',
          rawEventJson: buildRawEventJson(event),
          error: `Unsupported rewards event type for semantic projection: ${event.type}`,
        });
        counters.failuresCreated += 1;
      }

      await updateProjectionCursorSuccess(tx, REWARDS_SEMANTIC_PROJECTION, chainId, height);
      return { height, rowsWritten: counters.rowsWritten, failuresCreated: counters.failuresCreated };
    });
  } catch (error) {
    await haltProjectionCursorError(prisma, REWARDS_SEMANTIC_PROJECTION, chainId, height, error);
    throw error;
  }
}

// --- epoch finalization ----------------------------------------------------

async function projectEpochFinalized(
  tx: RewardsSemanticProjectionPrisma,
  event: EventSource,
  counters: Counters,
): Promise<void> {
  const attrs = attributesToRecord(event.attributesJson);
  const epochRaw = readString(attrs.epoch_number) ?? readString(attrs.epoch);
  const epochNumber = parseBigInt(epochRaw);
  if (epochNumber === undefined) {
    await createFailure(tx, {
      sourceHeight: event.height,
      sourceEventId: event.id,
      eventType: event.type,
      failureKind: 'invalid_epoch',
      rawEventJson: buildRawEventJson(event),
      error: `epoch_finalized event has invalid epoch_number: ${epochRaw ?? 'missing'}`,
    });
    counters.failuresCreated += 1;
    return;
  }

  // Live nyks-core epoch_finalized emits `allocated` (rewards distributed this epoch),
  // `eligible_slots`, `cumulative_emitted`, `distribution_method` — NOT total_reward/
  // active_slot_count (the originally-assumed keys, kept as defensive fallbacks). denom is
  // not emitted; rewards are utwlt by chain convention (REWARDS_NATIVE_DENOM). carry_out /
  // reward_pool stay in preserved raw until a fixture exercises carry_out != 0. See
  // docs/research/phase-7.2-rewards-fixture-findings.md.
  const totalReward =
    readString(attrs.allocated) ?? readString(attrs.total_reward) ?? readString(attrs.amount) ?? null;
  const denom = readString(attrs.denom) ?? REWARDS_NATIVE_DENOM;
  const activeSlotCount = parseInt32(
    readString(attrs.eligible_slots) ?? readString(attrs.active_slot_count),
  );
  const cumulativeEmitted = readString(attrs.cumulative_emitted) ?? null;
  const distributionMethod = readString(attrs.distribution_method) ?? null;

  const data = {
    epochNumber,
    height: event.height,
    totalReward,
    denom,
    activeSlotCount,
    cumulativeEmitted,
    distributionMethod,
    sourceEventId: event.id,
    rawEventJson: buildRawEventJson(event),
  };
  await tx.rewardEpochProjection.upsert({
    where: { epochNumber },
    create: data,
    update: {
      height: event.height,
      totalReward,
      denom,
      activeSlotCount,
      cumulativeEmitted,
      distributionMethod,
      sourceEventId: event.id,
      rawEventJson: buildRawEventJson(event),
    },
  });
  counters.rowsWritten += 1;
}

// --- params / pause / resume ----------------------------------------------

async function projectParams(
  tx: RewardsSemanticProjectionPrisma,
  args: {
    updateMessages: MessageSource[];
    pauseMessages: MessageSource[];
    resumeMessages: MessageSource[];
    queuedEvents: EventSource[];
    activatedEvents: EventSource[];
    pausedEvents: EventSource[];
    resumedEvents: EventSource[];
    successfulTxHashes: Set<string>;
    counters: Counters;
  },
): Promise<void> {
  const { counters } = args;
  const usedQueued = new Set<string>();
  const usedActivated = new Set<string>();
  const usedPaused = new Set<string>();
  const usedResumed = new Set<string>();

  // MsgUpdateRewardsParams -> queued (tx) or immediate activated (same tx).
  for (const message of args.updateMessages) {
    const decoded = asRecord(message.decodedJson);
    const authority = readString(decoded.authority) ?? null;
    const paramsJson = decoded.params ?? null;

    const queued = args.queuedEvents.find((e) => txEventMatches(e, message));
    if (queued) {
      await upsertParamsChange(tx, {
        changeType: REWARDS_PARAMS_CHANGE_TYPE.queued,
        message,
        event: queued,
        authority,
        paramsJson,
      });
      usedQueued.add(queued.id.toString());
      counters.rowsWritten += 1;
      continue;
    }
    const activated = args.activatedEvents.find((e) => txEventMatches(e, message));
    if (activated) {
      await upsertParamsChange(tx, {
        changeType: REWARDS_PARAMS_CHANGE_TYPE.activated,
        message,
        event: activated,
        authority,
        paramsJson,
      });
      usedActivated.add(activated.id.toString());
      counters.rowsWritten += 1;
      continue;
    }
    // Successful MsgUpdateRewardsParams with no params_update_queued/params_activated event.
    // A successful authority-gated params tx is itself the confirmation (there is no amount to
    // fabricate, the payload is in the message), so it is recorded as `direct_update` applied
    // at tx height. The `missing_event` failure below is a soft drift/decoder signal that the
    // expected confirming event was not seen — not a reason to drop the change.
    await upsertParamsChange(tx, {
      changeType: REWARDS_PARAMS_CHANGE_TYPE.directUpdate,
      message,
      event: null,
      authority,
      paramsJson,
    });
    await createFailure(tx, {
      sourceHeight: message.height,
      sourceMessageId: message.id,
      typeUrl: message.typeUrl,
      failureKind: 'missing_event',
      rawMessageJson: buildRawMessageJson(message),
      error: 'MsgUpdateRewardsParams had no params_update_queued/params_activated event.',
    });
    counters.rowsWritten += 1;
    counters.failuresCreated += 1;
  }

  // params_activated is normally an EndBlock event with no message.
  for (const event of args.activatedEvents) {
    if (usedActivated.has(event.id.toString())) continue;
    if (isFailedTxBound(event, args.successfulTxHashes)) continue;
    const attrs = attributesToRecord(event.attributesJson);
    await upsertParamsChange(tx, {
      changeType: REWARDS_PARAMS_CHANGE_TYPE.activated,
      message: null,
      event,
      authority: readString(attrs.authority) ?? null,
      paramsJson: readJson(attrs.params),
    });
    counters.rowsWritten += 1;
  }

  // Queued events with no message (decode gap) — still record as drift.
  for (const event of args.queuedEvents) {
    if (usedQueued.has(event.id.toString())) continue;
    if (isFailedTxBound(event, args.successfulTxHashes)) continue;
    const attrs = attributesToRecord(event.attributesJson);
    await upsertParamsChange(tx, {
      changeType: REWARDS_PARAMS_CHANGE_TYPE.queued,
      message: null,
      event,
      authority: readString(attrs.authority) ?? null,
      paramsJson: readJson(attrs.params),
    });
    await createFailure(tx, {
      sourceHeight: event.height,
      sourceEventId: event.id,
      eventType: event.type,
      failureKind: 'missing_message',
      rawEventJson: buildRawEventJson(event),
      error: 'params_update_queued event had no matching MsgUpdateRewardsParams.',
    });
    counters.rowsWritten += 1;
    counters.failuresCreated += 1;
  }

  await projectStateToggle(tx, {
    messages: args.pauseMessages,
    events: args.pausedEvents,
    used: usedPaused,
    changeType: REWARDS_PARAMS_CHANGE_TYPE.pause,
    successfulTxHashes: args.successfulTxHashes,
    counters,
  });
  await projectStateToggle(tx, {
    messages: args.resumeMessages,
    events: args.resumedEvents,
    used: usedResumed,
    changeType: REWARDS_PARAMS_CHANGE_TYPE.resume,
    successfulTxHashes: args.successfulTxHashes,
    counters,
  });
}

async function projectStateToggle(
  tx: RewardsSemanticProjectionPrisma,
  args: {
    messages: MessageSource[];
    events: EventSource[];
    used: Set<string>;
    changeType: string;
    successfulTxHashes: Set<string>;
    counters: Counters;
  },
): Promise<void> {
  const { counters } = args;
  for (const message of args.messages) {
    const decoded = asRecord(message.decodedJson);
    const event = args.events.find((e) => txEventMatches(e, message));
    if (event) {
      await upsertParamsChange(tx, {
        changeType: args.changeType,
        message,
        event,
        authority: readString(decoded.authority) ?? null,
        paramsJson: null,
      });
      args.used.add(event.id.toString());
      counters.rowsWritten += 1;
      continue;
    }
    await upsertParamsChange(tx, {
      changeType: args.changeType,
      message,
      event: null,
      authority: readString(decoded.authority) ?? null,
      paramsJson: null,
    });
    await createFailure(tx, {
      sourceHeight: message.height,
      sourceMessageId: message.id,
      typeUrl: message.typeUrl,
      failureKind: 'missing_event',
      rawMessageJson: buildRawMessageJson(message),
      error: `${message.typeUrl} had no matching ${args.changeType} event.`,
    });
    counters.rowsWritten += 1;
    counters.failuresCreated += 1;
  }

  for (const event of args.events) {
    if (args.used.has(event.id.toString())) continue;
    if (isFailedTxBound(event, args.successfulTxHashes)) continue;
    const attrs = attributesToRecord(event.attributesJson);
    await upsertParamsChange(tx, {
      changeType: args.changeType,
      message: null,
      event,
      authority: readString(attrs.authority) ?? null,
      paramsJson: null,
    });
    counters.rowsWritten += 1;
  }
}

async function upsertParamsChange(
  tx: RewardsSemanticProjectionPrisma,
  args: {
    changeType: string;
    message: MessageSource | null;
    event: EventSource | null;
    authority: string | null;
    paramsJson: unknown | null;
  },
): Promise<void> {
  const { message, event } = args;
  const data = {
    height: message?.height ?? event?.height ?? 0n,
    txHash: message?.txHash ?? event?.txHash ?? null,
    msgIndex: message?.msgIndex ?? event?.msgIndex ?? null,
    authority: args.authority,
    changeType: args.changeType,
    paramsJson: args.paramsJson ?? undefined,
    sourceMessageId: message?.id ?? null,
    sourceEventId: event?.id ?? null,
    rawMessageJson: message ? buildRawMessageJson(message) : undefined,
    rawEventJson: event ? buildRawEventJson(event) : undefined,
  };

  if (event) {
    await tx.rewardsParamsChange.upsert({
      where: { sourceEventId: event.id },
      create: data,
      update: data,
    });
    return;
  }
  if (message) {
    await tx.rewardsParamsChange.upsert({
      where: { sourceMessageId: message.id },
      create: data,
      update: data,
    });
  }
}

// --- claims ----------------------------------------------------------------

async function projectClaims(
  tx: RewardsSemanticProjectionPrisma,
  args: {
    claimMessages: MessageSource[];
    claimedEvents: EventSource[];
    successfulTxHashes: Set<string>;
    counters: Counters;
  },
): Promise<void> {
  const { counters } = args;
  const usedEvents = new Set<string>();

  for (const message of args.claimMessages) {
    const decoded = asRecord(message.decodedJson);
    const slotId = parseBigInt(readString(decoded.slot_id) ?? readString(decoded.slotId));
    if (slotId === undefined) {
      await createFailure(tx, {
        sourceHeight: message.height,
        sourceMessageId: message.id,
        typeUrl: message.typeUrl,
        failureKind: 'invalid_slot_id',
        rawMessageJson: buildRawMessageJson(message),
        error: 'MsgClaimRewards has invalid slot_id.',
      });
      counters.failuresCreated += 1;
      continue;
    }

    const matching = args.claimedEvents.filter(
      (e) => !usedEvents.has(e.id.toString())
        && txEventMatches(e, message)
        && eventSlotMatches(e, slotId),
    );
    if (matching.length === 0) {
      await createFailure(tx, {
        sourceHeight: message.height,
        sourceMessageId: message.id,
        typeUrl: message.typeUrl,
        failureKind: 'missing_event',
        rawMessageJson: buildRawMessageJson(message),
        error: 'MsgClaimRewards had no matching reward_claimed event.',
      });
      counters.failuresCreated += 1;
      continue;
    }
    if (matching.length > 1) {
      await createFailure(tx, {
        sourceHeight: message.height,
        sourceMessageId: message.id,
        sourceEventId: matching[0]?.id ?? null,
        typeUrl: message.typeUrl,
        failureKind: 'claim_correlation_failed',
        rawMessageJson: buildRawMessageJson(message),
        error: `${matching.length} reward_claimed events matched one MsgClaimRewards.`,
      });
      counters.failuresCreated += 1;
      continue;
    }
    const event = matching[0];
    if (!event) continue;
    usedEvents.add(event.id.toString());
    await applyClaim(tx, { slotId, message, event, counters });
  }

  // reward_claimed events with no message (out-of-band/auto claim): record from event.
  for (const event of args.claimedEvents) {
    if (usedEvents.has(event.id.toString())) continue;
    if (isFailedTxBound(event, args.successfulTxHashes)) continue;
    const slotId = parseBigInt(readString(attributesToRecord(event.attributesJson).slot_id));
    if (slotId === undefined) {
      await createFailure(tx, {
        sourceHeight: event.height,
        sourceEventId: event.id,
        eventType: event.type,
        failureKind: 'invalid_slot_id',
        rawEventJson: buildRawEventJson(event),
        error: 'reward_claimed event has invalid slot_id.',
      });
      counters.failuresCreated += 1;
      continue;
    }
    await applyClaim(tx, { slotId, message: null, event, counters });
    await createFailure(tx, {
      sourceHeight: event.height,
      sourceEventId: event.id,
      eventType: event.type,
      failureKind: 'missing_message',
      rawEventJson: buildRawEventJson(event),
      error: 'reward_claimed event had no matching MsgClaimRewards message.',
    });
    counters.failuresCreated += 1;
  }
}

async function applyClaim(
  tx: RewardsSemanticProjectionPrisma,
  args: {
    slotId: bigint;
    message: MessageSource | null;
    event: EventSource;
    counters: Counters;
  },
): Promise<void> {
  const { slotId, message, event, counters } = args;
  const attrs = attributesToRecord(event.attributesJson);
  const decoded = asRecord(message?.decodedJson);

  const startEpoch = parseBigInt(
    readString(attrs.start_epoch) ?? readString(decoded.start_epoch) ?? readString(decoded.startEpoch),
  );
  const endEpoch = parseBigInt(
    readString(attrs.end_epoch) ?? readString(decoded.end_epoch) ?? readString(decoded.endEpoch),
  );
  // Live nyks-core reward_claimed emits `signer` (the claim signer, which need not be the
  // slot's payout operator — see runbook). claimant/operator/creator kept as fallbacks.
  const claimant = readString(attrs.signer)
    ?? readString(attrs.claimant)
    ?? readString(attrs.operator)
    ?? readString(decoded.signer)
    ?? readString(decoded.claimant)
    ?? readString(decoded.creator)
    ?? null;

  await tx.rewardClaimEvent.upsert({
    where: { sourceEventId: event.id },
    create: {
      slotId,
      claimant,
      payoutAddress: readString(attrs.payout_address) ?? null,
      startEpoch: startEpoch ?? null,
      endEpoch: endEpoch ?? null,
      amount: readString(attrs.amount) ?? null,
      denom: readString(attrs.denom) ?? REWARDS_NATIVE_DENOM,
      height: event.height,
      txHash: event.txHash ?? message?.txHash ?? '',
      msgIndex: message?.msgIndex ?? event.msgIndex ?? null,
      sourceMessageId: message?.id ?? null,
      sourceEventId: event.id,
      rawMessageJson: message ? buildRawMessageJson(message) : undefined,
      rawEventJson: buildRawEventJson(event),
    },
    update: {
      slotId,
      claimant,
      payoutAddress: readString(attrs.payout_address) ?? null,
      startEpoch: startEpoch ?? null,
      endEpoch: endEpoch ?? null,
      amount: readString(attrs.amount) ?? null,
      denom: readString(attrs.denom) ?? REWARDS_NATIVE_DENOM,
      sourceMessageId: message?.id ?? null,
      rawMessageJson: message ? buildRawMessageJson(message) : undefined,
      rawEventJson: buildRawEventJson(event),
    },
  });
  counters.rowsWritten += 1;

  // Reconcile claim state onto existing observed slot reward rows (never fabricate).
  if (startEpoch === undefined || endEpoch === undefined) return;
  const rows = await tx.slotRewardProjection.findMany({
    where: { slotId, epochNumber: { gte: startEpoch, lte: endEpoch } },
  });
  if (rows.length === 0) {
    await createFailure(tx, {
      sourceHeight: event.height,
      sourceEventId: event.id,
      eventType: event.type,
      failureKind: 'missing_reward_records',
      rawEventJson: buildRawEventJson(event),
      error: `Claim for slot ${slotId} epochs ${startEpoch}..${endEpoch} has no SlotRewardProjection rows.`,
    });
    counters.failuresCreated += 1;
    return;
  }
  for (const row of rows) {
    await tx.slotRewardProjection.update({
      where: { id: row.id },
      data: {
        claimed: true,
        claimedAtHeight: event.height,
        claimTxHash: event.txHash ?? message?.txHash ?? null,
        claimMsgIndex: message?.msgIndex ?? event.msgIndex ?? null,
        claimEventId: event.id,
        rawClaimJson: buildRawEventJson(event),
      },
    });
  }
}

// --- treasury --------------------------------------------------------------

async function projectTreasuryPaid(
  tx: RewardsSemanticProjectionPrisma,
  event: EventSource,
  counters: Counters,
): Promise<void> {
  const attrs = attributesToRecord(event.attributesJson);
  await tx.rewardsTreasuryPayment.upsert({
    where: { sourceEventId: event.id },
    create: {
      height: event.height,
      recipient: readString(attrs.recipient) ?? readString(attrs.address) ?? null,
      denom: readString(attrs.denom) ?? null,
      amount: readString(attrs.amount) ?? null,
      purpose: readString(attrs.purpose) ?? null,
      sourceEventId: event.id,
      rawEventJson: buildRawEventJson(event),
    },
    update: {
      height: event.height,
      recipient: readString(attrs.recipient) ?? readString(attrs.address) ?? null,
      denom: readString(attrs.denom) ?? null,
      amount: readString(attrs.amount) ?? null,
      purpose: readString(attrs.purpose) ?? null,
      rawEventJson: buildRawEventJson(event),
    },
  });
  counters.rowsWritten += 1;
}

// --- helpers ---------------------------------------------------------------

function txEventMatches(event: EventSource, message: MessageSource): boolean {
  if (event.txHash !== message.txHash) return false;
  const eventMsgIndex = readString(attributesToRecord(event.attributesJson).msg_index);
  if (eventMsgIndex !== undefined && eventMsgIndex !== message.msgIndex.toString()) return false;
  return true;
}

function eventSlotMatches(event: EventSource, slotId: bigint): boolean {
  const eventSlot = readString(attributesToRecord(event.attributesJson).slot_id);
  if (eventSlot === undefined) return true;
  return eventSlot === slotId.toString();
}

function isFailedTxBound(event: EventSource, successfulTxHashes: Set<string>): boolean {
  return event.txHash !== null && !successfulTxHashes.has(event.txHash);
}

async function createFailure(
  prisma: RewardsSemanticProjectionPrisma,
  args: {
    sourceHeight: bigint;
    sourceMessageId?: bigint | null | undefined;
    sourceEventId?: bigint | null | undefined;
    typeUrl?: string | null | undefined;
    eventType?: string | null | undefined;
    failureKind: ProjectionFailureKind;
    rawMessageJson?: unknown | null | undefined;
    rawEventJson?: unknown | null | undefined;
    error: string;
  },
): Promise<void> {
  const failure: ProjectionFailureInput = {
    projectionName: REWARDS_SEMANTIC_PROJECTION,
    module: 'rewards',
    sourceHeight: args.sourceHeight,
    sourceMessageId: args.sourceMessageId ?? null,
    sourceEventId: args.sourceEventId ?? null,
    typeUrl: args.typeUrl ?? null,
    eventType: args.eventType ?? null,
    failureKind: args.failureKind,
    rawMessageJson: args.rawMessageJson ?? null,
    rawEventJson: args.rawEventJson ?? null,
    error: args.error,
  };
  const data = withProjectionFailureKey(failure);
  await prisma.projectionFailure.upsert({
    where: { failureKey: data.failureKey },
    create: data,
    update: { ...data, resolved: false, resolvedAt: null },
  });
}

function buildRawMessageJson(message: MessageSource): unknown {
  return {
    id: message.id.toString(),
    txHash: message.txHash,
    height: message.height.toString(),
    msgIndex: message.msgIndex,
    typeUrl: message.typeUrl,
    module: message.module,
    decodedJson: message.decodedJson,
    rawJson: message.rawJson,
  };
}

function buildRawEventJson(event: EventSource): unknown {
  return {
    id: event.id.toString(),
    height: event.height.toString(),
    txHash: event.txHash,
    msgIndex: event.msgIndex,
    type: event.type,
    attributesJson: event.attributesJson,
  };
}

function attributesToRecord(attributesJson: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const attribute of readArray(attributesJson)) {
    const record = asRecord(attribute);
    const key = readString(record.key);
    if (!key) continue;
    result[key] = record.value;
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return undefined;
}

function readJson(value: unknown): unknown | null {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value ?? null;
}

function parseBigInt(value: string | undefined): bigint | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function parseInt32(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
