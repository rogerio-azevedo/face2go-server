import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { InviteLinksService } from './invite-links.service';

@ApiTags('invite-links')
@Controller('invite-links')
export class InviteLinksController {
  constructor(private readonly inviteLinksService: InviteLinksService) {}

  @Public()
  @Get(':code')
  @ApiOperation({ summary: 'Pré-visualizar convite pelo código (público)' })
  preview(@Param('code') code: string) {
    return this.inviteLinksService.preview(code);
  }
}
