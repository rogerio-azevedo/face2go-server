import {
  parseIntelbrasFirmwareDate,
  parseIntelbrasFirmwareLabel,
} from './intelbras-push.config.client';

describe('Intelbras software version parsers', () => {
  it('monta uma identificação legível com versão e build', () => {
    const raw = [
      'version.Version=V4.900.0000000.1.R',
      'version.BuildDate=2026-04-16',
    ].join('\n');

    expect(parseIntelbrasFirmwareLabel(raw)).toBe(
      'V4.900.0000000.1.R (2026-04-16)',
    );
    expect(parseIntelbrasFirmwareDate(raw)).toBe(20260416);
  });

  it('aceita o formato textual usado por firmwares antigos', () => {
    expect(
      parseIntelbrasFirmwareLabel('Version: 3.5.0\nbuild: 2025-06-25'),
    ).toBe('3.5.0 (2025-06-25)');
  });
});
