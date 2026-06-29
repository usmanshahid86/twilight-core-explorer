'use client';

import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { NoSampleLabel, SampledAtNote } from '@/components/freshness/Freshness';
import { ErrorState, LoadingState } from '@/components/states/States';
import { useAccountBalances, useStatus } from '@/lib/api/queries';
import { deriveSampleAge } from '@/lib/freshness';
import { formatAmount } from '@/lib/format/amount';

// Sampled balances. sampled:false renders "no sample" — never a fabricated 0. The raw base-denom
// amount is shown alongside the TWLT display.
export function BalancesSection({ address }: { address: string }) {
  const query = useAccountBalances(address);
  const status = useStatus();

  if (query.isPending) return <LoadingState rows={3} />;
  if (query.isError) return <ErrorState error={query.error} context="Balances" />;

  const b = query.data.data;
  if (!b.sampled) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <NoSampleLabel />
        <span>— no balance sample exists for this account.</span>
      </div>
    );
  }

  const latestIndexed = status.data?.data.indexer?.lastIndexedHeight ?? null;
  const age = deriveSampleAge(b.sampledAtHeight, latestIndexed);
  return (
    <div className="space-y-3">
      <SampledAtNote sampledAtHeight={b.sampledAtHeight} age={age} />
      {b.balances.length === 0 ? (
        <div className="text-sm text-text-muted">Sampled — no balances held.</div>
      ) : (
        <Table
          caption="Account balances"
          head={
            <>
              <Th>Denom</Th>
              <Th>Amount</Th>
              <Th>Raw</Th>
            </>
          }
        >
          {b.balances.map((c, i) => {
            const amt = formatAmount(c.amount, c.denom);
            return (
              <Tr key={`${c.denom}-${i}`}>
                <Td>{c.denom}</Td>
                <Td mono>{`${amt.display} ${amt.symbol}`}</Td>
                <Td mono>{`${amt.raw} ${amt.rawDenom}`}</Td>
              </Tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
