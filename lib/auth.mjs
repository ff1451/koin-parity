// 로그인 상태(states[].auth === 'auth') 픽스처.
//
// 기록(record/fill): stage 테스트 계정으로 실제 로그인해 받은 토큰·쿠키를 브라우저에 넣는다.
//   계정은 .cache/credentials.env 의 PARITY_TEST_USER_ID / PARITY_TEST_USER_PASSWORD (커밋하지 않음)
// 재생(replay): 형식만 맞는 더미 JWT(exp가 먼 미래)를 같은 이름으로 넣는다.
//   WEB_RECODE 서버는 access JWT의 exp만 보고 세션 API를 부르는데, 그 응답은 카세트에서 나오므로 진짜 토큰이 필요 없다.
//   order는 AUTH_TOKEN_KEY를 Bearer로 보내지만 프록시는 인증 헤더를 키에 넣지 않아 그대로 재생된다.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const UPSTREAM = process.env.PARITY_UPSTREAM ?? 'https://api.stage.koreatech.in';
const UPSTREAM_ORIGIN = process.env.PARITY_UPSTREAM_ORIGIN ?? 'https://stage.koreatech.in';

export const ORDER_TOKEN_COOKIE = 'AUTH_TOKEN_KEY';
export const WEB_ACCESS_COOKIE = '__Secure-koin-stage-web-access';
export const WEB_REFRESH_COOKIE = '__Secure-koin-stage-web-refresh';
export const WEB_CSRF_COOKIE = '__Secure-koin-stage-web-csrf';

const FAR_FUTURE_EXP = 4102444800; // 2100-01-01

function dummyJwt(kind) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: 'parity', kind, exp: FAR_FUTURE_EXP })}.parity-signature`;
}

// 카세트의 Set-Cookie 값도 이 더미로 바꾼다(proxy.mjs). 재생 중 쿠키가 깨진 값으로 덮이지 않도록
export function dummyCookieValue(name) {
  if (name === WEB_CSRF_COOKIE) return 'parity-csrf';
  if (name === WEB_ACCESS_COOKIE) return dummyJwt('web-access');
  if (name === WEB_REFRESH_COOKIE) return dummyJwt('web-refresh');
  if (name === ORDER_TOKEN_COOKIE) return dummyJwt('order-access');
  return 'parity-dummy';
}

function loadCredentials() {
  const file = join(new URL('..', import.meta.url).pathname, '.cache', 'credentials.env');
  const env = { ...process.env };
  if (existsSync(file)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .forEach((line) => {
        const i = line.indexOf('=');
        env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
      });
  }
  if (!env.PARITY_TEST_USER_ID || !env.PARITY_TEST_USER_PASSWORD) {
    throw new Error('stage 테스트 계정이 없다: .cache/credentials.env 에 PARITY_TEST_USER_ID / PARITY_TEST_USER_PASSWORD');
  }
  return { id: env.PARITY_TEST_USER_ID, password: env.PARITY_TEST_USER_PASSWORD };
}

let liveCache = null;

// stage에 실제로 로그인한다 (기록 실행당 한 번)
async function liveCookies() {
  if (liveCache) return liveCache;
  const { id, password } = loadCredentials();
  const body = { login_id: id, login_pw: createHash('sha256').update(password).digest('hex') };
  const headers = { 'Content-Type': 'application/json', Origin: UPSTREAM_ORIGIN, Referer: `${UPSTREAM_ORIGIN}/` };

  const app = await fetch(`${UPSTREAM}/v2/users/login`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!app.ok) throw new Error(`order 로그인 실패 ${app.status}`);
  const { token } = await app.json();

  const web = await fetch(`${UPSTREAM}/v2/web/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, auto_login: true }),
  });
  if (!web.ok) throw new Error(`WEB_RECODE 로그인 실패 ${web.status}`);
  const webCookies = Object.fromEntries(
    web.headers.getSetCookie().map((c) => {
      const [nameValue] = c.split(';');
      const i = nameValue.indexOf('=');
      return [nameValue.slice(0, i), nameValue.slice(i + 1)];
    }),
  );
  liveCache = { [ORDER_TOKEN_COOKIE]: token, ...webCookies };
  return liveCache;
}

// 테스트 계정의 order 토큰(Bearer). 카세트 밖에서 stage 상태를 준비·복구할 때 쓴다(cart-state.mjs)
export async function stageOrderToken() {
  return (await liveCookies())[ORDER_TOKEN_COOKIE];
}

const toCookie = (name, value) => ({
  name,
  value,
  domain: 'localhost',
  path: '/',
  secure: name.startsWith('__Secure-'),
  httpOnly: name !== WEB_CSRF_COOKIE && name !== ORDER_TOKEN_COOKIE,
  sameSite: 'Lax',
});

// 브라우저 컨텍스트에 로그인 쿠키를 넣는다. localhost 쿠키는 포트를 가리지 않아 앱·프록시 모두에 전달된다
export async function applyAuth(context, mode) {
  const names = [ORDER_TOKEN_COOKIE, WEB_ACCESS_COOKIE, WEB_REFRESH_COOKIE, WEB_CSRF_COOKIE];
  const values = mode === 'replay' ? Object.fromEntries(names.map((n) => [n, dummyCookieValue(n)])) : await liveCookies();
  await context.addCookies(names.filter((n) => values[n]).map((n) => toCookie(n, values[n])));
}
