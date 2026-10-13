import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import MailComposer from 'nodemailer/lib/mail-composer';
import { EmailService } from './email.service';
import type { EmailSendParams } from './senders/email-sender.interface';

describe('Child approval email', () => {
  it('inclui logo CID no MIME, botão do link individual e nomes escapados', async () => {
    const send = jest
      .fn<Promise<void>, [EmailSendParams]>()
      .mockResolvedValue(undefined);
    const sender = { provider: 'smtp', isConfigured: () => true, send };
    const email = new EmailService(
      new ConfigService({
        EMAIL_PROVIDER: 'smtp',
        FRONTEND_URL: 'https://app.example.test',
      }),
      sender as never,
      sender as never,
    );
    await email.sendChildApprovalRequestEmail({
      to: 'adult@example.test',
      adultName: '<Adulto>',
      childName: '<Menor>',
      clientName: 'Mercado & Condomínio',
      token: 'a'.repeat(64),
    });
    const payload = send.mock.calls[0][0];
    expect(payload.html).toContain('cid:face2go-logo');
    expect(payload.html).toContain('&lt;Menor&gt;');
    expect(payload.html).not.toContain('<Menor>');
    expect(payload.html).toContain(
      `href="https://app.example.test/autorizar-menor/${'a'.repeat(64)}"`,
    );
    expect(payload.html).toContain('Ver foto e revisar autorização');
    expect(readFileSync(payload.attachments![0].path).length).toBeGreaterThan(
      0,
    );
    const mime = await new MailComposer({
      from: 'noreply@example.test',
      ...payload,
    })
      .compile()
      .build();
    expect(mime.toString()).toContain('Content-ID: <face2go-logo>');
    expect(payload.text).toContain('CPF do seu cadastro');
  });
});
