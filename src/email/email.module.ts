import { Module } from '@nestjs/common';

import { EmailService } from './email.service';
import { SesEmailSender } from './senders/ses-email.sender';
import { SmtpEmailSender } from './senders/smtp-email.sender';

@Module({
  providers: [EmailService, SmtpEmailSender, SesEmailSender],
  exports: [EmailService],
})
export class EmailModule {}
