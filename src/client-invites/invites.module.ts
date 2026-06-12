import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FaceSyncModule } from '../face-sync/face-sync.module';
import { LprPlateSyncModule } from '../lpr-plate-sync/lpr-plate-sync.module';
import { SchoolAccessModule } from '../school-access/school-access.module';
import { StorageModule } from '../storage/storage.module';
import {
  InvitesClientController,
  InvitesMemberController,
} from './invites.controller';
import { InvitesService } from './invites.service';
import { PublicInviteRegisterController } from './public-invite-register.controller';
import { PublicInviteRegisterService } from './public-invite-register.service';

@Module({
  imports: [
    DatabaseModule,
    SchoolAccessModule,
    StorageModule,
    FaceSyncModule,
    LprPlateSyncModule,
  ],
  controllers: [
    InvitesClientController,
    InvitesMemberController,
    PublicInviteRegisterController,
  ],
  providers: [InvitesService, PublicInviteRegisterService],
  exports: [InvitesService],
})
export class ClientInvitesModule {}
