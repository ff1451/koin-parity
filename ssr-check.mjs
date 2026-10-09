// SSR 점검: 페이지 × 기기(UA) × 쿠키 상태(없음/무효 access)로 서버가 만든 HTML 응답 코드를 본다. 5xx면 실패.
// 무효 access 쿠키: 서명이 틀리고 exp는 아직 남은 JWT. access 쿠키는 토큰 만료와 같이 브라우저에서 사라지므로(Max-Age 899)
// 실제로 서버에 실려 오는 것은 "만료 전인데 무효인" 토큰(서버 세션 무효화 직후, 다른 환경 쿠키 등)이다.
// 재생 프록시는 쿠키에 따라 달라지는 응답을 재현하지 못하므로 프록시를 live(stage 직접 전달)로 둔다.
// SSR은 GET만 보내므로 stage 데이터는 바뀌지 않는다.
//
// 실행: node ssr-check.mjs --ref <git-ref> [--paths /store,/store/64]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { proxyControl } from './capture.mjs';
import { APPS, PARITY_DIR, startProxy, startWeb, WEB_REPO } from './lib/apps.mjs';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const ref = arg('--ref', 'HEAD');
const spec = JSON.parse(readFileSync(join(PARITY_DIR, 'units', 'ssr-check.json'), 'utf8'));
const only = arg('--paths', '')?.split(',').filter(Boolean) ?? [];
const paths = only.length ? only : spec.paths;
const sha = execFileSync('git', ['rev-parse', ref], { cwd: WEB_REPO }).toString().trim();

const USER_AGENTS = {
  mobile: 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const invalidAccess = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'parity', exp: 4102444800 })}.parity-invalid-signature`;
const cookies = Object.fromEntries(Object.entries(spec.cookies).map(([k, v]) => [k, v.replace('{invalidAccess}', invalidAccess)]));

const results = [];
const stops = [];
try {
  stops.push(await startProxy());
  stops.push(await startWeb(sha, 'candidate'));
  await proxyControl('session', { mode: 'live', cassette: null, session: 'ssr-check' });
  for (const path of paths) {
    for (const [device, ua] of Object.entries(USER_AGENTS)) {
      for (const [cookieState, cookie] of Object.entries(cookies)) {
        const headers = { 'User-Agent': ua, ...(cookie ? { Cookie: cookie } : {}) };
        const res = await fetch(`${APPS.web.baseURL}${path}`, { headers, redirect: 'manual' });
        results.push({ path, device, cookie: cookieState, status: res.status, pass: res.status < 500 });
      }
    }
  }
} finally {
  stops.reverse().forEach((stop) => stop());
}

const pass = results.length === paths.length * 2 * Object.keys(cookies).length && results.every((r) => r.pass);
const runDir = join(PARITY_DIR, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-ssr-check`);
mkdirSync(runDir, { recursive: true });
writeFileSync(join(runDir, 'report.json'), `${JSON.stringify({ ref, sha, pass, results }, null, 2)}\n`);
for (const path of paths) {
  const row = results.filter((r) => r.path === path).map((r) => `${r.device}/${r.cookie}=${r.status}${r.pass ? '' : '!'}`);
  console.warn(`${results.filter((r) => r.path === path).every((r) => r.pass) ? 'PASS' : 'FAIL'}  ${path.padEnd(40)} ${row.join(' ')}`);
}
console.warn(`${pass ? 'PASS' : 'FAIL'}  ssr-check ${sha.slice(0, 8)}  report: ${join(runDir, 'report.json')}`);
process.exit(pass ? 0 : 1);
