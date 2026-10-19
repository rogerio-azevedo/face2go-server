import { Injectable, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { R2StorageService } from '../storage/r2-storage.service';
import { VisitorApprovalInvitationService } from './visitor-approval-invitation.service';
import { VisitorApprovalRepository } from './visitor-approval.repository';
import { ageForApproval, needsVisitorApproval } from './visitor-approval.util';

type Bundle = Awaited<ReturnType<VisitorApprovalInvitationService['bundle']>>;
type Consent = Awaited<
  ReturnType<VisitorApprovalRepository['consentByRequest']>
>;

export function canViewVisitorApprovalPhoto(bundle: Bundle, consent: Consent) {
  const { client, request, visitor, adult } = bundle;
  return Boolean(
    visitor.faceImageKey &&
    client.isActive &&
    !request.canceledAt &&
    needsVisitorApproval(client, visitor) &&
    visitor.isActive &&
    adult.isActive &&
    adult.status === 'approved' &&
    !adult.isVisitor &&
    (ageForApproval(adult.birthDate, client.timezoneOffsetMinutes) ?? -1) >=
      18 &&
    adult.unitId === request.unitId &&
    visitor.unitId === request.unitId &&
    (request.acceptedAt
      ? consent && !consent.revokedAt
      : request.expiresAt > new Date()),
  );
}

@Injectable()
export class VisitorApprovalPhotoService {
  constructor(
    private readonly invitations: VisitorApprovalInvitationService,
    private readonly repository: VisitorApprovalRepository,
    private readonly storage: R2StorageService,
  ) {}

  async load(token: string) {
    const bundle = await this.invitations.bundle(token);
    const consent = await this.repository.consentByRequest(
      bundle.client.id,
      bundle.request.id,
    );
    if (
      !canViewVisitorApprovalPhoto(bundle, consent) ||
      !(await this.repository.adultAvailable(bundle.client.id, bundle.adult.id))
    )
      throw new NotFoundException('Foto indisponível para esta autorização.');
    try {
      const { buffer } = await this.storage.getObjectBytes(
        bundle.visitor.faceImageKey!,
      );
      return await sharp(buffer, { limitInputPixels: 16_000_000 })
        .rotate()
        .resize({
          width: 240,
          height: 320,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch {
      throw new NotFoundException(
        'Não foi possível carregar a foto do visitante.',
      );
    }
  }
}
