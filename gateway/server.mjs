// Gateway de registro automático Intelbras.
// O leitor abre TCP até AUTOREG_PORT, envia POST /cgi-bin/api/autoRegist/connect
// e os CGIs voltam pelo mesmo socket. Credenciais só em memória, por comando.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const AUTOREG_PORT = Number(process.env.AUTOREG_PORT ?? 7070);
const CONTROL_PORT = Number(process.env.CONTROL_PORT ?? 8090);
const CONTROL_TOKEN = process.env.CONTROL_TOKEN ?? '';
const KEEPALIVE_SEC = Number(process.env.GATEWAY_KEEPALIVE_SEC ?? 20);
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_CONTROL_BODY = 8 * 1024 * 1024;

if (!CONTROL_TOKEN || CONTROL_TOKEN.length < 16) {
  console.error('CONTROL_TOKEN ausente ou curto demais');
  process.exit(1);
}

function log(...parts) {
  const text = parts
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ');
  console.log(`${new Date().toISOString()} ${text}`);
}

function parseHead(head) {
  const [startLine, ...lines] = head.split('\r\n');
  const headers = {};
  const headerList = [];
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    headers[key] = value;
    headerList.push([key, value]);
  }
  return { startLine, headers, headerList };
}

function tryParseMessage(buf) {
  const headerEnd = buf.indexOf('\r\n\r\n');
  if (headerEnd < 0) return null;
  const { startLine, headers, headerList } = parseHead(
    buf.subarray(0, headerEnd).toString('latin1'),
  );
  const bodyStart = headerEnd + 4;
  let body;
  let consumed;

  if ((headers['transfer-encoding'] ?? '').toLowerCase().includes('chunked')) {
    const chunks = [];
    let p = bodyStart;
    for (;;) {
      const lineEnd = buf.indexOf('\r\n', p);
      if (lineEnd < 0) return null;
      const size = parseInt(
        buf.subarray(p, lineEnd).toString('latin1').split(';')[0],
        16,
      );
      if (Number.isNaN(size)) throw new Error('chunk inválido');
      const dataStart = lineEnd + 2;
      if (size === 0) {
        if (buf.length < dataStart + 2) return null;
        consumed = dataStart + 2;
        break;
      }
      if (buf.length < dataStart + size + 2) return null;
      chunks.push(buf.subarray(dataStart, dataStart + size));
      p = dataStart + size + 2;
    }
    body = Buffer.concat(chunks);
  } else {
    const length = Number(headers['content-length'] ?? 0);
    if (buf.length < bodyStart + length) return null;
    body = buf.subarray(bodyStart, bodyStart + length);
    consumed = bodyStart + length;
  }

  const isResponse = startLine.startsWith('HTTP/');
  const [a, b] = startLine.split(' ');
  return {
    consumed,
    msg: {
      isResponse,
      status: isResponse ? Number(b) : undefined,
      method: isResponse ? undefined : a,
      path: isResponse ? undefined : b,
      headers,
      headerList,
      body: Buffer.from(body),
    },
  };
}

function frame(startLine, headers, body) {
  const lines = [startLine];
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'content-length') continue;
    lines.push(`${k}: ${v}`);
  }
  lines.push(`Content-Length: ${body.length}`);
  return Buffer.concat([Buffer.from(`${lines.join('\r\n')}\r\n\r\n`), body]);
}

const hash = (algo, s) => crypto.createHash(algo).update(s).digest('hex');
let nonceCount = 0;

function parseChallenge(value) {
  const params = {};
  const re = /(\w+)=("([^"]*)"|[^,\s]+)/g;
  let m;
  while ((m = re.exec(value))) params[m[1].toLowerCase()] = m[3] ?? m[2];
  return params;
}

