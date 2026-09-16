import { Module } from '@nestjs/common';

import { ClientUsersService } from './client-users.service';
import { CompanyClientUsersController } from './company-client-users.controller';

@Module({
  controllers: [CompanyClientUsersController],
  providers: [ClientUsersService],
  exports: [ClientUsersService],
})
export class ClientUsersModule {}
