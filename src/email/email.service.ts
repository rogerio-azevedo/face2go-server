import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  escapeEmailHtml as escapeHtml,
  face2goEmail,
} from './face2go-email.template';

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

  async sendChildApprovalRequestEmail(params: {
    to: string;
    adultName: string | null;
    childName: string | null;
    clientName: string;
    token: string;
  }): Promise<void> {
    if (!this.sender.isConfigured() || !this.frontendUrl)
      throw new Error('Envio de autorizações indisponível.');
    const url = `${this.frontendUrl}/autorizar-menor/${params.token}`;
    const adultName = params.adultName?.trim() || 'morador';
    const childName = params.childName?.trim() || 'Um menor';
    const text = `Olá, ${adultName}.\n\n${childName}, da sua unidade, solicita autorização para acesso em ${params.clientName}.\n\nConfira a foto do menor, leia o termo e, se concordar, confirme com o CPF do seu cadastro:\n${url}\n\nAbrir o link não autoriza o acesso. O aceite é registrado somente após sua confirmação.\n\nEste link é individual. Guarde este e-mail: você também poderá usá-lo para consultar ou revogar seu aceite.\n\nEquipe Face2Go`;
    const branded = face2goEmail(
      `<h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;color:#001b3d;">Autorização de acesso de menor</h1>
      <p style="margin:0 0 16px;">Olá, ${escapeHtml(adultName)}.</p>
      <p style="margin:0 0 20px;">Um menor da sua unidade solicita sua autorização para acessar o local abaixo.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f4f6f8;border-radius:8px;">
        <tr><td style="padding:16px 20px;font-family:Arial,sans-serif;">
          <p style="margin:0 0 4px;font-size:13px;color:#607083;">Cadastro do menor</p>
          <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#001b3d;">${escapeHtml(childName)}</p>
          <p style="margin:0;font-size:14px;color:#607083;">${escapeHtml(params.clientName)}</p>
        </td></tr>
      </table>
      <p style="margin:0 0 20px;">Confira a foto, leia o termo e, se concordar, confirme com o <strong>CPF do seu cadastro</strong>.</p>
      <p style="margin:0 0 20px;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 22px;background:#001b3d;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Ver foto e revisar autorização</a></p>
      <p style="margin:0 0 20px;font-size:13px;color:#607083;">Abrir o link não autoriza o acesso. O aceite é registrado somente após sua confirmação.</p>
      <p style="margin:0 0 20px;font-size:14px;">Este link é individual. Guarde este e-mail para consultar ou revogar seu aceite quando precisar.</p>
      <p style="margin:0 0 20px;font-size:12px;color:#607083;word-break:break-all;">Se o botão não funcionar, copie este link para o navegador:<br /><a href="${escapeHtml(url)}" style="color:#006b65;">${escapeHtml(url)}</a></p>
      <p style="margin:0;">Equipe Face2Go</p>`,
      `Confira a foto e a solicitação de ${childName} em ${params.clientName}.`,
    );
    await this.sender.send({
      to: params.to,
      subject: 'Face2Go — autorização de acesso de menor',
      text,
      ...branded,
    });
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
    const text = `${greeting},

Seu cadastro em ${place} foi aprovado.

Após a atualização dos leitores, o acesso estará disponível conforme as regras do local.

Equipe Face2Go

${siteUrl}`;

    const branded = face2goEmail(
      `<p style="margin:0 0 16px;">${escapeHtml(greeting)},</p>
              <p style="margin:0 0 16px;">Seu cadastro em <strong>${escapeHtml(place)}</strong> foi aprovado.</p>
              <p style="margin:0 0 16px;">Após a atualização dos leitores, o acesso estará disponível conforme as regras do local.</p>
              <p style="margin:0;">Equipe Face2Go</p>`,
      `Seu cadastro em ${place} foi aprovado.`,
    );

    await this.sender.send({
      to,
      subject,
      text,
      ...branded,
    });
    this.logger.log(
      `E-mail de cadastro aprovado enviado para ${to} (cliente="${place}")`,
    );
  }
}
