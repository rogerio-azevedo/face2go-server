import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { z } from 'zod';

import * as clientsQueries from '../database/queries/clients.queries';
import * as pickupQueries from '../database/queries/pickup-authorizations.queries';
import { DatabaseService } from '../database/database.service';
import {
  PICKUP_GUEST_FACE_SUBMITTED,
  type PickupGuestFaceSubmittedPayload,
} from '../notifications/notifications.events';
import { R2StorageService } from '../storage/r2-storage.service';
import { zodFirstMessage } from '../validation/zod-utils';
import { PickupAuthorizationsService } from './pickup-authorizations.service';

const uploadPhotoBodySchema = z.object({
  imageBase64: z.string().min(100),
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class PublicPickupRegisterService {
  constructor(
    private readonly database: DatabaseService,
    private readonly r2: R2StorageService,
    private readonly pickupAuthorizations: PickupAuthorizationsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async resolveActiveAuth(code: string) {
    const row = await this.pickupAuthorizations.getAuthByGuestLinkCode(code);
    if (!row) {
      throw new NotFoundException('Link inválido, expirado ou desativado.');
    }
    if (!row.guestLinkCode) {
      throw new NotFoundException('Link inválido.');
    }
    const now = new Date();
    const validFrom =
      row.validFrom instanceof Date
        ? row.validFrom
        : new Date(String(row.validFrom));
    if (now.getTime() < validFrom.getTime()) {
      throw new NotFoundException('Autorização ainda não está em vigência.');
    }
    return row;
  }

  async getPreview(code: string) {
    const row = await this.resolveActiveAuth(code);
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      row.clientId,
    );
    if (!client?.isActive) {
      throw new NotFoundException('Link inválido ou escola inativa.');
    }
    const students = await pickupQueries.pickupAuthListStudentsForAuth(
      this.database.db,
      row.id,
    );
    return {
      clientName: client.name,
      guestName: row.guestName,
      studentNames: students.map((s) => s.studentName),
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      guestApprovalStatus: row.guestApprovalStatus,
    };
  }

  async uploadPhoto(code: string, body: unknown) {
    const parsed = uploadPhotoBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const row = await this.resolveActiveAuth(code);
    if (row.guestApprovalStatus === 'approved') {
      throw new ConflictException('Esta autorização já foi aprovada.');
    }
    if (row.guestApprovalStatus === 'submitted') {
      throw new ConflictException('A foto desta autorização já foi enviada.');
    }
    // rejected → permite novo envio

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
    const contentType = mime.split(';')[0]?.trim().toLowerCase() ?? 'image/jpeg';
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      row.clientId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const key = this.r2.buildPickupGuestFaceKey(
      client.companyId,
      row.clientId,
      row.id,
      ext,
    );
    await this.r2.putObject(key, buffer, contentType);
    return { faceImageKey: key };
  }

  async submit(code: string, body: unknown) {
    const parsed = z
      .object({ faceImageKey: z.string().min(1) })
      .safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const row = await this.resolveActiveAuth(code);
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      row.clientId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const { faceImageKey } = parsed.data;
    const re = new RegExp(
      `^${escapeRegex(client.companyId)}/${escapeRegex(client.id)}/pickup/${escapeRegex(row.id)}/face\\.(jpg|png|webp)$`,
    );
    if (!re.test(faceImageKey)) {
      throw new BadRequestException('Chave da foto inválida.');
    }

    await this.r2.assertObjectExists(faceImageKey);

    if (row.guestApprovalStatus === 'approved') {
      throw new ConflictException('Esta autorização já foi aprovada.');
    }
    if (row.guestApprovalStatus === 'submitted') {
      throw new ConflictException('A foto já foi enviada.');
    }

    const updated = await pickupQueries.pickupAuthUpdateGuestFaceSubmitted(
      this.database.db,
      row.id,
      faceImageKey,
    );
    if (!updated) {
      throw new NotFoundException('Autorização não encontrada.');
    }

    this.eventEmitter.emit(PICKUP_GUEST_FACE_SUBMITTED, {
      authorizationId: row.id,
      clientId: row.clientId,
      requestedByResponsibleId: row.requestedByResponsibleId,
      guestName: row.guestName,
    } satisfies PickupGuestFaceSubmittedPayload);

    return {
      success: true as const,
      message:
        'Foto recebida. O responsável que criou a autorização precisa aprovar o cadastro.',
    };
  }
}
