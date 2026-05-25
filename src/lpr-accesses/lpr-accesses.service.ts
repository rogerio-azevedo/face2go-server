import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import type { Model } from 'mongoose';

import type { CameraStreamContext } from '../lpr-listener/lpr-listener.types';
import type { LprStreamReadingPayload } from '../lpr-listener/lpr-stream.parser';
import { ACCESS_LPR_RECORDED } from '../notifications/notifications.events';
import { R2StorageService } from '../storage/r2-storage.service';
import { LprAccess, type LprAccessDocument } from './lpr-access.schema';

function parseDeviceDate(raw: string | null | undefined): Date | null {
  if (raw == null || !String(raw).trim()) return null;
  const s = String(raw).trim();
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

@Injectable()
export class LprAccessesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LprAccessesService.name);
  private readonly processedKeys = new Map<string, number>();
  private readonly DEDUP_TTL_MS = 5 * 60 * 1000;
  private dedupCleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectModel(LprAccess.name)
    private readonly lprModel: Model<LprAccessDocument>,
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
    for (const [key, ts] of this.processedKeys) {
      if (ts < cutoff) this.processedKeys.delete(key);
    }
  }

  private dedupKey(
    ctx: CameraStreamContext,
    reading: LprStreamReadingPayload,
    normalizedPlate: string,
  ): string {
    const t = reading.accurateTimeRaw ?? reading.snapTimeRaw ?? '';
    const ch = reading.channel ?? '';
    const code = reading.eventCode ?? '';
    return `${ctx.id}|${normalizedPlate}|${t}|${ch}|${code}`;
  }

  /** Persiste leitura ANPR dos streams CGI (JPEGs opcionais no R2). */
  async recordLprReading(
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

    const dk = this.dedupKey(ctx, reading, plateNum);
    if (this.processedKeys.has(dk)) return;
    this.processedKeys.set(dk, Date.now());

    const snapTime = parseDeviceDate(reading.snapTimeRaw);
    const accurateTime = parseDeviceDate(reading.accurateTimeRaw);

    let cutoutPicKey: string | null = null;
    let vehiclePicKey: string | null = null;
    let normalPicKey: string | null = null;

    const imgs = imageJpegs?.filter((b) => b && b.length > 0) ?? [];
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
      cutoutPicKey = (await put(imgs[0]!, 'cutout')) ?? null;
    } else if (imgs.length === 2) {
      cutoutPicKey = (await put(imgs[0]!, 'cutout')) ?? null;
      vehiclePicKey = (await put(imgs[1]!, 'vehicle')) ?? null;
    } else if (imgs.length >= 3) {
      cutoutPicKey = (await put(imgs[0]!, 'cutout')) ?? null;
      vehiclePicKey = (await put(imgs[1]!, 'vehicle')) ?? null;
      normalPicKey = (await put(imgs[2]!, 'normal')) ?? null;
    }

    const rawPayload: Record<string, unknown> = {
      ...reading,
      plateNumber: plateNum,
      sourceHost: ctx.host,
    };

    try {
      const doc = await this.lprModel.create({
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
        rawPayload,
      });

      this.eventEmitter.emit(ACCESS_LPR_RECORDED, {
        accessId: String(doc._id),
        cameraId: ctx.id,
        clientId: ctx.clientId,
        plateNumber: plateNum,
        cameraName: ctx.name,
        snapTime,
      });
    } catch (err: unknown) {
      this.logger.error(
        `Mongo create lpr_access falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
