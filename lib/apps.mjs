// 프록시와 앱 서버를 띄우고 내린다.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PARITY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ORDER_DIR = join(PARITY_DIR, '.cache', 'order');
export const ORDER_REPO = 'https://github.com/BCSDLab/KOIN_ORDER_WEBVIEW.git';
// 오라클 커밋. Track A = HEAD(1b51c34, 상점 이벤트 #251 포함). Track B는 7243571 + 라우트 주석 해제 패치(추후)
export const ORDER_COMMIT = '1b51c34';
export const API_PATH = 'http://localhost:4000/stage';

// 검증 대상 KOIN_WEB_RECODE 저장소. 기본은 이 하네스와 같은 디렉터리에 있는 형제 저장소
export const WEB_REPO = process.env.KOIN_WEB_REPO ?? join(PARITY_DIR, '..', 'KOIN_WEB_RECODE');
// 빌드 시점 API 응답(ISR 사전 렌더 등). fill 모드로 기록해 빌드 결과를 고정한다.
// 여러 화면의 실데이터가 섞여 공개 저장소에 올리지 않는다(.cache)
const WEB_BUILD_CASSETTE = join(PARITY_DIR, '.cache', 'web-build.cassette.json');

// 개발 서버가 흔히 쓰는 3000번대를 피한다. 이미 쓰이는 포트면 기동 전에 실패한다(다른 서버에 붙어 캡처하는 사고 방지)
const ORDER_PORT = 4100;
const PROXY_PORT = 4000;

// WEB_RECODE는 슬롯마다 워크트리·포트를 따로 둔다. candidate: 검증 대상 ref, base: 회귀 비교 기준 ref
const WEB_SLOTS = {
  candidate: { dir: join(PARITY_DIR, '.cache', 'web'), port: 4101 },
  base: { dir: join(PARITY_DIR, '.cache', 'web-base'), port: 4102 },
};

export const APPS = {
  order: { baseURL: `http://localhost:${ORDER_PORT}` },
  web: { baseURL: `http://localhost:${WEB_SLOTS.candidate.port}` },
  'web-base': { baseURL: `http://localhost:${WEB_SLOTS.base.port}` },
};

// 서버 시계 고정 훅 (lib/freeze-time.mjs)
const FREEZE_TIME_HOOK = join(PARITY_DIR, 'lib', 'freeze-time.mjs');

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`port ${port} is already in use — 다른 프로세스가 쓰고 있어 하네스를 시작하지 않는다`)));
    server.once('listening', () => server.close(() => resolve()));
    server.listen(port, '::');
  });
}

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
  children.add(child);
  child.stderr.on('data', (d) => process.env.PARITY_VERBOSE && process.stderr.write(`[${name}] ${d}`));
  child.stdout.on('data', (d) => process.env.PARITY_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  return child;
}

// 실행이 예외로 끝나도 하네스가 띄운 서버가 포트를 붙잡고 남지 않도록 종료 시 정리한다
const children = new Set();
const killAll = () => children.forEach((c) => stop(c));
process.on('exit', killAll);
['SIGINT', 'SIGTERM'].forEach((sig) =>
  process.on(sig, () => {
    killAll();
    process.exit(130);
  }),
);
process.on('uncaughtException', (error) => {
  killAll();
  console.error(error);
  process.exit(1);
});

function stop(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // 이미 종료
  }
}

export async function startProxy() {
  await assertPortFree(PROXY_PORT);
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

// 오라클 패치 0002(폰트)가 참조하는 파일: KOIN_WEB_RECODE의 Pretendard 서브셋을 그대로 쓴다 (foundation D2)
const FONT_REF = process.env.PARITY_FONT_REF ?? 'origin/develop';
const FONT_DIR = 'src/assets/font';

function webFontFiles() {
  return execFileSync('git', ['ls-tree', '--name-only', `${FONT_REF}:${FONT_DIR}`], { cwd: WEB_REPO })
    .toString()
    .split('\n')
    .filter((f) => f.endsWith('.woff2'));
}

function syncOrderFonts() {
  const out = join(ORDER_DIR, 'public', 'fonts', 'web-recode');
  mkdirSync(out, { recursive: true });
  webFontFiles().forEach((f) => {
    writeFileSync(join(out, f), execFileSync('git', ['show', `${FONT_REF}:${FONT_DIR}/${f}`], { cwd: WEB_REPO, maxBuffer: 1 << 26 }));
  });
}

// 외부 서비스 키(.cache/credentials.env, 커밋하지 않음). 네이버 지도는 실제로 불러 비교한다(단위 스펙 live.naverMaps).
// 키가 없으면 빈 값으로 빌드되고 지도는 인증 실패로 그려지지 않는다
function secret(name) {
  const file = join(PARITY_DIR, '.cache', 'credentials.env');
  if (!existsSync(file)) return '';
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : '';
}
const NAVER_MAPS_CLIENT_ID = secret('PARITY_NAVER_MAPS_CLIENT_ID');
const MAPS_STAMP = `maps:${createHash('sha1').update(NAVER_MAPS_CLIENT_ID).digest('hex').slice(0, 8)}`;

// order를 고정 커밋 + 오라클 패치로 받아 프록시 API 경로로 빌드한다. 커밋·경로·패치가 같으면 다시 빌드하지 않는다
export function prepareOrder() {
  if (!existsSync(join(ORDER_DIR, '.git'))) run('git', ['clone', '-q', ORDER_REPO, ORDER_DIR], PARITY_DIR);
  const patches = orderPatches();
  const patchHash = createHash('sha1')
    .update(patches.map((p) => readFileSync(p, 'utf8')).join('\n'))
    .digest('hex')
    .slice(0, 12);
  const stamp = join(ORDER_DIR, 'dist', '.parity-build');
  const fontTree = execFileSync('git', ['rev-parse', `${FONT_REF}:${FONT_DIR}`], { cwd: WEB_REPO }).toString().trim();
  const wanted = `${ORDER_COMMIT} ${API_PATH} patches:${patchHash} fonts:${fontTree.slice(0, 12)} ${MAPS_STAMP}`;
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === wanted) return;

  run('git', ['fetch', '-q', 'origin'], ORDER_DIR);
  run('git', ['checkout', '-q', '--force', ORDER_COMMIT], ORDER_DIR);
  run('git', ['clean', '-q', '-fd', 'src', 'public'], ORDER_DIR);
  patches.forEach((p) => run('git', ['apply', p], ORDER_DIR));
  syncOrderFonts();
  writeFileSync(join(ORDER_DIR, '.env'), `VITE_API_PATH=${API_PATH}\nVITE_NAVER_MAPS_CLIENT_ID=${NAVER_MAPS_CLIENT_ID}\n`);
  run('corepack', ['pnpm', 'install', '--frozen-lockfile'], ORDER_DIR);
  run('corepack', ['pnpm', 'exec', 'vite', 'build'], ORDER_DIR);
  writeFileSync(stamp, wanted);
}

