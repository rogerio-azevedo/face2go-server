import { Injectable, Logger } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import * as displayDeviceQueries from '../database/queries/client-display-devices.queries';
import type { ClientDisplayDeviceType } from '../database/queries/client-display-devices.queries';
import * as peopleQueries from '../database/queries/people.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import * as pickupQueries from '../database/queries/pickup-authorizations.queries';
import * as visitorInviteQueries from '../database/queries/client-invites.queries';
import * as vehiclesQueries from '../database/queries/vehicles.queries';
import type {
  AccessFacialRecordedPayload,
  AccessLprRecordedPayload,
} from '../notifications/notifications.events';
import { R2StorageService } from '../storage/r2-storage.service';

import type {
  ArrivalDisplayKind,
  ArrivalSseDequeuePayload,
  ArrivalSsePayload,
  ArrivalSseStudent,
} from './arrivals.types';

type SinkFn = (data: ArrivalSsePayload | ArrivalSseDequeuePayload) => void;

type DisplayDeviceCacheEntry = {
  devices: displayDeviceQueries.ClientDisplayDeviceRow[];
  expiresAt: number;
};

@Injectable()
export class ArrivalsService {
  private readonly logger = new Logger(ArrivalsService.name);
  /** Por escola/cliente (UUID). */
  private readonly hubs = new Map<string, Set<SinkFn>>();
  private readonly displayDeviceCache = new Map<
    string,
    DisplayDeviceCacheEntry
  >();
  private static readonly DISPLAY_DEVICE_CACHE_TTL_MS = 30_000;

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

