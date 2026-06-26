// Minimal in-memory mock of the PrismaClient surface used by apps/api repositories. Mirrors the
// indexer's mock-Prisma test style. Heights are BigInt, matching the real schema.

export const testConfig = {
  databaseUrl: 'postgresql://unused',
  port: 0,
  host: '127.0.0.1',
  env: 'development',
  isProduction: false,
  corsOrigins: false,
};

const descBig = (a, b) => (a < b ? 1 : a > b ? -1 : 0);

export class MockPrisma {
  constructor(data = {}) {
    this._indexerCursor = data.indexerCursor ?? null;
    this._projectionCursors = data.projectionCursors ?? [];
    this._failures = data.failures ?? []; // [{ projectionName, failureKind?, resolved }]
    this._blocks = data.blocks ?? [];
    this._attributions = data.attributions ?? [];
    this._txs = data.txs ?? [];
    this._messages = data.messages ?? [];
    this._events = data.events ?? [];
    this._accounts = data.accounts ?? [];
    this._decodeFailures = data.decodeFailures ?? [];
    this._coreSlots = data.coreSlots ?? [];
    this._lifecycleEvents = data.lifecycleEvents ?? [];
    this._metadataChanges = data.metadataChanges ?? [];
    this._payoutChanges = data.payoutChanges ?? [];
    this._keyRotations = data.keyRotations ?? [];
    this._windows = data.windows ?? [];
    this._livenessSummaries = data.livenessSummaries ?? [];
    this._healthSnapshots = data.healthSnapshots ?? [];
    this._networkRisk = data.networkRisk ?? null;
    this._dbDown = data.dbDown ?? false;
    this._failedMigrations = data.failedMigrations ?? 0;

    this.indexerCursor = { findFirst: async () => this._indexerCursor };

    this.projectionCursor = {
      findMany: async () => [...this._projectionCursors],
    };

    this.projectionFailure = {
      groupBy: async (args = {}) => {
        const by = args.by ?? ['projectionName'];
        const counts = new Map();
        for (const f of this._failures) {
          if (args.where?.resolved === false && f.resolved) continue;
          const key = by.map((k) => String(f[k])).join('__keysep__');
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return [...counts.entries()].map(([key, n]) => {
          const parts = key.split('__keysep__');
          const row = { _count: { _all: n } };
          by.forEach((k, i) => {
            row[k] = parts[i];
          });
          return row;
        });
      },
    };

    this.block = {
      findMany: async (args = {}) => {
        let rows = [...this._blocks];
        const lt = args.where?.height?.lt;
        if (lt !== undefined) rows = rows.filter((b) => b.height < lt);
        rows.sort((a, b) => descBig(a.height, b.height));
        return args.take ? rows.slice(0, args.take) : rows;
      },
      findUnique: async (args) => {
        if (args.where.height !== undefined) {
          return this._blocks.find((b) => b.height === args.where.height) ?? null;
        }
        return this._blocks.find((b) => b.hash === args.where.hash) ?? null;
      },
    };

    this.blockProposerAttribution = {
      findFirst: async (args) =>
        this._attributions.find((a) => a.height === args.where.height) ?? null,
      findMany: async (args = {}) => {
        let rows = [...this._attributions];
        const w = args.where ?? {};
        if (w.height?.in) rows = rows.filter((a) => w.height.in.some((h) => h === a.height));
        if (w.slotId !== undefined) rows = rows.filter((a) => a.slotId === w.slotId);
        if (w.height?.lt !== undefined) rows = rows.filter((a) => a.height < w.height.lt);
        if (args.orderBy?.height === 'desc') rows.sort((a, b) => descBig(a.height, b.height));
        return args.take ? rows.slice(0, args.take) : rows;
      },
      groupBy: async (args = {}) => {
        const by = args.by ?? [];
        const rows = this._attributions.filter(
          (a) => args.where?.attributionStatus === undefined || a.attributionStatus === args.where.attributionStatus,
        );
        const groups = new Map();
        for (const a of rows) {
          const key = by.map((k) => String(a[k])).join('__keysep__');
          const cur = groups.get(key) ?? { row: a, count: 0 };
          cur.count += 1;
          groups.set(key, cur);
        }
        return [...groups.values()].map(({ row, count }) => {
          const out = { _count: { _all: count } };
          by.forEach((k) => {
            out[k] = row[k];
          });
          return out;
        });
      },
    };

    this.explorerTransaction = {
      findMany: async (args = {}) => {
        let rows = [...this._txs];
        const w = args.where ?? {};
        if (w.height !== undefined && typeof w.height !== 'object') {
          rows = rows.filter((t) => t.height === w.height);
        }
        if (w.status !== undefined) rows = rows.filter((t) => t.status === w.status);
        if (w.OR) {
          rows = rows.filter((t) =>
            w.OR.some((c) => {
              if (c.height && typeof c.height === 'object' && c.height.lt !== undefined) {
                return t.height < c.height.lt;
              }
              if (c.index && c.index.lt !== undefined) {
                return t.height === c.height && t.index < c.index.lt;
              }
              return false;
            }),
          );
        }
        rows.sort((a, b) => (a.height !== b.height ? descBig(a.height, b.height) : b.index - a.index));
        return args.take ? rows.slice(0, args.take) : rows;
      },
      findUnique: async (args) => this._txs.find((t) => t.hash === args.where.hash) ?? null,
    };

    this.message = {
      findMany: async (args = {}) =>
        this._messages
          .filter((m) => m.txHash === args.where.txHash)
          .sort((a, b) => a.msgIndex - b.msgIndex),
    };

    this.event = {
      findMany: async (args = {}) =>
        this._events
          .filter((e) => e.txHash === args.where.txHash)
          .sort((a, b) => (a.msgIndex ?? 0) - (b.msgIndex ?? 0) || a.eventIndex - b.eventIndex),
    };

    this.account = {
      findMany: async (args = {}) => {
        let rows = [...this._accounts];
        const w = args.where ?? {};
        if (w.accountKind !== undefined) rows = rows.filter((a) => a.accountKind === w.accountKind);
        if (w.address?.gt !== undefined) rows = rows.filter((a) => a.address > w.address.gt);
        rows.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0)); // asc
        return args.take ? rows.slice(0, args.take) : rows;
      },
      findUnique: async (args) =>
        this._accounts.find((a) => a.address === args.where.address) ?? null,
    };

