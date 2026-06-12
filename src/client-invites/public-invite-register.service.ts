import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { z } from 'zod';

import { normalizeCpf } from '../auth/utils/auth-identifiers';
import * as clientsQueries from '../database/queries/clients.queries';
import * as inviteQueries from '../database/queries/client-invites.queries';
import { DatabaseService } from '../database/database.service';
import {
  INVITE_GUEST_FACE_SUBMITTED,
  type InviteGuestFaceSubmittedPayload,
} from '../notifications/notifications.events';
import { R2StorageService } from '../storage/r2-storage.service';
import { zodFirstMessage } from '../validation/zod-utils';
import { InvitesService } from './invites.service';

const uploadPhotoBodySchema = z.object({
  imageBase64: z.string().min(100),
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class PublicInviteRegisterService {
  constructor(
    private readonly database: DatabaseService,
    private readonly r2: R2StorageService,
    private readonly invites: InvitesService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async resolveActiveInvite(code: string) {
    const row = await this.invites.getInviteByGuestLinkCode(code);
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
      throw new NotFoundException('Convite ainda não está em vigência.');
    }
    return row;
  }

  async getPreview(code: string) {
    const row = await this.resolveActiveInvite(code);
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      row.clientId,
    );
    if (!client?.isActive) {
      throw new NotFoundException('Link inválido ou cliente inativo.');
    }
    return {
      clientName: client.name,
      guestName: row.guestName ?? '',
      needsGuestData: !row.guestName,
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

    const row = await this.resolveActiveInvite(code);
    if (row.guestApprovalStatus === 'approved') {
      throw new ConflictException('Este convite já foi aprovado.');
    }
    if (row.guestApprovalStatus === 'submitted') {
      throw new ConflictException('A foto deste convite já foi enviada.');
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

    const key = this.r2.buildInviteGuestFaceKey(
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
      .object({
        faceImageKey: z.string().min(1),
        guestName: z.string().trim().min(1).max(255).optional(),
        guestDocument: z.string().trim().min(1).max(64).optional(),
        guestPhone: z.string().trim().max(32).nullable().optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const row = await this.resolveActiveInvite(code);
    const client = await clientsQueries.getClientByIdOnly(
      this.database.db,
      row.clientId,
    );
    if (!client) {
      throw new NotFoundException('Cliente não encontrado.');
    }

    const { faceImageKey } = parsed.data;
    const re = new RegExp(
      `^${escapeRegex(client.companyId)}/${escapeRegex(client.id)}/invite/${escapeRegex(row.id)}/face\\.(jpg|png|webp)$`,
    );
    if (!re.test(faceImageKey)) {
      throw new BadRequestException('Chave da foto inválida.');
    }

    await this.r2.assertObjectExists(faceImageKey);

    if (row.guestApprovalStatus === 'approved') {
      throw new ConflictException('Este convite já foi aprovado.');
    }
    if (row.guestApprovalStatus === 'submitted') {
      throw new ConflictException('A foto já foi enviada.');
    }

    if (!row.guestName) {
      const gn = parsed.data.guestName?.trim();
      const gd = parsed.data.guestDocument?.trim();
      if (!gn || !gd) {
        throw new BadRequestException(
          'Informe nome e documento antes de concluir.',
        );
      }
      await inviteQueries.inviteUpdateGuestProfile(this.database.db, row.id, {
        guestName: gn,
        guestDocument: normalizeCpf(gd) || gd,
        guestPhone: parsed.data.guestPhone?.trim()
          ? parsed.data.guestPhone.trim()
          : null,
      });
    }

    const updated = await inviteQueries.inviteUpdateGuestFaceSubmitted(
      this.database.db,
      row.id,
      faceImageKey,
    );
    if (!updated) {
      throw new NotFoundException('Convite não encontrado.');
    }

    const guestName =
      updated.guestName?.trim() ||
      row.guestName?.trim() ||
      parsed.data.guestName?.trim() ||
      'Visitante';

    this.eventEmitter.emit(INVITE_GUEST_FACE_SUBMITTED, {
      inviteId: row.id,
      clientId: row.clientId,
      requestedByMemberId: row.requestedByMemberId,
      guestName,
    } satisfies InviteGuestFaceSubmittedPayload);

    return {
      success: true as const,
      message:
        'Foto recebida. O funcionário que criou o convite precisa aprovar o cadastro.',
    };
  }
}
