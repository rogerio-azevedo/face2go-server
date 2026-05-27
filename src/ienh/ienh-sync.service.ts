import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';
import * as responsibleStudentsQueries from '../database/queries/responsible-students.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as schoolClassQueries from '../database/queries/school-classes.queries';
import * as studentClassesQueries from '../database/queries/student-classes.queries';
import * as studentsQueries from '../database/queries/students.queries';
import { syncFromSnapshotSchema, syncIenhSchema } from '../validation/ienh.schema';
import { zodFirstMessage } from '../validation/zod-utils';
import {
  IENH_FILIAL_LABELS,
  mapSituacaoMatricula,
  mapStatusAcessoToIsActive,
  normalizeDocument,
  normalizeEnrollment,
  normalizePhone,
  parsePerletYear,
  parseTotvsDate,
  resolveFilialFromRecord,
} from './ienh.mapper';
import { IenhService } from './ienh.service';
import type {
  IenhSnapshotInfo,
  IenhSyncResult,
  TotvsIenhRecordWithFilial,
} from './types/ienh-sync.types';
import type { TotvsIenhRecord, TotvsIenhSnapshot } from './types/totvs-ienh.types';

const PROGRESS_EMIT_INTERVAL = 10;
const PROCESS_CONCURRENCY = 10;
const SNAPSHOT_FILENAME_RE = /^ienh-snapshot-\d{8}-\d{4}\.json$/;

export type IenhSyncEmit = (evt: Record<string, unknown>) => void;

@Injectable()
export class IenhSyncService {
  private readonly logger = new Logger(IenhSyncService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly ienhService: IenhService,
  ) {}

  async runSyncForCompany(
    companyId: string,
    body: unknown,
    emit?: IenhSyncEmit,
  ): Promise<IenhSyncResult> {
    const parsed = syncIenhSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const perlet = parsed.data.perlet ?? String(new Date().getFullYear());
    const filialClientMap = await this.buildFilialClientMap(companyId);
    if (Object.keys(filialClientMap).length === 0) {
      throw new BadRequestException(
        'Configure o mapeamento das filiais IENH nos clientes antes de sincronizar.',
      );
    }

    const filiais = Object.keys(filialClientMap)
      .map(Number)
      .sort((a, b) => a - b);

    emit?.({
      type: 'start',
      perlet,
      totalFiliais: filiais.length,
    });

    const started = Date.now();
    const tagged: TotvsIenhRecordWithFilial[] = [];

    for (const filial of filiais) {
      emit?.({
        type: 'filial_start',
        filial,
        filialName: IENH_FILIAL_LABELS[filial] ?? `Filial ${filial}`,
      });

      const batch = await this.ienhService.fetchFilialRecordsTagged({
        perlet,
        filial,
        niveis: parsed.data.niveis,
      });
      tagged.push(...batch);

      emit?.({
        type: 'filial_fetched',
        filial,
        count: batch.length,
      });
    }

    const niveis = parsed.data.niveis ?? [1, 2, 3];
    const saved = await this.ienhService.persistTaggedSnapshot({
      tagged,
      perlet,
      filiais,
      niveis,
    });

    emit?.({
      type: 'snapshot_saved',
      file: saved.filename,
      recordCount: saved.recordCount,
    });

    const result = await this.processTaggedRecords({
      tagged,
      perlet,
      filialClientMap,
      emit,
      startedAt: started,
    });

    emit?.({ type: 'done', result });
    return result;
  }

  async runSyncFromSnapshot(
    companyId: string,
    filename: string,
    emit?: IenhSyncEmit,
  ): Promise<IenhSyncResult> {
    const parsed = syncFromSnapshotSchema.safeParse({ file: filename });
    if (!parsed.success) {
      throw new BadRequestException(zodFirstMessage(parsed.error));
    }

    const filialClientMap = await this.buildFilialClientMap(companyId);
    if (Object.keys(filialClientMap).length === 0) {
      throw new BadRequestException(
        'Configure o mapeamento das filiais IENH nos clientes antes de sincronizar.',
      );
    }

    const { tagged, perlet } = await this.loadSnapshot(parsed.data.file);

    emit?.({
      type: 'start',
      perlet,
      totalFiliais: 0,
      fromSnapshot: true,
      file: parsed.data.file,
    });

    const started = Date.now();
    const result = await this.processTaggedRecords({
      tagged,
      perlet,
      filialClientMap,
      emit,
      startedAt: started,
    });

    emit?.({ type: 'done', result });
    return result;
  }

