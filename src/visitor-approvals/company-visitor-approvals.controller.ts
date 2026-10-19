import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  VisitorApprovalHistoryDto,
  VisitorApprovalResultDto,
} from '../validation/dto/visitor-approvals.dto';
import { VisitorApprovalService } from './visitor-approval.service';

@ApiTags('visitor-approvals')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients/:clientId/registrations/:registrationId/visitor-approval')
export class CompanyVisitorApprovalsController {
  constructor(private readonly approvals: VisitorApprovalService) {}

  @Get()
  @ApiOkResponse({ type: VisitorApprovalHistoryDto })
  history(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.history(user, clientId, id);
  }

  @Post('regularize')
  @Roles('company_admin')
  @ApiOkResponse({ type: VisitorApprovalResultDto })
  regularize(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.regularize(user, clientId, id);
  }

  @Post('resend')
  @ApiOkResponse({ type: VisitorApprovalResultDto })
  resend(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.resend(user, clientId, id);
  }
}
