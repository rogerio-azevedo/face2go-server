import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  parseListPaginationParams,
  buildPaginatedResult,
} from '../common/pagination';
import type { EnrollmentReportFilters } from '../database/queries/reports.queries';
import { ClientsRepository } from '../database/repositories/clients.repository';
import { ReportsRepository } from '../database/repositories/reports.repository';
import { PermissionsService } from '../permissions/permissions.service';
import { R2StorageService } from '../storage/r2-storage.service';
import type {
  EnrollmentGroup,
  EnrollmentReportQuery,
} from '../validation/reports.schema';
import {
  buildEnrollmentCsv,
  enrollmentExportFilename,
  groupIncludesVehicle,
  percentOf,
} from './enrollment-report.utils';

export type EnrollmentSummaryResponse = {
  clientId: string;
  clientName: string;
  clientType: 'office' | 'clinic' | 'condominium' | 'school' | 'other';
  group: EnrollmentGroup;
  total: number;
  withFace: number;
  withoutFace: number;
  percentWithFace: number;
  withVehicle?: number;
  withoutVehicle?: number;
  percentWithVehicle?: number;
  classes?: { id: string; name: string }[];
};

@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);

  constructor(
    private readonly reports: ReportsRepository,
    private readonly clients: ClientsRepository,
    private readonly permissions: PermissionsService,
    private readonly r2Storage: R2StorageService,
  ) {}

  async getSummary(
    user: JwtPayload,
    query: EnrollmentReportQuery & { clientId?: string },
  ): Promise<EnrollmentSummaryResponse> {
    const client = await this.resolveClient(user, query.clientId);
    const filters = this.filtersFor(client.id, query);
    const counts = await this.reports.summarizeEnrollment(filters);
    const includeVehicle = groupIncludesVehicle(query.group);
    const classes =
      query.group === 'students' && client.type === 'school'
        ? await this.reports.listActiveSchoolClassesByClient(client.id)
        : undefined;

    return {
      clientId: client.id,
      clientName: client.name,
      clientType: client.type,
      group: query.group,
      total: counts.total,
      withFace: counts.withFace,
      withoutFace: counts.total - counts.withFace,
      percentWithFace: percentOf(counts.withFace, counts.total),
      ...(includeVehicle
        ? {
            withVehicle: counts.withVehicle,
            withoutVehicle: counts.total - counts.withVehicle,
            percentWithVehicle: percentOf(counts.withVehicle, counts.total),
          }
        : {}),
      ...(classes ? { classes } : {}),
    };
  }

  async getList(
    user: JwtPayload,
    query: EnrollmentReportQuery & { clientId?: string },
  ) {
    const client = await this.resolveClient(user, query.clientId);
    const filters = this.filtersFor(client.id, query, true);
    const { page, pageSize, offset } = parseListPaginationParams(
      query.page !== undefined ? String(query.page) : undefined,
      query.pageSize !== undefined ? String(query.pageSize) : undefined,
    );
    const [rows, counts, hasFacialReaders] = await Promise.all([
      this.reports.listEnrollment(filters, { offset, limit: pageSize }),
      this.reports.summarizeEnrollment(filters),
      this.reports.hasActiveFacialReaders(client.id),
    ]);
    const includeVehicle = groupIncludesVehicle(query.group);
    const includeLogin = query.group !== 'students';
    const data = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        name: row.name,
        className: query.group === 'students' ? row.className : undefined,
        roleName: query.group === 'members' ? row.roleName : undefined,
        photoUrl: await this.optionalPhotoUrl(row.photoKey),
        hasFace: row.hasFace,
        hasVehicle: includeVehicle ? row.hasVehicle : undefined,
        deviceSyncStatus: row.deviceSyncStatus,
        deviceSyncError: row.deviceSyncError,
        hasFacialReaders,
        hasLogin: includeLogin ? row.hasLogin : undefined,
      })),
    );
    return buildPaginatedResult(data, counts.total, page, pageSize);
  }

  async exportCsv(
    user: JwtPayload,
    query: EnrollmentReportQuery & { clientId?: string },
  ): Promise<StreamableFile> {
    const client = await this.resolveClient(user, query.clientId);
    const filters = this.filtersFor(client.id, query, true);
    const rows = await this.reports.listEnrollment(filters);
    const csv = buildEnrollmentCsv(query.group, rows);
    const filename = enrollmentExportFilename(query.group);
    return new StreamableFile(Buffer.from(`\uFEFF${csv}`, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  private filtersFor(
    clientId: string,
    query: EnrollmentReportQuery,
    includeStatusFilters = false,
  ): EnrollmentReportFilters {
    return {
      clientId,
      group: query.group,
      classId: query.group === 'students' ? query.classId : undefined,
      search: query.search,
      ...(includeStatusFilters
        ? {
            hasFace: query.hasFace,
            hasVehicle:
              query.group === 'students' ? undefined : query.hasVehicle,
            syncFailed: query.syncFailed,
          }
        : {}),
    };
  }

  private async resolveClient(user: JwtPayload, requestedClientId?: string) {
    const companyId = user.companyId ?? undefined;
    if (!companyId) {
      throw new ForbiddenException('Sem permissão.');
    }

    if (user.role === 'company_admin' || user.role === 'company_operator') {
      const ok = await this.permissions.evaluateCompanyFeatureAction(
        user.role,
        user.companyUserId,
        'reports',
        'can_read',
        companyId,
      );
      if (!ok) {
        throw new ForbiddenException('Sem permissão.');
      }
      if (!requestedClientId) {
        throw new BadRequestException('Informe o cliente.');
      }
      const client = await this.clients.findById(requestedClientId);
      if (!client || client.companyId !== companyId) {
        throw new NotFoundException('Cliente não encontrado.');
      }
      return client;
    }

    if (user.role === 'client_admin' || user.role === 'client_operator') {
      const clientId = user.clientId ?? undefined;
      if (!clientId) {
        throw new ForbiddenException('Sem permissão.');
      }
      const client = await this.clients.findById(clientId);
      if (!client || client.companyId !== companyId) {
        throw new ForbiddenException('Sem permissão.');
      }
      return client;
    }

    throw new ForbiddenException('Sem permissão.');
  }

  private async optionalPhotoUrl(
    photoKey: string | null,
  ): Promise<string | null> {
    if (!photoKey) return null;
    try {
      return await this.r2Storage.createPresignedPortraitGetUrl(photoKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(
        `URL assinada (relatório/R2): falha para key="${photoKey}": ${msg}`,
      );
      return null;
    }
  }
}
