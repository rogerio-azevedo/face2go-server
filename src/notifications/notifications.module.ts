import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ReaderOfflineListener } from './reader-offline.listener';

@Module({
  imports: [DatabaseModule, EmailModule, RealtimeModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, ReaderOfflineListener],
})
export class NotificationsModule {}
