// 기록·재생 API 프록시. 두 앱(order, WEB_RECODE)의 API 경로를 여기로 향하게 한다.
//
//   record: stage로 전달하고 응답을 카세트에 저장
//   replay: 카세트 응답만 반환. 없으면 502 + miss 기록 (stage로 절대 넘기지 않는다)
//   fill:   재생하되 카세트에 없는 GET만 stage에서 받아 채운다. 쓰기 요청은 채우지 않는다(miss).
//           후보 앱(WEB_RECODE)이 추가로 부르는 공통 API를 보충하는 용도. 루프 밖에서만 쓴다
//
// 제어 엔드포인트(/__parity/*)로 카세트·모드·세션을 전환하고 요청 로그를 읽는다.
// 실행: node proxy.mjs [--port 4000]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';

const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4000;
const UPSTREAM = process.env.PARITY_UPSTREAM ?? 'https://api.stage.koreatech.in';
const UPSTREAM_ORIGIN = process.env.PARITY_UPSTREAM_ORIGIN ?? 'https://stage.koreatech.in';

const FORWARDED_REQUEST_HEADERS = ['cookie', 'content-type', 'accept', 'authorization', 'x-csrf-token'];
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'set-cookie',
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-expose-headers',
  'vary',
  'date',
]);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// 앱에는 http://localhost:4000/stage 를 API 경로로 준다. WEB_RECODE의 IS_STAGE가 API 경로 문자열에
// 'stage'가 있는지로 쿠키 이름을 정하기 때문이다(*.localhost 호스트는 Node fetch가 해석하지 못한다).
const PATH_PREFIX = '/stage';

// 모든 모드에서 고정 응답을 주는 요청 (fixtures/_common.stubs.json). stage로 보내지 않고 epoch도 올리지 않는다
const STUBS_PATH = new URL('./fixtures/_common.stubs.json', import.meta.url);
const STUBS = existsSync(STUBS_PATH) ? JSON.parse(readFileSync(STUBS_PATH, 'utf8')).stubs : [];

const state = {
  mode: 'replay',
  cassettePath: null,
  cassette: { entries: [] },
  session: null,
  epoch: 0, // 세션 안에서 지금까지 본 쓰기 요청 수. 같은 GET도 쓰기 전후로 다른 응답을 가질 수 있다
  log: [],
};

