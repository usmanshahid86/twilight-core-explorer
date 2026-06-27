import Link from 'next/link';
import { shortenMiddle } from '@/lib/format/address';

// Operator-forward identity link: renders the operator's display name (moniker when enrichment
// provides one) linked to /operator/[address]. Falls back to the shortened address — so the LINK
// always works even if name enrichment is unavailable (the directory is non-blocking).
export function OperatorLink({
  operatorAddress,
  name,
}: {
  operatorAddress: string | null | undefined;
  name?: string | undefined;
}) {
  if (!operatorAddress) return <span className="text-text-muted">—</span>;
  const hasName = name !== undefined && name.length > 0;
  const label = hasName ? name : shortenMiddle(operatorAddress, 10, 6);
  return (
    <Link
      href={`/operator/${encodeURIComponent(operatorAddress)}`}
      title={operatorAddress}
      className={hasName ? 'text-primary hover:text-primary-light' : 'font-mono text-primary hover:text-primary-light'}
    >
      {label}
    </Link>
  );
}
