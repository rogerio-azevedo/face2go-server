import { parseHikvisionPushBody } from './hikvision-push.parser';

const faceJson = JSON.stringify({
  eventType: 'AccessControllerEvent',
  dateTime: '2026-09-25T13:40:00-04:00',
  AccessControllerEvent: {
    employeeNoString: '1',
    name: 'Otoniel',
    currentVerifyMode: 'face',
    major: 5,
    minor: 75,
    serialNo: 10,
  },
});

describe('parseHikvisionPushBody', () => {
  it('lê o JSON do acesso', () => {
    const parsed = parseHikvisionPushBody(
      'application/json',
      Buffer.from(faceJson),
    );
    expect(parsed.event?.employeeNoString).toBe('1');
    expect(parsed.event?.minor).toBe(75);
    expect(parsed.jpeg).toBeNull();
  });

  it('lê JSON e JPEG no multipart', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const raw = Buffer.concat([
      Buffer.from(
        `--bound\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(faceJson)}\r\n\r\n${faceJson}\r\n`,
      ),
      Buffer.from('--bound\r\nContent-Type: image/jpeg\r\n\r\n'),
      jpeg,
      Buffer.from('\r\n--bound--'),
    ]);
    const parsed = parseHikvisionPushBody(
      'multipart/form-data; boundary=bound',
      raw,
    );
    expect(parsed.event?.name).toBe('Otoniel');
    expect(parsed.jpeg?.equals(jpeg)).toBe(true);
  });

  it('lê o XML do acesso', () => {
    const xml = `<?xml version="1.0"?>
<EventNotificationAlert>
  <eventType>AccessControllerEvent</eventType>
  <dateTime>2026-09-25T13:40:00-04:00</dateTime>
  <AccessControllerEvent>
    <employeeNoString>1</employeeNoString>
    <majorEventType>5</majorEventType>
    <subEventType>75</subEventType>
    <currentVerifyMode>face</currentVerifyMode>
  </AccessControllerEvent>
</EventNotificationAlert>`;
    const parsed = parseHikvisionPushBody('application/xml', Buffer.from(xml));
    expect(parsed.event?.employeeNoString).toBe('1');
    expect(parsed.event?.minor).toBe(75);
  });
});
