// 한 앱의 한 상태를 캡처한다: 전체 페이지 스크린샷, 요소 목록(위치·계산된 스타일), API 요청 로그.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, devices } from '@playwright/test';

export const PROXY_ORIGIN = process.env.PARITY_PROXY_ORIGIN ?? 'http://localhost:4000';
export const API_PATH = `${PROXY_ORIGIN}/stage`;
export const FIXED_TIME = new Date('2026-10-07T12:00:00+09:00');
const SETTLE_MS = 2000; // 로드 후 가짜 시계로 진행시킬 시간 (애니메이션·지연 렌더 정착)

// 분석·지도·에러 수집은 결정성을 깨므로 막는다 (G4는 별도 계측으로 다룬다)
const BLOCKED_HOSTS = [
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'sentry.io',
  'ingest.sentry.io',
  'map.naver.com',
  'map.naver.net',
  'pstatic.net',
];

// 래스터 결과가 실행마다 같도록 GPU·부분 래스터·LCD 텍스트·색 프로파일 변수를 없앤다.
// (비정수 DPR에서 이미지 축소 결과가 실행마다 몇 픽셀씩 달라지는 것을 확인함)
const DETERMINISTIC_ARGS = [
  '--disable-gpu',
  '--disable-gpu-rasterization',
  '--disable-partial-raster',
  '--disable-skia-runtime-opts',
  '--disable-lcd-text',
  '--font-render-hinting=none',
  '--force-color-profile=srgb',
  '--disable-threaded-animation',
  '--disable-threaded-scrolling',
  '--disable-checker-imaging',
  '--disable-image-animation-resync',
];

// lottie-web은 svg 안에 __lottie_element_* id를 만든다
const DYNAMIC_SELECTOR = 'svg:has([id^="__lottie_element"]), canvas, video';

const FREEZE_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important;
  transition-duration: 0s !important; transition-delay: 0s !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; }
`;

export async function proxyControl(path, body) {
  const res = await fetch(`${PROXY_ORIGIN}/__parity/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`proxy ${path} ${res.status}`);
  return res.json();
}

// 외부 정적 리소스(이미지 등)는 API 프록시를 거치지 않으므로 page.route로 기록·재생한다
async function routeAssets(context, { assetsDir, mode, assetLog }) {
  mkdirSync(assetsDir, { recursive: true });

  const serveAsset = async (route, url) => {
    const id = createHash('sha1').update(url).digest('hex');
    const bodyPath = join(assetsDir, `${id}.bin`);
    const metaPath = join(assetsDir, `${id}.json`);
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      assetLog.push({ url, action: 'replayed' });
      return route.fulfill({ status: meta.status, headers: meta.headers, body: readFileSync(bodyPath) });
    }
    if (mode === 'replay') {
      assetLog.push({ url, action: 'miss' });
      return route.abort('failed');
    }
    const response = await context.request.get(url);
    const body = await response.body();
    writeFileSync(bodyPath, body);
    writeFileSync(metaPath, JSON.stringify({ url, status: response.status(), headers: response.headers() }));
    assetLog.push({ url, action: 'recorded' });
    return route.fulfill({ status: response.status(), headers: response.headers(), body });
  };

  // next/image는 서버가 원본을 받아 최적화하므로 page.route로 원본 요청이 보이지 않는다.
  // 원격 이미지는 원본을 그대로 돌려준다: 오라클(order)도 원본을 그리므로 비교가 공정하고, 서버 쪽 외부 요청도 없앤다
  await context.route(/\/_next\/image\?/, async (route) => {
    const original = new URL(route.request().url()).searchParams.get('url') ?? '';
    if (!/^https?:\/\//.test(original)) return route.continue();
    return serveAsset(route, original);
  });

  await context.route(
    (url) => !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.hostname.endsWith('.localhost'),
    async (route) => {
      const url = route.request().url();
      const { hostname } = new URL(url);
      if (BLOCKED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
        assetLog.push({ url, action: 'blocked' });
        return route.abort('blockedbyclient');
      }
      return serveAsset(route, url);
    },
  );
}

// 화면에 보이는 말단 요소 목록. DOM 구조가 달라도 짝을 맞출 수 있도록 role·텍스트·위치·스타일만 남긴다
function collectInventory(maskSelectors = []) {
  const STYLE_KEYS = [
    'color',
    'background-color',
    'font-size',
    'font-weight',
    'font-family',
    'line-height',
    'letter-spacing',
    'text-align',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border-top-left-radius',
    'border-top-width',
    'border-top-color',
    'opacity',
  ];
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'img') return 'img';
    if (tag === 'svg' && el.querySelector('[id^="__lottie_element"]')) return 'animation';
    if (tag === 'svg') return 'img';
    if (tag === 'input' || tag === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return 'text';
  };
  const directText = (el) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
  };

  const masked = maskSelectors.flatMap((sel) => [...document.querySelectorAll(sel)]);
  const isMasked = (el) => masked.some((m) => m === el || m.contains(el));
  const items = [];
  const walk = (el) => {
    if (!isVisible(el)) return;
    const tag = el.tagName.toLowerCase();
    const text = directText(el);
    const isLeafMedia = tag === 'img' || tag === 'svg' || tag === 'input' || tag === 'textarea';
    if (text || isLeafMedia) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      items.push({
        ...(isMasked(el) ? { masked: true } : {}),
        role: roleOf(el),
        tag,
        text,
        label:
          roleOf(el) === 'animation'
            ? // 마스킹되는 애니메이션도 다른 파일로 바뀌면 잡히도록 viewBox·레이어 수로 식별한다
              `lottie:${el.getAttribute('viewBox')}:${el.querySelectorAll(':scope > g > g').length}`
            : (el.getAttribute('aria-label') ?? el.getAttribute('alt') ?? ''),
        box: {
          x: Math.round(r.x + scrollX),
          y: Math.round(r.y + scrollY),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        style: Object.fromEntries(STYLE_KEYS.map((k) => [k, cs.getPropertyValue(k)])),
      });
    }
    if (tag === 'svg') return;
    [...el.children].forEach(walk);
  };
  walk(document.body);
  return items;
}

