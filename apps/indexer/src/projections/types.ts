export const CORESLOT_METADATA_PROJECTION = 'coreslot_metadata_v1';
export const CORESLOT_LIFECYCLE_PROJECTION = 'coreslot_lifecycle_v1';
export const CORESLOT_PAYOUT_PROJECTION = 'coreslot_payout_v1';
export const CORESLOT_PARAMS_PROJECTION = 'coreslot_params_v1';
export const CORESLOT_KEY_ROTATION_PROJECTION = 'coreslot_key_rotation_v1';
export const CORESLOT_TEMPORAL_MAP_PROJECTION = 'coreslot_temporal_map_v1';
export const BLOCK_SIGNATURES_PROJECTION = 'block_signatures_v1';
export const OPERATOR_SIGNING_EVIDENCE_PROJECTION = 'operator_signing_evidence_v1';
export const CORESLOT_LIVENESS_PROJECTION = 'coreslot_liveness_v1';

export const OPERATOR_SIGNING_ATTRIBUTION_STATUS = {
  attributed: 'attributed',
  absentNoValidator: 'absent_no_validator',
  noConsensusWindow: 'no_consensus_window',
  unmappedValidator: 'unmapped_validator',
  invalidValidatorAddress: 'invalid_validator_address',
  unknownShape: 'unknown_shape',
} as const;

// Phase 8c-1 liveness verdict per (committed height, expected active CoreSlot).
export const CORESLOT_LIVENESS_STATUS = {
  signed: 'signed',
  missed: 'missed',
} as const;

// Why a missed expected-signer did not commit. `absent` = anonymous flag-1 gap assigned by
// set-difference; `nil` = address-bearing flag-3 vote. Both are `missed`.
export const CORESLOT_LIVENESS_MISS_CAUSE = {
  absent: 'absent',
  nil: 'nil',
} as const;

// Currently implemented CoreSlot semantic projections, in deterministic rebuild
// order. The combined reset/rebuild command is scoped to exactly these.
export const CORESLOT_SEMANTIC_PROJECTIONS = [
  CORESLOT_METADATA_PROJECTION,
  CORESLOT_LIFECYCLE_PROJECTION,
  CORESLOT_PAYOUT_PROJECTION,
  CORESLOT_PARAMS_PROJECTION,
  CORESLOT_KEY_ROTATION_PROJECTION,
  CORESLOT_TEMPORAL_MAP_PROJECTION,
] as const;

export const PROJECTION_STATUS = {
  idle: 'idle',
  running: 'running',
  haltedError: 'halted_error',
} as const;

export const CORESLOT_METADATA_TYPE_URL =
  '/twilight.coreslot.v1.MsgUpdateOperatorMetadata';

export const CORESLOT_METADATA_EVENT_TYPE = 'coreslot_metadata_updated';
export const CORESLOT_PAYOUT_TYPE_URL =
  '/twilight.coreslot.v1.MsgUpdatePayoutAddress';
export const CORESLOT_PAYOUT_EVENT_TYPE = 'coreslot_payout_updated';
export const CORESLOT_PARAMS_TYPE_URL = '/twilight.coreslot.v1.MsgUpdateParams';
export const CORESLOT_PARAMS_EVENT_TYPE = 'coreslot_params_updated';

export const CORESLOT_KEY_ROTATION_TYPE_URL =
  '/twilight.coreslot.v1.MsgRotateConsensusKey';
export const CORESLOT_KEY_ROTATION_REQUESTED_EVENT_TYPE =
  'coreslot_key_rotation_requested';
export const CORESLOT_KEY_ROTATED_EVENT_TYPE = 'coreslot_key_rotated';
export const CORESLOT_ROTATION_CANCELLED_EVENT_TYPE =
  'coreslot_rotation_cancelled';

