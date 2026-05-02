import { Module } from '@nestjs/common';

import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { InviteLinksController } from './invite-links.controller';
import { InviteLinksService } from './invite-links.service';

@Module({
  controllers: [CompaniesController, InviteLinksController],
  providers: [CompaniesService, InviteLinksService],
})
export class CompaniesModule {}
