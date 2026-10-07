// 프록시와 앱 서버를 띄우고 내린다.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PARITY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ORDER_DIR = join(PARITY_DIR, '.cache', 'order');
export const ORDER_REPO = 'https://github.com/BCSDLab/KOIN_ORDER_WEBVIEW.git';
// 오라클 커밋. Track A = HEAD(1b51c34, 상점 이벤트 #251 포함). Track B는 7243571 + 라우트 주석 해제 패치(추후)
export const ORDER_COMMIT = '1b51c34';
export const API_PATH = 'http://localhost:4000/stage';

export const WEB_DIR = join(PARITY_DIR, '.cache', 'web');
// 검증 대상 KOIN_WEB_RECODE 저장소. 기본은 이 하네스와 같은 디렉터리에 있는 형제 저장소
export const WEB_REPO = process.env.KOIN_WEB_REPO ?? join(PARITY_DIR, '..', 'KOIN_WEB_RECODE');
// 빌드 시점 API 응답(ISR 사전 렌더 등). fill 모드로 기록해 빌드 결과를 고정한다.
// 여러 화면의 실데이터가 섞여 공개 저장소에 올리지 않는다(.cache)
const WEB_BUILD_CASSETTE = join(PARITY_DIR, '.cache', 'web-build.cassette.json');

const ORDER_PORT = 3000;
const WEB_PORT = 3001;
const PROXY_PORT = 4000;

export const APPS = {
  order: { baseURL: `http://localhost:${ORDER_PORT}` },
  web: { baseURL: `http://localhost:${WEB_PORT}` },
};

async function waitFor(url, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // 아직 기동 중
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout waiting for ${url}`);
}

// 상위 프로세스의 NODE_OPTIONS·yarn 환경(예: PnP 로더)이 order(pnpm)·WEB_RECODE(yarn PnP) 기동에 새지 않도록 지운다
function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  Object.keys(env)
    .filter((k) => k.startsWith('npm_') || k.startsWith('YARN_') || k.startsWith('BERRY_'))
    .forEach((k) => delete env[k]);
  return env;
}

function start(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  child.stderr.on('data', (d) => process.env.PARITY_VERBOSE && process.stderr.write(`[${name}] ${d}`));
  child.stdout.on('data', (d) => process.env.PARITY_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // 이미 종료
  }
}

export async function startProxy() {
  const child = start('proxy', process.execPath, [join(PARITY_DIR, 'proxy.mjs'), '--port', String(PROXY_PORT)], PARITY_DIR);
  await waitFor(`http://localhost:${PROXY_PORT}/__parity/log`);
  return () => stop(child);
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, env: cleanEnv(), stdio: process.env.PARITY_VERBOSE ? 'inherit' : 'ignore' });
}

// 오라클 버그를 고치는 패치. 사람이 승인한 것만 두며 루프 에이전트는 수정할 수 없다 (oracle-patches/README.md)
const ORDER_PATCH_DIR = join(PARITY_DIR, 'oracle-patches', 'order');

function orderPatches() {
  if (!existsSync(ORDER_PATCH_DIR)) return [];
  return readdirSync(ORDER_PATCH_DIR)
    .filter((f) => f.endsWith('.patch'))
    .sort()
    .map((f) => join(ORDER_PATCH_DIR, f));
}

