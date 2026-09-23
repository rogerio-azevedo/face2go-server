import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ClientsRepository } from '../database/repositories/clients.repository';
import { RegistrationFaceRetakeRepository } from '../database/repositories/registration-face-retake.repository';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { storeReaderFaceVariants } from '../face-sync/face-image-variants';
import { PermissionsService } from '../permissions/permissions.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { parseUploadedImageFile } from '../storage/uploaded-image.util';
import {
  FACE_RETAKE_GUIDANCE,
  FACE_RETAKE_TTL_MS,
  faceRetakeShareMessage,
  firstNameOf,
  isRetakeLinkOpen,
  isUniqueViolation,
  registrationCanRetakeFace,
} from './registration-face-retake.util';

function randomLinkCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

@Injectable()
export class RegistrationFaceRetakeService {
  private readonly logger = new Logger(RegistrationFaceRetakeService.name);

  constructor(
    private readonly retakes: RegistrationFaceRetakeRepository,
    private readonly clients: ClientsRepository,
    private readonly permissionsService: PermissionsService,
    private readonly r2: R2StorageService,
    private readonly faceSync: FaceSyncService,
    private readonly configService: ConfigService,
  ) {}

  async createForClientTenant(user: JwtPayload, registrationId: string) {
    const clientId = this.ensureClientTenant(user);
    await this.assertClientActive(clientId);
    return this.createShared(clientId, registrationId, user.sub);
  }

  async createForCompanyUser(
    user: JwtPayload,
    clientId: string,
    registrationId: string,
  ) {
    await this.ensureCompanyCanAccessClient(user, clientId);
    await this.assertClientActive(clientId);
    return this.createShared(clientId, registrationId, user.sub);
  }

  async getPreview(code: string) {
    const bundle = await this.retakes.findBundleByCode(code.trim());
    if (!bundle || !this.bundleIsOpen(bundle)) {
      throw new NotFoundException('Link inválido, expirado ou já utilizado.');
    }
    return {
      clientName: bundle.clientName,
      logoUrl: bundle.clientLogoUrl,
      firstName: firstNameOf(bundle.registration.name),
      guidance: FACE_RETAKE_GUIDANCE,
    };
  }

  async uploadPhoto(code: string, file: Express.Multer.File) {
    const trimmed = code.trim();
    const bundle = await this.retakes.findBundleByCode(trimmed);
    if (!bundle || !this.bundleIsOpen(bundle)) {
      throw new NotFoundException('Link inválido, expirado ou já utilizado.');
    }

    const { buffer, contentType, ext } = parseUploadedImageFile(file, this.r2);
    const faceImageKey = this.r2.buildFaceDraftKey(
      bundle.companyId,
      bundle.registration.clientId,
      bundle.registration.id,
      ext,
    );
    await this.r2.putObject(faceImageKey, buffer, contentType);
    await storeReaderFaceVariants(this.r2, faceImageKey, buffer);

    const consumed = await this.retakes.consumeAndSetFace(
      trimmed,
      faceImageKey,
    );
    if (!consumed.ok) {
      throw new ConflictException(
        consumed.reason === 'ineligible'
          ? 'Este cadastro não pode mais atualizar a foto.'
          : 'Link inválido, expirado ou já utilizado.',
      );
    }

    if (
      consumed.registration.status === 'approved' &&
      consumed.registration.faceId != null
    ) {
      try {
        await this.faceSync.enqueueApprovedRegistrationJob(
          consumed.registration.id,
          consumed.registration.clientId,
          undefined,
          { resetReaderProgress: true },
        );
      } catch (err: unknown) {
        this.logger.warn(
          `enqueue pós-recadastro reg=${consumed.registration.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return { faceImageKey, success: true as const };
  }

  private async createShared(
    clientId: string,
    registrationId: string,
    createdByUserId: string,
  ) {
    const registration = await this.retakes.findRegistration(
      clientId,
      registrationId,
    );
    if (!registration || !registrationCanRetakeFace(registration)) {
      throw new BadRequestException(
        'Só é possível gerar o link para cadastros ativos aguardando ou aprovados.',
      );
    }

    const expiresAt = new Date(Date.now() + FACE_RETAKE_TTL_MS);
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomLinkCode();
      try {
        const row = await this.retakes.insertReplacingOpen({
          registrationId,
          clientId,
          createdByUserId,
          code,
          expiresAt,
        });
        const url = this.publicUrl(row.code);
        return {
          url,
          message: faceRetakeShareMessage(url),
          expiresAt: row.expiresAt,
        };
      } catch (error: unknown) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }
    throw new ConflictException(
      'Não foi possível gerar o link. Tente novamente.',
    );
  }

  private publicUrl(code: string): string {
    const base = this.configService.get<string>('FRONTEND_URL') ?? '';
    const trimmed = base.replace(/\/$/, '');
    return `${trimmed}/cadastro/refazer/${code}`;
  }

  private bundleIsOpen(bundle: {
    clientIsActive: boolean;
    link: { usedAt: Date | null; expiresAt: Date };
    registration: {
      isActive: boolean;
      submittedAt: Date | null;
      status: string;
    };
  }): boolean {
    return (
      bundle.clientIsActive &&
      isRetakeLinkOpen(bundle.link) &&
      registrationCanRetakeFace(bundle.registration)
    );
  }

  private async assertClientActive(clientId: string) {
    const client = await this.clients.findById(clientId);
    if (!client?.isActive) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    return client;
  }

  private ensureClientTenant(user: JwtPayload): string {
    const clientId = user.clientId ?? undefined;
    if (
      !clientId ||
      (user.role !== 'client_admin' && user.role !== 'client_operator')
    ) {
      throw new ForbiddenException('Sem permissão.');
    }
    return clientId;
  }

  private async ensureCompanyCanAccessClient(
    user: JwtPayload,
    clientId: string,
  ) {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }
    if (user.role === 'company_operator') {
      const ok = await this.permissionsService.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'clients',
        'can_read',
      );
      if (!ok) {
        throw new ForbiddenException('Sem permissão.');
      }
    } else if (user.role !== 'company_admin') {
      throw new ForbiddenException('Sem permissão.');
    }
    const client = await this.clients.findById(clientId);
    if (!client || client.companyId !== companyId) {
      throw new NotFoundException('Cliente não encontrado.');
    }
    return client;
  }
}
