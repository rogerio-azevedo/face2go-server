import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as membersQueries from '../database/queries/members.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { AccessTimeZoneService } from '../face-sync/access-time-zone.service';
import {
  buildPaginatedResult,
  parseListPaginationParams,
  type ListPaginationParams,
} from '../common/pagination';
import { isPortraitImageUsable } from '../storage/portrait-image.utils';
import { R2StorageService } from '../storage/r2-storage.service';

export type FaceEnrollmentStatusDto = {
  photoUrl: string | null;
  faceId: number | null;
  deviceSyncStatus: 'pending_sync' | 'synced' | 'sync_failed' | null;
  deviceSyncError: string | null;
  deviceSyncedAt: string | null;
};

export type ChildFaceEnrollmentStatusDto = FaceEnrollmentStatusDto & {
  studentId: string;
  name: string;
};

export type MemberStudentSearchItemDto = {
  id: string;
  name: string;
  photoUrl: string | null;
  faceId: number | null;
  deviceSyncStatus: FaceEnrollmentStatusDto['deviceSyncStatus'];
};

function stripDataUrlBase64(imageBase64: string): string {
  const trimmed = imageBase64.trim();
  const comma = trimmed.indexOf(',');
  if (trimmed.startsWith('data:') && comma !== -1) {
    return trimmed.slice(comma + 1);
  }
  return trimmed;
}

function decodeBase64ToBuffer(imageBase64: string): Buffer {
  const b64 = stripDataUrlBase64(imageBase64);
  try {
    return Buffer.from(b64, 'base64');
  } catch {
    throw new BadRequestException('imageBase64 inválido.');
  }
}

