export const PROJECTION_ADVISORY_LOCK_KEY = {
  namespace: 847_002,
  key: 202_606_24,
} as const;

export interface ProjectionAdvisoryLockPrisma {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export class ProjectionLockUnavailableError extends Error {
  constructor() {
    super('Twilight explorer projection advisory lock is already held');
    this.name = 'ProjectionLockUnavailableError';
  }
}

export async function withProjectionAdvisoryLock<T>(
  prisma: ProjectionAdvisoryLockPrisma,
  fn: () => Promise<T>,
): Promise<T> {
  const acquiredRows = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_lock(${PROJECTION_ADVISORY_LOCK_KEY.namespace}::integer, ${PROJECTION_ADVISORY_LOCK_KEY.key}::integer) AS acquired
  `;
  const acquired = acquiredRows[0]?.acquired === true;
  if (!acquired) throw new ProjectionLockUnavailableError();

  try {
    return await fn();
  } finally {
    await prisma.$queryRaw`
      SELECT pg_advisory_unlock(${PROJECTION_ADVISORY_LOCK_KEY.namespace}::integer, ${PROJECTION_ADVISORY_LOCK_KEY.key}::integer) AS released
    `;
  }
}
