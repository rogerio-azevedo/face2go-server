import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: SESClient | null;
  private readonly fromEmail: string | null;
  private readonly frontendUrl: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );
    const fromEmail = this.configService.get<string>('SES_FROM_EMAIL');
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');

    this.frontendUrl = frontendUrl?.replace(/\/$/, '') ?? '';

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
    this.logger.warn(
      'SES não configurado (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SES_FROM_EMAIL). ' +
        'Links de redefinição de senha serão logados no console.',
    );
  }

  async sendPasswordResetEmail(
    to: string,
    name: string | null | undefined,
    token: string,
  ): Promise<void> {
    const resetUrl = `${this.frontendUrl}/redefinir-senha?token=${encodeURIComponent(token)}`;
    const greeting = name?.trim() ? `Olá, ${name.trim()}` : 'Olá';

    if (!this.client || !this.fromEmail) {
      this.logger.warn(
        `[SES desabilitado] Link de redefinição para ${to}: ${resetUrl}`,
      );
      return;
    }

    const subject = 'Face2Go — redefinir sua senha';
    const text = `${greeting},

Recebemos uma solicitação para redefinir a senha da sua conta Face2Go.

Acesse o link abaixo para criar uma nova senha (válido por 1 hora):
${resetUrl}

Se você não solicitou esta alteração, ignore este e-mail.

Equipe Face2Go`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a2e;">
  <p>${greeting},</p>
  <p>Recebemos uma solicitação para redefinir a senha da sua conta Face2Go.</p>
  <p>
    <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#00c7b7;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
      Redefinir senha
    </a>
  </p>
  <p style="font-size:14px;color:#666;">Ou copie e cole este link no navegador:<br><a href="${resetUrl}">${resetUrl}</a></p>
  <p style="font-size:14px;color:#666;">Este link expira em 1 hora. Se você não solicitou esta alteração, ignore este e-mail.</p>
  <p>Equipe Face2Go</p>
</body>
</html>`;

    await this.client.send(
      new SendEmailCommand({
        Source: this.fromEmail,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: text, Charset: 'UTF-8' },
            Html: { Data: html, Charset: 'UTF-8' },
          },
        },
      }),
    );

    this.logger.log(`E-mail de redefinição de senha enviado para ${to}`);
  }
}
