import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';

import { DatabaseService } from '../database/database.service';
import { clients } from '../database/schema';
import type { CameraStreamContext } from '../lpr-listener/lpr-listener.types';
import type { LprStreamReadingPayload } from '../lpr-listener/lpr-stream.parser';
import { ACCESS_LPR_RECORDED } from '../notifications/notifications.events';
import { R2StorageService } from '../storage/r2-storage.service';
import * as vehiclesQueries from '../database/queries/vehicles.queries';
import { LprAccess, type LprAccessDocument } from './lpr-access.schema';

export type LprAccessListItemDto = {
  id: string;
  companyId: string;
  cameraId: string;
  cameraName: string;
  clientId: string;
  clientName: string;
  plateNumber: string;
  plateColor: string | null;
  confidence: number | null;
  vehicleType: string | null;
  vehicleBrand: string | null;
  direction: string | null;
  snapTime: string | null;
  isAllowed: boolean | null;
  isBlocked: boolean | null;
  cutoutPicKey: string | null;
  createdAt: string;
};

export type LprAccessListResponse = {
  items: LprAccessListItemDto[];
  page: number;
  pageSize: number;
  total: number;
};

export type LprAccessPhotoUrlsDto = {
  cutoutUrl: string | null;
  vehicleUrl: string | null;
  normalUrl: string | null;
};

function parseDeviceDate(raw: string | null | undefined): Date | null {
  if (raw == null || !String(raw).trim()) return null;
  const s = String(raw).trim();

  if (/^\d+(\.\d+)?$/.test(s)) {
    const num = Number(s);
    if (Number.isFinite(num)) {
      const ms = num > 1e12 ? num : num * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeConfidencePercent(
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > 0 && value <= 1) return Math.round(value * 100);
  return Math.round(value);
}

function normalizeCorrelationEventId(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s !== '' ? s : null;
}

function resolveCorrelationEventId(
  reading: LprStreamReadingPayload,
): string | null {
  return normalizeCorrelationEventId(reading.correlationEventId);
}

function buildLprRawPayload(
  reading: LprStreamReadingPayload,
  plateNum: string,
  correlId: string,
  sourceHost: string,
): Record<string, unknown> {
  const { rawFlatSubset, ...fields } = reading;
  const payload: Record<string, unknown> = {
    ...fields,
    plateNumber: plateNum,
    correlationEventId: correlId,
    sourceHost,
  };
  if (rawFlatSubset && Object.keys(rawFlatSubset).length > 0) {
    payload.snapFlatSubsetJson = JSON.stringify(rawFlatSubset);
  }
  return payload;
}

function isNumericEventId(id: string): boolean {
  return /^\d+$/.test(id);
}

function isMongoDuplicateKeyError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  );
}

@Injectable()
export class LprAccessesService {
  private readonly logger = new Logger(LprAccessesService.name);
  private static readonly DEFAULT_PAGE_SIZE = 20;
  /** Evita gravar o mesmo EventID duas vezes no mesmo processo. */
  private readonly persistedEventKeys = new Map<string, number>();
  /** Serializa persistências concorrentes da mesma câmera. */
  private readonly persistChains = new Map<string, Promise<void>>();

  constructor(
    @InjectModel(LprAccess.name)
    private readonly lprModel: Model<LprAccessDocument>,
    private readonly database: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
    private readonly r2Storage: R2StorageService,
  ) {}