    this.decodeFailure = {
      findMany: async (args = {}) => {
        let rows = [...this._decodeFailures];
        const w = args.where ?? {};
        if (w.resolved !== undefined) rows = rows.filter((d) => d.resolved === w.resolved);
        if (w.failureKind !== undefined) rows = rows.filter((d) => d.failureKind === w.failureKind);
        if (w.height !== undefined) rows = rows.filter((d) => d.height === w.height);
        if (w.id?.lt !== undefined) rows = rows.filter((d) => d.id < w.id.lt);
        rows.sort((a, b) => descBig(a.id, b.id));
        return args.take ? rows.slice(0, args.take) : rows;
      },
    };

    const eventTable = (source) => ({
      findMany: async (args = {}) => {
        const w = args.where ?? {};
        let r = source.filter((e) => e.slotId === w.slotId);
        if (w.OR) {
          r = r.filter((e) =>
            w.OR.some((c) => {
              if (c.height && typeof c.height === 'object') return e.height < c.height.lt; // {height:{lt}}
              if (c.id?.lt !== undefined) return e.height === c.height && e.id < c.id.lt; // {height:H,id:{lt}}
              return e.height === c.height; // {height:H} (whole height for a later-ranked kind)
            }),
          );
        }
        r.sort((a, b) => (a.height !== b.height ? descBig(a.height, b.height) : descBig(a.id, b.id)));
        return args.take ? r.slice(0, args.take) : r;
      },
    });
    this.coreSlotLifecycleEvent = eventTable(this._lifecycleEvents);
    this.coreSlotMetadataChange = eventTable(this._metadataChanges);
    this.coreSlotPayoutChange = eventTable(this._payoutChanges);

