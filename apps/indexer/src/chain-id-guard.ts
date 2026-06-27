/**
 * Reconcile the configured chain-id against the chain-id the node actually reports
 * (CometBFT `status.node_info.network`).
 *
 * If CHAIN_ID is left unset, `config.chainId` silently falls back to a default
 * (e.g. `twilight-localnet-1`). Ingesting under that default stamps every Block /
 * ProjectionCursor row — and the API `/status` — with the wrong chain. This guard makes that
 * mistake loud: it throws before any data is written so the operator must set CHAIN_ID to match
 * the node. It is a no-op when the node does not report a chain-id (cannot reconcile) or when the
 * two already agree.
 */
export function assertChainIdMatches(
  configChainId: string,
  reportedChainId: string | undefined,
): void {
  if (reportedChainId && reportedChainId !== configChainId) {
    throw new Error(
      `CHAIN_ID mismatch: configured chainId "${configChainId}" does not match the node's `
      + `reported chain-id "${reportedChainId}". Set CHAIN_ID=${reportedChainId} before ingesting `
      + `(otherwise blocks, cursors, and /status are mislabeled).`,
    );
  }
}