  /** Persiste leitura TrafficJunction do snapManager (1 evento = 1 documento). */
  recordLprReading(
    reading: LprStreamReadingPayload,
    ctx: CameraStreamContext,
    imageJpegs?: Buffer[],
  ): Promise<void> {
    const prev = this.persistChains.get(ctx.id) ?? Promise.resolve();
    const next = prev
      .then(() => this.persistLprReadingOnce(reading, ctx, imageJpegs))
      .catch((err: unknown) => {
        this.logger.warn(
          `[LprAccesses] Persistência falhou: ${err instanceof Error ? err.message : String(err)}`,
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

  private async persistLprReadingOnce(
    reading: LprStreamReadingPayload,
    ctx: CameraStreamContext,
    imageJpegs?: Buffer[],
  ): Promise<void> {
    let plateNum = reading.plateNumber?.trim();
    if (
      plateNum == null ||
      plateNum === '' ||
      plateNum === '(sem placa reconhecida)'
    ) {
      return;
    }

    plateNum = plateNum.toUpperCase();

    if (reading.eventCode !== 'TrafficJunction') {
      return;
    }

    const eventId = resolveCorrelationEventId(reading);
    if (!eventId || !isNumericEventId(eventId)) {
      this.logger.warn(
        `[LprAccesses] Evento ignorado — EventID inválido (placa=${plateNum}, eventId=${eventId ?? 'null'})`,
      );
      return;
    }

    if (!reading.direction?.trim()) {
      this.logger.warn(
        `[LprAccesses] Evento ignorado — snap incompleto, sem direção (eventId=${eventId})`,
      );
      return;
    }

    if (reading.isAllowed == null && !reading.vehicleType?.trim()) {
      this.logger.warn(
        `[LprAccesses] Evento ignorado — snap incompleto, sem metadados ANPR (eventId=${eventId})`,
      );
      return;
    }

    const dedupKey = `${ctx.id}|${eventId}`;
    if (this.persistedEventKeys.has(dedupKey)) {
      console.log('[LPR][PERSIST][SKIP]', {
        plate: plateNum,
        eventId,
        reason: 'eventId já persistido neste processo',
      });
      return;
    }

    const imgs = imageJpegs?.filter((b) => b && b.length > 0) ?? [];
    if (imgs.length === 0) {
      this.logger.warn(
        `[LprAccesses] Evento ignorado — sem imagem (eventId=${eventId}, placa=${plateNum})`,
      );
      return;
    }

    const snapTime = parseDeviceDate(reading.snapTimeRaw);
    const accurateTime = parseDeviceDate(reading.accurateTimeRaw);

    let cutoutPicKey: string | null = null;
    let vehiclePicKey: string | null = null;
    let normalPicKey: string | null = null;

    const prefix = `lpr-accesses/${ctx.companyId}/${ctx.id}`;
    const put = async (buf: Buffer, slot: string) => {
      const key = `${prefix}/${Date.now()}-${slot}-${randomBytes(4).toString('hex')}.jpg`;
      try {
        await this.r2Storage.putObject(key, buf, 'image/jpeg');
        return key;
      } catch (err: unknown) {
        this.logger.warn(
          `[LprAccesses] Upload R2 falhou (${slot}): ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    };

    if (imgs.length === 1) {
      const first = imgs[0];
      if (first) cutoutPicKey = (await put(first, 'cutout')) ?? null;
    } else if (imgs.length === 2) {
      const first = imgs[0];
      const second = imgs[1];
      if (first) cutoutPicKey = (await put(first, 'cutout')) ?? null;
      if (second) vehiclePicKey = (await put(second, 'vehicle')) ?? null;
    } else {
      const first = imgs[0];
      const second = imgs[1];
      const third = imgs[2];
      if (first) cutoutPicKey = (await put(first, 'cutout')) ?? null;
      if (second) vehiclePicKey = (await put(second, 'vehicle')) ?? null;
      if (third) normalPicKey = (await put(third, 'normal')) ?? null;
    }

    if (!cutoutPicKey && !vehiclePicKey && !normalPicKey) {
      this.logger.warn(
        `[LprAccesses] Evento ignorado — upload R2 falhou (eventId=${eventId})`,
      );
      return;
    }

    const rawPayload = buildLprRawPayload(reading, plateNum, eventId, ctx.host);

    let personName: string | null = null;
    let personId: string | null = null;
    let personType: 'student' | 'responsible' | 'member' | null = null;

    try {
      const responsible = await vehiclesQueries.findResponsibleByPlate(
        this.database.db,
        plateNum,
        ctx.clientId,
      );
      if (responsible) {
        personName = responsible.name;
        personId = responsible.id;
        personType = 'responsible';
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Lookup responsible by plate falhou (placa=${plateNum}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!personId) {
      try {
        const member = await vehiclesQueries.findMemberByPlate(
          this.database.db,
          plateNum,
          ctx.clientId,
        );
        if (member) {
          personName = member.name;
          personId = member.id;
          personType = 'member';
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Lookup member by plate falhou (placa=${plateNum}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const docFields = {
      companyId: ctx.companyId,
      cameraId: ctx.id,
      cameraName: ctx.name,
      clientId: ctx.clientId,
      clientName: ctx.clientName,
      deviceIdReported: reading.deviceIdReported ?? null,
      plateNumber: plateNum,
      plateColor: reading.plateColor ?? null,
      plateType: reading.plateType ?? null,
      confidence: reading.confidence ?? null,
      vehicleColor: reading.vehicleColor ?? null,
      vehicleType: reading.vehicleType ?? null,
      vehicleBrand: reading.vehicleBrand ?? null,
      speed: reading.speed ?? null,
      direction: reading.direction ?? null,
      cameraDirection: ctx.direction ?? null,
      laneNo: reading.laneNo ?? null,
      channel: reading.channel ?? null,
      snapTime,
      accurateTime,
      isAllowed: reading.isAllowed ?? null,
      isBlocked: reading.isBlocked ?? null,
      openStrobe: reading.openStrobe ?? null,
      cutoutPicKey,
      vehiclePicKey,
      normalPicKey,
      correlationEventId: eventId,
      rawPayload,
      personName,
      personId,
      personType,
    };

    try {
      const filter = { cameraId: ctx.id, correlationEventId: eventId };
      let doc: LprAccessDocument | null = null;

      try {
        doc = await this.lprModel.findOneAndUpdate(
          filter,
          { $set: docFields },
          {
            upsert: true,
            returnDocument: 'after',
            setDefaultsOnInsert: true,
          },
        );
      } catch (err: unknown) {
        if (!isMongoDuplicateKeyError(err)) throw err;
        doc = await this.lprModel.findOneAndUpdate(
          filter,
          { $set: docFields },
          { returnDocument: 'after' },
        );
      }

      if (!doc) {
        throw new Error('findOneAndUpdate retornou null inesperadamente');
      }

      console.log('[LPR][PERSIST]', {
        accessId: String(doc._id),
        plate: plateNum,
        eventId,
        direction: doc.direction,
        snapTime: doc.snapTime,
        hasPic: !!(doc.cutoutPicKey ?? doc.vehiclePicKey ?? doc.normalPicKey),
      });

      this.persistedEventKeys.set(dedupKey, Date.now());

      this.eventEmitter.emit(ACCESS_LPR_RECORDED, {
        accessId: String(doc._id),
        cameraId: ctx.id,
        clientId: ctx.clientId,
        companyId: ctx.companyId,
        plateNumber: plateNum,
        cameraName: ctx.name,
        cameraDirection: ctx.direction ?? null,
        personName,
        personId,
        personType,
        snapTime: doc.snapTime ?? snapTime,
      });
    } catch (err: unknown) {
      this.logger.error(
        `Mongo upsert lpr_access falhou: ${err instanceof Error ? err.message : String(err)}`,
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
  ): Promise<LprAccessListResponse> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = LprAccessesService.DEFAULT_PAGE_SIZE;

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

    const filter: Record<string, unknown> = {
      companyId,
      correlationEventId: { $exists: true, $nin: [null, ''] },
      direction: { $exists: true, $nin: [null, ''] },
      cutoutPicKey: { $exists: true, $nin: [null, ''] },
    };
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

    const total = await this.lprModel.countDocuments(filter).exec();
    const skip = (page - 1) * pageSize;

    const docs = await this.lprModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean()
      .exec();

    const items: LprAccessListItemDto[] = docs.map((doc) => {
      const d = doc as LprAccessDocument & {
        _id: { toString(): string };
        createdAt?: Date;
        snapTime?: Date | null;
      };
      return {
        id: d._id.toString(),
        companyId: d.companyId,
        cameraId: d.cameraId,
        cameraName: d.cameraName,
        clientId: d.clientId,
        clientName: d.clientName,
        plateNumber: d.plateNumber,
        plateColor: d.plateColor ?? null,
        confidence: normalizeConfidencePercent(d.confidence ?? null),
        vehicleType: d.vehicleType ?? null,
        vehicleBrand: d.vehicleBrand ?? null,
        direction: d.direction ?? null,
        snapTime: d.snapTime ? d.snapTime.toISOString() : null,
        isAllowed: d.isAllowed ?? null,
        isBlocked: d.isBlocked ?? null,
        cutoutPicKey: d.cutoutPicKey ?? null,
        createdAt: d.createdAt
          ? d.createdAt.toISOString()
          : new Date().toISOString(),
      };
    });

    return { items, page, pageSize, total };
  }

  async getPhotoUrls(
    id: string,
    companyId: string,
  ): Promise<LprAccessPhotoUrlsDto> {
    const trimmed = typeof id === 'string' ? id.trim() : '';
    if (!trimmed || !Types.ObjectId.isValid(trimmed)) {
      throw new NotFoundException('Acesso LPR não encontrado.');
    }

    const doc = await this.lprModel
      .findOne({
        _id: new Types.ObjectId(trimmed),
        companyId,
      })
      .lean()
      .exec();

    if (!doc) {
      throw new NotFoundException('Acesso LPR não encontrado.');
    }

    const presign = async (
      key: string | null | undefined,
    ): Promise<string | null> => {
      const k = typeof key === 'string' ? key.trim() : '';
      if (!k) return null;
      try {
        return await this.r2Storage.createPresignedGetUrl(k);
      } catch (err: unknown) {
        this.logger.debug(
          `Presign LPR foto falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    };

    return {
      cutoutUrl: await presign(doc.cutoutPicKey),
      vehicleUrl: await presign(doc.vehiclePicKey),
      normalUrl: await presign(doc.normalPicKey),
    };
  }
}
