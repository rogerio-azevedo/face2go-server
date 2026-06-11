import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';

import { clients } from '../database/schema';
import { DatabaseService } from '../database/database.service';
import * as membersQueries from '../database/queries/members.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import * as pickupQueries from '../database/queries/pickup-authorizations.queries';
import { ACCESS_FACIAL_RECORDED } from '../notifications/notifications.events';
import type { VideoEvent } from '../face-listener/face-listener.types';
import { R2StorageService } from '../storage/r2-storage.service';
import type { ReaderStreamContextLike } from './reader-stream-context.type';
import { FacialAccess, type FacialAccessDocument } from './access.schema';
import {
  accessControlDataFromRecord,
  buildFacialCorrelationId,
  dateFromIntelbrasUtc,
  getStreamEventDedupKey,
} from './stream-event.util';

function isMongoDuplicateKeyError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  );
}

export type AccessListItemDto = {
  id: string;
  companyId: string;
  readerId: string;
  readerName: string;
  clientId: string;
  clientName: string;
  userId: number;
  personName: string | null;
  eventCode: string;
  eventAction: string;
  similarity: number | null;
  eventDate: string | null;
  createdAt: string;
  snapPath: string | null;
  snapR2Key: string | null;
  readerDirection: 'in' | 'out' | null;
};

export type FacialAccessPhotoUrlDto = {
  snapUrl: string | null;
};

export type AccessListResponse = {
  items: AccessListItemDto[];
  page: number;
  pageSize: number;
  total: number;
};

@Injectable()
export class AccessesService {
  private readonly logger = new Logger(AccessesService.name);
  /** Evita gravar o mesmo evento duas vezes no mesmo processo. */
  private readonly persistedEventKeys = new Map<string, number>();
  /** Serializa persistências concorrentes do mesmo leitor. */
  private readonly persistChains = new Map<string, Promise<void>>();

  private static readonly DEFAULT_PAGE_SIZE = 20;

  constructor(
    @InjectModel(FacialAccess.name)
    private readonly accessModel: Model<FacialAccessDocument>,
    private readonly database: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
    private readonly r2Storage: R2StorageService,
  ) {}

