import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { PublicInviteRegisterService } from './public-invite-register.service';

@ApiTags('public-invite-register')
@Controller('invite-register')
export class PublicInviteRegisterController {
  constructor(private readonly svc: PublicInviteRegisterService) {}

  @Public()
  @Get(':code')
  @ApiOperation({
    summary: 'Preview do convite de visitante para cadastro de face',
  })
  preview(@Param('code') code: string) {
    return this.svc.getPreview(code);
  }

  @Public()
  @Post(':code/upload-photo')
  @ApiOperation({ summary: 'Enviar foto do visitante (base64 via servidor)' })
  uploadPhoto(@Param('code') code: string, @Body() body: unknown) {
    return this.svc.uploadPhoto(code, body);
  }

  @Public()
  @Post(':code/submit')
  @ApiOperation({ summary: 'Confirmar envio da foto do visitante' })
  submit(@Param('code') code: string, @Body() body: unknown) {
    return this.svc.submit(code, body);
  }
}