  async listSnapshots(): Promise<IenhSnapshotInfo[]> {
    const dir = join(process.cwd(), 'data');
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }

    const snapshotFiles = files.filter(
      (f) => f.startsWith('ienh-snapshot-') && f.endsWith('.json'),
    );

    const infos: IenhSnapshotInfo[] = [];
    for (const file of snapshotFiles) {
      try {
        const raw = await readFile(join(dir, file), 'utf8');
        const snap = JSON.parse(raw) as TotvsIenhSnapshot;
        infos.push({
          file,
          recordCount: snap.meta.recordCount,
          fetchedAt: snap.meta.fetchedAt,
          perlet: snap.meta.perlet,
        });
      } catch {
        // ignora arquivos corrompidos
      }
    }

    return infos.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  }

  private async loadSnapshot(
    filename: string,
  ): Promise<{ tagged: TotvsIenhRecordWithFilial[]; perlet: string }> {
    if (!SNAPSHOT_FILENAME_RE.test(filename)) {
      throw new BadRequestException('Nome de snapshot inválido.');
    }

    const filePath = join(process.cwd(), 'data', filename);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      throw new NotFoundException(`Snapshot não encontrado: ${filename}`);
    }

    const snap = JSON.parse(raw) as TotvsIenhSnapshot;
    let tagged: TotvsIenhRecordWithFilial[];

    if (snap.taggedRecords?.length) {
      tagged = snap.taggedRecords;
    } else {
      tagged = [];
      for (const record of snap.records) {
        const filial = resolveFilialFromRecord(record);
        if (filial == null) continue;
        tagged.push({ filial, record });
      }
    }

    return { tagged, perlet: snap.meta.perlet };
  }

  private async processTaggedRecords(args: {
    tagged: TotvsIenhRecordWithFilial[];
    perlet: string;
    filialClientMap: Record<number, string>;
    emit?: IenhSyncEmit;
    startedAt: number;
  }): Promise<IenhSyncResult> {
    const { tagged, perlet, filialClientMap, emit, startedAt } = args;

    const result: IenhSyncResult = {
      processedRecords: 0,
      studentsCreated: 0,
      studentsUpdated: 0,
      studentsDeactivated: 0,
      responsiblesCreated: 0,
      responsiblesUpdated: 0,
      classesCreated: 0,
      classesMerged: 0,
      classLinksCreated: 0,
      classLinksUpdated: 0,
      classLinksDeactivated: 0,
      classLinksDeduped: 0,
      linksCreated: 0,
      errors: [],
      durationMs: 0,
    };

    emit?.({
      type: 'process_start',
      total: tagged.length,
    });

    const year = parsePerletYear(perlet);
    const enrollmentsByClient = new Map<string, Set<string>>();
    const activeClassIdsByStudent = new Map<string, Set<string>>();
    const classCache = new Map<string, string>();
    const classResolveInflight = new Map<string, Promise<string>>();
    const responsibleCache = new Map<string, string>();

    let processed = 0;

    await this.runWithConcurrency(tagged, PROCESS_CONCURRENCY, async (item) => {
      try {
        await this.processRecord({
          item,
          filialClientMap,
          year,
          result,
          enrollmentsByClient,
          activeClassIdsByStudent,
          classCache,
          classResolveInflight,
          responsibleCache,
        });
      } catch (err: unknown) {
        const enrollment = normalizeEnrollment(item.record.CODALUNO);
        result.errors.push({
          enrollment,
          message: err instanceof Error ? err.message : String(err),
        });
      }

      processed += 1;
      result.processedRecords = processed;

      if (
        processed % PROGRESS_EMIT_INTERVAL === 0 ||
        processed === tagged.length
      ) {
        emit?.({
          type: 'progress',
          filial: item.filial,
          processed,
          total: tagged.length,
          studentsCreated: result.studentsCreated,
          studentsUpdated: result.studentsUpdated,
        });
      }
    });

    emit?.({ type: 'deactivate_start' });

    const syncedClientIds = new Set(Object.values(filialClientMap));
    for (const clientId of syncedClientIds) {
      const merged =
        await schoolClassQueries.mergeDuplicateSchoolClassesForClient(
          this.database.db,
          clientId,
        );
      result.classesMerged += merged.classesRemoved;
    }

    for (const [clientId, enrollments] of enrollmentsByClient) {
      const deactivated = await studentsQueries.deactivateStudentsNotInList(
        this.database.db,
        clientId,
        [...enrollments],
      );
      result.studentsDeactivated += deactivated;
    }

    for (const [studentId, classIds] of activeClassIdsByStudent) {
      const deactivated =
        await studentClassesQueries.deactivateStudentClassLinksNotInList(
          this.database.db,
          studentId,
          [...classIds],
        );
      result.classLinksDeactivated += deactivated;

      const deduped =
        await studentClassesQueries.dedupeActiveStudentClassLinksByClassNameYear(
          this.database.db,
          studentId,
        );
      result.classLinksDeduped += deduped;
    }

    result.durationMs = Date.now() - startedAt;
    this.logger.log(
      `IENH sync: ${result.processedRecords} registros, ` +
        `${result.studentsCreated} alunos criados, ${result.studentsUpdated} atualizados, ` +
        `${result.studentsDeactivated} desativados, ` +
        `${result.classLinksCreated} vínculos turma criados, ` +
        `${result.classLinksDeactivated} vínculos turma desativados, ` +
        `${result.classLinksDeduped} vínculos duplicados removidos, ` +
        `${result.classesMerged} turmas duplicadas fundidas em ${result.durationMs}ms`,
    );

    return result;
  }

  private async runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    if (items.length === 0) return;

    let index = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      async () => {
        while (index < items.length) {
          const i = index;
          index += 1;
          await fn(items[i]!);
        }
      },
    );
    await Promise.all(workers);
  }

  private async buildFilialClientMap(
    companyId: string,
  ): Promise<Record<number, string>> {
    const rows = await clientsQueries.listClientsWithIenhFilialByCompany(
      this.database.db,
      companyId,
    );
    const map: Record<number, string> = {};
    for (const row of rows) {
      if (row.ienhFilialCode != null && row.ienhFilialCode >= 1 && row.ienhFilialCode <= 3) {
        map[row.ienhFilialCode] = row.id;
      }
    }
    return map;
  }

  private async processRecord(args: {
    item: TotvsIenhRecordWithFilial;
    filialClientMap: Record<number, string>;
    year: number;
    result: IenhSyncResult;
    enrollmentsByClient: Map<string, Set<string>>;
    activeClassIdsByStudent: Map<string, Set<string>>;
    classCache: Map<string, string>;
    classResolveInflight: Map<string, Promise<string>>;
    responsibleCache: Map<string, string>;
  }): Promise<void> {
    const {
      item,
      filialClientMap,
      year,
      result,
      enrollmentsByClient,
      activeClassIdsByStudent,
      classCache,
      classResolveInflight,
      responsibleCache,
    } = args;
    const record = item.record;
    const filial =
      item.filial ?? resolveFilialFromRecord(record) ?? null;
    if (filial == null) {
      throw new Error(`Filial não identificada para ${record.NOMEFILIAL}`);
    }

    const clientId = filialClientMap[filial];
    if (!clientId) {
      throw new Error(`Cliente não mapeado para filial ${filial}`);
    }

    const enrollment = normalizeEnrollment(record.CODALUNO);
    if (!enrollment) {
      throw new Error('CODALUNO vazio');
    }

    let classId: string | null = null;
    const turmaCode = record.CODTURMA?.trim();
    if (turmaCode) {
      const classKey = `${clientId}:${turmaCode}:${year}`;
      classId = await this.resolveSchoolClassId({
        classKey,
        clientId,
        turmaCode,
        year,
        classCache,
        classResolveInflight,
        onCreated: () => {
          result.classesCreated += 1;
        },
      });
    }

    const studentIsActive = mapStatusAcessoToIsActive(record.STATUSACESSO);
    const situacaoMatricula = mapSituacaoMatricula(record.SITUACAOMAT);

    const studentUpsert = await studentsQueries.upsertStudentByEnrollment(
      this.database.db,
      {
        clientId,
        enrollment,
        name: record.NOMEALUNO.trim(),
        birthDate: parseTotvsDate(record.DTNASCALUNO),
        situacaoMatricula,
        isActive: studentIsActive,
      },
    );
    if (studentUpsert.created) {
      result.studentsCreated += 1;
    } else {
      result.studentsUpdated += 1;
    }

    if (!enrollmentsByClient.has(clientId)) {
      enrollmentsByClient.set(clientId, new Set());
    }
    enrollmentsByClient.get(clientId)!.add(enrollment);

    const studentId = studentUpsert.row.id;

    if (classId) {
      const classLink = await studentClassesQueries.upsertStudentClassLink(
        this.database.db,
        {
          studentId,
          classId,
          situacaoMatricula,
          isActive: studentIsActive,
        },
      );
      if (classLink.created) {
        result.classLinksCreated += 1;
      } else {
        result.classLinksUpdated += 1;
      }
      if (!activeClassIdsByStudent.has(studentId)) {
        activeClassIdsByStudent.set(studentId, new Set());
      }
      activeClassIdsByStudent.get(studentId)!.add(classId);
    }
    await this.syncParent({
      record,
      clientId,
      studentId,
      side: 'mother',
      result,
      responsibleCache,
    });
    await this.syncParent({
      record,
      clientId,
      studentId,
      side: 'father',
      result,
      responsibleCache,
    });
  }

  /** Evita criar duas `school_classes` iguais quando o sync roda com concorrência. */
  private async resolveSchoolClassId(args: {
    classKey: string;
    clientId: string;
    turmaCode: string;
    year: number;
    classCache: Map<string, string>;
    classResolveInflight: Map<string, Promise<string>>;
    onCreated: () => void;
  }): Promise<string> {
    const {
      classKey,
      clientId,
      turmaCode,
      year,
      classCache,
      classResolveInflight,
      onCreated,
    } = args;

    const cached = classCache.get(classKey);
    if (cached) return cached;

    let inflight = classResolveInflight.get(classKey);
    if (!inflight) {
      inflight = (async () => {
        const again = classCache.get(classKey);
        if (again) return again;

        const klass = await schoolClassQueries.findOrCreateSchoolClassByCode(
          this.database.db,
          clientId,
          turmaCode,
          year,
        );
        classCache.set(classKey, klass.id);
        if (klass.created) onCreated();
        return klass.id;
      })();
      classResolveInflight.set(classKey, inflight);
    }

    return inflight;
  }

  private async syncParent(args: {
    record: TotvsIenhRecord;
    clientId: string;
    studentId: string;
    side: 'mother' | 'father';
    result: IenhSyncResult;
    responsibleCache: Map<string, string>;
  }): Promise<void> {
    const { record, clientId, studentId, side, result, responsibleCache } =
      args;
    const isMother = side === 'mother';
    const name = (isMother ? record.NOMEMAE : record.NOMEPAI)?.trim();
    const cpfRaw = isMother ? record.CPFMAE : record.CPFPAI;
    const phoneRaw = isMother ? record.TELEFONEMAE : record.TELEFONEPAI;

    const document = normalizeDocument(cpfRaw);
    if (!name || !document) return;

    const cacheKey = `${clientId}:${document}`;
    const phone = normalizePhone(phoneRaw);
    let responsibleId = responsibleCache.get(cacheKey);

    if (responsibleId) {
      await responsiblesQueries.updateResponsible(
        this.database.db,
        responsibleId,
        clientId,
        { name, phone, isActive: true },
      );
      result.responsiblesUpdated += 1;
    } else {
      const upsert = await responsiblesQueries.upsertResponsibleByDocument(
        this.database.db,
        {
          clientId,
          document,
          name,
          phone,
          isActive: true,
        },
      );
      responsibleId = upsert.row.id;
      responsibleCache.set(cacheKey, responsibleId);
      if (upsert.created) {
        result.responsiblesCreated += 1;
      } else {
        result.responsiblesUpdated += 1;
      }
    }

    const link = await responsibleStudentsQueries.findOrCreateResponsibleStudentLink(
      this.database.db,
      {
        responsibleId,
        studentId,
        relationshipType: isMother ? 'mother' : 'father',
      },
    );
    if (link.created) result.linksCreated += 1;
  }
}