function buildAuthorization(headerList, method, uri, username, password) {
  const challenges = headerList
    .filter(([k]) => k === 'www-authenticate')
    .map(([, v]) => v);
  const digest = challenges.find((c) => /^Digest/i.test(c));
  if (!digest) {
    if (challenges.some((c) => /^Basic/i.test(c))) {
      return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }
    return null;
  }
  const c = parseChallenge(digest.slice(6));
  const algorithm = c.algorithm ?? 'MD5';
  const algo = algorithm.toUpperCase().startsWith('SHA-256') ? 'sha256' : 'md5';
  const ha1 = hash(algo, `${username}:${c.realm}:${password}`);
  const ha2 = hash(algo, `${method}:${uri}`);
  const qop = c.qop?.split(',').map((s) => s.trim()).includes('auth')
    ? 'auth'
    : undefined;
  const nc = (++nonceCount).toString(16).padStart(8, '0');
  const cnonce = crypto.randomBytes(8).toString('hex');
  const response = qop
    ? hash(algo, `${ha1}:${c.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(algo, `${ha1}:${c.nonce}:${ha2}`);
  let header =
    `Digest username="${username}", realm="${c.realm}", ` +
    `nonce="${c.nonce}", uri="${uri}", algorithm=${algorithm}, response="${response}"`;
  if (c.opaque) header += `, opaque="${c.opaque}"`;
  if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  return header;
}

const connections = new Map();
const credsByDevice = new Map();
let nextConnId = 1;

function findConn(deviceId) {
  return [...connections.values()]
    .filter((c) => c.device?.DeviceID === String(deviceId))
    .at(-1);
}

function replyToDevice(conn, status, body = '') {
  conn.socket.write(
    frame(
      `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Error'}`,
      { Connection: 'keep-alive', 'Content-Type': 'application/json' },
      Buffer.from(body),
    ),
  );
}

function pump(conn) {
  if (conn.inflight || conn.queue.length === 0 || conn.socket.destroyed) return;
  const item = conn.queue.shift();
  const { method, path, headers = {}, body, quiet } = item.req;
  const payload =
    body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body);
  const host = (conn.socket.remoteAddress ?? '').replace('::ffff:', '');
  item.timer = setTimeout(() => {
    if (conn.inflight !== item) return;
    conn.inflight = null;
    log(`[conn ${conn.id}] timeout ${method} ${path}`);
    item.reject(new Error(`timeout ${method} ${path}`));
    pump(conn);
  }, REQUEST_TIMEOUT_MS);
  conn.inflight = item;
  if (!quiet) log(`[conn ${conn.id}] -> ${method} ${path} (${payload.length}B)`);
  conn.socket.write(
    frame(
      `${method} ${path} HTTP/1.1`,
      { Host: host, Connection: 'keep-alive', ...headers },
      payload,
    ),
  );
}

function enqueue(conn, req) {
  return new Promise((resolve, reject) => {
    conn.queue.push({ req, resolve, reject });
    pump(conn);
  });
}

async function deviceRequest(conn, { method, path, headers = {}, body, quiet }) {
  const creds = conn.creds;
  const withToken = { ...headers };
  if (conn.token) withToken['X-cgi-token'] = conn.token;
  let res = await enqueue(conn, { method, path, headers: withToken, body, quiet });
  if (res.status === 401 && creds) {
    const authorization = buildAuthorization(
      res.headerList,
      method,
      path,
      creds.username,
      creds.password,
    );
    if (authorization) {
      res = await enqueue(conn, {
        method,
        path,
        headers: { ...withToken, Authorization: authorization },
        body,
        quiet,
      });
    }
  }
  if (!quiet || res.status !== 200) {
    log(`[conn ${conn.id}] <- ${res.status} ${method} ${path} (${res.body.length}B)`);
  }
  return res;
}

function extractToken(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed.Token ?? parsed.token ?? parsed.params?.Token;
  } catch {
    return /"?Token"?\s*[:=]\s*"?([\w\-+/=]+)/i.exec(text)?.[1];
  }
}

function stopKeepAlive(conn) {
  if (conn.keepAliveTimer) {
    clearInterval(conn.keepAliveTimer);
    conn.keepAliveTimer = null;
  }
}

