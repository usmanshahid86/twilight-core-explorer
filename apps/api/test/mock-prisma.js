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

export class MockPrisma {
  constructor(data = {}) {
    this._indexerCursor = data.indexerCursor ?? null;
    this._projectionCursors = data.projectionCursors ?? [];
    this._failures = data.failures ?? []; // [{ projectionName, resolved }]
    this._blocks = data.blocks ?? [];
    this._attributions = data.attributions ?? [];
    this._dbDown = data.dbDown ?? false;
    this._failedMigrations = data.failedMigrations ?? 0;

    this.indexerCursor = {
      findFirst: async () => this._indexerCursor,
    };

    this.projectionCursor = {
      findMany: async () => [...this._projectionCursors],
    };

    this.projectionFailure = {
      groupBy: async () => {
        const counts = new Map();
        for (const f of this._failures) {
          if (f.resolved) continue;
          counts.set(f.projectionName, (counts.get(f.projectionName) ?? 0) + 1);
        }
        return [...counts.entries()].map(([projectionName, n]) => ({
          projectionName,
          _count: { _all: n },
        }));
      },
    };

    this.block = {
      findMany: async (args = {}) => {
        let rows = [...this._blocks];
        const lt = args.where?.height?.lt;
        if (lt !== undefined) rows = rows.filter((b) => b.height < lt);
        rows.sort((a, b) => (a.height < b.height ? 1 : a.height > b.height ? -1 : 0)); // desc
        return args.take ? rows.slice(0, args.take) : rows;
      },
      findUnique: async (args) =>
        this._blocks.find((b) => b.height === args.where.height) ?? null,
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
    hash: `hash${height}`,
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
