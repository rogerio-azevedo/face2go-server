import { createZodDto } from 'nestjs-zod';
import {
  acceptChildApprovalSchema,
  childApprovalCpfSchema,
  childApprovalHistorySchema,
  childApprovalPreviewSchema,
  childApprovalResultSchema,
  childApprovalSummarySchema,
  revokeChildApprovalSchema,
} from '../child-approvals.schema';

export class AcceptChildApprovalDto extends createZodDto(
  acceptChildApprovalSchema,
) {}
export class ChildApprovalCpfDto extends createZodDto(childApprovalCpfSchema) {}
export class RevokeChildApprovalDto extends createZodDto(
  revokeChildApprovalSchema,
) {}
export class ChildApprovalSummaryDto extends createZodDto(
  childApprovalSummarySchema,
) {}
export class ChildApprovalPreviewDto extends createZodDto(
  childApprovalPreviewSchema,
) {}
export class ChildApprovalHistoryDto extends createZodDto(
  childApprovalHistorySchema,
) {}
export class ChildApprovalResultDto extends createZodDto(
  childApprovalResultSchema,
) {}
