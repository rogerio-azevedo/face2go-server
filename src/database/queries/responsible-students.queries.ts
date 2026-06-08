import { and, eq } from 'drizzle-orm';

import type { AppDb } from '../database.types';
import { responsibleStudents } from '../schema';

export async function findResponsibleStudentLink(
  db: AppDb,
  responsibleId: string,
  studentId: string,
) {
  const [row] = await db
    .select({ id: responsibleStudents.id })
    .from(responsibleStudents)
    .where(
      and(
        eq(responsibleStudents.responsibleId, responsibleId),
        eq(responsibleStudents.studentId, studentId),
      ),
    )
    .limit(1);
  return row;
}

export async function findOrCreateResponsibleStudentLink(
  db: AppDb,
  args: {
    responsibleId: string;
    studentId: string;
    relationshipType:
      | 'parent'
      | 'grandparent'
      | 'aunt_uncle'
      | 'sibling'
      | 'godparent'
      | 'guardian'
      | 'other';
  },
): Promise<{ created: boolean }> {
  const existing = await findResponsibleStudentLink(
    db,
    args.responsibleId,
    args.studentId,
  );
  if (existing) {
    return { created: false };
  }
  await db.insert(responsibleStudents).values({
    responsibleId: args.responsibleId,
    studentId: args.studentId,
    relationshipType: args.relationshipType,
    isAuthorizedPickup: true,
  });
  return { created: true };
}