// 화면이 정착할 때까지 기다린다: 가짜 시계를 진행시킨 뒤, 요소 목록이 연속 두 번 같아질 때까지 반복한다.
// IntersectionObserver 같은 콜백은 가짜 시계와 무관하게 실제 렌더 타이밍에 오므로 시계 진행만으로는 부족하다
async function settle(page, firstRunMs) {
  await page.clock.runFor(firstRunMs);
  await page.waitForLoadState('networkidle');
  let previous = '';
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(250);
    await page.clock.runFor(100);
    const snapshot = JSON.stringify(await page.evaluate(collectInventory, []));
    if (snapshot === previous) return true;
    previous = snapshot;
  }
  return false;
}

/**
 * @param {object} opts
 * @param {string} opts.baseURL 앱 주소
 * @param {string} opts.path 경로
 * @param {string} opts.outDir 결과 디렉터리
 * @param {string} opts.cassette 카세트 파일 경로
 * @param {string} opts.assetsDir 정적 리소스 기록 디렉터리
 * @param {'record'|'replay'} opts.mode
 * @param {string} [opts.device]
 * @param {(page: import('@playwright/test').Page) => Promise<void>} [opts.mutate] 변이 테스트용: 캡처 직전 화면을 바꾼다
 * @param {(context: import('@playwright/test').BrowserContext) => Promise<void>} [opts.beforeGoto] 변이 테스트용: 로드 전 요청 차단 등
 * @param {Array<{ click: { role: string, name: string } }>} [opts.actions] 상태에 도달하기 위한 상호작용 (단위 스펙의 states[].actions)
 * @param {Array<{ selector: string, reason: string }>} [opts.masks] 사람이 사유와 함께 선언한 마스크 (단위 스펙 masks)
 */
export async function capture({ baseURL, path, outDir, cassette, assetsDir, mode, device = 'Pixel 5', mutate, beforeGoto, actions = [], masks = [] }) {
  const maskSelectors = masks.map((m) => m.selector);
  mkdirSync(outDir, { recursive: true });
  await proxyControl('session', { mode, cassette, session: outDir });

  const browser = await chromium.launch({ args: DETERMINISTIC_ARGS });
  const context = await browser.newContext({ ...devices[device], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const assetLog = [];
  await routeAssets(context, { assetsDir, mode, assetLog });
  if (beforeGoto) await beforeGoto(context);
  const page = await context.newPage();
  // 가짜 시계: Date·타이머·requestAnimationFrame을 모두 고정 시각에서 멈춘 뒤, 캡처 전에 정해진 시간만 진행시킨다.
  // CSS 애니메이션 차단만으로는 Lottie 같은 rAF 애니메이션의 프레임이 실행마다 달라진다.
  await page.clock.install({ time: FIXED_TIME });
  await page.clock.pauseAt(FIXED_TIME);

  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(`${baseURL}${path}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: FREEZE_CSS });
  // 폰트와 이미지 로드를 기다린다.
  // 페이지 안 타이머는 가짜 시계라 동작하지 않으므로 제한 시간은 Node 쪽에서 건다
  await Promise.race([
    page.evaluate(async () => {
      await document.fonts.ready;
      // 전체 페이지 스크린샷에 화면 밖 이미지도 나오도록 lazy를 eager로 바꾼다 (두 앱에 똑같이 적용)
      document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
        img.loading = 'eager';
      });
      const pending = [...document.images].filter((img) => !img.complete);
      await Promise.all(
        pending.map(
          (img) =>
            new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            }),
        ),
      );
    }),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  let settled = await settle(page, SETTLE_MS);

  // 상태 도달: 도달하지 못하면(요소 없음) 예외 → 캡처 실패 = 해당 상태 FAIL
  for (const action of actions) {
    if (action.click) {
      await page.getByRole(action.click.role, { name: action.click.name, exact: true }).first().click({ timeout: 5000 });
    }
    settled = (await settle(page, SETTLE_MS)) && settled;
  }
  const mutationApplied = mutate ? await mutate(page) : null;

  // 동적 영역(Lottie·canvas·video)은 프레임이 실행마다 달라 픽셀 비교에서 가린다.
  // 존재와 위치는 요소 목록(G6 inventory)으로 계속 검증하므로 "사라져도 통과"하지 않는다.
  const dynamic = page.locator(DYNAMIC_SELECTOR);
  const dynamicRegions = await dynamic.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
    }),
  );
  const declared = maskSelectors.map((sel) => page.locator(sel));
  await page.screenshot({ path: join(outDir, 'screenshot.png'), fullPage: true, mask: [dynamic, ...declared], maskColor: '#FF00FF' });
  const inventory = await page.evaluate(collectInventory, maskSelectors);
  const pageSize = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));

  if (mode !== 'replay') await proxyControl('flush', {});
  const { log } = await proxyControl('log');

  const result = { baseURL, path, device, mode, url: page.url(), settled, mutationApplied, page: pageSize, inventory, dynamicRegions, requests: log, assets: assetLog, consoleErrors };
  writeFileSync(join(outDir, 'capture.json'), `${JSON.stringify(result, null, 2)}\n`);

  await browser.close();
  return result;
}
