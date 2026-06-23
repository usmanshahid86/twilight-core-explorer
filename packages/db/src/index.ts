export { PrismaClient } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}
