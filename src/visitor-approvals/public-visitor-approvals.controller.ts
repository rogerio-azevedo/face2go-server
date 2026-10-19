import { VisitorApprovalRateLimitGuard } from './visitor-approval-rate-limit.guard';
import {
  Body,
  UseGuards,
  Controller,
  Get,
  Header,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import {
  AcceptVisitorApprovalDto,
  VisitorApprovalCpfDto,
  VisitorApprovalPreviewDto,
  VisitorApprovalResultDto,
} from '../validation/dto/visitor-approvals.dto';
import { VisitorApprovalService } from './visitor-approval.service';
import { VisitorApprovalPhotoService } from './visitor-approval-photo.service';

@UseGuards(VisitorApprovalRateLimitGuard)
@ApiTags('visitor-approvals')
@Controller('visitor-approvals')
export class PublicVisitorApprovalsController {
  constructor(
    private readonly approvals: VisitorApprovalService,
    private readonly photos: VisitorApprovalPhotoService,
  ) {}

  @Public()
  @Get(':token/photo')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Ver miniatura do visitante pelo link individual válido',
  })
  @ApiProduces('image/jpeg')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async photo(@Param('token') token: string) {
    return new StreamableFile(await this.photos.load(token), {
      type: 'image/jpeg',
    });
  }

  @Public()
  @Get(':token')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Consultar termo individual de autorização de visitante',
  })
  @ApiOkResponse({ type: VisitorApprovalPreviewDto })
  preview(@Param('token') token: string) {
    return this.approvals.preview(token);
  }

  @Public()
  @Post(':token/accept')
  @ApiOperation({
    summary: 'Aceitar termo com confirmação do CPF do destinatário',
  })
  @ApiOkResponse({ type: VisitorApprovalResultDto })
  accept(@Param('token') token: string, @Body() dto: AcceptVisitorApprovalDto) {
    return this.approvals.accept(token, dto);
  }

  @Public()
  @Post(':token/revoke')
  @ApiOperation({ summary: 'Revogar o próprio aceite com confirmação do CPF' })
  @ApiOkResponse({ type: VisitorApprovalResultDto })
  revoke(@Param('token') token: string, @Body() dto: VisitorApprovalCpfDto) {
    return this.approvals.revokeOwn(token, dto.cpf);
  }
}