function loadCassette(path) {
  if (!existsSync(path)) return { entries: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}

// 저장소가 공개라 카세트에 개인정보·인증 정보가 남으면 안 된다. 저장 시점에 가린다.
// 두 앱이 같은 가린 값을 받으므로 비교에는 영향이 없다. 글자 수·구분자는 유지해 레이아웃을 바꾸지 않는다
const SENSITIVE_KEY = /(phone|tel|account|email|token|password|student_number|login_id|refresh|session|csrf)/i;
const PHONE = /\b0\d{1,2}-?\d{3,4}-?\d{4}\b/g;
const maskChars = (v) => v.replace(/\d/g, '0').replace(/[A-Za-z]/g, 'x').replace(/[가-힣]/g, '가');

function scrub(value, key = '') {
  if (Array.isArray(value)) return value.map((v) => scrub(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
  if (typeof value === 'string') return SENSITIVE_KEY.test(key) ? maskChars(value) : value.replace(PHONE, (m) => maskChars(m));
  if (typeof value === 'number' && SENSITIVE_KEY.test(key)) return 0;
  return value;
}

function scrubResponse(response) {
  let body = response.body;
  try {
    const json = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
    body = Buffer.from(JSON.stringify(scrub(json))).toString('base64');
  } catch {
    // JSON이 아니면 그대로
  }
  const setCookie = response.setCookie.map((c) => c.replace(/^([^=]+)=[^;]*/, '$1=parity-dummy'));
  return { ...response, body, setCookie };
}

function saveCassette() {
  if (!state.cassettePath) return;
  mkdirSync(dirname(state.cassettePath), { recursive: true });
  const entries = [...state.cassette.entries]
    .sort((a, b) => (a.key + a.epoch).localeCompare(b.key + b.epoch))
    .map((e) => ({ ...e, request: { ...e.request, body: e.request.body ? JSON.stringify(scrub(safeJson(e.request.body))) : '' }, response: scrubResponse(e.response) }));
  writeFileSync(state.cassettePath, `${JSON.stringify({ entries }, null, 2)}\n`);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeQuery(searchParams) {
  return [...searchParams.entries()]
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

function canonicalBody(raw) {
  if (!raw || raw.length === 0) return '';
  const text = raw.toString('utf8');
  try {
    const sortKeys = (v) =>
      Array.isArray(v)
        ? v.map(sortKeys)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
          : v;
    return JSON.stringify(sortKeys(JSON.parse(text)));
  } catch {
    return text;
  }
}

function requestKey(method, pathname, query, body) {
  const bodyHash = body ? createHash('sha1').update(body).digest('hex').slice(0, 12) : '-';
  return `${method} ${pathname}?${query} #${bodyHash}`;
}

// Domain 제거 + Path=/ 강제 (src/pages/api/proxy 의 rewriteSetCookie 와 동일)
function rewriteSetCookie(raw) {
  return `${raw.replace(/;\s*Domain=[^;]*/gi, '').replace(/;\s*Path=[^;]*/gi, '')}; Path=/`;
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': '*',
    Vary: 'Origin',
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function sendJson(res, status, data, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
  res.end(JSON.stringify(data));
}

async function handleControl(req, res, url) {
  const body = await readBody(req);
  const input = body.length ? JSON.parse(body.toString('utf8')) : {};

  if (url.pathname === '/__parity/session' && req.method === 'POST') {
    if (state.mode !== 'replay') saveCassette();
    state.mode = input.mode ?? 'replay';
    state.cassettePath = input.cassette ?? null;
    state.cassette = state.cassettePath ? loadCassette(state.cassettePath) : { entries: [] };
    state.session = input.session ?? null;
    state.epoch = 0;
    state.log = [];
    return sendJson(res, 200, { ok: true, mode: state.mode, entries: state.cassette.entries.length });
  }
  if (url.pathname === '/__parity/log' && req.method === 'GET') {
    return sendJson(res, 200, { session: state.session, log: state.log });
  }
  if (url.pathname === '/__parity/flush' && req.method === 'POST') {
    if (state.mode !== 'replay') saveCassette();
    return sendJson(res, 200, { ok: true, entries: state.cassette.entries.length });
  }
  return sendJson(res, 404, { error: 'unknown control endpoint' });
}

async function forwardUpstream(req, url, body) {
  const headers = new Headers();
  FORWARDED_REQUEST_HEADERS.forEach((name) => {
    const v = req.headers[name];
    if (typeof v === 'string') headers.set(name, v);
  });
  headers.set('Origin', UPSTREAM_ORIGIN);
  headers.set('Referer', `${UPSTREAM_ORIGIN}/`);

  const upstream = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, {
    method: req.method,
    headers,
    body: MUTATING.has(req.method) && body.length ? body : undefined,
    redirect: 'manual',
  });
  const resHeaders = {};
  upstream.headers.forEach((v, k) => {
    if (!DROPPED_RESPONSE_HEADERS.has(k.toLowerCase())) resHeaders[k] = v;
  });
  return {
    status: upstream.status,
    headers: resHeaders,
    setCookie: upstream.headers.getSetCookie?.() ?? [],
    body: Buffer.from(await upstream.arrayBuffer()).toString('base64'),
  };
}

async function handleApi(req, res, url) {
  const body = MUTATING.has(req.method) ? await readBody(req) : Buffer.alloc(0);
  const canon = canonicalBody(body);
  const query = normalizeQuery(url.searchParams);
  const key = requestKey(req.method, url.pathname, query, canon);
  const source = req.headers['sec-fetch-mode'] ? 'client' : 'ssr';
  const epoch = state.epoch;

  const stub = STUBS.find((st) => st.method === req.method && st.path === url.pathname);
  if (stub) {
    state.log.push({ t: Date.now(), method: req.method, path: url.pathname, query, body: canon, source, epoch, status: stub.status, miss: false, stub: true });
    return sendJson(res, stub.status, stub.body, corsHeaders(req));
  }

  let response = null;
  let miss = false;

  const record = (res) => {
    const existing = state.cassette.entries.findIndex((e) => e.key === key && e.epoch === epoch);
    const entry = { key, epoch, request: { method: req.method, path: url.pathname, query, body: canon }, response: res };
    if (existing >= 0) state.cassette.entries[existing] = entry;
    else state.cassette.entries.push(entry);
  };
  let filled = false;

  // stage 응답은 받는 즉시 가린다: 기록 실행과 재생 실행이 같은 값을 보도록
  if (state.mode === 'record') {
    response = scrubResponse(await forwardUpstream(req, url, body));
    record(response);
  } else {
    const candidates = state.cassette.entries.filter((e) => e.key === key && e.epoch <= epoch);
    const hit = candidates.sort((a, b) => b.epoch - a.epoch)[0];
    if (hit) response = hit.response;
    else if (state.mode === 'fill' && req.method === 'GET') {
      response = scrubResponse(await forwardUpstream(req, url, body));
      record(response);
      filled = true;
    } else miss = true;
  }

  if (MUTATING.has(req.method)) state.epoch += 1;

  state.log.push({
    t: Date.now(),
    method: req.method,
    path: url.pathname,
    query,
    body: canon,
    source,
    epoch,
    status: miss ? 502 : response.status,
    miss,
    filled,
  });

  if (miss) {
    return sendJson(res, 502, { parity: 'miss', key, epoch }, corsHeaders(req));
  }

  const headers = { ...response.headers, ...corsHeaders(req) };
  if (response.setCookie.length) headers['Set-Cookie'] = response.setCookie.map(rewriteSetCookie);
  res.writeHead(response.status, headers);
  res.end(Buffer.from(response.body, 'base64'));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://proxy.local');
  try {
    if (url.pathname.startsWith('/__parity/')) return await handleControl(req, res, url);
    if (url.pathname === PATH_PREFIX || url.pathname.startsWith(`${PATH_PREFIX}/`)) {
      url.pathname = url.pathname.slice(PATH_PREFIX.length) || '/';
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders(req),
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }
    return await handleApi(req, res, url);
  } catch (error) {
    console.error('[parity-proxy]', error);
    return sendJson(res, 500, { parity: 'proxy-error', message: String(error) }, corsHeaders(req));
  }
}).listen(PORT, '::', () => {
  console.warn(`[parity-proxy] listening on :${PORT} (upstream ${UPSTREAM})`);
});

process.on('SIGTERM', () => {
  if (state.mode !== 'replay') saveCassette();
  process.exit(0);
});
