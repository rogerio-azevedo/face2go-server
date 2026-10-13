import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ChildApprovalRepository } from './child-approval.repository';
import { ChildApprovalPolicyService } from './child-approval-policy.service';

@Module({
  imports: [DatabaseModule],
  providers: [ChildApprovalRepository, ChildApprovalPolicyService],
  exports: [ChildApprovalRepository, ChildApprovalPolicyService],
})
export class ChildApprovalPolicyModule {}
