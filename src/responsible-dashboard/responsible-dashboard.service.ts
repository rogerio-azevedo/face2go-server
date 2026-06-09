import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import AxiosDigestAuth from '@mhoc/axios-digest-auth';
import { inArray } from 'drizzle-orm';
import type { Model } from 'mongoose';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { FacialAccessDocument } from '../accesses/access.schema';
import { FacialAccess } from '../accesses/access.schema';
import {
  createReaderCredentialsCipher,
  type ReaderCredentialsCipher,
} from '../common/crypto/reader-credentials.cipher';
import type { EnvVars } from '../config/env.validation';
import { DatabaseService } from '../database/database.service';
import { facialReaders } from '../database/schema';
import * as clientsQueries from '../database/queries/clients.queries';
import * as readersQueries from '../database/queries/readers.queries';
import * as responsiblesQueries from '../database/queries/responsibles.queries';
import * as studentsQueries from '../database/queries/students.queries';
import * as pickupQueries from '../database/queries/pickup-authorizations.queries';
import { R2StorageService } from '../storage/r2-storage.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LastAccessDto = {
  eventDate: string | null;
  readerName: string;
  eventAction: string;
};

export type ResponsibleChildSummaryDto = {
  kind: 'student' | 'responsible';
  /** Preenchido quando `kind === 'student'`. */
  studentId: string | null;
  /** Preenchido quando `kind === 'responsible'` (co-responsável do mesmo núcleo). */
  responsibleId: string | null;
  name: string;
  /** Turma formatada para exibição (nome + ano), ex.: `3º A – 2026`. */
  className: string | null;
  photoUrl: string | null;
  relationshipType: string;
  lastAccess: LastAccessDto | null;
};

export type ResponsibleAccessHistoryItemDto = {
  id: string;
  readerName: string;
  eventCode: string;
  eventAction: string;
  similarity: number | null;
  readerDirection: 'in' | 'out' | null;
  correlationId: string | null;
  eventDate: string | null;
  createdAt: string;
  snapPath: string | null;
  /** Quem passou no leitor (`userId` / face), quando resolvido (ex.: lista "Todos"). */
  subjectName: string | null;
  subjectPhotoUrl: string | null;
};

function inferDirectionFromReaderName(name: string): 'in' | 'out' | null {
  const n = name.trim().toLowerCase();
  if (/\bsa[ií]da\b/.test(n)) return 'out';
  if (/\bentrada\b/.test(n)) return 'in';
  return null;
}

@Injectable()
export class ResponsibleDashboardService {
  private readonly readerCipher: ReaderCredentialsCipher;

  constructor(
    @InjectModel(FacialAccess.name)
    private readonly accessModel: Model<FacialAccessDocument>,
    private readonly database: DatabaseService,
    private readonly r2Storage: R2StorageService,
    private readonly configService: ConfigService<EnvVars, true>,
  ) {
    const key = this.configService.get('READER_ENCRYPTION_KEY', {
      infer: true,
    });
    this.readerCipher = createReaderCredentialsCipher(key);
  }

  /** Minutos a somar ao instante UTC para o horário local da escola (ex.: −240 = UTC−4). */
  private async schoolTimezoneOffsetMinutes(clientId: string): Promise<number> {
    const row = await clientsQueries.getClientByIdOnly(
      this.database.db,
      clientId,
    );
    return row?.timezoneOffsetMinutes ?? 0;
  }

  private async loadReaderDirections(
    readerIds: string[],
  ): Promise<Map<string, 'in' | 'out' | null>> {
    const unique = [
      ...new Set(readerIds.filter((id) => UUID_RE.test(id.trim()))),
    ];
    if (unique.length === 0) return new Map();

    const rows = await this.database.db
      .select({
        id: facialReaders.id,
        direction: facialReaders.direction,
      })
      .from(facialReaders)
      .where(inArray(facialReaders.id, unique));

    const map = new Map<string, 'in' | 'out' | null>();
    for (const row of rows) {
      map.set(
        row.id,
        row.direction === 'in' || row.direction === 'out'
          ? row.direction
          : null,
      );
    }
    return map;
  }

  private resolveReaderDirection(
    stored: 'in' | 'out' | null | undefined,
    readerId: string | undefined,
    readerName: string,
    fromPg: Map<string, 'in' | 'out' | null>,
  ): 'in' | 'out' | null {
    if (stored === 'in' || stored === 'out') return stored;
    if (readerId && fromPg.has(readerId)) {
      const pg = fromPg.get(readerId);
      if (pg === 'in' || pg === 'out') return pg;
    }
    return inferDirectionFromReaderName(readerName);
  }