    this.coreSlotProjection = {
      findMany: async (args = {}) => {
        let r = [...this._coreSlots];
        const w = args.where ?? {};
        if (w.status !== undefined) r = r.filter((s) => s.status === w.status);
        if (w.operatorAddress !== undefined) r = r.filter((s) => s.operatorAddress === w.operatorAddress);
        if (w.consensusAddress !== undefined) r = r.filter((s) => s.consensusAddress === w.consensusAddress);
        if (w.payoutAddress !== undefined) r = r.filter((s) => s.payoutAddress === w.payoutAddress);
        if (w.slotId?.gt !== undefined) r = r.filter((s) => s.slotId > w.slotId.gt);
        r.sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
        return args.take ? r.slice(0, args.take) : r;
      },
      findUnique: async (args) => this._coreSlots.find((s) => s.slotId === args.where.slotId) ?? null,
      findFirst: async (args = {}) => {
        const w = args.where ?? {};
        return (
          this._coreSlots.find(
            (s) =>
              (w.consensusAddress === undefined || s.consensusAddress === w.consensusAddress) &&
              (w.operatorAddress === undefined || s.operatorAddress === w.operatorAddress) &&
              (w.payoutAddress === undefined || s.payoutAddress === w.payoutAddress),
          ) ?? null
        );
      },
    };

    this.coreSlotConsensusKeyRotation = {
      findMany: async (args = {}) => {
        let r = this._keyRotations.filter((k) => k.slotId === args.where.slotId);
        if (args.where?.id?.lt !== undefined) r = r.filter((k) => k.id < args.where.id.lt);
        r.sort((a, b) => descBig(a.id, b.id));
        return args.take ? r.slice(0, args.take) : r;
      },
    };

    this.coreSlotConsensusWindow = {
      findMany: async (args = {}) => {
        let r = [...this._windows];
        const w = args.where ?? {};
        if (w.slotId !== undefined) r = r.filter((x) => x.slotId === w.slotId);
        if (w.effectiveFromHeight?.lte !== undefined) {
          r = r.filter((x) => x.effectiveFromHeight <= w.effectiveFromHeight.lte);
        }
        if (w.OR) {
          r = r.filter((x) =>
            w.OR.some((c) => {
              if (c.effectiveFromHeight && typeof c.effectiveFromHeight === 'object' && c.effectiveFromHeight.lt !== undefined) {
                return x.effectiveFromHeight < c.effectiveFromHeight.lt;
              }
              if (c.effectiveFromHeight !== undefined && c.id?.lt !== undefined) {
                return x.effectiveFromHeight === c.effectiveFromHeight && x.id < c.id.lt;
              }
              if (c.effectiveToHeight === null) return x.effectiveToHeight === null;
              if (c.effectiveToHeight?.gt !== undefined) {
                return x.effectiveToHeight !== null && x.effectiveToHeight > c.effectiveToHeight.gt;
              }
              return false;
            }),
          );
        }
        if (Array.isArray(args.orderBy)) {
          r.sort((a, b) =>
            a.effectiveFromHeight !== b.effectiveFromHeight
              ? descBig(a.effectiveFromHeight, b.effectiveFromHeight)
              : descBig(a.id, b.id),
          );
        } else if (args.orderBy?.slotId === 'asc') {
          r.sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
        }
        return args.take ? r.slice(0, args.take) : r;
      },
    };

    this.coreSlotLivenessSummary = {
      findMany: async (args = {}) => {
        let r = this._livenessSummaries.filter((s) => s.slotId === args.where.slotId);
        if (args.where?.windowKind !== undefined) r = r.filter((s) => s.windowKind === args.where.windowKind);
        r.sort((a, b) => (a.windowKind < b.windowKind ? -1 : a.windowKind > b.windowKind ? 1 : 0));
        return r;
      },
    };

    this.coreSlotHealthSnapshot = {
      findFirst: async (args) => this._healthSnapshots.find((h) => h.slotId === args.where.slotId) ?? null,
    };

    this.networkLivenessRiskSnapshot = {
      findFirst: async () => this._networkRisk,
    };
  }

  async $queryRaw(strings) {
    if (this._dbDown) throw new Error('connection refused');
    const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (sql.includes('_prisma_migrations')) return [{ failed: this._failedMigrations }];
    return [{ ok: 1 }];
  }

  async $disconnect() {}
}

export function block(height, overrides = {}) {
  return {
    height: BigInt(height),
    hash: `HASH${height}`,
    time: new Date('2026-06-26T00:00:00.000Z'),
    chainId: 'twilight-localnet-1',
    proposerAddress: 'ABCDEF0123',
    appHash: 'app',
    validatorsHash: 'vh',
    nextValidatorsHash: 'nvh',
    lastBlockHash: 'lbh',
    txCount: 0,
    rawJson: { height },
    createdAt: new Date('2026-06-26T00:00:01.000Z'),
    ...overrides,
  };
}