async function login(conn) {
  if (!conn.creds) throw new Error('sem credenciais para login');
  stopKeepAlive(conn);
  conn.token = null;
  const res = await deviceRequest(conn, {
    method: 'POST',
    path: '/cgi-bin/api/global/login',
    body: '',
  });
  const token = res.status === 200 ? extractToken(res.body.toString('utf8')) : undefined;
  if (!token) {
    throw new Error(`login falhou: HTTP ${res.status}`);
  }
  conn.token = token;
  log(`[conn ${conn.id}] login ok device=${conn.device?.DeviceID ?? '?'}`);
  conn.keepAliveTimer = setInterval(() => {
    deviceRequest(conn, {
      method: 'POST',
      path: '/cgi-bin/api/global/keep-alive',
      body: '',
      quiet: true,
    }).catch((err) => {
      log(`[conn ${conn.id}] keep-alive falhou: ${err.message}`);
    });
  }, KEEPALIVE_SEC * 1000);
  if (typeof conn.keepAliveTimer.unref === 'function') conn.keepAliveTimer.unref();
}

function rememberCreds(deviceId, creds) {
  credsByDevice.set(deviceId, creds);
}

async function ensureLogin(conn, creds) {
  const changed =
    !conn.creds ||
    conn.creds.username !== creds.username ||
    conn.creds.password !== creds.password;
  conn.creds = creds;
  if (conn.device?.DeviceID) rememberCreds(conn.device.DeviceID, creds);
  if (changed || !conn.token) await login(conn);
}

function handleDeviceRequest(conn, msg) {
  const path = (msg.path ?? '').split('?')[0];
  if (path.endsWith('/cgi-bin/api/autoRegist/connect')) {
    let info = {};
    try {
      info = JSON.parse(msg.body.toString('utf8'));
    } catch {
      info = {};
    }
    const deviceId = String(info.DeviceID ?? '');
    conn.device = {
      DevClass: info.DevClass ?? null,
      DeviceID: deviceId,
      ServerIP: info.ServerIP ?? null,
      registeredAt: new Date().toISOString(),
    };
    for (const other of connections.values()) {
      if (other !== conn && other.device?.DeviceID === deviceId && deviceId) {
        log(`[conn ${other.id}] substituída por conn ${conn.id} (${deviceId})`);
        other.socket.destroy();
      }
    }
    replyToDevice(conn, 200, '{}');
    log(`[conn ${conn.id}] registrado ${deviceId || '?'}`);
    const cached = deviceId ? credsByDevice.get(deviceId) : undefined;
    if (cached) {
      setTimeout(() => {
        ensureLogin(conn, cached).catch((err) => {
          log(`[conn ${conn.id}] auto-login falhou: ${err.message}`);
        });
      }, 300);
    }
    return;
  }
  replyToDevice(conn, 200, '{}');
}

function onSocketData(conn, chunk) {
  conn.lastRxAt = new Date().toISOString();
  conn.buf = Buffer.concat([conn.buf, chunk]);
  for (;;) {
    const parsed = tryParseMessage(conn.buf);
    if (!parsed) break;
    conn.buf = conn.buf.subarray(parsed.consumed);
    const msg = parsed.msg;
    if (msg.isResponse) {
      const item = conn.inflight;
      if (!item) continue;
      clearTimeout(item.timer);
      conn.inflight = null;
      item.resolve(msg);
      pump(conn);
    } else {
      try {
        handleDeviceRequest(conn, msg);
      } catch (err) {
        log(`[conn ${conn.id}] erro ao tratar request: ${err.message}`);
      }
    }
  }
}

