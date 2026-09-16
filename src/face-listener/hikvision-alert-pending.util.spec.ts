import {
  applyHikvisionAlertPart,
  classifyHikvisionAlertPart,
  isHikvisionAlertFaceAccess,
} from './hikvision-alert-pending.util';
import type { HikvisionAccessEvent } from '../integrations/hikvision';

function faceEvent(
  overrides: Partial<HikvisionAccessEvent> = {},
): HikvisionAccessEvent {
  return {
    eventType: 'AccessControllerEvent',
    employeeNoString: '1',
    status: 1,
    similarity: 100,
    raw: {},
    ...overrides,
  };
}

describe('classifyHikvisionAlertPart', () => {
  it('classifica JSON, texto, imagem e o resto', () => {
    expect(classifyHikvisionAlertPart('application/json; charset=UTF-8')).toBe(
      'json',
    );
    expect(classifyHikvisionAlertPart('text/plain')).toBe('json');
    expect(classifyHikvisionAlertPart('image/jpeg')).toBe('image');
    expect(classifyHikvisionAlertPart('application/octet-stream')).toBe(
      'ignore',
    );
    expect(
      classifyHikvisionAlertPart(
        'application/octet-stream',
        Buffer.from([0xff, 0xd8, 0xff]),
      ),
    ).toBe('image');
  });
});

describe('applyHikvisionAlertPart', () => {
  const first = { id: 'a' };
  const second = { id: 'b' };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff]);

  it('evento sem pendente fica em hold', () => {
    expect(
      applyHikvisionAlertPart(null, { kind: 'event', event: first }),
    ).toEqual({
      flush: null,
      hold: { event: first, image: null },
    });
  });

  it('novo evento dá flush no pendente anterior', () => {
    const current = { event: first, image: null };
    expect(
      applyHikvisionAlertPart(current, { kind: 'event', event: second }),
    ).toEqual({
      flush: current,
      hold: { event: second, image: null },
    });
  });

  it('imagem casa com o pendente e dá flush imediato', () => {
    const current = { event: first, image: null };
    expect(
      applyHikvisionAlertPart(current, { kind: 'image', image: jpeg }),
    ).toEqual({
      flush: { event: first, image: jpeg },
      hold: null,
    });
  });

  it('imagem sem pendente é ignorada', () => {
    expect(
      applyHikvisionAlertPart(null, { kind: 'image', image: jpeg }),
    ).toEqual({
      flush: null,
      hold: null,
    });
  });
});

describe('isHikvisionAlertFaceAccess', () => {
  it('aceita reconhecimento com similaridade e status liberado', () => {
    expect(isHikvisionAlertFaceAccess(faceEvent())).toBe(true);
  });

  it('rejeita heartbeat sem employeeNo', () => {
    expect(
      isHikvisionAlertFaceAccess(faceEvent({ employeeNoString: undefined })),
    ).toBe(false);
  });

  it('rejeita status diferente de 1', () => {
    expect(isHikvisionAlertFaceAccess(faceEvent({ status: 0 }))).toBe(false);
  });

  it('rejeita similaridade zero', () => {
    expect(isHikvisionAlertFaceAccess(faceEvent({ similarity: 0 }))).toBe(
      false,
    );
  });

  it('aceita evento sem status/similarity (defaults do VideoEvent)', () => {
    expect(
      isHikvisionAlertFaceAccess(
        faceEvent({ status: undefined, similarity: undefined }),
      ),
    ).toBe(true);
  });
});
