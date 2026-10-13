import { ChildApprovalInvitationService } from './child-approval-invitation.service';
import { ChildApprovalPublicService } from './child-approval-public.service';
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ChildApprovalPhotoService } from './child-approval-photo.service';
import { EmailModule } from '../email/email.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ChildApprovalPolicyModule } from './child-approval-policy.module';
import { ChildApprovalService } from './child-approval.service';
import { ChildApprovalDeliveryRepository } from './child-approval-delivery.repository';
import { ChildApprovalDeliveryService } from './child-approval-delivery.service';
import { ChildApprovalMaintenanceService } from './child-approval-maintenance.service';
import { PublicChildApprovalsController } from './public-child-approvals.controller';
import { ClientChildApprovalsController } from './client-child-approvals.controller';
import { CompanyChildApprovalsController } from './company-child-approvals.controller';

@Module({
  imports: [
    ChildApprovalPolicyModule,
    EmailModule,
    PermissionsModule,
    StorageModule,
  ],
  controllers: [
    PublicChildApprovalsController,
    ClientChildApprovalsController,
    CompanyChildApprovalsController,
  ],
  providers: [
    ChildApprovalInvitationService,
    ChildApprovalPublicService,
    ChildApprovalPhotoService,
    ChildApprovalService,
    ChildApprovalDeliveryRepository,
    ChildApprovalDeliveryService,
    ChildApprovalMaintenanceService,
  ],
  exports: [
    ChildApprovalPolicyModule,
    ChildApprovalService,
    ChildApprovalDeliveryService,
  ],
})
export class ChildApprovalsModule {}