function attachSocket(socket) {
  const conn = {
    id: nextConnId++,
    socket,
    remote: `${socket.remoteAddress}:${socket.remotePort}`,
    connectedAt: new Date().toISOString(),
    lastRxAt: new Date().toISOString(),
    buf: Buffer.alloc(0),
    queue: [],
    inflight: null,
    device: null,
    token: null,
    creds: null,
    keepAliveTimer: null,
  };
  connections.set(conn.id, conn);
  log(`[conn ${conn.id}] conectado de ${conn.remote}`);
  socket.on('data', (chunk) => {
    try {
      onSocketData(conn, chunk);
    } catch (err) {
      log(`[conn ${conn.id}] parse: ${err.message}`);
      socket.destroy();
    }
  });
  socket.on('close', () => {
    stopKeepAlive(conn);
    connections.delete(conn.id);
    log(`[conn ${conn.id}] fechado ${conn.device?.DeviceID ?? ''}`);
  });
  socket.on('error', (err) => {
    log(`[conn ${conn.id}] socket: ${err.message}`);
  });
}

function tokenOk(header) {
  const presented = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(presented);
  const b = Buffer.from(CONTROL_TOKEN);
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_CONTROL_BODY) {
        reject(Object.assign(new Error('body grande demais'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': body.length,
  });
  res.end(body);
}

async function handleCgi(deviceId, raw) {
  let input;
  try {
    input = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('JSON inválido'), { status: 400 });
  }
  const method = String(input.method ?? 'GET').toUpperCase();
  const path = String(input.path ?? '');
  if (!path.startsWith('/cgi-bin/')) {
    throw Object.assign(new Error('path deve começar com /cgi-bin/'), { status: 400 });
  }
  const username = String(input.credentials?.username ?? '').trim();
  const password = String(input.credentials?.password ?? '');
  if (!username || !password) {
    throw Object.assign(new Error('credentials.username e password são obrigatórios'), {
      status: 400,
    });
  }
  const conn = findConn(deviceId);
  if (!conn) {
    throw Object.assign(new Error('dispositivo não conectado'), { status: 404 });
  }
  await ensureLogin(conn, { username, password });
  const isObject = input.body != null && typeof input.body === 'object';
  const headers = { ...(input.headers ?? {}) };
  if (isObject) headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  const res = await deviceRequest(conn, {
    method,
    path,
    headers,
    body: isObject ? JSON.stringify(input.body) : (input.body ?? ''),
  });
  return {
    status: res.status,
    headers: res.headers,
    body: res.body.toString('utf8'),
  };
}

async function onControl(req, res) {
  try {
    const url = new URL(req.url ?? '/', 'http://gateway.local');
    if (!tokenOk(req.headers.authorization)) {
      sendJson(res, 401, { error: 'não autorizado' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/devices') {
      sendJson(res, 200, {
        devices: [...connections.values()]
          .filter((c) => c.device?.DeviceID)
          .map((c) => ({
            deviceId: c.device.DeviceID,
            devClass: c.device.DevClass,
            remote: c.remote,
            connectedAt: c.connectedAt,
            lastRxAt: c.lastRxAt,
            loggedIn: Boolean(c.token),
          })),
      });
      return;
    }
    const match = /^\/devices\/([^/]+)\/cgi$/.exec(url.pathname);
    if (req.method === 'POST' && match) {
      const raw = await readBody(req);
      const result = await handleCgi(decodeURIComponent(match[1]), raw);
      sendJson(res, 200, result);
      return;
    }
    sendJson(res, 404, { error: 'não encontrado' });
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) log(`controle: ${err.message}`);
    sendJson(res, status, { error: err.message ?? 'erro' });
  }
}

const tcp = net.createServer(attachSocket);
tcp.listen(AUTOREG_PORT, '0.0.0.0', () => {
  log(`auto-registro escutando em 0.0.0.0:${AUTOREG_PORT}`);
});

const certPath = process.env.GATEWAY_TLS_CERT;
const keyPath = process.env.GATEWAY_TLS_KEY;
const control =
  certPath && keyPath
    ? https.createServer(
        { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
        onControl,
      )
    : http.createServer(onControl);
control.listen(CONTROL_PORT, '0.0.0.0', () => {
  log(
    `controle ${certPath && keyPath ? 'https' : 'http'} em 0.0.0.0:${CONTROL_PORT}`,
  );
});
