import { Module } from '@nestjs/common';

import { ClientUsersModule } from '../client-users/client-users.module';
import { ClientInviteLinksController } from './client-invite-links.controller';
import { ClientInviteLinksService } from './client-invite-links.service';

@Module({
  imports: [ClientUsersModule],
  controllers: [ClientInviteLinksController],
  providers: [ClientInviteLinksService],
})
export class ClientInviteLinksModule {}
