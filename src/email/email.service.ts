import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  EmailProvider,
  EmailSender,
} from './senders/email-sender.interface';
import { SesEmailSender } from './senders/ses-email.sender';
import { SmtpEmailSender } from './senders/smtp-email.sender';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly sender: EmailSender;
  private readonly frontendUrl: string;

  constructor(
    private readonly configService: ConfigService,
    smtpSender: SmtpEmailSender,
    sesSender: SesEmailSender,
  ) {
    const provider =
      this.configService.get<EmailProvider>('EMAIL_PROVIDER') ?? 'smtp';
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');

    this.frontendUrl = frontendUrl?.replace(/\/$/, '') ?? '';
    this.sender = provider === 'ses' ? sesSender : smtpSender;

    if (this.sender.isConfigured()) {
      this.logger.log(
        `Provedor de e-mail ativo: ${this.sender.provider.toUpperCase()}`,
      );
      return;
    }

    this.logger.warn(
      `Provedor ${this.sender.provider.toUpperCase()} selecionado (EMAIL_PROVIDER=${provider}), ` +
        'mas as credenciais estão incompletas. Links de redefinição de senha serão logados no console.',
    );
  }

  async sendPasswordResetEmail(
    to: string,
    name: string | null | undefined,
    token: string,
  ): Promise<void> {
    const resetUrl = `${this.frontendUrl}/redefinir-senha?token=${encodeURIComponent(token)}`;
    const greeting = name?.trim() ? `Olá, ${name.trim()}` : 'Olá';

    if (!this.sender.isConfigured()) {
      this.logger.warn(
        `[${this.sender.provider.toUpperCase()} desabilitado] Link de redefinição para ${to}: ${resetUrl}`,
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

    await this.sender.send({ to, subject, text, html });
    this.logger.log(`E-mail de redefinição de senha enviado para ${to}`);
  }
}
