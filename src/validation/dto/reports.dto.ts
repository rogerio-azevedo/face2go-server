import { createZodDto } from 'nestjs-zod';

import {
  companyEnrollmentReportQuerySchema,
  enrollmentListItemSchema,
  enrollmentReportQuerySchema,
  enrollmentSummarySchema,
} from '../reports.schema';

export class EnrollmentReportQueryDto extends createZodDto(
  enrollmentReportQuerySchema,
) {}

export class CompanyEnrollmentReportQueryDto extends createZodDto(
  companyEnrollmentReportQuerySchema,
) {}

export class EnrollmentSummaryDto extends createZodDto(
  enrollmentSummarySchema,
) {}

export class EnrollmentListItemDto extends createZodDto(
  enrollmentListItemSchema,
) {}
