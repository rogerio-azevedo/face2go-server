import { Injectable, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { R2StorageService } from '../storage/r2-storage.service';
import { ChildApprovalInvitationService } from './child-approval-invitation.service';
import { ChildApprovalRepository } from './child-approval.repository';
import { ageForApproval, needsChildApproval } from './child-approval.util';

type Bundle = Awaited<ReturnType<ChildApprovalInvitationService['bundle']>>;
type Consent = Awaited<ReturnType<ChildApprovalRepository['consentByRequest']>>;

export function canViewChildApprovalPhoto(bundle: Bundle, consent: Consent) {
  const { client, request, child, adult } = bundle;
  return Boolean(
    child.faceImageKey &&
    client.isActive &&
    !request.canceledAt &&
    needsChildApproval(client, child) &&
    child.isActive &&
    adult.isActive &&
    adult.status === 'approved' &&
    !adult.isVisitor &&
    (ageForApproval(adult.birthDate, client.timezoneOffsetMinutes) ?? -1) >=
      18 &&
    adult.unitId === request.unitId &&
    child.unitId === request.unitId &&
    (request.acceptedAt
      ? consent && !consent.revokedAt
      : request.expiresAt > new Date()),
  );
}

@Injectable()
export class ChildApprovalPhotoService {
  constructor(
    private readonly invitations: ChildApprovalInvitationService,
    private readonly repository: ChildApprovalRepository,
    private readonly storage: R2StorageService,
  ) {}

  async load(token: string) {
    const bundle = await this.invitations.bundle(token);
    const consent = await this.repository.consentByRequest(
      bundle.client.id,
      bundle.request.id,
    );
    if (
      !canViewChildApprovalPhoto(bundle, consent) ||
      !(await this.repository.adultAvailable(bundle.client.id, bundle.adult.id))
    )
      throw new NotFoundException('Foto indisponível para esta autorização.');
    try {
      const { buffer } = await this.storage.getObjectBytes(
        bundle.child.faceImageKey!,
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
      throw new NotFoundException('Não foi possível carregar a foto do menor.');
    }
  }
}
