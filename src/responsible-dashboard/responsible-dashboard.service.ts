import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import AxiosDigestAuth from '@mhoc/axios-digest-auth';
import type { Model } from 'mongoose';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { FacialAccessDocument } from '../accesses/access.schema';
import { FacialAccess } from '../accesses/access.schema';
import {
  createReaderCredentialsCipher,
  type ReaderCredentialsCipher,
} from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as readersQueries from '../database/queries/readers.queries';
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
  snapPath: string | null;
};

@Injectable()
export class ResponsibleDashboardService {
  private readonly readerCipher: ReaderCredentialsCipher;

  constructor(
    @InjectModel(FacialAccess.name)
    private readonly accessModel: Model<FacialAccessDocument>,
    private readonly database: DatabaseService,
    private readonly r2Storage: R2StorageService,
    private readonly configService: ConfigService<EnvVars, true>,
  ) {
    const key = this.configService.get('READER_ENCRYPTION_KEY', {
      infer: true,
    });
    this.readerCipher = createReaderCredentialsCipher(key);
  }

  private mapFacialDocsToDto(
    docs: unknown[],
  ): ResponsibleAccessHistoryItemDto[] {
    return docs.map((raw) => {
      const doc = raw as FacialAccessDocument & {
        readerName?: string;
        eventCode?: string;
        eventAction?: string;
        similarity?: number | null;
        eventDate?: Date | null;
        createdAt?: Date;
        snapPath?: string | null;
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
        snapPath:
          typeof doc.snapPath === 'string' && doc.snapPath.trim()
            ? doc.snapPath.trim()
            : null,
      };
    });
  }

  private async paginateFacialAccessByUserId(
    clientId: string,
    faceUserId: number,
    page: number,
    limit: number,
  ): Promise<{
    items: ResponsibleAccessHistoryItemDto[];
    total: number;
  }> {
    const filter = { clientId, userId: faceUserId };
    const total = await this.accessModel.countDocuments(filter).exec();
    const skip = (page - 1) * limit;

    const docs = await this.accessModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    const items = this.mapFacialDocsToDto(docs);
    return { items, total };
  }

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

    const { items, total } = await this.paginateFacialAccessByUserId(
      clientId,
      student.faceId,
      page,
      limit,
    );

    return { items, page, limit, total };
  }

  async listOwnAccesses(
    user: JwtPayload,
    page: number,
    limit: number,
  ): Promise<{
    items: ResponsibleAccessHistoryItemDto[];
    page: number;
    limit: number;
    total: number;
  }> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);

    const faceId =
      await responsiblesQueries.getResponsibleFaceId(
        this.database.db,
        responsibleId,
        clientId,
      );
    if (faceId == null) {
      return { items: [], page, limit, total: 0 };
    }

    const { items, total } = await this.paginateFacialAccessByUserId(
      clientId,
      faceId,
      page,
      limit,
    );

    return { items, page, limit, total };
  }

  /** Outros responsáveis ativos da mesma escola (ex.: autorizar retirada). */
  async listPeerResponsibles(user: JwtPayload) {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    return responsiblesQueries.listActiveResponsiblePeersExcept(
      this.database.db,
      clientId,
      responsibleId,
    );
  }

  /**
   * Proxy seguro da foto do evento: só permite host que coincide com leitor Intelbras
   * da mesma escola (`clientId`), usando Digest HTTP com credencial do leitor.
   */
  async proxyAccessSnapshot(
    user: JwtPayload,
    rawUrl: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const { clientId } = this.assertResponsibleScope(user);

    const snapshotUrl = rawUrl?.trim() ?? '';
    if (
      !snapshotUrl.startsWith('http://') &&
      !snapshotUrl.startsWith('https://')
    ) {
      throw new BadRequestException('Somente URLs http(s).');
    }

    let parsed: URL;
    try {
      parsed = new URL(snapshotUrl);
    } catch {
      throw new BadRequestException('URL malformada.');
    }

    if (parsed.username || parsed.password) {
      throw new BadRequestException('URL não permitida.');
    }

    const hostLower = parsed.hostname.trim().toLowerCase();
    const urlPort = parsed.port
      ? parseInt(parsed.port, 10)
      : parsed.protocol === 'https:'
        ? 443
        : 80;

    const readers = await readersQueries.listReadersForFaceSyncByClient(
      this.database.db,
      clientId,
    );

    const byIp = readers.filter(
      (r) => r.ip.trim().toLowerCase() === hostLower,
    );
    if (byIp.length === 0) {
      throw new ForbiddenException(
        'Origem da imagem não autorizada para esta escola.',
      );
    }

    let matched =
      byIp.find((r) => (r.port ?? 80) === urlPort) ?? null;
    if (!matched && byIp.length === 1) {
      matched = byIp[0];
    }
    if (!matched) {
      throw new ForbiddenException(
        'Nenhum leitor corresponde ao host/porta da URL.',
      );
    }

    let plainPassword: string;
    try {
      plainPassword = this.readerCipher.decrypt(matched.passwordEncrypted);
    } catch {
      throw new ForbiddenException('Credencial do leitor indisponível.');
    }

    const auth = new AxiosDigestAuth({
      username: matched.username.trim(),
      password: plainPassword,
    });

    try {
      const resp = (await auth.request({
        method: 'GET',
        url: snapshotUrl,
        responseType: 'arraybuffer',
        timeout: 20_000,
        validateStatus: () => true,
      })) as {
        status?: number;
        data?: ArrayBuffer;
        headers?: Record<string, unknown>;
      };

      const status = resp.status ?? 0;
      if (status < 200 || status >= 300) {
        throw new ForbiddenException(`Leitor retornou HTTP ${status}.`);
      }

      const buf = Buffer.from(resp.data ?? new ArrayBuffer(0));
      const rawCt = resp.headers?.['content-type'];
      const contentType =
        typeof rawCt === 'string'
          ? rawCt.split(';')[0]?.trim() ?? 'image/jpeg'
          : 'image/jpeg';

      if (!contentType.startsWith('image/')) {
        throw new ForbiddenException('Resposta não é uma imagem.');
      }

      return { body: buf, contentType };
    } catch (err: unknown) {
      if (
        err instanceof BadRequestException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }
      throw new ForbiddenException(
        `Falha ao obter imagem: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
