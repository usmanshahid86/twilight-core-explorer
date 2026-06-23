export const INDEXER_ADVISORY_LOCK_KEY = {
  namespace: 847_001,
  key: 202_606_24,
} as const;

export interface AdvisoryLockPrisma {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export class IndexerLockUnavailableError extends Error {
  constructor() {
    super('Twilight explorer indexer advisory lock is already held');
    this.name = 'IndexerLockUnavailableError';
  }
}

export async function withIndexerAdvisoryLock<T>(
  prisma: AdvisoryLockPrisma,
  fn: () => Promise<T>,
): Promise<T> {
  const acquiredRows = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_lock(${INDEXER_ADVISORY_LOCK_KEY.namespace}, ${INDEXER_ADVISORY_LOCK_KEY.key}) AS acquired
  `;
  const acquired = acquiredRows[0]?.acquired === true;
  if (!acquired) throw new IndexerLockUnavailableError();

  try {
    return await fn();
  } finally {
    await prisma.$queryRaw`
      SELECT pg_advisory_unlock(${INDEXER_ADVISORY_LOCK_KEY.namespace}, ${INDEXER_ADVISORY_LOCK_KEY.key}) AS released
    `;
  }
}