  private async mapFacialDocsToDto(
    docs: unknown[],
    subjectByFaceId?: Map<number, { name: string; photoKey: string | null }>,
  ): Promise<ResponsibleAccessHistoryItemDto[]> {
    type ParsedDoc = FacialAccessDocument & {
      _id?: { toString(): string };
      readerId?: string;
      userId?: number;
      personName?: string | null;
      readerName?: string;
      eventCode?: string;
      eventAction?: string;
      similarity?: number | null;
      readerDirection?: 'in' | 'out' | null;
      correlationId?: string | null;
      eventDate?: Date | null;
      createdAt?: Date;
      snapPath?: string | null;
      snapR2Key?: string | null;
    };

    const parsed = docs as ParsedDoc[];
    const directionsByReaderId = await this.loadReaderDirections(
      parsed.map((doc) => doc.readerId ?? ''),
    );

    const out: ResponsibleAccessHistoryItemDto[] = [];
    for (const doc of parsed) {
      let snapPath: string | null =
        typeof doc.snapPath === 'string' && doc.snapPath.trim()
          ? doc.snapPath.trim()
          : null;

      const snapR2Key =
        typeof doc.snapR2Key === 'string' && doc.snapR2Key.trim()
          ? doc.snapR2Key.trim()
          : null;

      if (snapR2Key) {
        try {
          snapPath = await this.r2Storage.createPresignedGetUrl(snapR2Key);
        } catch {
          /* mantém snapPath do leitor se presign falhar */
        }
      }

      let subjectName: string | null = null;
      let subjectPhotoUrl: string | null = null;
      const uid = typeof doc.userId === 'number' ? doc.userId : null;
      if (subjectByFaceId && uid != null && subjectByFaceId.has(uid)) {
        const s = subjectByFaceId.get(uid)!;
        subjectName = s.name;
        subjectPhotoUrl = await this.optionalPhotoUrl(s.photoKey);
      }
      const pn =
        typeof doc.personName === 'string' && doc.personName.trim()
          ? doc.personName.trim()
          : '';
      if (!subjectName && pn) {
        subjectName = pn;
      }

      const readerName = doc.readerName ?? '';
      const readerDirection = this.resolveReaderDirection(
        doc.readerDirection,
        doc.readerId,
        readerName,
        directionsByReaderId,
      );

      out.push({
        id: doc._id ? doc._id.toString() : '',
        readerName,
        eventCode: doc.eventCode ?? '',
        eventAction: doc.eventAction ?? '',
        similarity: doc.similarity ?? null,
        readerDirection,
        correlationId:
          typeof doc.correlationId === 'string' && doc.correlationId.trim()
            ? doc.correlationId.trim()
            : null,
        eventDate: doc.eventDate ? doc.eventDate.toISOString() : null,
        createdAt: doc.createdAt
          ? doc.createdAt.toISOString()
          : new Date().toISOString(),
        snapPath,
        subjectName,
        subjectPhotoUrl,
      });
    }
    return out;
  }

  private async paginateFacialAccessByUserId(
    clientId: string,
    faceUserId: number,
    page: number,
    limit: number,
  ): Promise<{
    items: ResponsibleAccessHistoryItemDto[];
    total: number;
  }> {
    const filter = { clientId, userId: faceUserId };
    const total = await this.accessModel.countDocuments(filter).exec();
    const skip = (page - 1) * limit;

    const docs = await this.accessModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    const items = await this.mapFacialDocsToDto(docs);
    return { items, total };
  }

  private async paginateFacialAccessByUserIds(
    clientId: string,
    userIds: number[],
    page: number,
    limit: number,
    subjectByFaceId?: Map<number, { name: string; photoKey: string | null }>,
  ): Promise<{
    items: ResponsibleAccessHistoryItemDto[];
    total: number;
  }> {
    if (userIds.length === 0) {
      return { items: [], total: 0 };
    }
    const filter = { clientId, userId: { $in: userIds } };
    const total = await this.accessModel.countDocuments(filter).exec();
    const skip = (page - 1) * limit;

    const docs = await this.accessModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    const items = await this.mapFacialDocsToDto(docs, subjectByFaceId);
    return { items, total };
  }

