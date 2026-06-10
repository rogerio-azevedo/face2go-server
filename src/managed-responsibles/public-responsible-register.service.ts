import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import * as clientsQueries from '../database/queries/clients.queries';
import * as invitationQueries from '../database/queries/responsible-invitations.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import { DatabaseService } from '../database/database.service';
import { users } from '../database/schema';
import { R2StorageService } from '../storage/r2-storage.service';
import { publicResponsibleRegisterSubmitSchema } from '../validation/managed-responsibles.schema';
import { zodFirstMessage } from '../validation/zod-utils';
import { ManagedResponsiblesService } from './managed-responsibles.service';

const uploadPhotoBodySchema = z.object({
  imageBase64: z.string().min(100),
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class PublicResponsibleRegisterService {
  constructor(
    private readonly database: DatabaseService,
    private readonly r2: R2StorageService,
    private readonly managedResponsibles: ManagedResponsiblesService,
  ) {}

  private async resolveActiveInvitation(code: string) {
    const row = await this.managedResponsibles.getInvitationByLinkCode(code);
    if (!row) {
      throw new NotFoundException('Link inválido ou desativado.');
    }
    if (row.status === 'cancelled' || row.status === 'approved') {
      throw new NotFoundException('Link inválido ou já utilizado.');
    }
    if (!row.guestLinkCode) {
      throw new NotFoundException('Link inválido.');
    }
    return row;
  }

  async getPreview(code: string) {
    const row = await this.resolveActiveInvitation(code);
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      row.clientId,
    );
    if (!client?.isActive) {
      throw new NotFoundException('Link inválido ou escola inativa.');
    }
    const inviterName = await invitationQueries.invitationGetInviterName(
      this.database.db,
      row.inviterResponsibleId,
    );
    const students =
      await invitationQueries.invitationListStudentsForInvitation(
        this.database.db,
        row.id,
      );
    return {
      clientName: client.name,
      inviterName,
      studentLinks: students.map((s) => ({
        studentName: s.studentName,
        relationshipType: s.relationshipType,
        isAuthorizedPickup: s.isAuthorizedPickup,
      })),
      status: row.status,
      faceApprovalStatus: row.faceApprovalStatus,
      plateApprovalStatus: row.plateApprovalStatus,
    };
  }

  async uploadPhoto(code: string, body: unknown) {
    const parsed = uploadPhotoBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const row = await this.resolveActiveInvitation(code);
    if (row.status === 'submitted' || row.faceApprovalStatus === 'submitted') {
      throw new ConflictException('O cadastro deste convite já foi enviado.');
    }
    if (row.faceApprovalStatus === 'approved') {
      throw new ConflictException('Este convite já foi aprovado.');
    }

    let payload = parsed.data.imageBase64.trim();
    let mime = 'image/jpeg';
    const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/i.exec(payload);
    if (dataUrlMatch) {
      mime = dataUrlMatch[1].trim().toLowerCase();
      payload = dataUrlMatch[2].replace(/\s/g, '');
    } else {
      payload = payload.replace(/\s/g, '');
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(payload, 'base64');
    } catch {
      throw new BadRequestException('Imagem inválida.');
    }

    if (buffer.length < 200) {
      throw new BadRequestException('Imagem inválida ou muito pequena.');
    }
    const maxBytes = 5 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new BadRequestException('Imagem maior que 5 MB.');
    }

    const ext = this.r2.extForImageMime(mime);
    const contentType =
      mime.split(';')[0]?.trim().toLowerCase() ?? 'image/jpeg';
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      row.clientId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const key = this.r2.buildResponsibleInvitationFaceKey(
      client.companyId,
      row.clientId,
      row.id,
      ext,
    );
    await this.r2.putObject(key, buffer, contentType);
    return { faceImageKey: key };
  }

  async submit(code: string, body: unknown) {
    const parsed = publicResponsibleRegisterSubmitSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const row = await this.resolveActiveInvitation(code);
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      row.clientId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const existing = await this.database.db.query.users.findFirst({
      where: eq(users.email, parsed.data.email),
    });
    if (existing) {
      if (!existing.password) {
        throw new ConflictException('E-mail já cadastrado.');
      }
      const passwordOk = await bcrypt.compare(
        parsed.data.password,
        existing.password,
      );
      if (!passwordOk) {
        throw new UnauthorizedException(
          'Este e-mail já possui conta. Informe a senha correta para vincular à nova escola.',
        );
      }
      const alreadyInSchool =
        await responsiblesQueries.getResponsibleByUserIdAndClient(
          this.database.db,
          existing.id,
          row.clientId,
        );
      if (alreadyInSchool) {
        throw new ConflictException('Você já está vinculado a esta escola.');
      }
    }

    const { faceImageKey } = parsed.data;
    const re = new RegExp(
      `^${escapeRegex(client.companyId)}/${escapeRegex(client.id)}/responsible-invitation/${escapeRegex(row.id)}/face\\.(jpg|png|webp)$`,
    );
    if (!re.test(faceImageKey)) {
      throw new BadRequestException('Chave da foto inválida.');
    }

    await this.r2.assertObjectExists(faceImageKey);

    if (row.status === 'submitted') {
      throw new ConflictException('O cadastro deste convite já foi enviado.');
    }

    const hashed = await bcrypt.hash(parsed.data.password, 10);
    const hasVehicle = !!parsed.data.vehicle?.plate?.trim();

    const updated = await invitationQueries.invitationUpdate(
      this.database.db,
      row.id,
      row.clientId,
      {
        status: 'submitted',
        faceApprovalStatus: 'submitted',
        plateApprovalStatus: hasVehicle ? 'submitted' : 'approved',
        submittedName: parsed.data.name,
        submittedEmail: parsed.data.email,
        submittedPhone: parsed.data.phone ?? null,
        submittedDocument: parsed.data.document ?? null,
        submittedPasswordHash: hashed,
        faceImageKey,
        vehiclePlate: parsed.data.vehicle?.plate ?? null,
        vehicleBrand: parsed.data.vehicle?.brand ?? null,
        vehicleModel: parsed.data.vehicle?.model ?? null,
        vehicleColor: parsed.data.vehicle?.color ?? null,
      },
    );
    if (!updated) {
      throw new NotFoundException('Convite não encontrado.');
    }

    this.managedResponsibles.emitInvitationSubmitted({
      invitationId: row.id,
      clientId: row.clientId,
      inviterResponsibleId: row.inviterResponsibleId,
      guestName: parsed.data.name,
    });

    return {
      success: true as const,
      message:
        'Cadastro enviado. O responsável que convidou precisa aprovar sua foto e placa.',
    };
  }
}
