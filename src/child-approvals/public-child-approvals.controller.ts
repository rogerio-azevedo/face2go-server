import {
  Body,
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
  AcceptChildApprovalDto,
  ChildApprovalCpfDto,
  ChildApprovalPreviewDto,
  ChildApprovalResultDto,
} from '../validation/dto/child-approvals.dto';
import { ChildApprovalService } from './child-approval.service';
import { ChildApprovalPhotoService } from './child-approval-photo.service';

@ApiTags('child-approvals')
@Controller('child-approvals')
export class PublicChildApprovalsController {
  constructor(
    private readonly approvals: ChildApprovalService,
    private readonly photos: ChildApprovalPhotoService,
  ) {}

  @Public()
  @Get(':token/photo')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Ver miniatura do menor pelo link individual válido',
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
    summary: 'Consultar termo individual de autorização de menor',
  })
  @ApiOkResponse({ type: ChildApprovalPreviewDto })
  preview(@Param('token') token: string) {
    return this.approvals.preview(token);
  }

  @Public()
  @Post(':token/accept')
  @ApiOperation({
    summary: 'Aceitar termo com confirmação do CPF do destinatário',
  })
  @ApiOkResponse({ type: ChildApprovalResultDto })
  accept(@Param('token') token: string, @Body() dto: AcceptChildApprovalDto) {
    return this.approvals.accept(token, dto);
  }

  @Public()
  @Post(':token/revoke')
  @ApiOperation({ summary: 'Revogar o próprio aceite com confirmação do CPF' })
  @ApiOkResponse({ type: ChildApprovalResultDto })
  revoke(@Param('token') token: string, @Body() dto: ChildApprovalCpfDto) {
    return this.approvals.revokeOwn(token, dto.cpf);
  }
}
