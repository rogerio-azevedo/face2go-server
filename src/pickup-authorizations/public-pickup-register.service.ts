import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { resolveClientAppBrand } from '../common/utils/client-app-brand';
import * as clientsQueries from '../database/queries/clients.queries';
import * as pickupQueries from '../database/queries/pickup-authorizations.queries';
import { DatabaseService } from '../database/database.service';
import {
  PICKUP_GUEST_FACE_SUBMITTED,
  type PickupGuestFaceSubmittedPayload,
} from '../notifications/notifications.events';
import { R2StorageService } from '../storage/r2-storage.service';
import { parseUploadedImageFile } from '../storage/uploaded-image.util';
import { zodFirstMessage } from '../validation/zod-utils';
import { publicPickupRegisterSubmitSchema } from '../validation/pickup-authorizations.schema';
import { PickupAuthorizationsService } from './pickup-authorizations.service';

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
      appBrand: resolveClientAppBrand(client.ienhFilialCode),
      guestName: row.guestName ?? '',
      needsGuestData: !row.guestName,
      studentNames: students.map((s) => s.studentName),
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      guestApprovalStatus: row.guestApprovalStatus,
    };
  }

  async uploadPhoto(code: string, file: Express.Multer.File) {
    const row = await this.resolveActiveAuth(code);
    if (row.guestApprovalStatus === 'approved') {
      throw new ConflictException('Esta autorização já foi aprovada.');
    }
    if (row.guestApprovalStatus === 'submitted') {
      throw new ConflictException('A foto desta autorização já foi enviada.');
    }
    // rejected → permite novo envio

    const { buffer, contentType, ext } = parseUploadedImageFile(file, this.r2);
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
    const parsed = publicPickupRegisterSubmitSchema.safeParse(body);
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

    const needsGuestData = !row.guestName?.trim();
    const name = parsed.data.name?.trim();
    const document = parsed.data.document?.trim();
    if (needsGuestData) {
      if (!name || !document) {
        throw new BadRequestException(
          'Informe nome e documento antes de concluir.',
        );
      }
    }

    const vehicle = parsed.data.vehicle;
    const profilePatch: Parameters<
      typeof pickupQueries.pickupAuthUpdateGuestProfile
    >[2] = {};

    if (name) profilePatch.guestName = name;
    if (document) profilePatch.guestDocument = document;
    if (parsed.data.phone !== undefined) {
      profilePatch.guestPhone = parsed.data.phone?.trim()
        ? parsed.data.phone.trim()
        : null;
    }
    if (vehicle) {
      profilePatch.guestVehiclePlate = vehicle.plate;
      profilePatch.guestVehicleBrand = vehicle.brand;
      profilePatch.guestVehicleModel = vehicle.model;
      profilePatch.guestVehicleColor = vehicle.color;
      profilePatch.guestVehicleLprSyncStatus = 'pending_sync';
    }

    if (Object.keys(profilePatch).length > 0) {
      await pickupQueries.pickupAuthUpdateGuestProfile(
        this.database.db,
        row.id,
        profilePatch,
      );
    }

    const updated = await pickupQueries.pickupAuthUpdateGuestFaceSubmitted(
      this.database.db,
      row.id,
      faceImageKey,
    );
    if (!updated) {
      throw new NotFoundException('Autorização não encontrada.');
    }

    const guestName =
      updated.guestName?.trim() || row.guestName?.trim() || name || 'Convidado';

    this.eventEmitter.emit(PICKUP_GUEST_FACE_SUBMITTED, {
      authorizationId: row.id,
      clientId: row.clientId,
      requestedByResponsibleId: row.requestedByResponsibleId,
      guestName,
    } satisfies PickupGuestFaceSubmittedPayload);

    return {
      success: true as const,
      message:
        'Foto recebida. O responsável que criou a autorização precisa aprovar o cadastro.',
    };
  }
}
