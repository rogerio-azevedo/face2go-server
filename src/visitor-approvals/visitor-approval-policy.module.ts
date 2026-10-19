import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { VisitorApprovalRepository } from './visitor-approval.repository';
import { VisitorApprovalPolicyService } from './visitor-approval-policy.service';
import { VisitorApprovalRevocationService } from './visitor-approval-revocation.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    VisitorApprovalRepository,
    VisitorApprovalPolicyService,
    VisitorApprovalRevocationService,
  ],
  exports: [
    VisitorApprovalRepository,
    VisitorApprovalPolicyService,
    VisitorApprovalRevocationService,
  ],
})
export class VisitorApprovalPolicyModule {}
