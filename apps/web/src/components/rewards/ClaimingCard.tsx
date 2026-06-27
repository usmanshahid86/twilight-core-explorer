import { Card, CardBody, CardHeader } from '@/components/ui/Card';

/**
 * Non-actionable Claiming info card (Phase 12 §4 — locked posture/copy).
 *
 * The explorer performs NO claim action. This card MUST stay non-actionable: no claim button,
 * no disabled claim button, no wallet prompt, no dApp/web link, no "claim now" language. Claiming
 * is CLI-only; the canonical command is shown as documentation-only monospace text (selectable,
 * not a control).
 */
const CLAIM_COMMAND = 'twilightd rewards claim <slotId> <startEpoch> <endEpoch> --from <operator>';

export function ClaimingCard() {
  return (
    <Card>
      <CardHeader title="Claiming" />
      <CardBody>
        <p className="text-sm text-text-muted">
          Claiming is not available from this explorer. This page displays observed rewards and
          historical claim events only. Operators claim externally using the Twilight CLI.
        </p>
        <p className="mt-3 text-xs text-text-muted">Canonical command (documentation only):</p>
        <pre className="mt-1 overflow-x-auto rounded-lg border border-card-border bg-background px-3 py-2 font-mono text-xs text-text">
          {CLAIM_COMMAND}
        </pre>
      </CardBody>
    </Card>
  );
}
