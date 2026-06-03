import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import { DatabaseService } from '../database/database.service';
import * as registrationsQueries from '../database/queries/registrations.queries';
import { R2StorageService } from '../storage/r2-storage.service';
import { zodFirstMessage } from '../validation/zod-utils';

const presignBodySchema = z.object({
  registrationId: z.string().uuid(),
  mimeType: z.string().min(3),
});

const submitBodySchema = z.object({
  registrationId: z.string().uuid(),
  name: z.string().min(2).max(255),
  document: z.string().min(5).max(32),
  phone: z.string().min(8).max(32),
  email: z.string().email(),
  faceImageKey: z.string().min(1),
  additionalData: z.record(z.string(), z.unknown()).optional(),
});

const uploadPhotoBodySchema = z.object({
  registrationId: z.string().uuid(),
  imageBase64: z.string().min(100),
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

function normalizeAdditionalDataForClientType(
  clientType: string,
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (clientType === 'condominium') {
    const block = String(raw?.block ?? '').trim();
    const unit = String(raw?.unit ?? '').trim();
    if (!block || !unit) {
      throw new BadRequestException('Informe bloco e unidade.');
    }
    return { block, unit };
  }
  if (clientType === 'office' || clientType === 'clinic') {
    const room = String(raw?.room ?? '').trim();
    if (!room) {
      throw new BadRequestException('Informe a sala.');
    }
    return { room };
  }
  return null;
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

  /**
   * Envia a foto pelo servidor para o R2 (evita CORS browser → bucket).
   * Aceita data URL (`data:image/jpeg;base64,...`) ou base64 cru (tratado como JPEG).
   */
  async uploadPhoto(code: string, body: unknown) {
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

    const { registrationId, imageBase64 } = parsed.data;
    let payload = imageBase64.trim();
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
    const key = this.r2.buildFaceDraftKey(
      bundle.client.companyId,
      bundle.client.id,
      registrationId,
      ext,
    );

    await this.r2.putObject(key, buffer, contentType);
    return { faceImageKey: key };
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
      faceImageKey,
      additionalData,
    } = parsed.data;

    const clientType = bundle.client.type;
    const additionalNormalized = normalizeAdditionalDataForClientType(
      clientType,
      additionalData,
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
          document: document.trim(),
          phone: phone.trim(),
          email: email.trim().toLowerCase(),
          faceImageKey,
          additionalData: additionalNormalized,
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
