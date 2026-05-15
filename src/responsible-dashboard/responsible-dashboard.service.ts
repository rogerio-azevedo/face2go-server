import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { FacialAccessDocument } from '../accesses/access.schema';
import { FacialAccess } from '../accesses/access.schema';
import { DatabaseService } from '../database/database.service';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { R2StorageService } from '../storage/r2-storage.service';

type LastAccessDto = {
  eventDate: string | null;
  readerName: string;
  eventAction: string;
};

export type ResponsibleChildSummaryDto = {
  studentId: string;
  name: string;
  photoUrl: string | null;
  relationshipType: string;
  lastAccess: LastAccessDto | null;
};

export type ResponsibleAccessHistoryItemDto = {
  readerName: string;
  eventCode: string;
  eventAction: string;
  similarity: number | null;
  eventDate: string | null;
  createdAt: string;
};

@Injectable()
export class ResponsibleDashboardService {
  constructor(
    @InjectModel(FacialAccess.name)
    private readonly accessModel: Model<FacialAccessDocument>,
    private readonly database: DatabaseService,
    private readonly r2Storage: R2StorageService,
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

  private async optionalPhotoUrl(photoKey: string | null): Promise<string | null> {
    if (!photoKey) return null;
    try {
      return await this.r2Storage.createPresignedGetUrl(photoKey);
    } catch {
      return null;
    }
  }

  async listChildren(user: JwtPayload): Promise<ResponsibleChildSummaryDto[]> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    const rows =
      await responsiblesQueries.listResponsibleStudentLinksWithStudents(
        this.database.db,
        responsibleId,
        clientId,
      );

    const out: ResponsibleChildSummaryDto[] = [];
    for (const row of rows) {
      let lastAccess: LastAccessDto | null = null;
      const faceId = row.student.faceId;
      if (faceId != null) {
        const doc = await this.accessModel
          .findOne({ clientId, userId: faceId })
          .sort({ createdAt: -1 })
          .lean()
          .exec();
        if (doc) {
          const d = doc as FacialAccessDocument & {
            readerName?: string;
            eventAction?: string;
            eventDate?: Date | null;
            createdAt?: Date;
          };
          lastAccess = {
            eventDate: d.eventDate ? d.eventDate.toISOString() : null,
            readerName: d.readerName ?? '',
            eventAction: d.eventAction ?? '',
          };
        }
      }

      out.push({
        studentId: row.student.id,
        name: row.student.name,
        photoUrl: await this.optionalPhotoUrl(row.student.photoKey),
        relationshipType: row.link.relationshipType,
        lastAccess,
      });
    }
    return out;
  }

  async listAccessesForLinkedStudent(
    user: JwtPayload,
    studentId: string,
    page: number,
    limit: number,
  ): Promise<{
    items: ResponsibleAccessHistoryItemDto[];
    page: number;
    limit: number;
    total: number;
  }> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);

    const allowedIds = await studentsQueries.listStudentIdsForResponsible(
      this.database.db,
      responsibleId,
    );
    if (!allowedIds.includes(studentId)) {
      throw new NotFoundException('Aluno não encontrado ou sem vínculo.');
    }

    const student = await studentsQueries.getStudentById(
      this.database.db,
      studentId,
      clientId,
    );
    if (!student?.faceId) {
      return { items: [], page, limit, total: 0 };
    }

    const filter = {
      clientId,
      userId: student.faceId,
    };

    const total = await this.accessModel.countDocuments(filter).exec();
    const skip = (page - 1) * limit;

    const docs = await this.accessModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    const items: ResponsibleAccessHistoryItemDto[] = docs.map((raw) => {
      const doc = raw as FacialAccessDocument & {
        readerName?: string;
        eventCode?: string;
        eventAction?: string;
        similarity?: number | null;
        eventDate?: Date | null;
        createdAt?: Date;
      };
      return {
        readerName: doc.readerName ?? '',
        eventCode: doc.eventCode ?? '',
        eventAction: doc.eventAction ?? '',
        similarity: doc.similarity ?? null,
        eventDate: doc.eventDate ? doc.eventDate.toISOString() : null,
        createdAt: doc.createdAt
          ? doc.createdAt.toISOString()
          : new Date().toISOString(),
      };
    });

    return { items, page, limit, total };
  }
}
