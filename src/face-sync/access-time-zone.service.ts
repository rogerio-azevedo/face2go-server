import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createReaderCredentialsCipher } from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import * as readersQueries from '../database/queries/readers.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as shiftsQueries from '../database/queries/shifts.queries';
import * as studentClassesQueries from '../database/queries/student-classes.queries';
import type { shifts } from '../database/schema';
import {
  ALWAYS_TIME_ZONE_INDEX,
  DEFAULT_READER_MAX_TIME_ZONES,
} from './intelbras-time-zone.constants';
import {
  formatReaderFaceSyncError,
  intelbrasSetTimeScheduleZone,
  toPlainReaderCredential,
  type PlainReaderCredential,
} from './intelbras-device.client';
import { readerLabel, syncLog, syncLogError } from './intelbras-sync-debug.util';

type ShiftRow = typeof shifts.$inferSelect;

@Injectable()
export class AccessTimeZoneService {
  private readonly log = new Logger(AccessTimeZoneService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly configService: ConfigService<EnvVars, true>,
  ) {}

  private maxZones(): number {
    return (
      this.configService.get('READER_MAX_TIME_ZONES', { infer: true }) ??
      DEFAULT_READER_MAX_TIME_ZONES
    );
  }

  /** Fallback 24/7 quando não há turno/turma aplicável. */
  defaultTimeSections(): number[] {
    return [ALWAYS_TIME_ZONE_INDEX];
  }

  /** Aloca índice de zona no banco (sem enviar ao leitor). */
  private async ensureShiftZoneIndex(
    clientId: string,
    shift: Pick<ShiftRow, 'id' | 'clientId' | 'timeZoneIndex'>,
  ): Promise<number> {
    if (shift.timeZoneIndex != null) {
      return shift.timeZoneIndex;
    }

    const zoneIndex = await shiftsQueries.allocateShiftZoneIndex(
      this.database.db,
      clientId,
      this.maxZones(),
    );
    await shiftsQueries.setShiftTimeZoneIndex(
      this.database.db,
      shift.id,
      clientId,
      zoneIndex,
    );
    return zoneIndex;
  }

  /**
   * Garante índice de zona no turno e sincroniza AccessTimeSchedule[n] em todos os leitores.
   * Usado ao criar/editar turno — não deve bloquear sync de face individual.
   */
  async ensureShiftZone(
    clientId: string,
    shift: Pick<ShiftRow, 'id' | 'clientId' | 'name' | 'schedule' | 'timeZoneIndex'>,
  ): Promise<number> {
    const zoneIndex = await this.ensureShiftZoneIndex(clientId, shift);
    await this.pushShiftScheduleToReaders(clientId, zoneIndex, shift);
    return zoneIndex;
  }

  private async pushShiftScheduleToReaders(
    clientId: string,
    zoneIndex: number,
    shift: Pick<ShiftRow, 'name' | 'schedule'>,
  ): Promise<void> {
    syncLog('pushShiftSchedule:inicio', { clientId, zoneIndex });

    try {
      const intelbrasReaders =
        await readersQueries.listReadersForFaceSyncByClient(
          this.database.db,
          clientId,
        );
      if (intelbrasReaders.length === 0) {
        syncLog('pushShiftSchedule:semLeitores', { clientId, zoneIndex });
        return;
      }

      const cipher = createReaderCredentialsCipher(
        this.configService.get('READER_ENCRYPTION_KEY', { infer: true }),
      );

      const failures: string[] = [];

      await Promise.all(
        intelbrasReaders.map(async (r) => {
          const label = readerLabel(r);
          try {
            syncLog('pushShiftSchedule:leitor', {
              clientId,
              zoneIndex,
              reader: label,
            });
            const plain = toPlainReaderCredential(
              r,
              cipher.decrypt(r.passwordEncrypted),
            );
            await intelbrasSetTimeScheduleZone(
              plain,
              zoneIndex,
              shift.schedule,
              shift.name,
            );
            syncLog('pushShiftSchedule:leitorOk', {
              clientId,
              zoneIndex,
              reader: label,
            });
          } catch (e) {
            const msg = formatReaderFaceSyncError(r.name, e);
            syncLogError('pushShiftSchedule:leitor', e, {
              clientId,
              zoneIndex,
              reader: label,
            });
            this.log.warn(
              `Falha ao sincronizar zona ${zoneIndex} no leitor ${r.name}: ${msg}`,
            );
            failures.push(msg);
          }
        }),
      );

      if (failures.length === intelbrasReaders.length) {
        const err = new Error(
          `Não foi possível sincronizar a zona ${zoneIndex} em nenhum leitor. ${failures.join('; ')}`,
        );
        syncLogError('pushShiftSchedule:todosFalharam', err, {
          clientId,
          zoneIndex,
          failures,
        });
        throw err;
      }

      syncLog('pushShiftSchedule:ok', {
        clientId,
        zoneIndex,
        leitores: intelbrasReaders.length,
        falhas: failures.length,
      });
    } catch (err) {
      syncLogError('pushShiftSchedule', err, { clientId, zoneIndex });
      throw err;
    }
  }

  /** Resolve índices de zona para TimeSections — só banco, sem reconfigurar leitor. */
  async resolveStudentTimeSections(
    clientId: string,
    studentId: string,
  ): Promise<number[]> {
    const shiftRows = await studentClassesQueries.listActiveShiftsForStudent(
      this.database.db,
      studentId,
    );

    if (shiftRows.length === 0) {
      return this.defaultTimeSections();
    }

    const zoneIndices: number[] = [];
    for (const shift of shiftRows) {
      const zoneIndex = await this.ensureShiftZoneIndex(clientId, shift);
      zoneIndices.push(zoneIndex);
    }

    const unique = [...new Set(zoneIndices)].sort((a, b) => a - b);
    return unique.length > 0 ? unique : this.defaultTimeSections();
  }

