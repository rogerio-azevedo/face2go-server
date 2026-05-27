import { Module } from '@nestjs/common';

import { ClientInviteLinksController } from './client-invite-links.controller';
import { ClientInviteLinksService } from './client-invite-links.service';

@Module({
  controllers: [ClientInviteLinksController],
  providers: [ClientInviteLinksService],
})
export class ClientInviteLinksModule {}