// order를 고정 커밋 + 오라클 패치로 받아 프록시 API 경로로 빌드한다. 커밋·경로·패치가 같으면 다시 빌드하지 않는다
export function prepareOrder() {
  if (!existsSync(join(ORDER_DIR, '.git'))) run('git', ['clone', '-q', ORDER_REPO, ORDER_DIR], PARITY_DIR);
  const patches = orderPatches();
  const patchHash = createHash('sha1')
    .update(patches.map((p) => readFileSync(p, 'utf8')).join('\n'))
    .digest('hex')
    .slice(0, 12);
  const stamp = join(ORDER_DIR, 'dist', '.parity-build');
  const wanted = `${ORDER_COMMIT} ${API_PATH} patches:${patchHash}`;
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === wanted) return;

  run('git', ['fetch', '-q', 'origin'], ORDER_DIR);
  run('git', ['checkout', '-q', '--force', ORDER_COMMIT], ORDER_DIR);
  run('git', ['clean', '-q', '-fd', 'src'], ORDER_DIR);
  patches.forEach((p) => run('git', ['apply', p], ORDER_DIR));
  writeFileSync(join(ORDER_DIR, '.env'), `VITE_API_PATH=${API_PATH}\n`);
  run('corepack', ['pnpm', 'install', '--frozen-lockfile'], ORDER_DIR);
  run('corepack', ['pnpm', 'exec', 'vite', 'build'], ORDER_DIR);
  writeFileSync(stamp, wanted);
}

// order는 고정 커밋을 vite build 한 결과를 preview로 띄운다 (VITE_API_PATH는 빌드 시 .env로 주입)
export async function startOrder() {
  prepareOrder();
  const child = start('order', 'corepack', ['pnpm', 'exec', 'vite', 'preview', '--port', String(ORDER_PORT), '--strictPort'], ORDER_DIR);
  await waitFor(APPS.order.baseURL);
  return () => stop(child);
}

async function proxySession(body) {
  const res = await fetch(`http://localhost:${PROXY_PORT}/__parity/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`proxy session ${res.status}`);
}

function webEnv() {
  return { NEXT_PUBLIC_API_PATH: API_PATH, NEXT_TELEMETRY_DISABLED: '1' };
}

// WEB_RECODE를 지정 ref로 별도 워크트리에 체크아웃해 프로덕션 빌드한다 (dev 서버는 결정성이 떨어진다).
// 빌드 중 API 호출은 프록시 fill 모드로 기록·재생한다. 프록시가 떠 있어야 한다
export async function prepareWeb(ref = 'HEAD') {
  const sha = execFileSync('git', ['rev-parse', ref], { cwd: WEB_REPO }).toString().trim();
  if (!existsSync(join(WEB_DIR, '.git'))) run('git', ['worktree', 'add', '--detach', WEB_DIR, sha], WEB_REPO);
  const stamp = join(WEB_DIR, '.next', '.parity-build');
  const wanted = `${sha} ${API_PATH}`;
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === wanted) return sha;

  run('git', ['checkout', '-q', '--force', '--detach', sha], WEB_DIR);
  run('yarn', ['install', '--immutable'], WEB_DIR);
  await proxySession({ mode: 'fill', cassette: WEB_BUILD_CASSETTE, session: 'web-build' });
  // lint는 KOIN 저장소 CI가 검사한다. 워크트리가 저장소 밖에 있으면 import 그룹 판정이 달라져 빌드가 실패하므로 끈다
  execFileSync('yarn', ['next', 'build', '--no-lint'], {
    cwd: WEB_DIR,
    env: { ...cleanEnv(), ...webEnv() },
    stdio: process.env.PARITY_VERBOSE ? 'inherit' : 'ignore',
  });
  await proxySession({ mode: 'replay', cassette: null, session: null });
  writeFileSync(stamp, wanted);
  return sha;
}

export async function startWeb(ref = 'HEAD') {
  await prepareWeb(ref);
  const child = spawn('yarn', ['next', 'start', '-p', String(WEB_PORT)], {
    cwd: WEB_DIR,
    env: { ...cleanEnv(), ...webEnv() },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stderr.on('data', (d) => process.env.PARITY_VERBOSE && process.stderr.write(`[web] ${d}`));
  child.stdout.on('data', (d) => process.env.PARITY_VERBOSE && process.stdout.write(`[web] ${d}`));
  // 준비 확인은 API를 부르지 않는 헬스 엔드포인트로 한다 (홈을 열면 서버가 API를 호출해 로그가 섞인다)
  await waitFor(`${APPS.web.baseURL}/api/health`, 120_000);
  return () => stop(child);
}
