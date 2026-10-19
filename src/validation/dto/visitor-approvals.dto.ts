import { createZodDto } from 'nestjs-zod';
import {
  acceptVisitorApprovalSchema,
  visitorApprovalCpfSchema,
  visitorApprovalHistorySchema,
  visitorApprovalPreviewSchema,
  visitorApprovalResultSchema,
  visitorApprovalSummarySchema,
  revokeVisitorApprovalSchema,
} from '../visitor-approvals.schema';

export class AcceptVisitorApprovalDto extends createZodDto(
  acceptVisitorApprovalSchema,
) {}
export class VisitorApprovalCpfDto extends createZodDto(
  visitorApprovalCpfSchema,
) {}
export class RevokeVisitorApprovalDto extends createZodDto(
  revokeVisitorApprovalSchema,
) {}
export class VisitorApprovalSummaryDto extends createZodDto(
  visitorApprovalSummarySchema,
) {}
export class VisitorApprovalPreviewDto extends createZodDto(
  visitorApprovalPreviewSchema,
) {}
export class VisitorApprovalHistoryDto extends createZodDto(
  visitorApprovalHistorySchema,
) {}
export class VisitorApprovalResultDto extends createZodDto(
  visitorApprovalResultSchema,
) {}
