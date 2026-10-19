import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  VisitorApprovalHistoryDto,
  VisitorApprovalResultDto,
  RevokeVisitorApprovalDto,
} from '../validation/dto/visitor-approvals.dto';
import { VisitorApprovalService } from './visitor-approval.service';

@ApiTags('visitor-approvals')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/registrations/:registrationId/visitor-approval')
export class ClientVisitorApprovalsController {
  constructor(private readonly approvals: VisitorApprovalService) {}

  @Get()
  @ApiOkResponse({ type: VisitorApprovalHistoryDto })
  history(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.history(user, user.clientId!, id);
  }

  @Post('regularize')
  @Roles('client_admin')
  @ApiOkResponse({ type: VisitorApprovalResultDto })
  regularize(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.regularize(user, user.clientId!, id);
  }

  @Post('resend')
  @ApiOkResponse({ type: VisitorApprovalResultDto })
  resend(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.resend(user, user.clientId!, id);
  }

  @Post('consents/:consentId/revoke')
  @Roles('client_admin')
  @ApiOkResponse({ type: VisitorApprovalResultDto })
  revoke(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) id: string,
    @Param('consentId', ParseUUIDPipe) consentId: string,
    @Body() dto: RevokeVisitorApprovalDto,
  ) {
    return this.approvals.revokeAdmin(
      user,
      user.clientId!,
      consentId,
      dto.reason,
      id,
    );
  }
}
