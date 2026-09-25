import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';

import { clients } from '../database/schema';
import { DatabaseService } from '../database/database.service';
import { buildFacialAccessMongoFilter } from './build-facial-access-list-filter';
import { findAccessPersonIdsByLocation } from './find-access-person-ids-by-location';
import { resolveAccessPersonByFaceId } from './resolve-access-person';
import {
  ACCESS_BLOCKED_ATTEMPT,
  ACCESS_FACIAL_RECORDED,
} from '../notifications/notifications.events';
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
  status: 'granted' | 'denied';
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

export type ClientAccessListResponse = AccessListResponse & {
  timezoneOffsetMinutes: number;
};

export type AccessListQueryOptions = {
  clientId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  name?: string;
  block?: string;
  unit?: string;
  readerId?: string;
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
    const denied = data.Status != null && data.Status !== 1;

    const rawSim = data.Similarity;
    const similarityNum =
      typeof rawSim === 'number'
        ? rawSim
        : rawSim != null && String(rawSim).trim() !== ''
          ? Number(rawSim)
          : NaN;
    if (!denied && (!Number.isFinite(similarityNum) || similarityNum <= 0)) {
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
    let personId: string | null = null;
    let personType: 'student' | 'responsible' | 'member' | 'guest' | null =
      null;
    let isBlocked = false;
    let blockReason: string | null = null;

    try {
      const resolved = await resolveAccessPersonByFaceId(
        this.database.db,
        faceIdNum,
        ctx.clientId,
      );
      if (resolved) {
        personName = resolved.personName;
        personId = resolved.personId;
        personType = resolved.personType;
        isBlocked = resolved.isBlocked === true;
        blockReason = resolved.blockReason ?? null;
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Lookup person identity falhou (faceId=${faceIdNum}, client=${ctx.clientId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (denied && !personId) {
      return;
    }

    const eventDate = dateFromIntelbrasUtc(data.CreateTime ?? data.UTC);
    const status: 'granted' | 'denied' = denied ? 'denied' : 'granted';

    const docFields = {
      companyId: ctx.companyId,
      readerId: ctx.id,
      readerName: ctx.name,
      clientId: ctx.clientId,
      clientName: ctx.clientName,
      userId: faceIdNum,
      personName,
      personId,
      personType,
      status,
      errorCode: data.ErrorCode ?? null,
      userType: data.UserType ?? null,
      cardType: data.CardType ?? null,
      eventCode: event.code,
      eventAction: String(event.action),
      similarity: Number.isFinite(similarityNum) ? similarityNum : null,
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

      if (denied) {
        if (isBlocked) {
          this.eventEmitter.emit(ACCESS_BLOCKED_ATTEMPT, {
            accessId: String(doc._id),
            faceId: faceIdNum,
            clientId: ctx.clientId,
            clientName: ctx.clientName,
            companyId: ctx.companyId,
            personName,
            personId,
            personType,
            blockReason,
            readerId: ctx.id,
            readerName: ctx.name,
            readerDirection: ctx.direction ?? null,
            eventDate: eventDate ?? null,
            snapR2Key,
          });
        }
      } else {
        this.eventEmitter.emit(ACCESS_FACIAL_RECORDED, {
          accessId: String(doc._id),
          faceId: faceIdNum,
          clientId: ctx.clientId,
          companyId: ctx.companyId,
          personName,
          personId,
          personType,
          readerId: ctx.id,
          readerName: ctx.name,
          readerDirection: ctx.direction ?? null,
          eventDate: eventDate ?? null,
        });
      }
    } catch (err: unknown) {
      this.logger.error(
        `Mongo upsert facial_access (snap) falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  async recordRemoteOpen(input: {
    companyId: string;
    readerId: string;
    readerName: string;
    clientId: string;
    clientName: string;
    readerDirection: 'in' | 'out' | null;
    triggeredByUserId: string;
    triggeredByName: string;
    opened: boolean;
  }): Promise<void> {
    const now = new Date();
    const actor = input.triggeredByName.trim() || 'Usuário';
    try {
      await this.accessModel.create({
        companyId: input.companyId,
        readerId: input.readerId,
        readerName: input.readerName,
        clientId: input.clientId,
        clientName: input.clientName,
        userId: 0,
        personName: `${actor} (abertura remota)`,
        personId: null,
        personType: null,
        status: input.opened ? 'granted' : 'denied',
        eventCode: 'RemoteOpen',
        eventAction: 'Manual',
        similarity: null,
        eventDate: now,
        snapPath: null,
        snapR2Key: null,
        readerDirection: input.readerDirection,
        triggeredByUserId: input.triggeredByUserId,
        triggeredByName: actor,
      });
    } catch (err: unknown) {
      this.logger.error(
        `Falha ao gravar abertura remota: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listForCompany(
    companyId: string,
    options: AccessListQueryOptions,
  ): Promise<AccessListResponse> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = AccessesService.DEFAULT_PAGE_SIZE;

    let timezoneOffsetMinutes = 0;
    if (options.clientId) {
      const row = await this.database.db.query.clients.findFirst({
        where: and(
          eq(clients.id, options.clientId),
          eq(clients.companyId, companyId),
        ),
        columns: { timezoneOffsetMinutes: true },
      });
      if (!row) {
        return { items: [], page, pageSize, total: 0 };
      }
      timezoneOffsetMinutes = row.timezoneOffsetMinutes ?? 0;
    }

    const wantsLocation = Boolean(
      options.block?.trim() || options.unit?.trim(),
    );
    const locationIds = wantsLocation
      ? await findAccessPersonIdsByLocation(this.database.db, {
          companyId,
          clientId: options.clientId,
          block: options.block,
          unit: options.unit,
        })
      : undefined;

    const filter = buildFacialAccessMongoFilter(
      {
        companyId,
        clientId: options.clientId,
        startDate: options.startDate,
        endDate: options.endDate,
        name: options.name,
        readerId: options.readerId,
        timezoneOffsetMinutes,
      },
      locationIds,
    );
    if (!filter) {
      return { items: [], page, pageSize, total: 0 };
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
        status: d.status === 'denied' ? 'denied' : 'granted',
      };
    });

    return { items, page, pageSize, total };
  }

  async listForClient(
    companyId: string,
    clientId: string,
    options: Omit<AccessListQueryOptions, 'clientId'>,
  ): Promise<ClientAccessListResponse> {
    const row = await this.database.db.query.clients.findFirst({
      where: and(eq(clients.id, clientId), eq(clients.companyId, companyId)),
      columns: { timezoneOffsetMinutes: true },
    });
    const list = await this.listForCompany(companyId, {
      ...options,
      clientId,
    });
    return {
      ...list,
      timezoneOffsetMinutes: row?.timezoneOffsetMinutes ?? 0,
    };
  }

  async getPhotoUrl(
    id: string,
    companyId: string,
    clientId?: string,
  ): Promise<FacialAccessPhotoUrlDto> {
    const trimmed = typeof id === 'string' ? id.trim() : '';
    if (!trimmed || !Types.ObjectId.isValid(trimmed)) {
      throw new NotFoundException('Acesso facial não encontrado.');
    }

    const doc = await this.accessModel
      .findOne({
        _id: new Types.ObjectId(trimmed),
        companyId,
        ...(clientId ? { clientId } : {}),
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