export function tx(hash, height, index, overrides = {}) {
  return {
    hash,
    height: BigInt(height),
    index,
    status: 'success',
    code: 0,
    gasWanted: 100000n,
    gasUsed: 80000n,
    memo: null,
    feeJson: { amount: [{ denom: 'utwlt', amount: '5' }] },
    signerAddressesJson: ['twilight1signer'],
    messageTypesJson: ['/twilight.coreslot.MsgUpdate'],
    rawTx: { tx: hash },
    rawResultJson: { result: hash },
    createdAt: new Date('2026-06-26T00:00:02.000Z'),
    ...overrides,
  };
}

export function msg(txHash, msgIndex, overrides = {}) {
  return {
    id: BigInt(msgIndex + 1),
    txHash,
    height: 1n,
    msgIndex,
    typeUrl: '/twilight.coreslot.MsgUpdate',
    module: 'coreslot',
    typeName: 'MsgUpdate',
    decodedJson: { a: 1 },
    rawJson: { raw: msgIndex },
    decodeError: null,
    ...overrides,
  };
}

export function evt(txHash, eventIndex, overrides = {}) {
  return {
    id: BigInt(eventIndex + 1),
    eventKey: `${txHash}:${eventIndex}`,
    height: 1n,
    txHash,
    txIndex: 0,
    msgIndex: 0,
    eventIndex,
    phase: 'tx',
    type: 'message',
    attributesJson: [{ key: 'action', value: 'update' }],
    module: 'coreslot',
    keyFieldsJson: null,
    ...overrides,
  };
}

export function account(address, overrides = {}) {
  return {
    address,
    firstSeenHeight: 10n,
    lastSeenHeight: 20n,
    txCount: 3,
    accountKind: 'base',
    rawAccountJson: { address },
    createdAt: new Date('2026-06-26T00:00:00.000Z'),
    updatedAt: new Date('2026-06-26T00:00:00.000Z'),
    ...overrides,
  };
}

export function decodeFailure(id, overrides = {}) {
  return {
    id: BigInt(id),
    height: 5n,
    txHash: 'TXH',
    msgIndex: 0,
    eventIndex: null,
    typeUrl: '/some.Type',
    eventType: null,
    failureKind: 'unknown_message_type',
    rawJson: { big: 'payload' },
    rawBase64: 'AAAA',
    decodeError: 'boom',
    resolved: false,
    resolvedAt: null,
    createdAt: new Date('2026-06-26T00:00:03.000Z'),
    ...overrides,
  };
}

export function coreSlot(slotId, overrides = {}) {
  return {
    slotId: BigInt(slotId),
    status: 'ACTIVE',
    operatorAddress: `twilight1op${slotId}`,
    payoutAddress: `twilight1pay${slotId}`,
    consensusAddress: `cafe${slotId}`,
    consensusPubkeyJson: { key: `pk${slotId}` },
    metadataJson: { moniker: `slot${slotId}` },
    rewardWeight: '1',
    consensusPower: 10n,
    createdHeight: 1n,
    updatedHeight: 100n,
    removedHeight: null,
    rawSnapshotJson: { slotId },
    createdAt: new Date('2026-06-26T00:00:00.000Z'),
    updatedAtDb: new Date('2026-06-26T00:00:00.000Z'),
    ...overrides,
  };
}

export function lifecycleEvent(slotId, height, id, overrides = {}) {
  return {
    id: BigInt(id),
    slotId: BigInt(slotId),
    height: BigInt(height),
    txHash: `TX${id}`,
    msgIndex: 0,
    eventType: 'activate',
    oldStatus: 'INACTIVE',
    newStatus: 'ACTIVE',
    operatorAddress: `twilight1op${slotId}`,
    consensusAddress: `cafe${slotId}`,
    power: 10n,
    reason: null,
    authority: null,
    ...overrides,
  };
}

export function metadataChange(slotId, height, id, overrides = {}) {
  return {
    id: BigInt(id),
    slotId: BigInt(slotId),
    height: BigInt(height),
    txHash: `TX${id}`,
    msgIndex: 0,
    operatorAddress: `twilight1op${slotId}`,
    metadataJson: { moniker: `m${id}` },
    ...overrides,
  };
}

