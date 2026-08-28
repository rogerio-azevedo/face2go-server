import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import * as clientsQueries from '../database/queries/clients.queries';
import * as invitationQueries from '../database/queries/responsible-invitations.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import { DatabaseService } from '../database/database.service';
import { users } from '../database/schema';
import { storeReaderFaceVariants } from '../face-sync/face-image-variants';
import { R2StorageService } from '../storage/r2-storage.service';
import { parseUploadedImageFile } from '../storage/uploaded-image.util';
import { publicResponsibleRegisterSubmitSchema } from '../validation/managed-responsibles.schema';
import { zodFirstMessage } from '../validation/zod-utils';
import { resolveClientAppBrand } from '../common/utils/client-app-brand';
import { ManagedResponsiblesService } from './managed-responsibles.service';

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
      appBrand: resolveClientAppBrand(client.ienhFilialCode),
      inviterName,
      studentLinks: students.map((s) => ({
        studentName: s.studentName,
        relationshipType: s.relationshipType,
        isAuthorizedPickup: s.isAuthorizedPickup,
      })),
      status: row.status,
      faceApprovalStatus: row.faceApprovalStatus,
    };
  }

  async uploadPhoto(code: string, file: Express.Multer.File) {
    const row = await this.resolveActiveInvitation(code);
    if (row.status === 'submitted' || row.faceApprovalStatus === 'submitted') {
      throw new ConflictException('O cadastro deste convite já foi enviado.');
    }
    if (row.faceApprovalStatus === 'approved') {
      throw new ConflictException('Este convite já foi aprovado.');
    }

    const { buffer, contentType, ext } = parseUploadedImageFile(file, this.r2);
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
    void storeReaderFaceVariants(this.r2, key, buffer);
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

    const email = parsed.data.email?.trim() || undefined;
    const password = parsed.data.password || undefined;

    if (email) {
      const existing = await this.database.db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (existing) {
        if (!password) {
          throw new BadRequestException(
            'Informe a senha para vincular à conta existente.',
          );
        }
        if (!existing.password) {
          throw new ConflictException('E-mail já cadastrado.');
        }
        const passwordOk = await bcrypt.compare(password, existing.password);
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

    const hashed = password ? await bcrypt.hash(password, 10) : null;
    const updated = await invitationQueries.invitationUpdate(
      this.database.db,
      row.id,
      row.clientId,
      {
        status: 'submitted',
        faceApprovalStatus: 'submitted',
        submittedName: parsed.data.name,
        submittedEmail: email ?? null,
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
