import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { FaceSyncService } from '../face-sync/face-sync.service';
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
  ) {}

  private assertResponsibleScope(
    user: JwtPayload,
  ): { responsibleId: string; clientId: string } {
    if (
      user.role !== 'responsible' ||
      !user.responsibleId ||
      !user.clientId
    ) {
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

  async getMyFaceStatus(user: JwtPayload): Promise<FaceEnrollmentStatusDto> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
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

  async uploadAndSyncMyFace(
    user: JwtPayload,
    imageBase64: string,
  ): Promise<FaceEnrollmentStatusDto> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
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
      logContext: `responsible=${responsibleId}`,
    });

    await responsiblesQueries.updateResponsibleFace(
      this.database.db,
      responsibleId,
      clientId,
      {
        deviceSyncStatus: sync.deviceSyncStatus,
        deviceSyncedAt:
          sync.deviceSyncStatus === 'synced' ? new Date() : null,
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
      logContext: `student=${studentId}`,
    });

    await studentsQueries.updateStudentFace(
      this.database.db,
      studentId,
      clientId,
      {
        deviceSyncStatus: sync.deviceSyncStatus,
        deviceSyncedAt:
          sync.deviceSyncStatus === 'synced' ? new Date() : null,
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
}
