import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

const createPrismaClient = () => new PrismaClient().$extends(withAccelerate());

type PrismaClientWithAccelerate = ReturnType<typeof createPrismaClient>;

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClientWithAccelerate | undefined;
}

if (!global.prismaGlobal) {
  global.prismaGlobal = createPrismaClient();
}

const prisma = global.prismaGlobal;

export default prisma;
