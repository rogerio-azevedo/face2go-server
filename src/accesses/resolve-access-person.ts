import type { AppDb } from '../database/database.types';
import * as clientInviteQueries from '../database/queries/client-invites.queries';
import * as membersQueries from '../database/queries/members.queries';
import * as pickupQueries from '../database/queries/pickup-authorizations.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import type { ResolvedAccessPerson } from '../common/access-person.types';
import { and, eq } from 'drizzle-orm';
import { registrations } from '../database/schema';

export async function resolveAccessPersonByFaceId(
  db: AppDb,
  faceId: number,
  clientId: string,
): Promise<ResolvedAccessPerson | null> {
  try {
    const responsible =
      await responsiblesQueries.findResponsibleByFaceIdAndClientId(
        db,
        faceId,
        clientId,
      );
    if (responsible) {
      return {
        personId: responsible.id,
        personType: 'responsible',
        personName: responsible.name,
      };
    }
  } catch {
    /* ignore lookup failure */
  }

  try {
    const student = await studentsQueries.findStudentByFaceIdAndClientId(
      db,
      faceId,
      clientId,
    );
    if (student) {
      return {
        personId: student.id,
        personType: 'student',
        personName: student.name,
      };
    }
  } catch {
    /* ignore lookup failure */
  }

  try {
    const member = await membersQueries.findMemberByFaceIdAndClientId(
      db,
      faceId,
      clientId,
    );
    if (member) {
      return {
        personId: member.id,
        personType: 'member',
        personName: member.name,
      };
    }
  } catch {
    /* ignore lookup failure */
  }

  try {
    const [registration] = await db
      .select({ id: registrations.id, name: registrations.name })
      .from(registrations)
      .where(
        and(
          eq(registrations.clientId, clientId),
          eq(registrations.faceId, faceId),
          eq(registrations.status, 'approved'),
        ),
      )
      .limit(1);
    const name = registration?.name?.trim();
    if (registration && name) {
      return {
        personId: registration.id,
        personType: 'guest',
        personName: name,
      };
    }
  } catch {
    /* ignore lookup failure */
  }

  try {
    const pickupAuths = await pickupQueries.pickupAuthFindActiveByGuestFaceId(
      db,
      clientId,
      faceId,
    );
    const guestName = pickupAuths[0]?.guestName?.trim();
    if (pickupAuths[0] && guestName) {
      return {
        personId: pickupAuths[0].id,
        personType: 'guest',
        personName: guestName,
      };
    }
  } catch {
    /* ignore lookup failure */
  }

  try {
    const inviteAuths = await clientInviteQueries.inviteFindActiveByGuestFaceId(
      db,
      clientId,
      faceId,
    );
    const guestName = inviteAuths[0]?.guestName?.trim();
    if (inviteAuths[0] && guestName) {
      return {
        personId: inviteAuths[0].id,
        personType: 'guest',
        personName: guestName,
      };
    }
  } catch {
    /* ignore lookup failure */
  }

  return null;
}
