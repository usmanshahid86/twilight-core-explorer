// Shared CoreSlot id parsing — used by the 9c CoreSlot routes and the 9d /coreslots/:slotId/rewards
// route so slotId validation (int64-bounded, length-capped) stays identical everywhere.

import { parseUint64 } from './pagination.js';
import { badRequest } from './errors.js';

/** Parse a path :slotId; non-digit / out-of-int64 / over-long → 400 invalid_slot_id. */
export function parseSlotId(raw: string): bigint {
  const slotId = parseUint64(raw);
  if (slotId === null) {
    throw badRequest('invalid_slot_id', 'invalid slot id');
  }
  return slotId;
}
