function coerceHttpStatus(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.trunc(raw);
    return n >= 100 && n <= 599 ? n : undefined;
  }
  if (typeof raw === 'string') {
    const m = /^(\d{3})$/.exec(raw.trim());
    if (m) return parseInt(m[1], 10);
  }
  return undefined;
}

function walkErrorRoots(err: unknown): unknown[] {
  const out: unknown[] = [];
  const queue: unknown[] = [err];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === null || cur === undefined) continue;
    if (typeof cur !== 'object') {
      if (typeof cur === 'string') out.push(cur);
      continue;
    }
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);

    const cause = (cur as { cause?: unknown }).cause;
    if (cause !== undefined) queue.push(cause);

    if (cur instanceof AggregateError && Array.isArray(cur.errors)) {
      for (const nested of cur.errors) {
        queue.push(nested);
      }
    }
  }
  return out;
}

function httpStatusFromError(err: unknown): number | undefined {
  for (const node of walkErrorRoots(err)) {
    if (typeof node !== 'object' || node === null) continue;
    const r = node as {
      response?: { status?: unknown; statusCode?: unknown };
      status?: unknown;
      statusCode?: unknown;
    };
    const fromResp =
      coerceHttpStatus(r.response?.status) ??
      coerceHttpStatus(r.response?.statusCode);
    if (fromResp !== undefined) return fromResp;

    const top = coerceHttpStatus(r.status) ?? coerceHttpStatus(r.statusCode);
    if (top !== undefined) return top;
  }

  for (const node of walkErrorRoots(err)) {
    const raw =
      node instanceof Error
        ? node.message
        : typeof node === 'string'
          ? node
          : '';
    if (!raw) continue;
    const m = /status\s*(?:code)?\D{0,3}(\d{3})\b/i.exec(raw);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 100 && n <= 599) return n;
    }
  }

  return undefined;
}

function collectedMessages(err: unknown): string {
  return walkErrorRoots(err)
    .flatMap((n) =>
      n instanceof Error
        ? n.message
          ? [n.message]
          : []
        : typeof n === 'string'
          ? [n]
          : [],
    )
    .join(' ');
}

/** 401/403 ou texto Unauthorized — não confundir com “já existe no aparelho”. */
export function isUnauthorizedDeviceError(err: unknown): boolean {
  const http = httpStatusFromError(err);
  if (http === 401 || http === 403) return true;
  const lower = collectedMessages(err).toLowerCase();
  return (
    /\bunauthorized\b/.test(lower) ||
    lower.includes('credenciais inválidas') ||
    lower.includes('credenciais invalidas')
  );
}

/**
 * Se o CGI falhou por Unauthorized mas o equipamento já tem a pessoa/face,
 * trata como sucesso. Verify que também 401 (credencial realmente inválida)
 * devolve false e o chamador relança o erro original.
 */
export async function recoverUnauthorizedIfExists(
  err: unknown,
  checkExists: () => Promise<boolean>,
): Promise<boolean> {
  if (!isUnauthorizedDeviceError(err)) return false;
  try {
    return (await checkExists()) === true;
  } catch {
    return false;
  }
}
