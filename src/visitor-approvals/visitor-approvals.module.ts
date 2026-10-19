import { VisitorApprovalRateLimitGuard } from './visitor-approval-rate-limit.guard';
import { VisitorApprovalInvitationService } from './visitor-approval-invitation.service';
import { VisitorApprovalPublicService } from './visitor-approval-public.service';
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { VisitorApprovalPhotoService } from './visitor-approval-photo.service';
import { EmailModule } from '../email/email.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { VisitorApprovalPolicyModule } from './visitor-approval-policy.module';
import { VisitorApprovalService } from './visitor-approval.service';
import { VisitorApprovalDeliveryRepository } from './visitor-approval-delivery.repository';
import { VisitorApprovalDeliveryService } from './visitor-approval-delivery.service';
import { VisitorApprovalMaintenanceService } from './visitor-approval-maintenance.service';
import { PublicVisitorApprovalsController } from './public-visitor-approvals.controller';
import { ClientVisitorApprovalsController } from './client-visitor-approvals.controller';
import { CompanyVisitorApprovalsController } from './company-visitor-approvals.controller';

@Module({
  imports: [
    VisitorApprovalPolicyModule,
    EmailModule,
    PermissionsModule,
    StorageModule,
  ],
  controllers: [
    PublicVisitorApprovalsController,
    ClientVisitorApprovalsController,
    CompanyVisitorApprovalsController,
  ],
  providers: [
    VisitorApprovalRateLimitGuard,
    VisitorApprovalInvitationService,
    VisitorApprovalPublicService,
    VisitorApprovalPhotoService,
    VisitorApprovalService,
    VisitorApprovalDeliveryRepository,
    VisitorApprovalDeliveryService,
    VisitorApprovalMaintenanceService,
  ],
  exports: [
    VisitorApprovalRateLimitGuard,
    VisitorApprovalPolicyModule,
    VisitorApprovalService,
    VisitorApprovalDeliveryService,
  ],
})
export class VisitorApprovalsModule {}