  private emitToHub(
    clientId: string,
    payload: ArrivalSsePayload | ArrivalSseDequeuePayload,
  ): void {
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

  private mergeStudentsByName(
    ...groups: ArrivalSseStudent[][]
  ): ArrivalSseStudent[] {
    const seen = new Set<string>();
    const merged: ArrivalSseStudent[] = [];
    for (const group of groups) {
      for (const student of group) {
        const key = student.name.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(student);
      }
    }
    return merged;
  }

  private async resolvePickupAuthStudents(
    clientId: string,
    authorizationId: string,
  ): Promise<ArrivalSseStudent[]> {
    const links = await pickupQueries.pickupAuthListStudentsForAuth(
      this.database.db,
      authorizationId,
    );
    const enriched = await Promise.all(
      links.map(async (link) => {
        const student = await studentsQueries.getStudentById(
          this.database.db,
          link.studentId,
          clientId,
        );
        return {
          name: link.studentName,
          photoUrl: student ? await this.presignPhoto(student.photoKey) : null,
          className: null as string | null,
        };
      }),
    );
    return enriched;
  }

  /** Alunos extras de autorizações ativas em que o responsável é o retirante vinculado. */
  private async mergeLinkedPickupStudents(
    clientId: string,
    responsibleId: string,
    baseStudents: ArrivalSseStudent[],
  ): Promise<ArrivalSseStudent[]> {
    const auths = await pickupQueries.pickupAuthFindActiveByLinkedResponsible(
      this.database.db,
      clientId,
      responsibleId,
    );
    if (auths.length === 0) {
      return baseStudents;
    }

    const extraGroups = await Promise.all(
      auths.map(async (auth) => {
        const [authStudents, requesterStudents] = await Promise.all([
          this.resolvePickupAuthStudents(clientId, auth.id),
          this.resolveStudentsResponsible(
            clientId,
            auth.requestedByResponsibleId,
          ),
        ]);
        return [...authStudents, ...requesterStudents];
      }),
    );

    return this.mergeStudentsByName(baseStudents, ...extraGroups);
  }

  private async resolveGuestArrivalStudents(
    clientId: string,
    guestAuth: {
      id: string;
      linkedResponsibleId: string | null;
      requestedByResponsibleId: string;
    },
  ): Promise<ArrivalSseStudent[]> {
    const authStudents = await this.resolvePickupAuthStudents(
      clientId,
      guestAuth.id,
    );

    if (guestAuth.linkedResponsibleId) {
      const [linkedStudents, requesterStudents] = await Promise.all([
        this.resolveStudentsResponsible(
          clientId,
          guestAuth.linkedResponsibleId,
        ),
        this.resolveStudentsResponsible(
          clientId,
          guestAuth.requestedByResponsibleId,
        ),
      ]);
      return this.mergeStudentsByName(
        linkedStudents,
        requesterStudents,
        authStudents,
      );
    }

    return authStudents;
  }

  private async resolvePickupGuestArrivalStudents(
    clientId: string,
    auths: Array<{
      id: string;
      linkedResponsibleId: string | null;
      requestedByResponsibleId: string;
    }>,
  ): Promise<ArrivalSseStudent[]> {
    const groups = await Promise.all(
      auths.map((auth) => this.resolveGuestArrivalStudents(clientId, auth)),
    );
    return this.mergeStudentsByName(...groups);
  }

  private async getConfiguredDisplayDevices(
    clientId: string,
  ): Promise<displayDeviceQueries.ClientDisplayDeviceRow[]> {
    const now = Date.now();
    const cached = this.displayDeviceCache.get(clientId);
    if (cached && cached.expiresAt > now) {
      return cached.devices;
    }

    const devices = await displayDeviceQueries.listDisplayDevices(
      this.database.db,
      clientId,
    );
    this.displayDeviceCache.set(clientId, {
      devices,
      expiresAt: now + ArrivalsService.DISPLAY_DEVICE_CACHE_TTL_MS,
    });
    return devices;
  }

  private async isDeviceAllowed(
    clientId: string,
    deviceType: ClientDisplayDeviceType,
    deviceId: string,
  ): Promise<boolean> {
    const configured = await this.getConfiguredDisplayDevices(clientId);
    if (configured.length === 0) {
      return true;
    }
    return configured.some(
      (d) => d.deviceType === deviceType && d.deviceId === deviceId,
    );
  }

  private async broadcastStudentDequeue(
    payload: AccessFacialRecordedPayload,
  ): Promise<void> {
    const student = await studentsQueries.findStudentByFaceIdAndClientId(
      this.database.db,
      payload.faceId,
      payload.clientId,
    );
    if (!student) {
      return;
    }

    const links = await responsiblesQueries.findResponsibleIdsByStudentId(
      this.database.db,
      student.id,
    );
    for (const { responsibleId } of links) {
      this.emitToHub(payload.clientId, {
        type: 'dequeue',
        responsibleId,
      });
    }
  }

  async broadcastFacialRecorded(
    payload: AccessFacialRecordedPayload,
  ): Promise<void> {
    try {
      await this.broadcastStudentDequeue(payload);

      if (
        !(await this.isDeviceAllowed(
          payload.clientId,
          'facial_reader',
          payload.readerId,
        ))
      ) {
        return;
      }

      const responsibles =
        await peopleQueries.listResponsiblesByFaceIdAndClientId(
          this.database.db,
          payload.faceId,
          payload.clientId,
        );
      const members = await peopleQueries.listMembersByFaceIdAndClientId(
        this.database.db,
        payload.faceId,
        payload.clientId,
      );
      const responsible = responsibles[0] ?? null;

      let kind: ArrivalDisplayKind;
      let responsibleId: string | null = null;
      let personName = payload.personName?.trim() || null;
      let personPhotoUrl: string | null = null;
      let students: ArrivalSseStudent[] = [];
      let vehiclePlate: string | null = null;

      if (responsible) {
        kind = 'responsible';
        responsibleId = responsible.id;
        if (!personName) {
          personName = responsible.name;
        }
        personPhotoUrl = await this.presignPortraitPhoto(responsible.photoKey);
        students = await this.mergeLinkedPickupStudents(
          payload.clientId,
          responsible.id,
          await this.resolveStudentsResponsible(
            payload.clientId,
            responsible.id,
          ),
        );
        const memberIds = members.map((m) => m.id);
        vehiclePlate = await vehiclesQueries.findVehiclePlateForPersonOwners(
          this.database.db,
          payload.clientId,
          [responsible.id],
          memberIds,
        );
      } else {
        const student = await studentsQueries.findStudentByFaceIdAndClientId(
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
          const member = members[0] ?? null;
          if (member) {
            kind = 'responsible';
            personName = member.name;
            personPhotoUrl = await this.presignPortraitPhoto(member.photoKey);
            if (member.userId) {
              const owners =
                await peopleQueries.listVehicleOwnerIdsByUserIdAndClient(
                  this.database.db,
                  member.userId,
                  payload.clientId,
                );
              const primaryResponsibleId = owners.responsibleIds[0];
              if (primaryResponsibleId) {
                responsibleId = primaryResponsibleId;
                students = await this.mergeLinkedPickupStudents(
                  payload.clientId,
                  primaryResponsibleId,
                  await this.resolveStudentsResponsible(
                    payload.clientId,
                    primaryResponsibleId,
                  ),
                );
              } else {
                students = [];
              }
              vehiclePlate = await vehiclesQueries.findVehiclePlateForPersonOwners(
                this.database.db,
                payload.clientId,
                owners.responsibleIds,
                owners.memberIds,
              );
            } else {
              students = [];
              vehiclePlate = await vehiclesQueries.findVehiclePlateForMember(
                this.database.db,
                member.id,
                payload.clientId,
              );
            }
          } else {
            const pickupAuths =
              await pickupQueries.pickupAuthFindActiveByGuestFaceId(
                this.database.db,
                payload.clientId,
                payload.faceId,
              );
            if (pickupAuths.length > 0) {
              const primary = pickupAuths[0];
              kind = 'responsible';
              if (!personName) {
                personName = primary.guestName ?? null;
              }
              personPhotoUrl = await this.presignPortraitPhoto(
                primary.guestFaceImageKey,
              );
              students = await this.resolvePickupGuestArrivalStudents(
                payload.clientId,
                pickupAuths,
              );
              vehiclePlate = primary.guestVehiclePlate ?? null;
            } else {
              const inviteAuths =
                await visitorInviteQueries.inviteFindActiveByGuestFaceId(
                  this.database.db,
                  payload.clientId,
                  payload.faceId,
                );
              if (inviteAuths.length > 0) {
                const primary = inviteAuths[0];
                kind = 'responsible';
                if (!personName) {
                  personName = primary.guestName ?? 'Visitante';
                }
                personPhotoUrl = await this.presignPortraitPhoto(
                  primary.guestFaceImageKey,
                );
                students = [];
                vehiclePlate = primary.guestVehiclePlate ?? null;
              } else {
                kind = 'student';
                if (!personName) {
                  personName = payload.personName ?? 'Visitante';
                }
                students = [];
              }
            }
          }
        }
      }

      const eventDateIso = payload.eventDate
        ? new Date(payload.eventDate).toISOString()
        : null;

      const out: ArrivalSsePayload = {
        type: 'arrival',
        kind,
        accessId: payload.accessId,
        responsibleId,
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

  async broadcastLprRecorded(payload: AccessLprRecordedPayload): Promise<void> {
    try {
      if (
        !(await this.isDeviceAllowed(
          payload.clientId,
          'lpr_camera',
          payload.cameraId,
        ))
      ) {
        return;
      }

      const responsible = await vehiclesQueries.findResponsibleByPlate(
        this.database.db,
        payload.plateNumber,
        payload.clientId,
      );

      if (responsible) {
        const personPhotoUrl = await this.presignPortraitPhoto(
          responsible.photoKey,
        );
        const students = await this.mergeLinkedPickupStudents(
          payload.clientId,
          responsible.id,
          await this.resolveStudentsResponsible(
            payload.clientId,
            responsible.id,
          ),
        );

        let vehiclePlate = payload.plateNumber;
        const userId = await peopleQueries.findUserIdByVehicleOwner(
          this.database.db,
          payload.clientId,
          { responsibleId: responsible.id },
        );
        if (userId) {
          const owners = await peopleQueries.listVehicleOwnerIdsByUserIdAndClient(
            this.database.db,
            userId,
            payload.clientId,
          );
          const mergedPlate = await vehiclesQueries.findVehiclePlateForPersonOwners(
            this.database.db,
            payload.clientId,
            owners.responsibleIds,
            owners.memberIds,
          );
          if (mergedPlate) vehiclePlate = mergedPlate;
        }

        const out: ArrivalSsePayload = {
          type: 'arrival',
          kind: 'responsible',
          accessId: payload.accessId,
          responsibleId: responsible.id,
          personName: responsible.name,
          personPhotoUrl,
          readerName: payload.cameraName,
          eventDate: payload.snapTime?.toISOString() ?? null,
          vehiclePlate,
          students,
        };

        this.emitToHub(payload.clientId, out);
        return;
      }

      const member = await vehiclesQueries.findMemberByPlate(
        this.database.db,
        payload.plateNumber,
        payload.clientId,
      );

      if (member) {
        let students: ArrivalSseStudent[] = [];
        let responsibleId: string | null = null;
        const userId = await peopleQueries.findUserIdByVehicleOwner(
          this.database.db,
          payload.clientId,
          { memberId: member.id },
        );
        if (userId) {
          const owners = await peopleQueries.listVehicleOwnerIdsByUserIdAndClient(
            this.database.db,
            userId,
            payload.clientId,
          );
          const primaryResponsibleId = owners.responsibleIds[0];
          if (primaryResponsibleId) {
            responsibleId = primaryResponsibleId;
            students = await this.mergeLinkedPickupStudents(
              payload.clientId,
              primaryResponsibleId,
              await this.resolveStudentsResponsible(
                payload.clientId,
                primaryResponsibleId,
              ),
            );
          }
        }

        const out: ArrivalSsePayload = {
          type: 'arrival',
          kind: 'responsible',
          accessId: payload.accessId,
          responsibleId,
          personName: member.name,
          personPhotoUrl: await this.presignPortraitPhoto(member.photoKey),
          readerName: payload.cameraName,
          eventDate: payload.snapTime?.toISOString() ?? null,
          vehiclePlate: payload.plateNumber,
          students,
        };
        this.emitToHub(payload.clientId, out);
        return;
      }

      const guestAuth = await pickupQueries.pickupAuthFindActiveGuestByPlate(
        this.database.db,
        payload.clientId,
        payload.plateNumber,
      );

      if (guestAuth) {
        let personPhotoUrl = await this.presignPortraitPhoto(
          guestAuth.guestFaceImageKey,
        );
        let personName = guestAuth.guestName;
        const responsibleId: string | null = guestAuth.linkedResponsibleId;

        if (guestAuth.linkedResponsibleId) {
          const linked = await responsiblesQueries.getResponsibleById(
            this.database.db,
            guestAuth.linkedResponsibleId,
            payload.clientId,
          );
          if (linked) {
            personName = linked.name;
            personPhotoUrl = await this.presignPortraitPhoto(linked.photoKey);
          }
        }

        const students = await this.resolveGuestArrivalStudents(
          payload.clientId,
          guestAuth,
        );

        const out: ArrivalSsePayload = {
          type: 'arrival',
          kind: 'responsible',
          accessId: payload.accessId,
          responsibleId,
          personName,
          personPhotoUrl,
          readerName: payload.cameraName,
          eventDate: payload.snapTime?.toISOString() ?? null,
          vehiclePlate: payload.plateNumber,
          students,
        };

        this.emitToHub(payload.clientId, out);
        return;
      }

      const inviteGuest =
        await visitorInviteQueries.inviteFindActiveGuestByPlate(
          this.database.db,
          payload.clientId,
          payload.plateNumber,
        );

      if (!inviteGuest) {
        return;
      }

      const personPhotoUrl = await this.presignPortraitPhoto(
        inviteGuest.guestFaceImageKey,
      );
      const personName = inviteGuest.guestName ?? 'Visitante';

      const out: ArrivalSsePayload = {
        type: 'arrival',
        kind: 'responsible',
        accessId: payload.accessId,
        responsibleId: null,
        personName,
        personPhotoUrl,
        readerName: payload.cameraName,
        eventDate: payload.snapTime?.toISOString() ?? null,
        vehiclePlate: payload.plateNumber,
        students: [],
      };

      this.emitToHub(payload.clientId, out);
    } catch (err: unknown) {
      this.logger.warn(
        `broadcastLprRecorded falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
