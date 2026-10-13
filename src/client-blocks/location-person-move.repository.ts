import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  clientBlocks,
  clientMembers,
  clientUnits,
  locationPersonMoves,
  registrations,
} from '../database/schema';
import type { MoveLocationPersonInput } from '../validation/client-blocks.schema';
import { locationJson } from './client-blocks.repository';

@Injectable()
export class LocationPersonMoveRepository {
  constructor(private readonly database: DatabaseService) {}

  async move(
    clientId: string,
    actorUserId: string,
    input: MoveLocationPersonInput,
  ) {
    if (input.sourceUnitId === input.targetUnitId) {
      throw new BadRequestException('Escolha uma unidade diferente da atual.');
    }
    return this.database.db.transaction(async (tx) => {
      // Lock both units and blocks so names/activity cannot change mid-move.
      const locations = await tx
        .select({ unit: clientUnits, block: clientBlocks })
        .from(clientUnits)
        .innerJoin(clientBlocks, eq(clientBlocks.id, clientUnits.blockId))
        .where(
          and(
            eq(clientUnits.clientId, clientId),
            eq(clientBlocks.clientId, clientId),
            inArray(clientUnits.id, [input.sourceUnitId, input.targetUnitId]),
          ),
        )
        .orderBy(clientUnits.id)
        .for('update');
      const source = locations.find(
        (row) => row.unit.id === input.sourceUnitId,
      );
      const target = locations.find(
        (row) => row.unit.id === input.targetUnitId,
      );
      if (!source)
        throw new NotFoundException('Unidade de origem não encontrada.');
      if (
        !target ||
        !target.unit.isActive ||
        !target.block.isActive ||
        target.block.id !== input.targetBlockId
      ) {
        throw new BadRequestException(
          'Bloco ou unidade de destino inválido ou inativo.',
        );
      }

      // Read the member's registration, then always lock registration before member.
      // This order also serializes edits through either representation of a person.
      const initialMember =
        input.kind === 'member'
          ? (
              await tx
                .select()
                .from(clientMembers)
                .where(
                  and(
                    eq(clientMembers.clientId, clientId),
                    eq(clientMembers.id, input.personId),
                  ),
                )
            )[0]
          : null;
      if (input.kind === 'member' && !initialMember)
        throw new NotFoundException('Pessoa não encontrada.');
      const registrationId =
        input.kind === 'registration'
          ? input.personId
          : initialMember?.registrationId;
      const registration = registrationId
        ? (
            await tx
              .select()
              .from(registrations)
              .where(
                and(
                  eq(registrations.clientId, clientId),
                  eq(registrations.id, registrationId),
                ),
              )
              .for('update')
          )[0]
        : null;
      if (registrationId && !registration)
        throw new NotFoundException('Cadastro não encontrado.');
      const members = await tx
        .select()
        .from(clientMembers)
        .where(
          and(
            eq(clientMembers.clientId, clientId),
            input.kind === 'member'
              ? eq(clientMembers.id, input.personId)
              : eq(clientMembers.registrationId, input.personId),
          ),
        )
        .for('update');
      const member = members[0];
      if (
        input.kind === 'member' &&
        (!member || member.registrationId !== initialMember?.registrationId)
      ) {
        throw new ConflictException(
          'O cadastro foi alterado. Atualize a tela e tente novamente.',
        );
      }
      const selected = input.kind === 'member' ? member : registration;
      if (!selected) throw new NotFoundException('Pessoa não encontrada.');
      if (selected.unitId !== input.sourceUnitId) {
        throw new ConflictException(
          'A pessoa mudou de unidade. Atualize a tela e tente novamente.',
        );
      }
      // A null legacy mirror can be repaired, but a different link needs review.
      if (
        [registration, ...members].some(
          (row) => row?.unitId && row.unitId !== input.sourceUnitId,
        )
      ) {
        throw new ConflictException(
          'Cadastro e membro estão em unidades diferentes. Revise os vínculos antes de mover.',
        );
      }
      const patch = {
        unitId: target.unit.id,
        additionalData: locationJson(target.block.name, target.unit.name),
        updatedAt: new Date(),
      };
      if (registration)
        await tx
          .update(registrations)
          .set(patch)
          .where(
            and(
              eq(registrations.clientId, clientId),
              eq(registrations.id, registration.id),
            ),
          );
      if (member)
        await tx
          .update(clientMembers)
          .set(patch)
          .where(
            and(
              eq(clientMembers.clientId, clientId),
              eq(clientMembers.id, member.id),
            ),
          );
      await tx.insert(locationPersonMoves).values({
        clientId,
        actorUserId,
        personKind: input.kind,
        personId: input.personId,
        sourceUnitId: source.unit.id,
        targetUnitId: target.unit.id,
        sourceBlockName: source.block.name,
        sourceUnitName: source.unit.name,
        targetBlockName: target.block.name,
        targetUnitName: target.unit.name,
      });
      // Deliberately keep source unit active, even when now empty.
    });
  }
}
