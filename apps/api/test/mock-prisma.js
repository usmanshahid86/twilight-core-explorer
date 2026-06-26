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
        const inList = args.where?.height?.in;
        if (!inList) return [...this._attributions];
        return this._attributions.filter((a) => inList.some((h) => h === a.height));
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
