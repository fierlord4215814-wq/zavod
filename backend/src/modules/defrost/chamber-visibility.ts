import { Prisma } from '@prisma/client';

// Legacy line events have no chamberId. They remain on their original line;
// the one-to-one catalogue row decides whether ordinary reads may expose them.
export const visibleDefrostEventWhere: Prisma.DefrostEventWhereInput = {
  OR: [
    { lineId: { not: null }, line: { chamber: { is: { hiddenAt: null } } } },
    { chamberId: { not: null }, chamber: { hiddenAt: null } },
  ],
};