// order는 고정 커밋을 vite build 한 결과를 preview로 띄운다 (VITE_API_PATH는 빌드 시 .env로 주입)
export async function startOrder() {
  prepareOrder();
  await assertPortFree(ORDER_PORT);
  // IPv4로 연다: vite는 localhost를 ::1로만 열 수 있어 컨테이너 브라우저(browser.sh)가 호스트로 넘어오지 못한다
  const child = start('order', 'corepack', ['pnpm', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(ORDER_PORT), '--strictPort'], ORDER_DIR);
  await waitFor(APPS.order.baseURL);
  return () => stop(child);
}

// 빌드(execFileSync)가 이벤트 루프를 막는 동안 프록시가 keep-alive 소켓을 닫으면, 빌드 직후 첫 요청이
// 닫힌 소켓을 재사용해 ECONNRESET이 난다. 새 연결로 한 번 더 시도한다
async function proxySession(body, retried = false) {
  let res;
  try {
    res = await fetch(`http://localhost:${PROXY_PORT}/__parity/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (retried) throw error;
    return proxySession(body, true);
  }
  if (!res.ok) throw new Error(`proxy session ${res.status}`);
}

function webEnv() {
  // 주문 화면(/order/*)은 웹 주문을 열기 전까지 middleware가 막는다(KOIN 진입 차단 레이어). 하네스는 켜고 검증한다
  return { NEXT_PUBLIC_API_PATH: API_PATH, NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID: NAVER_MAPS_CLIENT_ID, NEXT_PUBLIC_ORDER_ENABLED: 'true', NEXT_TELEMETRY_DISABLED: '1' };
}

// WEB_RECODE를 지정 ref로 별도 워크트리에 체크아웃해 프로덕션 빌드한다 (dev 서버는 결정성이 떨어진다).
// 빌드 중 API 호출은 프록시 fill 모드로 기록·재생한다. 프록시가 떠 있어야 한다
export async function prepareWeb(ref = 'HEAD', slot = 'candidate') {
  const WEB_DIR = WEB_SLOTS[slot].dir;
  const sha = execFileSync('git', ['rev-parse', ref], { cwd: WEB_REPO }).toString().trim();
  if (!existsSync(join(WEB_DIR, '.git'))) run('git', ['worktree', 'add', '--detach', WEB_DIR, sha], WEB_REPO);
  const stamp = join(WEB_DIR, '.next', '.parity-build');
  const wanted = `${sha} ${API_PATH} ${MAPS_STAMP} order:on`;
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

export async function startWeb(ref = 'HEAD', slot = 'candidate') {
  await prepareWeb(ref, slot);
  const { dir, port } = WEB_SLOTS[slot];
  await assertPortFree(port);
  const child = spawn('yarn', ['next', 'start', '-p', String(port)], {
    cwd: dir,
    env: { ...cleanEnv(), ...webEnv(), NODE_OPTIONS: `--import ${FREEZE_TIME_HOOK}` },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  children.add(child);
  child.stderr.on('data', (d) => process.env.PARITY_VERBOSE && process.stderr.write(`[web:${slot}] ${d}`));
  child.stdout.on('data', (d) => process.env.PARITY_VERBOSE && process.stdout.write(`[web:${slot}] ${d}`));
  // 준비 확인은 API를 부르지 않는 헬스 엔드포인트로 한다 (홈을 열면 서버가 API를 호출해 로그가 섞인다)
  await waitFor(`http://localhost:${port}/api/health`, 120_000);
  return () => stop(child);
}
