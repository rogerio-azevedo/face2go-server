import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

import type { EmailSendParams, EmailSender } from './email-sender.interface';

@Injectable()
export class SmtpEmailSender implements EmailSender {
  readonly provider = 'smtp' as const;

  private readonly logger = new Logger(SmtpEmailSender.name);
  private readonly transporter: Transporter | null;
  private readonly fromEmail: string | null;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const fromEmail = this.configService.get<string>('SMTP_FROM_EMAIL');

    if (host && port && user && pass && fromEmail) {
      this.fromEmail = fromEmail;
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      return;
    }

    this.fromEmail = null;
    this.transporter = null;
  }

  isConfigured(): boolean {
    return this.transporter !== null && this.fromEmail !== null;
  }

  async send(params: EmailSendParams): Promise<void> {
    if (!this.transporter || !this.fromEmail) {
      throw new Error('SMTP não configurado');
    }

    await this.transporter.sendMail({
      from: this.fromEmail,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });

    this.logger.log(`E-mail enviado via SMTP para ${params.to}`);
  }
}
