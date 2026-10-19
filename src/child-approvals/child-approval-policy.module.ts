import { VisitorApprovalPolicyModule } from '../visitor-approvals/visitor-approval-policy.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ChildApprovalRepository } from './child-approval.repository';
import { ChildApprovalPolicyService } from './child-approval-policy.service';
import { ChildApprovalRevocationService } from './child-approval-revocation.service';

@Module({
  imports: [DatabaseModule, VisitorApprovalPolicyModule],
  providers: [
    ChildApprovalRepository,
    ChildApprovalPolicyService,
    ChildApprovalRevocationService,
  ],
  exports: [
    VisitorApprovalPolicyModule,
    ChildApprovalRepository,
    ChildApprovalPolicyService,
    ChildApprovalRevocationService,
  ],
})
export class ChildApprovalPolicyModule {}
