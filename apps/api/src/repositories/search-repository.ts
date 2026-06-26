// Search lookups. Each is a single indexed point-read; the route classifies the query string and
// calls the relevant ones. References only — never returns full entities.

import type { PrismaClient } from '@twilight-explorer/db';

export async function findBlockByHeight(prisma: PrismaClient, height: bigint) {
  return prisma.block.findUnique({ where: { height }, select: { height: true, hash: true } });
}

export async function findBlockByHash(prisma: PrismaClient, hash: string) {
  return prisma.block.findUnique({ where: { hash }, select: { height: true, hash: true } });
}

export async function findTxByHash(prisma: PrismaClient, hash: string) {
  return prisma.explorerTransaction.findUnique({
    where: { hash },
    select: { hash: true, height: true },
  });
}

export async function findAccountByAddress(prisma: PrismaClient, address: string) {
  return prisma.account.findUnique({ where: { address }, select: { address: true } });
}
