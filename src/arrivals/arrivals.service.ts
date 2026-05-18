import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';

import {
  FacialAccess,
  type FacialAccessDocument,
} from '../accesses/access.schema';
import { DatabaseService } from '../database/database.service';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import * as vehiclesQueries from '../database/queries/vehicles.queries';
import type { AccessFacialRecordedPayload } from '../notifications/notifications.events';
import { R2StorageService } from '../storage/r2-storage.service';

import type {
  ArrivalDisplayKind,
  ArrivalSsePayload,
  ArrivalSseStudent,
} from './arrivals.types';

type SinkFn = (data: ArrivalSsePayload) => void;

@Injectable()
export class ArrivalsService {
  private readonly logger = new Logger(ArrivalsService.name);
  /** Por escola/cliente (UUID). */
  private readonly hubs = new Map<string, Set<SinkFn>>();

  constructor(
    @InjectModel(FacialAccess.name)
    private readonly accessModel: Model<FacialAccessDocument>,
    private readonly database: DatabaseService,
    private readonly r2Storage: R2StorageService,
  ) {}

  /** Registra receptor SSE; devolve unsubscribe. */
  subscribe(clientId: string, sink: SinkFn): () => void {
    let set = this.hubs.get(clientId);
    if (!set) {
      set = new Set();
      this.hubs.set(clientId, set);
    }
    set.add(sink);
    return () => {
      const s = this.hubs.get(clientId);
      if (!s) return;
      s.delete(sink);
      if (s.size === 0) {
        this.hubs.delete(clientId);
      }
    };
  }

  private emitToHub(clientId: string, payload: ArrivalSsePayload): void {
    const set = this.hubs.get(clientId);
    if (!set?.size) {
      return;
    }
    for (const sink of set) {
      try {
        sink(payload);
      } catch (err: unknown) {
        this.logger.warn(
          `Sink arrivals falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async presignPhoto(
    photoKey: string | null | undefined,
  ): Promise<string | null> {
    const k = typeof photoKey === 'string' ? photoKey.trim() : '';
    if (!k) return null;
    try {
      return await this.r2Storage.createPresignedGetUrl(k);
    } catch (err: unknown) {
      this.logger.debug(
        `Presign arrivals falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async loadSnapPhotoUrl(accessId: string): Promise<string | null> {
    try {
      if (!Types.ObjectId.isValid(accessId)) {
        return null;
      }
      const doc = await this.accessModel
        .findById(new Types.ObjectId(accessId))
        .lean<{ snapR2Key?: string | null }>();
      const key = doc?.snapR2Key?.trim();
      if (!key) return null;
      return this.presignPhoto(key);
    } catch (err: unknown) {
      this.logger.debug(
        `Mongo access arrival: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async resolveStudentsResponsible(
    clientId: string,
    responsibleId: string,
  ): Promise<ArrivalSseStudent[]> {
    const rows = await studentsQueries.listStudentsWithClassByResponsible(
      this.database.db,
      clientId,
      responsibleId,
    );
    const active = rows.filter((s) => s.isActive);
    const enriched = await Promise.all(
      active.map(async (s) => ({
        name: s.name,
        photoUrl: await this.presignPhoto(s.photoKey),
        className: s.className?.trim() || null,
      })),
    );
    return enriched;
  }

  async broadcastFacialRecorded(
    payload: AccessFacialRecordedPayload,
  ): Promise<void> {
    try {
      const snapUrl = await this.loadSnapPhotoUrl(payload.accessId);
      const responsible =
        await responsiblesQueries.findResponsibleByFaceIdAndClientId(
          this.database.db,
          payload.faceId,
          payload.clientId,
        );

      let kind: ArrivalDisplayKind;
      let personName = payload.personName?.trim() || null;
      let personPhotoUrl: string | null = snapUrl;
      let students: ArrivalSseStudent[] = [];
      let vehiclePlate: string | null = null;

      if (responsible) {
        kind = 'responsible';
        if (!personName) {
          personName = responsible.name;
        }
        if (!personPhotoUrl) {
          personPhotoUrl = await this.presignPhoto(responsible.photoKey);
        }
        students = await this.resolveStudentsResponsible(
          payload.clientId,
          responsible.id,
        );
        vehiclePlate = await vehiclesQueries.findVehiclePlateForArrival(
          this.database.db,
          responsible.id,
          payload.clientId,
        );
      } else {
        const student =
          await studentsQueries.findStudentByFaceIdAndClientId(
            this.database.db,
            payload.faceId,
            payload.clientId,
          );
        if (student) {
          kind = 'student';
          personName = student.name;
          personPhotoUrl =
            snapUrl ?? (await this.presignPhoto(student.photoKey));
          students = [];
        } else {
          kind = 'student';
          if (!personName) {
            personName = payload.personName ?? 'Visitante';
          }
          students = [];
        }
      }

      const eventDateIso = payload.eventDate
        ? new Date(payload.eventDate).toISOString()
        : null;

      const out: ArrivalSsePayload = {
        type: 'arrival',
        kind,
        accessId: payload.accessId,
        personName,
        personPhotoUrl,
        readerName: payload.readerName,
        eventDate: eventDateIso,
        vehiclePlate,
        students,
      };

      this.emitToHub(payload.clientId, out);
    } catch (err: unknown) {
      this.logger.warn(
        `broadcastFacialRecorded falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
