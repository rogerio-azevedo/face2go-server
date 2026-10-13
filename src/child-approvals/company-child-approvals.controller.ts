import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ChildApprovalHistoryDto,
  ChildApprovalResultDto,
} from '../validation/dto/child-approvals.dto';
import { ChildApprovalService } from './child-approval.service';

@ApiTags('child-approvals')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients/:clientId/registrations/:registrationId/child-approval')
export class CompanyChildApprovalsController {
  constructor(private readonly approvals: ChildApprovalService) {}

  @Get()
  @ApiOkResponse({ type: ChildApprovalHistoryDto })
  history(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.history(user, clientId, id);
  }

  @Post('regularize')
  @Roles('company_admin')
  @ApiOkResponse({ type: ChildApprovalResultDto })
  regularize(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.regularize(user, clientId, id);
  }

  @Post('resend')
  @ApiOkResponse({ type: ChildApprovalResultDto })
  resend(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.resend(user, clientId, id);
  }
}