  private async buildHouseholdFaceSubjectMap(
    responsibleId: string,
    clientId: string,
  ): Promise<Map<number, { name: string; photoKey: string | null }>> {
    const map = new Map<number, { name: string; photoKey: string | null }>();
    const householdIds = await responsiblesQueries.listHouseholdResponsibleIds(
      this.database.db,
      responsibleId,
      clientId,
    );
    for (const hid of householdIds) {
      const row = await responsiblesQueries.getResponsibleById(
        this.database.db,
        hid,
        clientId,
      );
      if (!row?.faceId) continue;
      map.set(row.faceId, {
        name: row.name,
        photoKey: row.photoKey ?? null,
      });
    }
    const linkRows =
      await responsiblesQueries.listResponsibleStudentLinksWithStudents(
        this.database.db,
        responsibleId,
        clientId,
      );
    for (const r of linkRows) {
      const fid = r.student.faceId;
      if (fid == null) continue;
      map.set(fid, {
        name: r.student.name,
        photoKey: r.student.photoKey ?? null,
      });
    }
    return map;
  }

  private async buildPickupGuestFaceSubjectMap(
    responsibleId: string,
    clientId: string,
  ): Promise<Map<number, { name: string; photoKey: string | null }>> {
    const map = new Map<number, { name: string; photoKey: string | null }>();
    const auths = await pickupQueries.pickupAuthListByResponsible(
      this.database.db,
      responsibleId,
      clientId,
    );

    const documentsToExpand = new Set<string>();

    for (const auth of auths) {
      if (auth.guestFaceId != null) {
        map.set(auth.guestFaceId, {
          name: auth.guestName?.trim() || 'Convidado',
          photoKey: auth.guestFaceImageKey ?? null,
        });
      }

      const doc = auth.guestDocument?.trim();
      if (doc) {
        documentsToExpand.add(doc);
      }

      if (auth.linkedResponsibleId) {
        const linked = await responsiblesQueries.getResponsibleById(
          this.database.db,
          auth.linkedResponsibleId,
          clientId,
        );
        if (linked?.faceId != null && !map.has(linked.faceId)) {
          map.set(linked.faceId, {
            name: linked.name,
            photoKey: linked.photoKey ?? null,
          });
        }
      }
    }

    for (const doc of documentsToExpand) {
      const crossAuths = await pickupQueries.pickupAuthListGuestFaceIdsByDocument(
        this.database.db,
        clientId,
        doc,
      );
      for (const entry of crossAuths) {
        if (entry.guestFaceId == null || map.has(entry.guestFaceId)) {
          continue;
        }
        map.set(entry.guestFaceId, {
          name: entry.guestName?.trim() || 'Convidado',
          photoKey: entry.guestFaceImageKey ?? null,
        });
      }
    }

    return map;
  }

  private mergeFaceSubjectMaps(
    base: Map<number, { name: string; photoKey: string | null }>,
    extra: Map<number, { name: string; photoKey: string | null }>,
  ): Map<number, { name: string; photoKey: string | null }> {
    for (const [faceId, subject] of extra) {
      if (!base.has(faceId)) {
        base.set(faceId, subject);
      }
    }
    return base;
  }