  /**
   * Persiste acesso facial a partir do stream SnapManager (texto + JPEG inline),
   * enviando a imagem para o R2 quando disponível.
   */
  recordSnapManagerAccess(
    event: VideoEvent,
    ctx: ReaderStreamContextLike,
    imageJpeg: Buffer | null,
  ): Promise<void> {
    const prev = this.persistChains.get(ctx.id) ?? Promise.resolve();
    const next = prev
      .then(() => this.persistSnapManagerAccessOnce(event, ctx, imageJpeg))
      .catch((err: unknown) => {
        this.logger.warn(
          `[AccessesService] Persistência falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        if (this.persistChains.get(ctx.id) === next) {
          this.persistChains.delete(ctx.id);
        }
      });
    this.persistChains.set(ctx.id, next);
    return next;
  }

  private async persistSnapManagerAccessOnce(
    event: VideoEvent,
    ctx: ReaderStreamContextLike,
    imageJpeg: Buffer | null,
  ): Promise<void> {
    const action = String(event.action).toLowerCase();
    const code = event.code;
    const isDoorFace = code === '_DoorFace_';
    const isAccessControl = code === 'AccessControl';

    if (!isDoorFace && !isAccessControl) {
      return;
    }
    if (isDoorFace && action !== 'pulse') {
      return;
    }
    if (isAccessControl && action !== 'pulse' && action !== 'start') {
      return;
    }

    const raw = event.data;
    if (!raw || typeof raw !== 'object') {
      return;
    }

    const data = accessControlDataFromRecord(raw);
    const userId = data.UserID;
    if (userId === undefined || userId === null || String(userId) === '') {
      return;
    }
    if (data.Status != null && data.Status !== 1) {
      return;
    }

    const rawSim = data.Similarity;
    const similarityNum =
      typeof rawSim === 'number'
        ? rawSim
        : rawSim != null && String(rawSim).trim() !== ''
          ? Number(rawSim)
          : NaN;
    if (!Number.isFinite(similarityNum) || similarityNum <= 0) {
      return;
    }

    const correlationId = buildFacialCorrelationId(ctx.id, data);
    const dedupKey =
      correlationId ?? getStreamEventDedupKey(ctx.id, data) ?? null;
    if (dedupKey && this.persistedEventKeys.has(dedupKey)) {
      return;
    }

    const faceIdNum = Number(userId);
    if (!Number.isFinite(faceIdNum)) {
      return;
    }

    let snapR2Key: string | null = null;
    if (imageJpeg && imageJpeg.length > 0) {
      const key = `accesses/${ctx.companyId}/${Date.now()}-${faceIdNum}-${randomBytes(4).toString('hex')}.jpg`;
      try {
        await this.r2Storage.putObject(key, imageJpeg, 'image/jpeg');
        snapR2Key = key;
      } catch (err: unknown) {
        this.logger.warn(
          `[AccessesService] Upload snapshot R2 falhou (faceId=${faceIdNum}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const snapPathDevice =
      typeof data.SnapPath === 'string' && data.SnapPath.trim()
        ? data.SnapPath.trim()
        : null;
    const snapPath = snapR2Key ? null : snapPathDevice;

    let personName: string | null = null;
    try {
      personName =
        await responsiblesQueries.findResponsibleByFaceIdAndClientId(
          this.database.db,
          faceIdNum,
          ctx.clientId,
        ).then((r) => r?.name ?? null);
    } catch (err: unknown) {
      this.logger.warn(
        `Lookup responsible personName falhou (faceId=${faceIdNum}, client=${ctx.clientId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!personName) {
      try {
        personName = await studentsQueries.findStudentByFaceIdAndClientId(
          this.database.db,
          faceIdNum,
          ctx.clientId,
        ).then((s) => s?.name ?? null);
      } catch (err: unknown) {
        this.logger.warn(
          `Lookup student personName falhou (faceId=${faceIdNum}, client=${ctx.clientId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!personName) {
      try {
        personName = await membersQueries.findMemberNameByFaceId(
          this.database.db,
          ctx.clientId,
          faceIdNum,
        );
      } catch (err: unknown) {
        this.logger.warn(
          `Lookup member personName falhou (faceId=${faceIdNum}, client=${ctx.clientId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!personName) {
      try {
        personName =
          await registrationsQueries.findApprovedRegistrationNameByFaceId(
            this.database.db,
            ctx.clientId,
            faceIdNum,
          );
      } catch (err: unknown) {
        this.logger.warn(
          `Lookup personName falhou (faceId=${faceIdNum}, client=${ctx.clientId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!personName) {
      try {
        const pickupAuths =
          await pickupQueries.pickupAuthFindActiveByGuestFaceId(
            this.database.db,
            ctx.clientId,
            faceIdNum,
          );
        const guestName = pickupAuths[0]?.guestName?.trim();
        if (guestName) {
          personName = guestName;
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Lookup pickup guestName falhou (faceId=${faceIdNum}, client=${ctx.clientId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const eventDate = dateFromIntelbrasUtc(data.CreateTime ?? data.UTC);

    const docFields = {
      companyId: ctx.companyId,
      readerId: ctx.id,
      readerName: ctx.name,
      clientId: ctx.clientId,
      clientName: ctx.clientName,
      userId: faceIdNum,
      personName,
      eventCode: event.code,
      eventAction: String(event.action),
      similarity: similarityNum,
      eventDate: eventDate ?? null,
      snapPath,
      snapR2Key,
      readerDirection: ctx.direction ?? null,
      correlationId,
    };

    try {
      let doc: FacialAccessDocument | null = null;

      if (correlationId) {
        const filter = { readerId: ctx.id, correlationId };
        try {
          doc = await this.accessModel.findOneAndUpdate(
            filter,
            { $set: docFields },
            {
              upsert: true,
              returnDocument: 'after',
              setDefaultsOnInsert: true,
            },
          );
        } catch (err: unknown) {
          if (!isMongoDuplicateKeyError(err)) {
            throw err;
          }
          doc = await this.accessModel.findOneAndUpdate(
            filter,
            { $set: docFields },
            { returnDocument: 'after' },
          );
        }
      } else {
        doc = await this.accessModel.create(docFields);
      }

      if (!doc) {
        throw new Error('Persistência facial retornou null inesperadamente');
      }

      if (dedupKey) {
        this.persistedEventKeys.set(dedupKey, Date.now());
      }

      this.eventEmitter.emit(ACCESS_FACIAL_RECORDED, {
        accessId: String(doc._id),
        faceId: faceIdNum,
        clientId: ctx.clientId,
        personName,
        readerId: ctx.id,
        readerName: ctx.name,
        readerDirection: ctx.direction ?? null,
        eventDate: eventDate ?? null,
      });
    } catch (err: unknown) {
      this.logger.error(
        `Mongo upsert facial_access (snap) falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  async listForCompany(
    companyId: string,
    options: {
      clientId?: string;
      startDate?: string;
      endDate?: string;
      page?: number;
    },
  ): Promise<AccessListResponse> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = AccessesService.DEFAULT_PAGE_SIZE;

    if (options.clientId) {
      const row = await this.database.db.query.clients.findFirst({
        where: and(
          eq(clients.id, options.clientId),
          eq(clients.companyId, companyId),
        ),
      });
      if (!row) {
        return { items: [], page, pageSize, total: 0 };
      }
    }

    const filter: Record<string, unknown> = { companyId };
    if (options.clientId) {
      filter.clientId = options.clientId;
    }

    let start: Date | undefined;
    let end: Date | undefined;
    if (options.startDate) {
      start = new Date(options.startDate);
      if (Number.isNaN(start.getTime())) {
        start = undefined;
      }
    }
    if (options.endDate) {
      end = new Date(options.endDate);
      if (Number.isNaN(end.getTime())) {
        end = undefined;
      } else {
        end.setHours(23, 59, 59, 999);
      }
    }
    if (start && end) {
      filter.createdAt = { $gte: start, $lte: end };
    } else if (start) {
      filter.createdAt = { $gte: start };
    } else if (end) {
      filter.createdAt = { $lte: end };
    }

    const total = await this.accessModel.countDocuments(filter).exec();
    const skip = (page - 1) * pageSize;

    const docs = await this.accessModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean()
      .exec();

    const items: AccessListItemDto[] = docs.map((doc) => {
      const d = doc as FacialAccessDocument & {
        _id: { toString(): string };
        createdAt?: Date;
        eventDate?: Date | null;
      };
      return {
        id: d._id.toString(),
        companyId: d.companyId,
        readerId: d.readerId,
        readerName: d.readerName,
        clientId: d.clientId,
        clientName: d.clientName,
        userId: d.userId,
        personName: d.personName ?? null,
        eventCode: d.eventCode,
        eventAction: d.eventAction,
        similarity: d.similarity ?? null,
        eventDate: d.eventDate ? d.eventDate.toISOString() : null,
        createdAt: d.createdAt
          ? d.createdAt.toISOString()
          : new Date().toISOString(),
        snapPath:
          (d as FacialAccessDocument & { snapPath?: string | null }).snapPath ??
          null,
        snapR2Key:
          (d as FacialAccessDocument & { snapR2Key?: string | null })
            .snapR2Key ?? null,
        readerDirection:
          (
            d as FacialAccessDocument & {
              readerDirection?: 'in' | 'out' | null;
            }
          ).readerDirection ?? null,
      };
    });

    return { items, page, pageSize, total };
  }

  async getPhotoUrl(
    id: string,
    companyId: string,
  ): Promise<FacialAccessPhotoUrlDto> {
    const trimmed = typeof id === 'string' ? id.trim() : '';
    if (!trimmed || !Types.ObjectId.isValid(trimmed)) {
      throw new NotFoundException('Acesso facial não encontrado.');
    }

    const doc = await this.accessModel
      .findOne({
        _id: new Types.ObjectId(trimmed),
        companyId,
      })
      .lean()
      .exec();

    if (!doc) {
      throw new NotFoundException('Acesso facial não encontrado.');
    }

    const key = typeof doc.snapR2Key === 'string' ? doc.snapR2Key.trim() : '';
    if (!key) {
      return { snapUrl: null };
    }

    try {
      const snapUrl = await this.r2Storage.createPresignedGetUrl(key);
      return { snapUrl };
    } catch (err: unknown) {
      this.logger.debug(
        `Presign facial foto falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { snapUrl: null };
    }
  }
}