@Injectable()
export class FaceEnrollmentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly r2: R2StorageService,
    private readonly faceSync: FaceSyncService,
    private readonly accessTimeZone: AccessTimeZoneService,
  ) {}

  private assertResponsibleScope(user: JwtPayload): {
    responsibleId: string;
    clientId: string;
  } {
    if (user.role !== 'responsible' || !user.responsibleId || !user.clientId) {
      throw new ForbiddenException('Acesso apenas para conta de responsável.');
    }
    return { responsibleId: user.responsibleId, clientId: user.clientId };
  }

  private async optionalPhotoUrl(
    photoKey: string | null | undefined,
  ): Promise<string | null> {
    if (!photoKey) return null;
    try {
      return await this.r2.createPresignedGetUrl(photoKey);
    } catch {
      return null;
    }
  }

  private async assertHouseholdPeer(
    user: JwtPayload,
    targetResponsibleId: string,
  ): Promise<{ clientId: string }> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    const householdIds = await responsiblesQueries.listHouseholdResponsibleIds(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!householdIds.includes(targetResponsibleId)) {
      throw new ForbiddenException(
        'Responsável não pertence ao seu núcleo familiar.',
      );
    }
    return { clientId };
  }

  private async responsibleFaceStatusDto(
    responsibleId: string,
    clientId: string,
  ): Promise<FaceEnrollmentStatusDto> {
    const row = await responsiblesQueries.getResponsibleWithFaceStatus(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Responsável não encontrado.');
    }
    return {
      photoUrl: await this.optionalPhotoUrl(row.photoKey),
      faceId: row.faceId ?? null,
      deviceSyncStatus: row.deviceSyncStatus ?? null,
      deviceSyncError: row.deviceSyncError ?? null,
      deviceSyncedAt: row.deviceSyncedAt
        ? row.deviceSyncedAt.toISOString()
        : null,
    };
  }

  async getMyFaceStatus(user: JwtPayload): Promise<FaceEnrollmentStatusDto> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    return this.responsibleFaceStatusDto(responsibleId, clientId);
  }

  async getHouseholdMemberFaceStatus(
    user: JwtPayload,
    targetResponsibleId: string,
  ): Promise<FaceEnrollmentStatusDto> {
    const { clientId } = await this.assertHouseholdPeer(
      user,
      targetResponsibleId,
    );
    return this.responsibleFaceStatusDto(targetResponsibleId, clientId);
  }

  async getChildFaceStatus(
    user: JwtPayload,
    studentId: string,
  ): Promise<ChildFaceEnrollmentStatusDto> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    const allowed = await studentsQueries.listStudentIdsForResponsible(
      this.database.db,
      responsibleId,
    );
    if (!allowed.includes(studentId)) {
      throw new NotFoundException('Aluno não encontrado ou sem vínculo.');
    }
    const student = await studentsQueries.getStudentById(
      this.database.db,
      studentId,
      clientId,
    );
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }
    return {
      studentId: student.id,
      name: student.name,
      photoUrl: await this.optionalPhotoUrl(student.photoKey),
      faceId: student.faceId ?? null,
      deviceSyncStatus: student.deviceSyncStatus ?? null,
      deviceSyncError: student.deviceSyncError ?? null,
      deviceSyncedAt: student.deviceSyncedAt
        ? student.deviceSyncedAt.toISOString()
        : null,
    };
  }

  private async uploadAndSyncResponsibleFace(
    clientId: string,
    responsibleId: string,
    imageBase64: string,
  ): Promise<FaceEnrollmentStatusDto> {
    const responsible = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!responsible) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    const buffer = decodeBase64ToBuffer(imageBase64);
    if (buffer.length < 256) {
      throw new BadRequestException('Imagem muito pequena ou inválida.');
    }
    if (!(await isPortraitImageUsable(buffer))) {
      throw new BadRequestException(
        'Foto muito escura ou inválida. Melhore a iluminação e enquadre o rosto.',
      );
    }

    const photoKey = `responsibles/${clientId}/${responsibleId}/face.jpg`;
    await this.r2.putObject(photoKey, buffer, 'image/jpeg');

    let faceId = responsible.faceId ?? null;
    if (faceId == null) {
      faceId = await registrationsQueries.bumpClientFaceCounter(
        this.database.db,
        clientId,
      );
    }

    await responsiblesQueries.updateResponsibleFace(
      this.database.db,
      responsibleId,
      clientId,
      {
        photoKey,
        faceId,
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );

    const sync = await this.faceSync.syncPersonOnReaders({
      clientId,
      faceId,
      name: responsible.name,
      imageBuffer: buffer,
      timeSectionIds: await this.accessTimeZone.resolveResponsibleTimeSections(
        clientId,
        responsibleId,
      ),
      logContext: `responsible=${responsibleId}`,
    });

    await responsiblesQueries.updateResponsibleFace(
      this.database.db,
      responsibleId,
      clientId,
      {
        deviceSyncStatus: sync.deviceSyncStatus,
        deviceSyncedAt: sync.deviceSyncStatus === 'synced' ? new Date() : null,
        deviceSyncError: sync.deviceSyncError,
      },
    );

    return {
      photoUrl: await this.optionalPhotoUrl(photoKey),
      faceId,
      deviceSyncStatus: sync.deviceSyncStatus,
      deviceSyncError: sync.deviceSyncError,
      deviceSyncedAt:
        sync.deviceSyncStatus === 'synced' ? new Date().toISOString() : null,
    };
  }

  async uploadAndSyncMyFace(
    user: JwtPayload,
    imageBase64: string,
  ): Promise<FaceEnrollmentStatusDto> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    return this.uploadAndSyncResponsibleFace(
      clientId,
      responsibleId,
      imageBase64,
    );
  }

  async uploadAndSyncHouseholdMemberFace(
    user: JwtPayload,
    targetResponsibleId: string,
    imageBase64: string,
  ): Promise<FaceEnrollmentStatusDto> {
    const { clientId } = await this.assertHouseholdPeer(
      user,
      targetResponsibleId,
    );
    return this.uploadAndSyncResponsibleFace(
      clientId,
      targetResponsibleId,
      imageBase64,
    );
  }

  async uploadAndSyncChildFace(
    user: JwtPayload,
    studentId: string,
    imageBase64: string,
  ): Promise<ChildFaceEnrollmentStatusDto> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    const allowed = await studentsQueries.listStudentIdsForResponsible(
      this.database.db,
      responsibleId,
    );
    if (!allowed.includes(studentId)) {
      throw new NotFoundException('Aluno não encontrado ou sem vínculo.');
    }
    return this.uploadAndSyncStudentFaceInternal(
      clientId,
      studentId,
      imageBase64,
    );
  }

  private async uploadAndSyncStudentFaceInternal(
    clientId: string,
    studentId: string,
    imageBase64: string,
  ): Promise<ChildFaceEnrollmentStatusDto> {
    const student = await studentsQueries.getStudentById(
      this.database.db,
      studentId,
      clientId,
    );
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }

    const buffer = decodeBase64ToBuffer(imageBase64);
    if (buffer.length < 256) {
      throw new BadRequestException('Imagem muito pequena ou inválida.');
    }
    if (!(await isPortraitImageUsable(buffer))) {
      throw new BadRequestException(
        'Foto muito escura ou inválida. Melhore a iluminação e enquadre o rosto.',
      );
    }

    const photoKey = `students/${clientId}/${studentId}/face.jpg`;
    await this.r2.putObject(photoKey, buffer, 'image/jpeg');

    let faceId = student.faceId ?? null;
    if (faceId == null) {
      faceId = await registrationsQueries.bumpClientFaceCounter(
        this.database.db,
        clientId,
      );
    }

    await studentsQueries.updateStudentFace(
      this.database.db,
      studentId,
      clientId,
      {
        photoKey,
        faceId,
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );

    const sync = await this.faceSync.syncPersonOnReaders({
      clientId,
      faceId,
      name: student.name,
      imageBuffer: buffer,
      timeSectionIds: await this.accessTimeZone.resolveStudentTimeSections(
        clientId,
        studentId,
      ),
      logContext: `student=${studentId}`,
    });

    await studentsQueries.updateStudentFace(
      this.database.db,
      studentId,
      clientId,
      {
        deviceSyncStatus: sync.deviceSyncStatus,
        deviceSyncedAt: sync.deviceSyncStatus === 'synced' ? new Date() : null,
        deviceSyncError: sync.deviceSyncError,
      },
    );

    return {
      studentId: student.id,
      name: student.name,
      photoUrl: await this.optionalPhotoUrl(photoKey),
      faceId,
      deviceSyncStatus: sync.deviceSyncStatus,
      deviceSyncError: sync.deviceSyncError,
      deviceSyncedAt:
        sync.deviceSyncStatus === 'synced' ? new Date().toISOString() : null,
    };
  }

  private async resyncResponsibleFromR2(
    clientId: string,
    responsibleId: string,
  ): Promise<FaceEnrollmentStatusDto> {
    const row = await responsiblesQueries.getResponsibleWithFaceStatus(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Responsável não encontrado.');
    }
    if (!row.photoKey || row.faceId == null) {
      throw new BadRequestException('Sem foto cadastrada para sincronizar.');
    }

    const responsible = await responsiblesQueries.getResponsibleById(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!responsible) {
      throw new NotFoundException('Responsável não encontrado.');
    }

    let buffer: Buffer;
    try {
      const got = await this.r2.getObjectBytes(row.photoKey);
      buffer = got.buffer;
    } catch {
      throw new BadRequestException(
        'Não foi possível obter a foto armazenada.',
      );
    }
    if (buffer.length < 256) {
      throw new BadRequestException(
        'Imagem armazenada inválida ou muito pequena.',
      );
    }

    await responsiblesQueries.updateResponsibleFace(
      this.database.db,
      responsibleId,
      clientId,
      {
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );

    const sync = await this.faceSync.syncPersonOnReaders({
      clientId,
      faceId: row.faceId,
      name: responsible.name,
      imageBuffer: buffer,
      timeSectionIds: await this.accessTimeZone.resolveResponsibleTimeSections(
        clientId,
        responsibleId,
      ),
      logContext: `responsible=${responsibleId}`,
    });

    await responsiblesQueries.updateResponsibleFace(
      this.database.db,
      responsibleId,
      clientId,
      {
        deviceSyncStatus: sync.deviceSyncStatus,
        deviceSyncedAt: sync.deviceSyncStatus === 'synced' ? new Date() : null,
        deviceSyncError: sync.deviceSyncError,
      },
    );

    return {
      photoUrl: await this.optionalPhotoUrl(row.photoKey),
      faceId: row.faceId,
      deviceSyncStatus: sync.deviceSyncStatus,
      deviceSyncError: sync.deviceSyncError,
      deviceSyncedAt:
        sync.deviceSyncStatus === 'synced' ? new Date().toISOString() : null,
    };
  }

  private async resyncStudentFromR2(
    clientId: string,
    studentId: string,
  ): Promise<ChildFaceEnrollmentStatusDto> {
    const student = await studentsQueries.getStudentById(
      this.database.db,
      studentId,
      clientId,
    );
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }
    if (!student.photoKey || student.faceId == null) {
      throw new BadRequestException('Sem foto cadastrada para sincronizar.');
    }

    let buffer: Buffer;
    try {
      const got = await this.r2.getObjectBytes(student.photoKey);
      buffer = got.buffer;
    } catch {
      throw new BadRequestException(
        'Não foi possível obter a foto armazenada.',
      );
    }
    if (buffer.length < 256) {
      throw new BadRequestException(
        'Imagem armazenada inválida ou muito pequena.',
      );
    }

    await studentsQueries.updateStudentFace(
      this.database.db,
      studentId,
      clientId,
      {
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );

    const sync = await this.faceSync.syncPersonOnReaders({
      clientId,
      faceId: student.faceId,
      name: student.name,
      imageBuffer: buffer,
      timeSectionIds: await this.accessTimeZone.resolveStudentTimeSections(
        clientId,
        studentId,
      ),
      logContext: `student=${studentId}`,
    });

    await studentsQueries.updateStudentFace(
      this.database.db,
      studentId,
      clientId,
      {
        deviceSyncStatus: sync.deviceSyncStatus,
        deviceSyncedAt: sync.deviceSyncStatus === 'synced' ? new Date() : null,
        deviceSyncError: sync.deviceSyncError,
      },
    );

    return {
      studentId: student.id,
      name: student.name,
      photoUrl: await this.optionalPhotoUrl(student.photoKey),
      faceId: student.faceId,
      deviceSyncStatus: sync.deviceSyncStatus,
      deviceSyncError: sync.deviceSyncError,
      deviceSyncedAt:
        sync.deviceSyncStatus === 'synced' ? new Date().toISOString() : null,
    };
  }

  async resyncMyFaceFromR2(user: JwtPayload): Promise<FaceEnrollmentStatusDto> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    return this.resyncResponsibleFromR2(clientId, responsibleId);
  }

  async resyncHouseholdMemberFaceFromR2(
    user: JwtPayload,
    targetResponsibleId: string,
  ): Promise<FaceEnrollmentStatusDto> {
    const { clientId } = await this.assertHouseholdPeer(
      user,
      targetResponsibleId,
    );
    return this.resyncResponsibleFromR2(clientId, targetResponsibleId);
  }

  async resyncChildFaceFromR2(
    user: JwtPayload,
    studentId: string,
  ): Promise<ChildFaceEnrollmentStatusDto> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    const allowed = await studentsQueries.listStudentIdsForResponsible(
      this.database.db,
      responsibleId,
    );
    if (!allowed.includes(studentId)) {
      throw new NotFoundException('Aluno não encontrado ou sem vínculo.');
    }
    return this.resyncStudentFromR2(clientId, studentId);
  }

  private assertMemberScope(user: JwtPayload): {
    memberId: string;
    clientId: string;
  } {
    if (user.role !== 'member' || !user.memberId || !user.clientId) {
      throw new ForbiddenException('Acesso apenas para conta de membro.');
    }
    return { memberId: user.memberId, clientId: user.clientId };
  }

  private async assertMemberCanEnrollStudentFace(user: JwtPayload): Promise<{
    memberId: string;
    clientId: string;
  }> {
    const { memberId, clientId } = this.assertMemberScope(user);
    const member = await membersQueries.getMemberById(
      this.database.db,
      memberId,
      clientId,
    );
    if (!member) {
      throw new NotFoundException('Membro não encontrado.');
    }
    if (!member.canEnrollStudentFace) {
      throw new ForbiddenException('Sem permissão para fotografar alunos.');
    }
    return { memberId, clientId };
  }

  async listStudentsForMemberEnrollment(
    user: JwtPayload,
    query: ListPaginationParams = {},
  ) {
    const { clientId } = await this.assertMemberCanEnrollStudentFace(user);
    const { page, pageSize, search, offset } = parseListPaginationParams(
      query.page !== undefined ? String(query.page) : undefined,
      query.pageSize !== undefined ? String(query.pageSize) : undefined,
      query.search,
    );
    const listOpts = { search, offset, limit: pageSize };
    const [total, rows] = await Promise.all([
      studentsQueries.countStudentsByClient(this.database.db, clientId, {
        search,
      }),
      studentsQueries.listStudentsByClient(
        this.database.db,
        clientId,
        listOpts,
      ),
    ]);
    const data: MemberStudentSearchItemDto[] = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        name: row.name,
        photoUrl: await this.optionalPhotoUrl(row.photoKey),
        faceId: row.faceId ?? null,
        deviceSyncStatus: row.deviceSyncStatus ?? null,
      })),
    );
    return buildPaginatedResult(data, total, page, pageSize);
  }

  async uploadAndSyncStudentFaceByMember(
    user: JwtPayload,
    studentId: string,
    imageBase64: string,
  ): Promise<ChildFaceEnrollmentStatusDto> {
    const { clientId } = await this.assertMemberCanEnrollStudentFace(user);
    return this.uploadAndSyncStudentFaceInternal(
      clientId,
      studentId,
      imageBase64,
    );
  }

  private async memberFaceStatusDto(
    memberId: string,
    clientId: string,
  ): Promise<FaceEnrollmentStatusDto> {
    const row = await membersQueries.getMemberWithFaceStatus(
      this.database.db,
      memberId,
      clientId,
    );
    if (!row) {
      throw new NotFoundException('Membro não encontrado.');
    }
    return {
      photoUrl: await this.optionalPhotoUrl(row.photoKey),
      faceId: row.faceId ?? null,
      deviceSyncStatus: row.deviceSyncStatus ?? null,
      deviceSyncError: row.deviceSyncError ?? null,
      deviceSyncedAt: row.deviceSyncedAt
        ? row.deviceSyncedAt.toISOString()
        : null,
    };
  }

  async getMemberMyFaceStatus(
    user: JwtPayload,
  ): Promise<FaceEnrollmentStatusDto> {
    const { memberId, clientId } = this.assertMemberScope(user);
    return this.memberFaceStatusDto(memberId, clientId);
  }

  async uploadAndSyncMemberMyFace(
    user: JwtPayload,
    imageBase64: string,
  ): Promise<FaceEnrollmentStatusDto> {
    const { memberId, clientId } = this.assertMemberScope(user);
    const member = await membersQueries.getMemberById(
      this.database.db,
      memberId,
      clientId,
    );
    if (!member) {
      throw new NotFoundException('Membro não encontrado.');
    }

    const buffer = decodeBase64ToBuffer(imageBase64);
    if (buffer.length < 256) {
      throw new BadRequestException('Imagem muito pequena ou inválida.');
    }
    if (!(await isPortraitImageUsable(buffer))) {
      throw new BadRequestException(
        'Foto muito escura ou inválida. Melhore a iluminação e enquadre o rosto.',
      );
    }

    const photoKey = `members/${clientId}/${memberId}/face.jpg`;
    await this.r2.putObject(photoKey, buffer, 'image/jpeg');

    let faceId = member.faceId ?? null;
    if (faceId == null) {
      faceId = await registrationsQueries.bumpClientFaceCounter(
        this.database.db,
        clientId,
      );
    }

    await membersQueries.updateMemberFace(
      this.database.db,
      memberId,
      clientId,
      {
        photoKey,
        faceId,
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );

    const sync = await this.faceSync.syncPersonOnReaders({
      clientId,
      faceId,
      name: member.name,
      imageBuffer: buffer,
      logContext: `member=${memberId}`,
    });

    await membersQueries.updateMemberFace(
      this.database.db,
      memberId,
      clientId,
      {
        deviceSyncStatus: sync.deviceSyncStatus,
        deviceSyncedAt: sync.deviceSyncStatus === 'synced' ? new Date() : null,
        deviceSyncError: sync.deviceSyncError,
      },
    );

    return {
      photoUrl: await this.optionalPhotoUrl(photoKey),
      faceId,
      deviceSyncStatus: sync.deviceSyncStatus,
      deviceSyncError: sync.deviceSyncError,
      deviceSyncedAt:
        sync.deviceSyncStatus === 'synced' ? new Date().toISOString() : null,
    };
  }

  async resyncMemberMyFaceFromR2(
    user: JwtPayload,
  ): Promise<FaceEnrollmentStatusDto> {
    const { memberId, clientId } = this.assertMemberScope(user);
    const member = await membersQueries.getMemberById(
      this.database.db,
      memberId,
      clientId,
    );
    if (!member?.photoKey || member.faceId == null) {
      throw new BadRequestException('Sem foto cadastrada para sincronizar.');
    }

    const got = await this.r2.getObjectBytes(member.photoKey);
    const buffer = got.buffer;
    if (buffer.length < 256) {
      throw new BadRequestException(
        'Imagem armazenada inválida ou muito pequena.',
      );
    }

    await membersQueries.updateMemberFace(
      this.database.db,
      memberId,
      clientId,
      {
        deviceSyncStatus: 'pending_sync',
        deviceSyncedAt: null,
        deviceSyncError: null,
      },
    );

    const sync = await this.faceSync.syncPersonOnReaders({
      clientId,
      faceId: member.faceId,
      name: member.name,
      imageBuffer: buffer,
      logContext: `member-resync=${memberId}`,
    });

    await membersQueries.updateMemberFace(
      this.database.db,
      memberId,
      clientId,
      {
        deviceSyncStatus: sync.deviceSyncStatus,
        deviceSyncedAt: sync.deviceSyncStatus === 'synced' ? new Date() : null,
        deviceSyncError: sync.deviceSyncError,
      },
    );

    return this.memberFaceStatusDto(memberId, clientId);
  }
}
