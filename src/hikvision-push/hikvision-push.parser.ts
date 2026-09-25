import {
  normalizeHikvisionAccessEvent,
  parseHikvisionAlertStreamPart,
  type HikvisionAccessEvent,
} from '../integrations/hikvision';

export type HikvisionPushParsed = {
  event: HikvisionAccessEvent | null;
  jpeg: Buffer | null;
};

function isJpeg(buf: Buffer): boolean {
  return buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

function boundaryFromContentType(contentType: string | undefined): string | null {
  const match = /boundary="?([^";]+)"?/i.exec(contentType ?? '');
  const value = match?.[1]?.trim();
  return value || null;
}

function headerValue(headerText: string, name: string): string {
  const re = new RegExp(`^${name}:\\s*(.+)$`, 'im');
  return re.exec(headerText)?.[1]?.trim().split(';')[0]?.trim() ?? '';
}

function splitMultipart(
  raw: Buffer,
  boundary: string,
): { contentType: string; body: Buffer }[] {
  const marker = Buffer.from(`--${boundary}`);
  const parts: { contentType: string; body: Buffer }[] = [];
  let cursor = raw.indexOf(marker);
  while (cursor !== -1) {
    let start = cursor + marker.length;
    if (raw[start] === 45 && raw[start + 1] === 45) break;
    if (raw[start] === 13) start += 1;
    if (raw[start] === 10) start += 1;
    const next = raw.indexOf(marker, start);
    const slice = raw.subarray(start, next === -1 ? raw.length : next);
    const sep = slice.indexOf(Buffer.from('\r\n\r\n'));
    const sepLen = sep === -1 ? slice.indexOf(Buffer.from('\n\n')) : sep;
    const gap = sep === -1 ? 2 : 4;
    if (sepLen !== -1) {
      const headerText = slice.subarray(0, sepLen).toString('latin1');
      let body = slice.subarray(sepLen + (sep === -1 ? 2 : gap));
      if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) {
        body = body.subarray(0, body.length - 2);
      }
      parts.push({
        contentType: headerValue(headerText, 'Content-Type'),
        body,
      });
    }
    if (next === -1) break;
    cursor = next;
  }
  return parts;
}

function xmlTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const value = xml.match(re)?.[1]?.trim();
  return value || undefined;
}

function eventFromXml(xml: string): HikvisionAccessEvent | null {
  const minor = xmlTag(xml, 'subEventType') ?? xmlTag(xml, 'minor');
  const major = xmlTag(xml, 'majorEventType') ?? xmlTag(xml, 'major');
  return normalizeHikvisionAccessEvent({
    EventNotificationAlert: {
      eventType: xmlTag(xml, 'eventType'),
      dateTime: xmlTag(xml, 'dateTime'),
      AccessControllerEvent: {
        employeeNoString:
          xmlTag(xml, 'employeeNoString') ?? xmlTag(xml, 'employeeNo'),
        name: xmlTag(xml, 'name'),
        currentVerifyMode: xmlTag(xml, 'currentVerifyMode'),
        cardNo: xmlTag(xml, 'cardNo'),
        major,
        minor,
        serialNo: xmlTag(xml, 'serialNo'),
        userType: xmlTag(xml, 'userType'),
      },
    },
  });
}

function eventFromPart(contentType: string, body: Buffer): HikvisionAccessEvent | null {
  const text = body.toString('utf8').trim();
  if (!text) return null;
  if (text.startsWith('<') || contentType.includes('xml')) {
    return eventFromXml(text);
  }
  return parseHikvisionAlertStreamPart(body);
}

export function parseHikvisionPushBody(
  contentType: string | undefined,
  raw: Buffer,
): HikvisionPushParsed {
  const ct = (contentType ?? '').toLowerCase();
  const boundary = boundaryFromContentType(contentType);
  if (ct.includes('multipart') && boundary) {
    let event: HikvisionAccessEvent | null = null;
    let jpeg: Buffer | null = null;
    for (const part of splitMultipart(raw, boundary)) {
      const partType = part.contentType.toLowerCase();
      if (!jpeg && (partType.startsWith('image/') || isJpeg(part.body))) {
        jpeg = part.body;
        continue;
      }
      if (!event) {
        event = eventFromPart(partType, part.body);
      }
    }
    return { event, jpeg };
  }

  const text = raw.toString('utf8').trim();
  if (text.startsWith('<') || ct.includes('xml')) {
    return { event: eventFromXml(text), jpeg: null };
  }
  return { event: parseHikvisionAlertStreamPart(raw), jpeg: null };
}
