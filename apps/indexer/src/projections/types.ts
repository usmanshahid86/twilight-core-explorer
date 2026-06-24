export const CORESLOT_METADATA_PROJECTION = 'coreslot_metadata_v1';

export const PROJECTION_STATUS = {
  idle: 'idle',
  running: 'running',
  haltedError: 'halted_error',
} as const;

export const CORESLOT_METADATA_TYPE_URL =
  '/twilight.coreslot.v1.MsgUpdateOperatorMetadata';

export const CORESLOT_METADATA_EVENT_TYPE = 'coreslot_metadata_updated';

export type ProjectionFailureKind =
  | 'missing_event'
  | 'missing_message'
  | 'ambiguous_event'
  | 'ambiguous_message'
  | 'failed_tx_skipped'
  | 'invalid_slot_id'
  | 'missing_required_payload'
  | 'unknown_coreslot_message'
  | 'unknown_coreslot_event';

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