  /** União dos turnos dos alunos vinculados; fallback 24/7. */
  async resolveResponsibleTimeSections(
    clientId: string,
    responsibleId: string,
  ): Promise<number[]> {
    const studentLinks =
      await responsiblesQueries.listResponsibleStudentLinksWithStudents(
        this.database.db,
        responsibleId,
        clientId,
      );

    if (studentLinks.length === 0) {
      return this.defaultTimeSections();
    }

    const zoneIndices = new Set<number>();
    for (const link of studentLinks) {
      const sections = await this.resolveStudentTimeSections(
        clientId,
        link.student.id,
      );
      for (const z of sections) {
        if (z !== ALWAYS_TIME_ZONE_INDEX) zoneIndices.add(z);
      }
    }

    const sorted = [...zoneIndices].sort((a, b) => a - b);
    return sorted.length > 0 ? sorted : this.defaultTimeSections();
  }

  /**
   * Mapa zona → turno (nome + schedule) carregado uma vez por operação de sync.
   */
  async loadShiftsByZoneIndex(
    clientId: string,
  ): Promise<Map<number, Pick<ShiftRow, 'name' | 'schedule'>>> {
    const allShifts = await shiftsQueries.listShiftsWithZoneIndexByClient(
      this.database.db,
      clientId,
    );
    return new Map(
      allShifts
        .filter((s) => s.timeZoneIndex != null)
        .map((s) => [
          s.timeZoneIndex as number,
          { name: s.name, schedule: s.schedule },
        ]),
    );
  }

  /** @deprecated Use {@link loadShiftsByZoneIndex}. */
  async loadSchedulesByZoneIndex(
    clientId: string,
  ): Promise<Map<number, ShiftRow['schedule']>> {
    const shifts = await this.loadShiftsByZoneIndex(clientId);
    return new Map(
      [...shifts.entries()].map(([idx, s]) => [idx, s.schedule]),
    );
  }

  /**
   * Cria/atualiza AccessTimeSchedule[n] **neste leitor** antes do cartão usar TimeSections[n].
   * O firmware recusa TimeSections customizadas se a zona ainda não existir no equipamento.
   */
  async ensureZonesOnSingleReader(
    reader: PlainReaderCredential,
    zoneIndices: number[],
    shiftsByZone: Map<number, Pick<ShiftRow, 'name' | 'schedule'>>,
  ): Promise<void> {
    const needed = [...new Set(zoneIndices)].filter(
      (z) => z !== ALWAYS_TIME_ZONE_INDEX,
    );
    if (needed.length === 0) return;

    const label = readerLabel(reader);
    syncLog('ensureZonesOnReader:inicio', { reader: label, zoneIndices: needed });

    try {
      for (const zoneIndex of needed) {
        const shift = shiftsByZone.get(zoneIndex);
        if (!shift) {
          throw new Error(
            `Zona ${zoneIndex} referenciada mas sem turno configurado no banco.`,
          );
        }
        syncLog('ensureZonesOnReader:push', {
          reader: label,
          zoneIndex,
          zoneName: shift.name,
        });
        await intelbrasSetTimeScheduleZone(
          reader,
          zoneIndex,
          shift.schedule,
          shift.name,
        );
      }
      syncLog('ensureZonesOnReader:ok', { reader: label, zoneIndices: needed });
    } catch (err) {
      syncLogError('ensureZonesOnReader', err, {
        reader: label,
        zoneIndices: needed,
      });
      throw err;
    }
  }

  /**
   * Envia AccessTimeSchedule[n] aos leitores antes do sync de face quando o cartão
   * referencia zonas customizadas (≠ 255). Falha parcial não aborta o sync.
   * @deprecated Preferir {@link ensureZonesOnSingleReader} por leitor — garante ordem zona → cartão.
   */
  async ensureZonesOnReadersForSync(
    clientId: string,
    zoneIndices: number[],
  ): Promise<void> {
    syncLog('ensureZonesForSync:inicio', { clientId, zoneIndices });

    try {
      const needed = [...new Set(zoneIndices)].filter(
        (z) => z !== ALWAYS_TIME_ZONE_INDEX,
      );
      if (needed.length === 0) {
        syncLog('ensureZonesForSync:pula255', { clientId, zoneIndices });
        return;
      }

      const allShifts = await shiftsQueries.listShiftsWithZoneIndexByClient(
        this.database.db,
        clientId,
      );
      const byIndex = new Map(
        allShifts
          .filter((s) => s.timeZoneIndex != null)
          .map((s) => [s.timeZoneIndex as number, s]),
      );

      for (const zoneIndex of needed) {
        const shift = byIndex.get(zoneIndex);
        if (!shift) {
          syncLog('ensureZonesForSync:turnoAusente', { clientId, zoneIndex });
          this.log.warn(
            `Zona ${zoneIndex} referenciada no sync mas sem turno no banco.`,
          );
          continue;
        }
        syncLog('ensureZonesForSync:pushZona', {
          clientId,
          zoneIndex,
          shiftId: shift.id,
        });
        await this.pushShiftScheduleToReaders(
          clientId,
          zoneIndex,
          { name: shift.name, schedule: shift.schedule },
        );
      }

      syncLog('ensureZonesForSync:ok', { clientId, zoneIndices: needed });
    } catch (err) {
      syncLogError('ensureZonesForSync', err, { clientId, zoneIndices });
      throw err;
    }
  }
}
