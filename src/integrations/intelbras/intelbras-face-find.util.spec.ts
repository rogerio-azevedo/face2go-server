import { intelbrasFaceFindIndicatesExists } from './intelbras-face-find.util';

describe('intelbrasFaceFindIndicatesExists', () => {
  it('Total > 0 no JSON', () => {
    expect(intelbrasFaceFindIndicatesExists({ Total: 1 })).toBe(true);
    expect(intelbrasFaceFindIndicatesExists({ Total: 0 })).toBe(false);
  });

  it('Total= / found= no CGI texto', () => {
    expect(intelbrasFaceFindIndicatesExists('Total=2\r\nfound=2')).toBe(true);
    expect(intelbrasFaceFindIndicatesExists('found=1\n')).toBe(true);
    expect(intelbrasFaceFindIndicatesExists('Total=0')).toBe(false);
  });

  it('payload vazio ou irrelevante', () => {
    expect(intelbrasFaceFindIndicatesExists(undefined)).toBe(false);
    expect(intelbrasFaceFindIndicatesExists('ok')).toBe(false);
  });
});