  private async lastAccessForFaceUserId(
    clientId: string,
    faceUserId: number,
  ): Promise<LastAccessDto | null> {
    const doc = await this.accessModel
      .findOne({ clientId, userId: faceUserId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (!doc) return null;
    const d = doc as FacialAccessDocument & {
      readerName?: string;
      eventAction?: string;
      eventDate?: Date | null;
      createdAt?: Date;
    };
    return {
      eventDate: d.eventDate ? d.eventDate.toISOString() : null,
      readerName: d.readerName ?? '',
      eventAction: d.eventAction ?? '',
    };
  }

  private assertResponsibleScope(user: JwtPayload): {
    responsibleId: string;
    clientId: string;
  } {
    if (user.role !== 'responsible' || !user.responsibleId || !user.clientId) {
      throw new ForbiddenException('Acesso apenas para conta de responsável.');
    }
    return { responsibleId: user.responsibleId, clientId: user.clientId };
  }

  private async optionalPhotoUrl(
    photoKey: string | null,
  ): Promise<string | null> {
    if (!photoKey) return null;
    try {
      return await this.r2Storage.createPresignedGetUrl(photoKey);
    } catch {
      return null;
    }
  }

  async listChildren(user: JwtPayload): Promise<{
    children: ResponsibleChildSummaryDto[];
    timezoneOffsetMinutes: number;
  }> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    const timezoneOffsetMinutes =
      await this.schoolTimezoneOffsetMinutes(clientId);
    const rows =
      await responsiblesQueries.listResponsibleStudentLinksWithStudents(
        this.database.db,
        responsibleId,
        clientId,
      );

    const out: ResponsibleChildSummaryDto[] = [];
    for (const row of rows) {
      let lastAccess: LastAccessDto | null = null;
      const faceId = row.student.faceId;
      if (faceId != null) {
        lastAccess = await this.lastAccessForFaceUserId(clientId, faceId);
      }

      const sc = row.schoolClass;
      const rawName = sc?.name?.trim() ?? '';
      const className =
        rawName !== ''
          ? sc?.year != null
            ? `${rawName} – ${sc.year}`
            : rawName
          : null;

      out.push({
        kind: 'student',
        studentId: row.student.id,
        responsibleId: null,
        name: row.student.name,
        className,
        photoUrl: await this.optionalPhotoUrl(row.student.photoKey),
        relationshipType: row.link.relationshipType,
        lastAccess,
      });
    }

    const peerOptions = await responsiblesQueries.listHouseholdDriverOptions(
      this.database.db,
      responsibleId,
      clientId,
    );
    const peers = peerOptions.filter((p) => p.id !== responsibleId);

    for (const peer of peers) {
      const faceId = await responsiblesQueries.getResponsibleFaceId(
        this.database.db,
        peer.id,
        clientId,
      );
      const lastAccess =
        faceId != null
          ? await this.lastAccessForFaceUserId(clientId, faceId)
          : null;
      const respRow = await responsiblesQueries.getResponsibleById(
        this.database.db,
        peer.id,
        clientId,
      );
      out.push({
        kind: 'responsible',
        studentId: null,
        responsibleId: peer.id,
        name: peer.name,
        className: null,
        photoUrl: await this.optionalPhotoUrl(respRow?.photoKey ?? null),
        relationshipType: peer.relationshipType,
        lastAccess,
      });
    }

    return { children: out, timezoneOffsetMinutes };
  }

  async listAllHouseholdAccesses(
    user: JwtPayload,
    page: number,
    limit: number,
  ): Promise<{
    items: ResponsibleAccessHistoryItemDto[];
    page: number;
    limit: number;
    total: number;
    timezoneOffsetMinutes: number;
  }> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    const timezoneOffsetMinutes =
      await this.schoolTimezoneOffsetMinutes(clientId);

    const subjectMap = this.mergeFaceSubjectMaps(
      await this.buildHouseholdFaceSubjectMap(responsibleId, clientId),
      await this.buildPickupGuestFaceSubjectMap(responsibleId, clientId),
    );
    const userIds = [...subjectMap.keys()];
    const { items, total } = await this.paginateFacialAccessByUserIds(
      clientId,
      userIds,
      page,
      limit,
      subjectMap,
    );

    return { items, page, limit, total, timezoneOffsetMinutes };
  }

  async listAccessesForHouseholdResponsible(
    user: JwtPayload,
    targetResponsibleId: string,
    page: number,
    limit: number,
  ): Promise<{
    items: ResponsibleAccessHistoryItemDto[];
    page: number;
    limit: number;
    total: number;
    timezoneOffsetMinutes: number;
  }> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    const timezoneOffsetMinutes =
      await this.schoolTimezoneOffsetMinutes(clientId);

    const householdIds = await responsiblesQueries.listHouseholdResponsibleIds(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (!householdIds.includes(targetResponsibleId)) {
      throw new NotFoundException('Responsável não encontrado ou sem vínculo.');
    }

    const faceId = await responsiblesQueries.getResponsibleFaceId(
      this.database.db,
      targetResponsibleId,
      clientId,
    );
    if (faceId == null) {
      return {
        items: [],
        page,
        limit,
        total: 0,
        timezoneOffsetMinutes,
      };
    }

    const { items, total } = await this.paginateFacialAccessByUserId(
      clientId,
      faceId,
      page,
      limit,
    );

    return { items, page, limit, total, timezoneOffsetMinutes };
  }

  async listAccessesForLinkedStudent(
    user: JwtPayload,
    studentId: string,
    page: number,
    limit: number,
  ): Promise<{
    items: ResponsibleAccessHistoryItemDto[];
    page: number;
    limit: number;
    total: number;
    timezoneOffsetMinutes: number;
  }> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    const timezoneOffsetMinutes =
      await this.schoolTimezoneOffsetMinutes(clientId);

    const allowedIds = await studentsQueries.listStudentIdsForResponsible(
      this.database.db,
      responsibleId,
    );
    if (!allowedIds.includes(studentId)) {
      throw new NotFoundException('Aluno não encontrado ou sem vínculo.');
    }

    const student = await studentsQueries.getStudentById(
      this.database.db,
      studentId,
      clientId,
    );
    if (!student?.faceId) {
      return {
        items: [],
        page,
        limit,
        total: 0,
        timezoneOffsetMinutes,
      };
    }

