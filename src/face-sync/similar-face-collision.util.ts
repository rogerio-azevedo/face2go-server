const FACE_ID_KEYS = new Set([
  'employeeno',
  'employeenostring',
  'fpid',
  'userid',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function parseFaceId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function collectFaceIds(node: unknown, into: Set<number>, depth: number): void {
  if (depth > 8 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) collectFaceIds(item, into, depth + 1);
    return;
  }
  const record = asRecord(node);
  if (!record) return;
  for (const [key, value] of Object.entries(record)) {
    if (FACE_ID_KEYS.has(key.toLowerCase())) {
      const id = parseFaceId(value);
      if (id != null) into.add(id);
    }
    collectFaceIds(value, into, depth + 1);
  }
}

function responseBodies(error: unknown): unknown[] {
  const bodies: unknown[] = [];
  let node: unknown = error;
  for (let i = 0; i < 6 && node; i++) {
    if (node && typeof node === 'object' && 'response' in node) {
      const data = (node as { response?: { data?: unknown } }).response?.data;
      if (data !== undefined) bodies.push(data);
    }
    node =
      node instanceof Error && 'cause' in node
        ? (node as Error & { cause?: unknown }).cause
        : undefined;
  }
  return bodies;
}

/** Id de outra pessoa no corpo do erro, quando o firmware manda. */
export function extractCollidingFaceId(
  error: unknown,
  excludeFaceId?: number,
): number | null {
  const ids = new Set<number>();
  for (const body of responseBodies(error)) {
    collectFaceIds(body, ids, 0);
  }
  if (excludeFaceId != null) ids.delete(excludeFaceId);
  const [first] = ids;
  return first ?? null;
}

export function withCollidingPerson(
  readerMessage: string,
  person: { faceId: number; name?: string | null },
): string {
  const name = person.name?.trim();
  const who = name
    ? `${name} (ID leitor ${person.faceId})`
    : `ID leitor ${person.faceId}`;
  const note = `Coincide com ${who}.`;
  if (readerMessage.includes(note)) return readerMessage;
  return `${readerMessage} ${note}`;
}
