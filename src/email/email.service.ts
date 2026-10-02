import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';

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

  async sendReaderOfflineEmail(
    to: string,
    adminName: string | null,
    readerName: string,
    clientName: string,
    detectedAt: Date,
  ): Promise<void> {
    const greeting = adminName?.trim() ? `Olá, ${adminName.trim()}` : 'Olá';
    const when = detectedAt.toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    });
    const dashboardUrl = `${this.frontendUrl}/client/dashboard`;

    if (!this.sender.isConfigured()) {
      this.logger.warn(
        `[${this.sender.provider.toUpperCase()} desabilitado] Leitor "${readerName}" offline em ${clientName} — destinatário ${to}`,
      );
      return;
    }

    const subject = `Face2Go — leitor "${readerName}" está offline`;
    const text = `${greeting},

O leitor facial "${readerName}" do cliente ${clientName} ficou offline.

Detectado em: ${when}

Acesse o painel para acompanhar o status:
${dashboardUrl}

Equipe Face2Go`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a2e;">
  <p>${greeting},</p>
  <p>O leitor facial <strong>${escapeHtml(readerName)}</strong> do cliente <strong>${escapeHtml(clientName)}</strong> ficou offline.</p>
  <p style="font-size:14px;color:#666;">Detectado em: ${escapeHtml(when)}</p>
  <p>
    <a href="${dashboardUrl}" style="display:inline-block;padding:12px 24px;background:#00c7b7;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
      Abrir painel
    </a>
  </p>
  <p>Equipe Face2Go</p>
</body>
</html>`;

    await this.sender.send({ to, subject, text, html });
    this.logger.log(
      `E-mail de leitor offline enviado para ${to} (leitor="${readerName}")`,
    );
  }

  async sendBlockedAttemptEmail(
    to: string,
    adminName: string | null,
    personName: string,
    blockReason: string | null,
    readerName: string,
    clientName: string,
    eventDate: Date | null,
  ): Promise<void> {
    const greeting = adminName?.trim() ? `Olá, ${adminName.trim()}` : 'Olá';
    const when = (eventDate ?? new Date()).toLocaleString('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    });
    const dashboardUrl = `${this.frontendUrl}/client/dashboard`;
    const reason = blockReason?.trim() || 'Não informado';

    if (!this.sender.isConfigured()) {
      this.logger.warn(
        `[${this.sender.provider.toUpperCase()} desabilitado] Tentativa bloqueada de "${personName}" no leitor "${readerName}" — destinatário ${to}`,
      );
      return;
    }

    const subject = `Face2Go — tentativa de acesso de pessoa bloqueada`;
    const text = `${greeting},

Uma pessoa bloqueada tentou acessar o leitor "${readerName}" (${clientName}).

Pessoa: ${personName}
Motivo do bloqueio: ${reason}
Quando: ${when}

A porta não foi aberta.

${dashboardUrl}

Equipe Face2Go`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a2e;">
  <p>${greeting},</p>
  <p>Uma pessoa bloqueada tentou acessar o leitor <strong>${escapeHtml(readerName)}</strong> (${escapeHtml(clientName)}).</p>
  <p><strong>Pessoa:</strong> ${escapeHtml(personName)}<br/>
  <strong>Motivo do bloqueio:</strong> ${escapeHtml(reason)}<br/>
  <strong>Quando:</strong> ${escapeHtml(when)}</p>
  <p>A porta não foi aberta.</p>
  <p>
    <a href="${dashboardUrl}" style="display:inline-block;padding:12px 24px;background:#00c7b7;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
      Abrir painel
    </a>
  </p>
  <p>Equipe Face2Go</p>
</body>
</html>`;

    await this.sender.send({ to, subject, text, html });
    this.logger.log(
      `E-mail de tentativa bloqueada enviado para ${to} (pessoa="${personName}")`,
    );
  }

  async sendRegistrationApprovedEmail(params: {
    to: string;
    name: string | null | undefined;
    clientName: string;
  }): Promise<void> {
    const { to, name, clientName } = params;
    const greeting = name?.trim() ? `Olá, ${name.trim()}` : 'Olá';
    const place = clientName.trim() || 'seu local';

    if (!this.sender.isConfigured()) {
      this.logger.warn(
        `[${this.sender.provider.toUpperCase()} desabilitado] Cadastro aprovado em ${place} — destinatário ${to}`,
      );
      return;
    }

    const subject = 'Face2Go — cadastro aprovado';
    const siteUrl = 'https://www.face2go.com.br';
    const logoCid = 'face2go-logo';
    const text = `${greeting},

Seu cadastro em ${place} foi aprovado.

O acesso facial já pode ser usado.

Equipe Face2Go

${siteUrl}`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#f4f6f8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;">
          <tr>
            <td style="background:#001b3d;padding:20px 28px;">
              <img src="cid:${logoCid}" alt="Face2Go" width="180" height="45" style="display:block;border:0;width:180px;height:45px;" />
            </td>
          </tr>
          <tr>
            <td style="background:#00c7b7;height:4px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a1a2e;">
              <p style="margin:0 0 16px;">${escapeHtml(greeting)},</p>
              <p style="margin:0 0 16px;">Seu cadastro em <strong>${escapeHtml(place)}</strong> foi aprovado.</p>
              <p style="margin:0 0 16px;">O acesso facial já pode ser usado.</p>
              <p style="margin:0;">Equipe Face2Go</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px;background:#f4f6f8;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#607083;text-align:center;">
              <p style="margin:0 0 6px;">Gestão de cadastro e acesso com biometria</p>
              <p style="margin:0;"><a href="${siteUrl}" style="color:#00c7b7;text-decoration:none;">face2go.com.br</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    await this.sender.send({
      to,
      subject,
      text,
      html,
      attachments: [
        {
          filename: 'face2go-white.png',
          path: join(__dirname, 'assets', 'face2go-white.png'),
          cid: logoCid,
        },
      ],
    });
    this.logger.log(
      `E-mail de cadastro aprovado enviado para ${to} (cliente="${place}")`,
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
