import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { PublicResponsibleRegisterService } from './public-responsible-register.service';

@ApiTags('public-responsible-register')
@Controller('responsible-register')
export class PublicResponsibleRegisterController {
  constructor(private readonly svc: PublicResponsibleRegisterService) {}

  @Public()
  @Get(':code')
  @ApiOperation({ summary: 'Preview do convite de cadastro de responsável' })
  preview(@Param('code') code: string) {
    return this.svc.getPreview(code);
  }

  @Public()
  @Post(':code/upload-photo')
  @ApiOperation({ summary: 'Enviar foto do convidado (base64 via servidor)' })
  uploadPhoto(@Param('code') code: string, @Body() body: unknown) {
    return this.svc.uploadPhoto(code, body);
  }

  @Public()
  @Post(':code/submit')
  @ApiOperation({ summary: 'Confirmar cadastro completo do convidado' })
  submit(@Param('code') code: string, @Body() body: unknown) {
    return this.svc.submit(code, body);
  }
}
