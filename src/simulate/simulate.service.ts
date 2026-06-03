import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import {
  FacialAccess,
  type FacialAccessDocument,
} from '../accesses/access.schema';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as readersQueries from '../database/queries/readers.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { ACCESS_FACIAL_RECORDED } from '../notifications/notifications.events';
import { R2StorageService } from '../storage/r2-storage.service';

import type { SimulateFaceAccessDto } from './simulate.dto';

export type SimulatePersonDto = {
  id: string;
  name: string;
  photoUrl: string | null;
  hasFace: boolean;
};

@Injectable()
export class SimulateService {
  constructor(
    @InjectModel(FacialAccess.name)
    private readonly accessModel: Model<FacialAccessDocument>,
    private readonly database: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
    private readonly r2Storage: R2StorageService,
  ) {}

  private async presignPhoto(
    photoKey: string | null | undefined,
  ): Promise<string | null> {
    const k = typeof photoKey === 'string' ? photoKey.trim() : '';
    if (!k) return null;
    try {
      return await this.r2Storage.createPresignedGetUrl(k);
    } catch {
      return null;
    }
  }

  private async resolveClientForUser(user: JwtPayload, clientId: string) {
    if (user.role === 'super_admin') {
      const row = await clientsQueries.getClientByIdOnly(
        this.database.db,
        clientId,
      );
      if (!row) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      return row;
    }

    const companyId = user.companyId;
    if (!companyId) {
      throw new ForbiddenException('Empresa não associada ao usuário.');
    }

    const row = await clientsQueries.getClientById(
      this.database.db,
      clientId,
      companyId,
    );
    if (!row) {
      throw new ForbiddenException('Cliente não encontrado ou sem permissão.');
    }
    return row;
  }

  private async resolveSimulationReaderContext(
    companyId: string,
    clientId: string,
    readerIdInput: string | undefined,
  ): Promise<{
    mongoReaderId: string;
    readerName: string;
    readerDirection: 'in' | 'out' | null;
  }> {
    const fallback = {
      mongoReaderId: 'simulator',
      readerName: 'Simulador (Dev)',
      readerDirection: null as 'in' | 'out' | null,
    };
    const trimmed = readerIdInput?.trim();
    if (!trimmed) {
      return fallback;
    }

    const reader = await readersQueries.getReaderById(
      this.database.db,
      trimmed,
      companyId,
    );
    if (!reader || !reader.isActive || reader.clientId !== clientId) {
      return fallback;
    }

    return {
      mongoReaderId: reader.id,
      readerName: reader.name,
      readerDirection: reader.direction ?? null,
    };
  }

  async listPeople(
    user: JwtPayload,
    clientId: string,
  ): Promise<{
    students: SimulatePersonDto[];
    responsibles: SimulatePersonDto[];
  }> {
    await this.resolveClientForUser(user, clientId);

    const [students, responsibles] = await Promise.all([
      studentsQueries.listStudentsByClient(this.database.db, clientId),
      responsiblesQueries.listResponsiblesByClient(this.database.db, clientId),
    ]);

    const studentsOut: SimulatePersonDto[] = await Promise.all(
      students.map(async (s) => ({
        id: s.id,
        name: s.name,
        photoUrl: await this.presignPhoto(s.photoKey),
        hasFace: s.faceId != null,
      })),
    );

    const responsiblesOut: SimulatePersonDto[] = await Promise.all(
      responsibles.map(async (r) => ({
        id: r.id,
        name: r.name,
        photoUrl: await this.presignPhoto(r.photoKey),
        hasFace: r.faceId != null,
      })),
    );

    return {
      students: studentsOut,
      responsibles: responsiblesOut,
    };
  }

  async simulateFaceAccess(
    user: JwtPayload,
    dto: SimulateFaceAccessDto,
  ): Promise<{ accessId: string }> {
    const client = await this.resolveClientForUser(user, dto.clientId);

    const simReader = await this.resolveSimulationReaderContext(
      client.companyId,
      dto.clientId,
      dto.readerId,
    );

    if (dto.personType === 'student') {
      const student = await studentsQueries.getStudentById(
        this.database.db,
        dto.personId,
        dto.clientId,
      );
      if (!student) {
        throw new NotFoundException('Aluno não encontrado.');
      }
      if (student.faceId == null) {
        throw new BadRequestException('Este aluno não possui face cadastrada.');
      }

      let personName: string | null = student.name;
      try {
        const fromRegistration =
          await registrationsQueries.findApprovedRegistrationNameByFaceId(
            this.database.db,
            dto.clientId,
            student.faceId,
          );
        personName = fromRegistration ?? student.name;
      } catch {
        personName = student.name;
      }

      const snapKey =
        typeof student.photoKey === 'string' && student.photoKey.trim()
          ? student.photoKey.trim()
          : null;

      const doc = await this.accessModel.create({
        companyId: client.companyId,
        readerId: simReader.mongoReaderId,
        readerName: simReader.readerName,
        clientId: dto.clientId,
        clientName: client.name,
        userId: student.faceId,
        personName,
        eventCode: 'Simulated',
        eventAction: 'pulse',
        similarity: 1,
        eventDate: new Date(),
        snapPath: null,
        snapR2Key: snapKey,
      });

      this.eventEmitter.emit(ACCESS_FACIAL_RECORDED, {
        accessId: String(doc._id),
        faceId: student.faceId,
        clientId: dto.clientId,
        personName,
        readerId: simReader.mongoReaderId,
        readerName: simReader.readerName,
        readerDirection: simReader.readerDirection,
        eventDate:
          doc.eventDate instanceof Date
            ? doc.eventDate
            : doc.eventDate
              ? new Date(doc.eventDate)
              : null,
      });

      return { accessId: String(doc._id) };
    }

    const responsible = await responsiblesQueries.getResponsibleById(
      this.database.db,
      dto.personId,
      dto.clientId,
    );
    if (!responsible) {
      throw new NotFoundException('Responsável não encontrado.');
    }
    if (responsible.faceId == null) {
      throw new BadRequestException(
        'Este responsável não possui face cadastrada.',
      );
    }

    let personName: string | null = responsible.name;
    try {
      const fromRegistration =
        await registrationsQueries.findApprovedRegistrationNameByFaceId(
          this.database.db,
          dto.clientId,
          responsible.faceId,
        );
      personName = fromRegistration ?? responsible.name;
    } catch {
      personName = responsible.name;
    }

    const snapKey =
      typeof responsible.photoKey === 'string' && responsible.photoKey.trim()
        ? responsible.photoKey.trim()
        : null;

    const doc = await this.accessModel.create({
      companyId: client.companyId,
      readerId: simReader.mongoReaderId,
      readerName: simReader.readerName,
      clientId: dto.clientId,
      clientName: client.name,
      userId: responsible.faceId,
      personName,
      eventCode: 'Simulated',
      eventAction: 'pulse',
      similarity: 1,
      eventDate: new Date(),
      snapPath: null,
      snapR2Key: snapKey,
    });

    this.eventEmitter.emit(ACCESS_FACIAL_RECORDED, {
      accessId: String(doc._id),
      faceId: responsible.faceId,
      clientId: dto.clientId,
      personName,
      readerId: simReader.mongoReaderId,
      readerName: simReader.readerName,
      readerDirection: simReader.readerDirection,
      eventDate:
        doc.eventDate instanceof Date
          ? doc.eventDate
          : doc.eventDate
            ? new Date(doc.eventDate)
            : null,
    });

    return { accessId: String(doc._id) };
  }
}
