import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import * as membersQueries from '../database/queries/members.queries';
import { DatabaseService } from '../database/database.service';
import { R2StorageService } from '../storage/r2-storage.service';

@Injectable()
export class MemberPortalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly r2Storage: R2StorageService,
  ) {}

  private assertMemberScope(user: JwtPayload): {
    memberId: string;
    clientId: string;
  } {
    if (user.role !== 'member' || !user.memberId || !user.clientId) {
      throw new ForbiddenException('Acesso apenas para conta de membro.');
    }
    return { memberId: user.memberId, clientId: user.clientId };
  }

  async getMe(user: JwtPayload) {
    const { memberId, clientId } = this.assertMemberScope(user);
    const row = await membersQueries.getMemberWithRoleById(
      this.database.db,
      memberId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Membro não encontrado.');
    }

    let photoUrl: string | null = null;
    if (row.photoKey) {
      try {
        photoUrl = await this.r2Storage.createPresignedPortraitGetUrl(
          row.photoKey,
        );
      } catch {
        photoUrl = null;
      }
    }

    return {
      id: row.id,
      clientId: row.clientId,
      roleId: row.roleId,
      roleName: row.roleName,
      roleSlug: row.roleSlug,
      userId: row.userId,
      name: row.name,
      email: row.email,
      phone: row.phone,
      document: row.document,
      birthDate: row.birthDate,
      photoUrl,
      faceId: row.faceId,
      deviceSyncStatus: row.deviceSyncStatus,
      deviceSyncedAt: row.deviceSyncedAt
        ? row.deviceSyncedAt.toISOString()
        : null,
      deviceSyncError: row.deviceSyncError,
      additionalData: row.additionalData,
      isActive: row.isActive,
    };
  }
}
