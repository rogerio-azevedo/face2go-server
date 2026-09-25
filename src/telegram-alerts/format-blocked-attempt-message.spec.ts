import type { AccessBlockedAttemptPayload } from '../notifications/notifications.events';
import { formatBlockedAttemptMessage } from './format-blocked-attempt-message';

function payload(
  overrides: Partial<AccessBlockedAttemptPayload> = {},
): AccessBlockedAttemptPayload {
  return {
    accessId: 'access-1',
    faceId: 42,
    clientId: 'client-1',
    clientName: 'Mercado 24Hs',
    companyId: 'company-1',
    personName: 'Rogerio Azevedo',
    personId: 'person-1',
    personType: 'member',
    blockReason: 'Teste de Bloqueio',
    readerId: 'reader-1',
    readerName: 'Porta Entrada',
    readerDirection: 'in',
    eventDate: new Date('2026-09-25T20:32:00.000Z'),
    snapR2Key: null,
    ...overrides,
  };
}

describe('formatBlockedAttemptMessage', () => {
  it('monta o alerta visual em HTML', () => {
    const text = formatBlockedAttemptMessage(payload());

    expect(text).toContain('🔐 <b>ALERTA FACE2GO</b>');
    expect(text).toContain('⚠️ <b>Tentativa de acesso bloqueada</b>');
    expect(text).toContain('👤 <b>Pessoa:</b> Rogerio Azevedo');
    expect(text).toContain('🚫 <b>Motivo:</b> Teste de Bloqueio');
    expect(text).toContain('🚪 <b>Leitor:</b> Porta Entrada');
    expect(text).toContain('🏢 <b>Cliente:</b> Mercado 24Hs');
    expect(text).toMatch(/🕐 <b>Quando:<\/b> 25\/09\/2026,\s*17:32/);
  });

  it('usa Face {id} quando o nome está vazio', () => {
    expect(
      formatBlockedAttemptMessage(payload({ personName: '  ' })),
    ).toContain('👤 <b>Pessoa:</b> Face 42');
    expect(
      formatBlockedAttemptMessage(payload({ personName: null })),
    ).toContain('👤 <b>Pessoa:</b> Face 42');
  });

  it('usa motivo padrão e "agora" quando faltam dados', () => {
    const text = formatBlockedAttemptMessage(
      payload({ blockReason: '   ', eventDate: null }),
    );

    expect(text).toContain('🚫 <b>Motivo:</b> não informado');
    expect(text).toContain('🕐 <b>Quando:</b> agora');
  });

  it('escapa HTML nos valores', () => {
    const text = formatBlockedAttemptMessage(
      payload({
        personName: 'Ana <script>',
        blockReason: 'A & B',
        readerName: 'Porta > 1',
        clientName: 'Mercado & Cia',
      }),
    );

    expect(text).toContain('👤 <b>Pessoa:</b> Ana &lt;script&gt;');
    expect(text).toContain('🚫 <b>Motivo:</b> A &amp; B');
    expect(text).toContain('🚪 <b>Leitor:</b> Porta &gt; 1');
    expect(text).toContain('🏢 <b>Cliente:</b> Mercado &amp; Cia');
  });
});
