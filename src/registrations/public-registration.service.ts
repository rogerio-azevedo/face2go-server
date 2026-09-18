import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import { DatabaseService } from '../database/database.service';
import * as registrationsQueries from '../database/queries/registrations.queries';
import { storeReaderFaceVariants } from '../face-sync/face-image-variants';
import { R2StorageService } from '../storage/r2-storage.service';
import { parseUploadedImageFile } from '../storage/uploaded-image.util';
import {
  publicCheckDocumentSchema,
  publicSubmitRegistrationSchema,
} from '../validation/registrations.schema';
import { zodFirstMessage } from '../validation/zod-utils';
import { normalizeRegistrationFields } from './registration-additional-data';
import { assertDocumentAvailableInClient } from './registration-document-unique';
import { resolveFieldsConsideringRestrictMinors } from './registration-fields-resolve';

const presignBodySchema = z.object({
  registrationId: z.string().uuid(),
  mimeType: z.string().min(3),
});

const submitBodySchema = publicSubmitRegistrationSchema;

const uploadPhotoBodySchema = z.object({
  registrationId: z.string().uuid(),
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLinkBundleUsable(
  bundle: registrationsQueries.RegistrationLinkWithClient,
): boolean {
  if (!bundle.link.isActive || !bundle.client.isActive) return false;
  const now = new Date();
  if (bundle.link.validFrom && now < bundle.link.validFrom) {
    return false;
  }
  if (bundle.link.expiresAt && now > bundle.link.expiresAt) {
    return false;
  }
  return true;
}

@Injectable()
export class PublicRegistrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly r2: R2StorageService,
  ) {}

  async getPreview(code: string) {
    const bundle =
      await registrationsQueries.getActiveRegistrationLinkWithClient(
        this.database.db,
        code,
      );
    if (!bundle || !isLinkBundleUsable(bundle)) {
      throw new NotFoundException('Link inválido, expirado ou desativado.');
    }
    return {
      clientName: bundle.client.name,
      clientType: bundle.client.type,
      logoUrl: bundle.client.logoUrl,
      fields: (
        await resolveFieldsConsideringRestrictMinors(
          this.database.db,
          bundle.client.id,
          bundle.client.type,
          bundle.client.registrationConfig,
        )
      ).fields,
    };
  }

  async presignPhoto(code: string, body: unknown) {
    const parsed = presignBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const bundle =
      await registrationsQueries.getActiveRegistrationLinkWithClient(
        this.database.db,
        code,
      );
    if (!bundle || !isLinkBundleUsable(bundle)) {
      throw new NotFoundException('Link inválido, expirado ou desativado.');
    }

    const { registrationId, mimeType } = parsed.data;
    const ext = this.r2.extForImageMime(mimeType);
    const key = this.r2.buildFaceDraftKey(
      bundle.client.companyId,
      bundle.client.id,
      registrationId,
      ext,
    );

    const contentType =
      mimeType.split(';')[0]?.trim().toLowerCase() ?? 'image/jpeg';
    const uploadUrl = await this.r2.createPresignedPutUrl(key, contentType);

    return {
      uploadUrl,
      faceImageKey: key,
      contentType,
      expiresInSeconds: 15 * 60,
    };
  }

  /** Envia a foto pelo servidor para o R2 (multipart, campo `file`). */
  async uploadPhoto(code: string, file: Express.Multer.File, body: unknown) {
    const parsed = uploadPhotoBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const bundle =
      await registrationsQueries.getActiveRegistrationLinkWithClient(
        this.database.db,
        code,
      );
    if (!bundle || !isLinkBundleUsable(bundle)) {
      throw new NotFoundException('Link inválido, expirado ou desativado.');
    }

    const { registrationId } = parsed.data;
    const { buffer, contentType, ext } = parseUploadedImageFile(file, this.r2);
    const key = this.r2.buildFaceDraftKey(
      bundle.client.companyId,
      bundle.client.id,
      registrationId,
      ext,
    );

    await this.r2.putObject(key, buffer, contentType);
    void storeReaderFaceVariants(this.r2, key, buffer);
    return { faceImageKey: key };
  }

  async checkDocument(code: string, body: unknown) {
    const parsed = publicCheckDocumentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const bundle =
      await registrationsQueries.getActiveRegistrationLinkWithClient(
        this.database.db,
        code,
      );
    if (!bundle || !isLinkBundleUsable(bundle)) {
      throw new NotFoundException('Link inválido, expirado ou desativado.');
    }

    await assertDocumentAvailableInClient(
      this.database.db,
      bundle.client.id,
      parsed.data.document,
    );

    return { available: true as const };
  }

  async submit(code: string, body: unknown) {
    const parsed = submitBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const bundle =
      await registrationsQueries.getActiveRegistrationLinkWithClient(
        this.database.db,
        code,
      );
    if (!bundle || !isLinkBundleUsable(bundle)) {
      throw new NotFoundException('Link inválido, expirado ou desativado.');
    }

    const {
      registrationId,
      name,
      document,
      phone,
      email,
      birthDate,
      faceImageKey,
      additionalData,
    } = parsed.data;
    const truthDeclaredAt = new Date();

    const fieldsConfig = (
      await resolveFieldsConsideringRestrictMinors(
        this.database.db,
        bundle.client.id,
        bundle.client.type,
        bundle.client.registrationConfig,
      )
    ).fields;
    const normalized = normalizeRegistrationFields(fieldsConfig, {
      document,
      phone,
      email,
      birthDate,
      additionalData,
    });

    await assertDocumentAvailableInClient(
      this.database.db,
      bundle.client.id,
      normalized.document,
    );

    const re = new RegExp(
      `^${escapeRegex(bundle.client.companyId)}/${escapeRegex(bundle.client.id)}/${escapeRegex(registrationId)}/face\\.(jpg|png|webp)$`,
    );
    if (!re.test(faceImageKey)) {
      throw new BadRequestException('Chave da foto inválida.');
    }

    await this.r2.assertObjectExists(faceImageKey);

    const existing = await registrationsQueries.getRegistrationByIdForClient(
      this.database.db,
      registrationId,
      bundle.client.id,
    );
    if (existing?.submittedAt) {
      throw new ConflictException('Este cadastro já foi enviado.');
    }

    try {
      const row = await registrationsQueries.insertRegistration(
        this.database.db,
        {
          id: registrationId,
          registrationLinkId: bundle.link.id,
          clientId: bundle.client.id,
          name: name.trim(),
          document: normalized.document,
          phone: normalized.phone,
          email: normalized.email,
          birthDate: normalized.birthDate,
          faceImageKey,
          additionalData: normalized.additionalData,
          truthDeclaredAt,
        },
      );
      return {
        success: true as const,
        registrationId: row.id,
        message:
          'Cadastro recebido. Aguarde a aprovação do administrador do cliente.',
      };
    } catch (e: unknown) {
      const codePg =
        e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
      if (codePg === '23505') {
        throw new ConflictException('Este cadastro já foi enviado.');
      }
      throw e;
    }
  }
}
