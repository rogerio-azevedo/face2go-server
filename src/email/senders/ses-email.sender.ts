import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EmailSendParams, EmailSender } from './email-sender.interface';

@Injectable()
export class SesEmailSender implements EmailSender {
  readonly provider = 'ses' as const;

  private readonly logger = new Logger(SesEmailSender.name);
  private readonly client: SESClient | null;
  private readonly fromEmail: string | null;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );
    const fromEmail = this.configService.get<string>('SES_FROM_EMAIL');

    if (region && accessKeyId && secretAccessKey && fromEmail) {
      this.fromEmail = fromEmail;
      this.client = new SESClient({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      return;
    }

    this.fromEmail = null;
    this.client = null;
  }

  isConfigured(): boolean {
    return this.client !== null && this.fromEmail !== null;
  }

  async send(params: EmailSendParams): Promise<void> {
    if (!this.client || !this.fromEmail) {
      throw new Error('SES não configurado');
    }

    await this.client.send(
      new SendEmailCommand({
        Source: this.fromEmail,
        Destination: { ToAddresses: [params.to] },
        Message: {
          Subject: { Data: params.subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: params.text, Charset: 'UTF-8' },
            Html: { Data: params.html, Charset: 'UTF-8' },
          },
        },
      }),
    );

    this.logger.log(`E-mail enviado via SES para ${params.to}`);
  }
}
