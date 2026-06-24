export const CORESLOT_METADATA_PROJECTION = 'coreslot_metadata_v1';
export const CORESLOT_LIFECYCLE_PROJECTION = 'coreslot_lifecycle_v1';

export const PROJECTION_STATUS = {
  idle: 'idle',
  running: 'running',
  haltedError: 'halted_error',
} as const;

export const CORESLOT_METADATA_TYPE_URL =
  '/twilight.coreslot.v1.MsgUpdateOperatorMetadata';

export const CORESLOT_METADATA_EVENT_TYPE = 'coreslot_metadata_updated';

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
  | 'ambiguous_event'
  | 'ambiguous_message'
  | 'failed_tx_skipped'
  | 'invalid_slot_id'
  | 'invalid_consensus_address'
  | 'missing_required_payload'
  | 'unknown_coreslot_message'
  | 'unknown_coreslot_event'
  | 'unknown_coreslot_lifecycle_event';

export interface ProjectionFailureInput {
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