export const CORESLOT_KEY_ROTATION_EVENT_TYPES = [
  CORESLOT_KEY_ROTATION_REQUESTED_EVENT_TYPE,
  CORESLOT_KEY_ROTATED_EVENT_TYPE,
  CORESLOT_ROTATION_CANCELLED_EVENT_TYPE,
] as const;

export const CORESLOT_KEY_ROTATION_STATUS = {
  requested: 'requested',
  applied: 'applied',
  immediateApplied: 'immediate_applied',
  cancelled: 'cancelled',
} as const;

// --- Rewards (x/rewards) projections (Phase 7) ----------------------------

// Rebuildable semantic projection derived from generic Message/Event/Transaction rows.
export const REWARDS_SEMANTIC_PROJECTION = 'rewards_semantic_v1';
// Observed-sample projection populated from live ChainClient snapshots at a height.
export const REWARDS_SNAPSHOT_PROJECTION = 'rewards_snapshot_v1';

// Rewards is a separate domain from CoreSlot; it is NOT part of the CoreSlot combined
// rebuild. These names scope the rewards reset only.
export const REWARDS_PROJECTIONS = [
  REWARDS_SEMANTIC_PROJECTION,
  REWARDS_SNAPSHOT_PROJECTION,
] as const;

export const REWARDS_CLAIM_TYPE_URL = '/twilight.rewards.v1.MsgClaimRewards';
export const REWARDS_UPDATE_PARAMS_TYPE_URL =
  '/twilight.rewards.v1.MsgUpdateRewardsParams';
export const REWARDS_PAUSE_TYPE_URL = '/twilight.rewards.v1.MsgPauseRewards';
export const REWARDS_RESUME_TYPE_URL = '/twilight.rewards.v1.MsgResumeRewards';

export const REWARDS_MESSAGE_TYPE_URLS = [
  REWARDS_CLAIM_TYPE_URL,
  REWARDS_UPDATE_PARAMS_TYPE_URL,
  REWARDS_PAUSE_TYPE_URL,
  REWARDS_RESUME_TYPE_URL,
] as const;

export const EPOCH_FINALIZED_EVENT_TYPE = 'epoch_finalized';
export const REWARD_CLAIMED_EVENT_TYPE = 'reward_claimed';
export const PARAMS_UPDATE_QUEUED_EVENT_TYPE = 'params_update_queued';
export const PARAMS_ACTIVATED_EVENT_TYPE = 'params_activated';
export const REWARDS_PAUSED_EVENT_TYPE = 'rewards_paused';
export const REWARDS_RESUMED_EVENT_TYPE = 'rewards_resumed';
export const TREASURY_PAID_EVENT_TYPE = 'treasury_paid';

export const REWARDS_EVENT_TYPES = [
  EPOCH_FINALIZED_EVENT_TYPE,
  REWARD_CLAIMED_EVENT_TYPE,
  PARAMS_UPDATE_QUEUED_EVENT_TYPE,
  PARAMS_ACTIVATED_EVENT_TYPE,
  REWARDS_PAUSED_EVENT_TYPE,
  REWARDS_RESUMED_EVENT_TYPE,
  TREASURY_PAID_EVENT_TYPE,
] as const;

export const REWARDS_PARAMS_CHANGE_TYPE = {
  queued: 'queued',
  activated: 'activated',
  pause: 'pause',
  resume: 'resume',
  directUpdate: 'direct_update',
} as const;

export const REWARDS_NATIVE_DENOM = 'utwlt';

export const CORESLOT_LIFECYCLE_MESSAGE_TO_EVENT = {
  '/twilight.coreslot.v1.MsgRegisterCoreSlot': 'coreslot_registered',
  '/twilight.coreslot.v1.MsgActivateCoreSlot': 'coreslot_activated',
  '/twilight.coreslot.v1.MsgInactivateCoreSlot': 'coreslot_inactivated',
  '/twilight.coreslot.v1.MsgSuspendCoreSlot': 'coreslot_suspended',
  '/twilight.coreslot.v1.MsgRemoveCoreSlot': 'coreslot_removed',
} as const;