export function payoutChange(slotId, height, id, overrides = {}) {
  return {
    id: BigInt(id),
    slotId: BigInt(slotId),
    height: BigInt(height),
    txHash: `TX${id}`,
    msgIndex: 0,
    operatorAddress: `twilight1op${slotId}`,
    newPayoutAddress: `twilight1pay${id}`,
    ...overrides,
  };
}

export function keyRotation(slotId, id, overrides = {}) {
  return {
    id: BigInt(id),
    slotId: BigInt(slotId),
    status: 'applied',
    operatorAddress: `twilight1op${slotId}`,
    oldConsensusAddress: `old${slotId}`,
    newConsensusAddress: `new${slotId}`,
    requestedHeight: 50n,
    effectiveHeight: 52n,
    appliedHeight: 52n,
    cancelledHeight: null,
    reason: null,
    requestTxHash: `REQ${id}`,
    appliedTxHash: `APP${id}`,
    cancelledTxHash: null,
    ...overrides,
  };
}

export function consensusWindow(slotId, id, from, to, overrides = {}) {
  return {
    id: BigInt(id),
    slotId: BigInt(slotId),
    operatorAddress: `twilight1op${slotId}`,
    consensusAddress: `cafe${slotId}`,
    consensusPower: 10n,
    validatorUpdateHeight: BigInt(from),
    effectiveFromHeight: BigInt(from),
    effectiveToHeight: to === null ? null : BigInt(to),
    status: 'ACTIVE',
    openedByKind: 'lifecycle',
    closedByKind: to === null ? null : 'key_rotation',
    ...overrides,
  };
}

export function livenessSummary(slotId, windowKind, overrides = {}) {
  return {
    slotId: BigInt(slotId),
    windowKind,
    windowSize: windowKind === 'lifetime' ? null : Number(windowKind.split('_')[1]),
    operatorAddress: `twilight1op${slotId}`,
    consensusAddress: `cafe${slotId}`,
    firstCommittedHeight: 1n,
    lastCommittedHeight: 360n,
    spanHeightCount: 360n,
    evidenceHeightCount: 360,
    expectedCount: 360,
    signedCount: 360,
    missedCount: 0,
    absentMissedCount: 0,
    nilMissedCount: 0,
    uptimeBps: 10000,
    currentSignedStreak: 360,
    currentMissedStreak: 0,
    latestMissedHeight: null,
    invalidHeightCount: 0,
    summaryStatus: 'complete',
    ...overrides,
  };
}

export function healthSnapshot(slotId, overrides = {}) {
  return {
    slotId: BigInt(slotId),
    healthStatus: 'healthy',
    healthReason: null,
    isActiveAtLatest: true,
    primaryWindowKind: 'recent_100',
    expectedCount: 100,
    signedCount: 100,
    missedCount: 0,
    absentMissedCount: 0,
    nilMissedCount: 0,
    uptimeBps: 10000,
    lifetimeUptimeBps: 10000,
    recent500UptimeBps: 10000,
    recent1000UptimeBps: 10000,
    currentSignedStreak: 100,
    currentMissedStreak: 0,
    latestMissedHeight: null,
    firstCommittedHeight: 1n,
    lastCommittedHeight: 360n,
    summaryStatus: 'complete',
    invalidHeightCount: 0,
    policyVersion: 'coreslot_health_policy_v1',
    updatedAtDb: new Date('2026-06-26T00:00:00.000Z'),
    ...overrides,
  };
}

export function networkRisk(overrides = {}) {
  return {
    haltRiskLevel: 'low',
    haltRiskReason: null,
    latestCommittedHeight: 360n,
    activeSlotCount: 4,
    healthySlotCount: 4,
    degradedSlotCount: 0,
    downSlotCount: 0,
    incompleteSlotCount: 0,
    unknownSlotCount: 0,
    availableSlotCount: 4,
    unavailableSlotCount: 0,
    availablePowerBps: 10000,
    unavailablePowerBps: 0,
    policyVersion: 'coreslot_health_policy_v1',
    updatedAtDb: new Date('2026-06-26T00:00:00.000Z'),
    ...overrides,
  };
}