    const { items, total } = await this.paginateFacialAccessByUserId(
      clientId,
      student.faceId,
      page,
      limit,
    );

    return { items, page, limit, total, timezoneOffsetMinutes };
  }

  async listOwnAccesses(
    user: JwtPayload,
    page: number,
    limit: number,
  ): Promise<{
    items: ResponsibleAccessHistoryItemDto[];
    page: number;
    limit: number;
    total: number;
    timezoneOffsetMinutes: number;
  }> {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    const timezoneOffsetMinutes =
      await this.schoolTimezoneOffsetMinutes(clientId);

    const faceId = await responsiblesQueries.getResponsibleFaceId(
      this.database.db,
      responsibleId,
      clientId,
    );
    if (faceId == null) {
      return {
        items: [],
        page,
        limit,
        total: 0,
        timezoneOffsetMinutes,
      };
    }

    const { items, total } = await this.paginateFacialAccessByUserId(
      clientId,
      faceId,
      page,
      limit,
    );

    return { items, page, limit, total, timezoneOffsetMinutes };
  }

  /** Outros responsáveis ativos da mesma escola (ex.: autorizar retirada). */
  async listPeerResponsibles(user: JwtPayload) {
    const { responsibleId, clientId } = this.assertResponsibleScope(user);
    return responsiblesQueries.listActiveResponsiblePeersExcept(
      this.database.db,
      clientId,
      responsibleId,
    );
  }

  /**
   * Proxy seguro da foto do evento: só permite host que coincide com leitor Intelbras
   * da mesma escola (`clientId`), usando Digest HTTP com credencial do leitor.
   */
  async proxyAccessSnapshot(
    user: JwtPayload,
    rawUrl: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const { clientId } = this.assertResponsibleScope(user);

    const snapshotUrl = rawUrl?.trim() ?? '';
    if (
      !snapshotUrl.startsWith('http://') &&
      !snapshotUrl.startsWith('https://')
    ) {
      throw new BadRequestException('Somente URLs http(s).');
    }

    let parsed: URL;
    try {
      parsed = new URL(snapshotUrl);
    } catch {
      throw new BadRequestException('URL malformada.');
    }

    if (parsed.username || parsed.password) {
      throw new BadRequestException('URL não permitida.');
    }

    const hostLower = parsed.hostname.trim().toLowerCase();
    const urlPort = parsed.port
      ? parseInt(parsed.port, 10)
      : parsed.protocol === 'https:'
        ? 443
        : 80;

    const readers = await readersQueries.listReadersForFaceSyncByClient(
      this.database.db,
      clientId,
    );

    const byIp = readers.filter((r) => r.ip.trim().toLowerCase() === hostLower);
    if (byIp.length === 0) {
      throw new ForbiddenException(
        'Origem da imagem não autorizada para esta escola.',
      );
    }

    let matched = byIp.find((r) => (r.port ?? 80) === urlPort) ?? null;
    if (!matched && byIp.length === 1) {
      matched = byIp[0];
    }
    if (!matched) {
      throw new ForbiddenException(
        'Nenhum leitor corresponde ao host/porta da URL.',
      );
    }

    let plainPassword: string;
    try {
      plainPassword = this.readerCipher.decrypt(matched.passwordEncrypted);
    } catch {
      throw new ForbiddenException('Credencial do leitor indisponível.');
    }

    const auth = new AxiosDigestAuth({
      username: matched.username.trim(),
      password: plainPassword,
    });

    try {
      const resp = (await auth.request({
        method: 'GET',
        url: snapshotUrl,
        responseType: 'arraybuffer',
        timeout: 20_000,
        validateStatus: () => true,
      })) as {
        status?: number;
        data?: ArrayBuffer;
        headers?: Record<string, unknown>;
      };

      const status = resp.status ?? 0;
      if (status < 200 || status >= 300) {
        throw new ForbiddenException(`Leitor retornou HTTP ${status}.`);
      }

      const buf = Buffer.from(resp.data ?? new ArrayBuffer(0));
      const rawCt = resp.headers?.['content-type'];
      const contentType =
        typeof rawCt === 'string'
          ? (rawCt.split(';')[0]?.trim() ?? 'image/jpeg')
          : 'image/jpeg';

      if (!contentType.startsWith('image/')) {
        throw new ForbiddenException('Resposta não é uma imagem.');
      }

      return { body: buf, contentType };
    } catch (err: unknown) {
      if (
        err instanceof BadRequestException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }
      throw new ForbiddenException(
        `Falha ao obter imagem: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