export const CORESLOT_LIFECYCLE_EVENT_TYPES = Object.values(
  CORESLOT_LIFECYCLE_MESSAGE_TO_EVENT,
);

export type CoreSlotLifecycleMessageTypeUrl =
  keyof typeof CORESLOT_LIFECYCLE_MESSAGE_TO_EVENT;

export type CoreSlotLifecycleEventType =
  typeof CORESLOT_LIFECYCLE_MESSAGE_TO_EVENT[CoreSlotLifecycleMessageTypeUrl];

export type ProjectionFailureKind =
  | 'missing_event'
  | 'missing_message'
  | 'missing_request'
  | 'ambiguous_event'
  | 'ambiguous_message'
  | 'failed_tx_skipped'
  | 'invalid_slot_id'
  | 'invalid_consensus_address'
  | 'invalid_payout_address'
  | 'invalid_params_payload'
  | 'missing_required_payload'
  | 'rotation_correlation_failed'
  | 'missing_activation_window'
  | 'temporal_window_conflict'
  | 'temporal_window_ambiguous'
  | 'temporal_order_ambiguous'
  | 'effective_height_invalid'
  | 'invalid_epoch'
  | 'invalid_amount'
  | 'missing_reward_records'
  | 'claim_correlation_failed'
  | 'missing_block_raw'
  | 'missing_last_commit'
  | 'missing_signatures'
  | 'invalid_signature_payload'
  | 'invalid_validator_address'
  | 'invalid_height'
  | 'unknown_block_signature_shape'
  | 'genesis_unavailable'
  | 'genesis_coreslot_malformed'
  | 'invalid_committed_height'
  | 'missing_required_block_signature_field'
  | 'malformed_temporal_window'
  | 'database_write_failure'
  | 'unknown_operator_signing_evidence_shape'
  | 'liveness_absent_count_mismatch'
  | 'duplicate_expected_slot_at_height'
  | 'duplicate_observed_signed_slot_at_height'
  | 'nil_and_signed_same_slot_height'
  | 'observed_attributed_slot_not_expected'
  | 'unknown_liveness_shape'
  | 'malformed_liveness_input'
  | 'unknown_semantic_type'
  | 'unknown_coreslot_message'
  | 'unknown_coreslot_event'
  | 'unknown_coreslot_lifecycle_event'
  | 'unknown_key_rotation_event';

export interface ProjectionFailureInput {
  failureKey?: string | null | undefined;
  projectionName: string;
  module?: string | null | undefined;
  sourceHeight: bigint;
  sourceTxHash?: string | null | undefined;
  sourceMsgIndex?: number | null | undefined;
  sourceMessageId?: bigint | null | undefined;
  sourceEventId?: bigint | null | undefined;
  typeUrl?: string | null | undefined;
  eventType?: string | null | undefined;
  failureKind: ProjectionFailureKind;
  rawMessageJson?: unknown | null | undefined;
  rawEventJson?: unknown | null | undefined;
  error: string;
}

export interface ProjectionFailureWithKey extends ProjectionFailureInput {
  failureKey: string;
}

export function withProjectionFailureKey(
  input: ProjectionFailureInput,
): ProjectionFailureWithKey {
  return {
    ...input,
    failureKey: input.failureKey ?? buildProjectionFailureKey(input),
  };
}

export function buildProjectionFailureKey(input: ProjectionFailureInput): string {
  return [
    input.projectionName,
    input.failureKind,
    input.sourceHeight.toString(),
    input.sourceTxHash ?? 'none',
    input.sourceMsgIndex?.toString() ?? 'none',
    input.sourceMessageId?.toString() ?? 'none',
    input.sourceEventId?.toString() ?? 'none',
    input.typeUrl ?? 'none',
    input.eventType ?? 'none',
  ].join(':');
}
