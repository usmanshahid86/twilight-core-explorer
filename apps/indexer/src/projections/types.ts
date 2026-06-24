export const CORESLOT_METADATA_PROJECTION = 'coreslot_metadata_v1';
export const CORESLOT_LIFECYCLE_PROJECTION = 'coreslot_lifecycle_v1';
export const CORESLOT_PAYOUT_PROJECTION = 'coreslot_payout_v1';
export const CORESLOT_PARAMS_PROJECTION = 'coreslot_params_v1';
export const CORESLOT_KEY_ROTATION_PROJECTION = 'coreslot_key_rotation_v1';

// Currently implemented CoreSlot semantic projections, in deterministic rebuild
// order. The temporal consensus map is intentionally absent until Phase 6b-2.
// The combined reset/rebuild command is scoped to exactly these.
export const CORESLOT_SEMANTIC_PROJECTIONS = [
  CORESLOT_METADATA_PROJECTION,
  CORESLOT_LIFECYCLE_PROJECTION,
  CORESLOT_PAYOUT_PROJECTION,
  CORESLOT_PARAMS_PROJECTION,
  CORESLOT_KEY_ROTATION_PROJECTION,
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
