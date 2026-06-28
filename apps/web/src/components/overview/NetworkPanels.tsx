'use client';

import { QueryBoundary } from '@/components/QueryBoundary';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import type { ReactNode } from 'react';
import { ApiError, ERROR_CODES } from '@/lib/api/client';
import {
  useCoreSlots,
  useLivenessRisk,
  useProposers,
  useStatus,
  useValidatorSet,
} from '@/lib/api/queries';
import { statusTone } from '@/lib/format/status';
import { bpsToPercent } from '@/lib/format/bps';

export function CoreSlotHealthPanel() {
  const status = useStatus();
  const slots = useCoreSlots();
  const proposers = useProposers();

  // The active set is the validator set AT the latest indexed height (string; never Number()).
  // "Not removed" in the registry is NOT the same as active, so we do not infer active from it.
  const latest = status.data?.data.indexer?.lastIndexedHeight;
  const height = typeof latest === 'string' && /^\d+$/.test(latest) ? latest : undefined;
  const validatorSet = useValidatorSet(height);

  let activeSet: ReactNode;
  if (height === undefined) {
    activeSet = status.isError ? (
      <Badge tone="danger">unavailable</Badge>
    ) : (
      <Badge tone="neutral">awaiting height…</Badge>
    );
  } else if (validatorSet.isPending) {
    activeSet = '…';
  } else if (validatorSet.isError) {
    activeSet = <Badge tone="danger">unavailable</Badge>;
  } else {
    activeSet = validatorSet.data.data.length;
  }

  return (
    <Card>
      <CardHeader title="CoreSlot active set" href="/coreslots" linkLabel="All CoreSlots" />
      <CardBody>
        <QueryBoundary query={slots} context="CoreSlots" loadingRows={3}>
          {(res) => {
            const registered = res.data.length;
            const propCount = proposers.data ? proposers.data.data.length : null;
            return (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard
                  label="Active validator set"
                  value={activeSet}
                  hint={height ? `at height ${height}` : 'needs latest height'}
                  mono
                />
                <StatCard label="Registered CoreSlots" value={registered} mono />
                <StatCard label="Proposers seen" value={propCount === null ? '…' : propCount} mono />
              </div>
            );
          }}
        </QueryBoundary>
      </CardBody>
    </Card>
  );
}

export function LivenessRiskPanel() {
  const query = useLivenessRisk();
  // J-008: a 404 is "no snapshot yet" — render it as the SAME soft state the /liveness page uses,
  // not a hard error, so the home page and the liveness page agree.
  const is404 =
    query.isError && query.error instanceof ApiError && query.error.code === ERROR_CODES.notFound;
  return (
    <Card>
      <CardHeader title="Network liveness risk" href="/liveness" linkLabel="Open liveness" />
      <CardBody>
        {is404 ? (
          <div className="text-sm text-text-muted">No liveness snapshot yet.</div>
        ) : (
        <QueryBoundary query={query} context="Liveness risk" loadingRows={3}>
          {(res) => {
            const d = res.data;
            return (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(d.haltRiskLevel)}>halt risk: {d.haltRiskLevel}</Badge>
                  {d.haltRiskReason ? (
                    <span className="text-xs text-text-muted">{d.haltRiskReason}</span>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard label="Healthy" value={d.healthySlotCount} mono />
                  <StatCard label="Degraded" value={d.degradedSlotCount} mono />
                  <StatCard label="Down" value={d.downSlotCount} mono />
                  <StatCard
                    label="Available power"
                    value={bpsToPercent(d.availablePowerBps)}
                    mono
                  />
                </div>
              </div>
            );
          }}
        </QueryBoundary>
        )}
      </CardBody>
    </Card>
  );
}
