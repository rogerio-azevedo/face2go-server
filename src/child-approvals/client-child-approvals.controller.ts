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
  ChildApprovalHistoryDto,
  ChildApprovalResultDto,
  RevokeChildApprovalDto,
} from '../validation/dto/child-approvals.dto';
import { ChildApprovalService } from './child-approval.service';

@ApiTags('child-approvals')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/registrations/:registrationId/child-approval')
export class ClientChildApprovalsController {
  constructor(private readonly approvals: ChildApprovalService) {}

  @Get()
  @ApiOkResponse({ type: ChildApprovalHistoryDto })
  history(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.history(user, user.clientId!, id);
  }

  @Post('regularize')
  @Roles('client_admin')
  @ApiOkResponse({ type: ChildApprovalResultDto })
  regularize(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.regularize(user, user.clientId!, id);
  }

  @Post('resend')
  @ApiOkResponse({ type: ChildApprovalResultDto })
  resend(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.resend(user, user.clientId!, id);
  }

  @Post('consents/:consentId/revoke')
  @Roles('client_admin')
  @ApiOkResponse({ type: ChildApprovalResultDto })
  revoke(
    @CurrentUser() user: JwtPayload,
    @Param('registrationId', ParseUUIDPipe) id: string,
    @Param('consentId', ParseUUIDPipe) consentId: string,
    @Body() dto: RevokeChildApprovalDto,
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
