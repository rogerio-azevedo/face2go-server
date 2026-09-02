import { Injectable } from '@nestjs/common';

import * as reportsQueries from '../queries/reports.queries';
import { BaseRepository } from './base.repository';

@Injectable()
export class ReportsRepository extends BaseRepository {
  summarizeEnrollment(filters: reportsQueries.EnrollmentReportFilters) {
    return reportsQueries.summarizeEnrollment(this.db, filters);
  }

  listEnrollment(
    filters: reportsQueries.EnrollmentReportFilters,
    options: reportsQueries.EnrollmentListOptions = {},
  ) {
    return reportsQueries.listEnrollment(this.db, filters, options);
  }

  listActiveSchoolClassesByClient(clientId: string) {
    return reportsQueries.listActiveSchoolClassesByClient(this.db, clientId);
  }

  hasActiveFacialReaders(clientId: string) {
    return reportsQueries.hasActiveFacialReaders(this.db, clientId);
  }
}
