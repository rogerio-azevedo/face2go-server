import { Module } from '@nestjs/common';

import { CompanyUsersController } from './company-users.controller';
import { CompanyUsersService } from './company-users.service';

@Module({
  controllers: [CompanyUsersController],
  providers: [CompanyUsersService],
})
export class CompanyUsersModule {}
