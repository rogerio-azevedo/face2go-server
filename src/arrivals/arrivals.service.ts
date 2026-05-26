import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import * as vehiclesQueries from '../database/queries/vehicles.queries';
import type {
  AccessFacialRecordedPayload,
  AccessLprRecordedPayload,
} from '../notifications/notifications.events';
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

  private async presignPortraitPhoto(
    photoKey: string | null | undefined,
  ): Promise<string | null> {
    const k = typeof photoKey === 'string' ? photoKey.trim() : '';
    if (!k) return null;
    try {
      return await this.r2Storage.createPresignedPortraitGetUrl(k);
    } catch (err: unknown) {
      this.logger.debug(
        `Presign retrato arrivals falhou: ${err instanceof Error ? err.message : String(err)}`,
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
      const responsible =
        await responsiblesQueries.findResponsibleByFaceIdAndClientId(
          this.database.db,
          payload.faceId,
          payload.clientId,
        );

      let kind: ArrivalDisplayKind;
      let personName = payload.personName?.trim() || null;
      let personPhotoUrl: string | null = null;
      let students: ArrivalSseStudent[] = [];
      let vehiclePlate: string | null = null;

      if (responsible) {
        kind = 'responsible';
        if (!personName) {
          personName = responsible.name;
        }
        personPhotoUrl = await this.presignPortraitPhoto(responsible.photoKey);
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
          personPhotoUrl = await this.presignPhoto(student.photoKey);
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

  async broadcastLprRecorded(
    payload: AccessLprRecordedPayload,
  ): Promise<void> {
    try {
      const responsible = await vehiclesQueries.findResponsibleByPlate(
        this.database.db,
        payload.plateNumber,
        payload.clientId,
      );

      if (!responsible) {
        return;
      }

      const personPhotoUrl = await this.presignPortraitPhoto(
        responsible.photoKey,
      );
      const students = await this.resolveStudentsResponsible(
        payload.clientId,
        responsible.id,
      );

      const out: ArrivalSsePayload = {
        type: 'arrival',
        kind: 'responsible',
        accessId: payload.accessId,
        personName: responsible.name,
        personPhotoUrl,
        readerName: payload.cameraName,
        eventDate: payload.snapTime?.toISOString() ?? null,
        vehiclePlate: payload.plateNumber,
        students,
      };

      this.emitToHub(payload.clientId, out);
    } catch (err: unknown) {
      this.logger.warn(
        `broadcastLprRecorded falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
