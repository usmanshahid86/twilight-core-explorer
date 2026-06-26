'use client';

import { QueryBoundary } from '@/components/QueryBoundary';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { useCoreSlots, useLivenessRisk, useProposers, useValidatorSet } from '@/lib/api/queries';
import { statusTone } from '@/lib/format/status';
import { bpsToPercent } from '@/lib/format/bps';

export function CoreSlotHealthPanel() {
  const slots = useCoreSlots();
  const validatorSet = useValidatorSet();
  const proposers = useProposers();
  return (
    <Card>
      <CardHeader title="CoreSlot active set" href="/coreslots" />
      <CardBody>
        <QueryBoundary query={slots} context="CoreSlots" loadingRows={3}>
          {(res) => {
            const total = res.data.length;
            const active = res.data.filter((s) => s.removedHeight === null).length;
            const vsCount = validatorSet.data ? validatorSet.data.data.length : null;
            const propCount = proposers.data ? proposers.data.data.length : null;
            return (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard label="Active CoreSlots" value={`${active} / ${total}`} mono />
                <StatCard label="Validator set" value={vsCount === null ? '…' : vsCount} mono />
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
  return (
    <Card>
      <CardHeader title="Network liveness risk" href="/liveness" />
      <CardBody>
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
      </CardBody>
    </Card>
  );
}
