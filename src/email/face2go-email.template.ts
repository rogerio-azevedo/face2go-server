import { join } from 'node:path';

export function escapeEmailHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Cabeçalho e rodapé compartilhados dos e-mails institucionais. */
export function face2goEmail(body: string, preheader: string) {
  const logoCid = 'face2go-logo';
  return {
    html: `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f6f8;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeEmailHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;">
        <tr><td style="background:#001b3d;padding:20px 28px;">
          <img src="cid:${logoCid}" alt="Face2Go" width="180" height="45" style="display:block;border:0;width:180px;height:45px;" />
        </td></tr>
        <tr><td style="background:#00c7b7;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a1a2e;">${body}</td></tr>
        <tr><td style="padding:20px 28px;background:#f4f6f8;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#607083;text-align:center;">
          <p style="margin:0 0 6px;">Gestão de cadastro e acesso com biometria</p>
          <p style="margin:0;"><a href="https://www.face2go.com.br" style="color:#00a899;text-decoration:none;">face2go.com.br</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    attachments: [
      {
        filename: 'face2go-white.png',
        path: join(__dirname, 'assets', 'face2go-white.png'),
        cid: logoCid,
      },
    ],
  };
}
