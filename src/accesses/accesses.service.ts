import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Model } from 'mongoose';

import { clients } from '../database/schema';
import { DatabaseService } from '../database/database.service';
import * as registrationsQueries from '../database/queries/registrations.queries';
import { ACCESS_FACIAL_RECORDED } from '../notifications/notifications.events';
import type { VideoEvent } from '../face-listener/face-listener.types';
import { R2StorageService } from '../storage/r2-storage.service';
import type { ReaderStreamContextLike } from './reader-stream-context.type';
import { FacialAccess, type FacialAccessDocument } from './access.schema';
import {
  accessControlDataFromRecord,
  dateFromIntelbrasUtc,
  getStreamEventDedupKey,
} from './stream-event.util';

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
};

export type AccessListResponse = {
  items: AccessListItemDto[];
  page: number;
  pageSize: number;
  total: number;
};

@Injectable()
export class AccessesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccessesService.name);
  private readonly processedEventKeys = new Map<string, number>();
  private readonly DEDUP_TTL_MS = 5 * 60 * 1000;
  private dedupCleanupTimer?: ReturnType<typeof setInterval>;

  private static readonly DEFAULT_PAGE_SIZE = 20;

  constructor(
    @InjectModel(FacialAccess.name)
    private readonly accessModel: Model<FacialAccessDocument>,
    private readonly database: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
    private readonly r2Storage: R2StorageService,
  ) {}

  onModuleInit(): void {
    this.dedupCleanupTimer = setInterval(() => {
      this.cleanupExpiredDedupKeys();
    }, this.DEDUP_TTL_MS);
  }

  onModuleDestroy(): void {
    if (this.dedupCleanupTimer) {
      clearInterval(this.dedupCleanupTimer);
    }
  }

  private cleanupExpiredDedupKeys(): void {
    const cutoff = Date.now() - this.DEDUP_TTL_MS;
    for (const [key, ts] of this.processedEventKeys) {
      if (ts < cutoff) {
        this.processedEventKeys.delete(key);
      }
    }
  }

  /**
   * Persiste acesso facial a partir do stream SnapManager (texto + JPEG inline),
   * enviando a imagem para o R2 quando disponível.
   */
  async recordSnapManagerAccess(
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

    const data = accessControlDataFromRecord(raw as Record<string, unknown>);
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

    const streamKey = getStreamEventDedupKey(ctx.id, data);
    if (streamKey !== null) {
      if (this.processedEventKeys.has(streamKey)) {
        return;
      }
      this.processedEventKeys.set(streamKey, Date.now());
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

    const eventDate = dateFromIntelbrasUtc(data.CreateTime ?? data.UTC);

    try {
      const doc = await this.accessModel.create({
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
      });

      this.eventEmitter.emit(ACCESS_FACIAL_RECORDED, {
        accessId: String(doc._id),
        faceId: faceIdNum,
        clientId: ctx.clientId,
        personName,
        readerName: ctx.name,
        readerDirection: ctx.direction ?? null,
        eventDate: eventDate ?? null,
      });
    } catch (err: unknown) {
      this.logger.error(
        `Mongo create facial_access (snap) falhou: ${err instanceof Error ? err.message : String(err)}`,
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
      };
    });

    return { items, page, pageSize, total };
  }
}
