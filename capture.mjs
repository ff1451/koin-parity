// 한 앱의 한 상태를 캡처한다: 전체 페이지 스크린샷, 요소 목록(위치·계산된 스타일), API 요청 로그.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, devices } from '@playwright/test';

import { applyAuth } from './lib/auth.mjs';

export const PROXY_ORIGIN = process.env.PARITY_PROXY_ORIGIN ?? 'http://localhost:4000';
export const API_PATH = `${PROXY_ORIGIN}/stage`;
export const FIXED_TIME = new Date('2026-10-07T12:00:00+09:00');
const SETTLE_MS = 2000;
const MAX_VIEWPORT_HEIGHT = 20000; // 이보다 긴 페이지는 fullPage 캡처로 남긴다
export const DEFAULT_CHROME = { toastSelector: '.Toastify__toast, div.fixed.bottom-6.z-150', footerSelector: 'footer' }; // 로드 후 가짜 시계로 진행시킬 시간 (애니메이션·지연 렌더 정착)

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

// PARITY_BROWSER_WS가 있으면 Linux 컨테이너의 브라우저(browser.sh)에 붙는다. 실행 인자는 같은 목록을 헤더로 넘긴다
export function launchBrowser() {
  const ws = process.env.PARITY_BROWSER_WS;
  if (!ws) return chromium.launch({ args: DETERMINISTIC_ARGS });
  return chromium.connect(ws, { headers: { 'x-playwright-launch-options': JSON.stringify({ args: DETERMINISTIC_ARGS }) } });
}

// lottie-web은 svg 안에 __lottie_element_* id를 만든다
const DYNAMIC_SELECTOR = 'svg:has([id^="__lottie_element"]), canvas, video';

// 페이지보다 먼저 실행되는 계측: 분석 이벤트(gtag 호출)와 토스트 문구를 시간순으로 기록한다.
// 두 앱 모두 window.gtag가 있을 때만 이벤트를 보내므로 기록용 함수를 미리 심는다(실제 GA 스크립트는 차단됨)
const INSTRUMENT = ({ toastSelector }) => {
  const parity = { gtag: [], toasts: [] };
  window.__parity = parity;
  const record = (args) => {
    try {
      parity.gtag.push(JSON.parse(JSON.stringify(args)));
    } catch {
      parity.gtag.push(args.map(String));
    }
  };
  window.gtag = (...args) => record(args);
  // order의 index.html은 전역 function gtag(){dataLayer.push(arguments)}로 위 함수를 덮어쓴다 → dataLayer.push도 기록
  const dataLayer = [];
  dataLayer.push = (...items) => {
    items.forEach((item) => {
      if (item && typeof item === 'object' && typeof item.length === 'number' && !Array.isArray(item)) record(Array.from(item));
    });
    return Array.prototype.push.apply(dataLayer, items);
  };
  window.dataLayer = dataLayer;
  const seen = new WeakMap();
  const scan = () => {
    document.querySelectorAll(toastSelector).forEach((el) => {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text && seen.get(el) !== text) {
        seen.set(el, text);
        parity.toasts.push(text);
      }
    });
  };
  const start = () => new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
};

const FREEZE_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important;
  transition-duration: 0s !important; transition-delay: 0s !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; }
`;

// 프록시가 닫은 keep-alive 소켓을 재사용하면 ECONNRESET이 난다(lib/apps.mjs proxySession 참고). 새 연결로 한 번 더 시도한다
export async function proxyControl(path, body, retried = false) {
  let res;
  try {
    res = await fetch(`${PROXY_ORIGIN}/__parity/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (retried) throw error;
    return proxyControl(path, body, true);
  }
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

  // Next <Link> 프리페치는 화면에 보이는 링크 수(=뷰포트 크기)에 따라 서버 렌더·API 호출을 일으킨다.
  // 화면 결과와 무관하고 결정성을 깨므로 막는다 (실제 이동 요청은 purpose 헤더가 없어 통과)
  await context.route(/\/_next\/data\//, (route) =>
    route.request().headers().purpose === 'prefetch' ? route.abort('blockedbyclient') : route.continue(),
  );

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


// 상태 도달용 상호작용. click.role+name(접근 가능한 이름) 또는 click.css(+nth, 이름 없는 아이콘 버튼 등)
export async function performAction(page, action) {
  if (action.click?.css) {
    await page.locator(action.click.css).nth(action.click.nth ?? 0).click({ timeout: 5000 });
    return;
  }
  // 입력: 값을 한 번에 넣고 input 이벤트를 낸다(글자별 입력은 디바운스·IME 처리에 따라 요청 수가 달라질 수 있음)
  if (action.fill) {
    const target = action.fill.placeholder
      ? page.getByPlaceholder(action.fill.placeholder, { exact: true })
      : page.getByRole(action.fill.role, { name: action.fill.name, exact: true });
    await target.nth(action.fill.nth ?? 0).fill(action.fill.text, { timeout: 5000 });
    return;
  }
  // 역할이 없는 클릭 대상(숨긴 체크박스를 감싼 label 등)은 보이는 글자로 찾는다
  if (action.click?.text) {
    await page.getByText(action.click.text, { exact: true }).nth(action.click.nth ?? 0).click({ timeout: 5000 });
    return;
  }
  if (action.click) {
    await page
      .getByRole(action.click.role, { name: action.click.name, exact: true })
      .nth(action.click.nth ?? 0)
      .click({ timeout: 5000 });
    return;
  }
  throw new Error(`unknown action ${JSON.stringify(action)}`);
}

// 브라우저를 띄우고 경로를 열어 정착시킨 뒤 actions로 상태에 도달한다 (capture·explore 공용)
export async function openPage({ baseURL, path, assetsDir, mode, device = 'Pixel 5', beforeGoto, actions = [], chrome = DEFAULT_CHROME, auth = 'guest' }) {
  const browser = await launchBrowser();
  const context = await browser.newContext({ ...devices[device], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const assetLog = [];
  await routeAssets(context, { assetsDir, mode, assetLog });
  if (auth === 'auth') await applyAuth(context, mode);
  await context.addInitScript(INSTRUMENT, { toastSelector: chrome.toastSelector });
  // 변이용 스크립트는 계측보다 뒤에 등록해 계측을 덮어쓸 수 있게 한다
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
  // 실패하면 브라우저를 닫고 던진다: 컨테이너 브라우저(browser.sh) 연결이 남으면 프로세스가 끝나지 않는다
  try {
    for (const action of actions) {
      await performAction(page, action);
      settled = (await settle(page, SETTLE_MS)) && settled;
    }
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }

  return { browser, context, page, assetLog, consoleErrors, settled };
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
 * @param {'device'|'expand'} [opts.viewportMode] device: 기기 뷰포트 유지(단위 비교 — 100vh 레이아웃이 실제 사용자와 같다),
 *   expand: 페이지 높이로 늘린 뒤 캡처(같은 앱끼리의 회귀 비교 — 전체 페이지 캡처 중 레이아웃 재계산 경합 회피)
 * @param {{ toastSelector: string, footerSelector: string }} [opts.chrome] 토스트·푸터 선택자 (units/_common.json chrome)
 * @param {'guest'|'auth'} [opts.auth] 로그인 상태 (lib/auth.mjs)
 */
export async function capture({ baseURL, path, outDir, cassette, assetsDir, mode, device = 'Pixel 5', mutate, beforeGoto, actions = [], masks = [], viewportMode = 'device', chrome = DEFAULT_CHROME, auth = 'guest' }) {
  const maskSelectors = masks.map((m) => m.selector);
  mkdirSync(outDir, { recursive: true });
  await proxyControl('session', { mode, cassette, session: outDir });

  const { browser, page, assetLog, consoleErrors, settled: openSettled } = await openPage({ baseURL, path, assetsDir, mode, device, beforeGoto, actions, chrome, auth });
  let settled = openSettled;
  const mutationApplied = mutate ? await mutate(page) : null;

  // 전체 페이지 스크린샷은 찍는 동안 뷰포트를 늘려 100vh 기반 레이아웃이 다시 계산된다(경합 확인됨).
  // 미리 뷰포트를 페이지 높이로 늘리고 정착시킨 뒤, 그 레이아웃에서 스크린샷·요소 목록을 함께 얻는다
  const viewport = page.viewportSize();
  for (let i = 0; viewportMode === 'expand' && i < 5; i += 1) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const current = page.viewportSize().height;
    if (height === current || height > MAX_VIEWPORT_HEIGHT) break;
    await page.setViewportSize({ width: viewport.width, height });
    settled = (await settle(page, 0)) && settled;
  }

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
  // 토스트는 앱마다 표시 시간이 달라(1.5초 vs react-toastify) 같은 시점에 한쪽만 남는다 → 픽셀·요소 목록에서 빼고 문구 기록으로 비교
  const toasts = page.locator(chrome.toastSelector);
  await page.screenshot({ path: join(outDir, 'screenshot.png'), fullPage: true, mask: [dynamic, ...declared, toasts], maskColor: '#FF00FF' });
  const inventory = await page.evaluate(collectInventory, [...maskSelectors, chrome.toastSelector]);
  const pageSize = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  // 본문 영역 비교(foundation D1)용: 푸터 시작 위치. 헤더는 두 앱 모두 60px로 맞춰 compare가 위쪽을 잘라낸다
  const footerTop = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().top + scrollY) : null;
  }, chrome.footerSelector);
  const devicePixelRatio = await page.evaluate(() => window.devicePixelRatio);
  const instrumented = await page.evaluate(() => window.__parity ?? { gtag: [], toasts: [] });

  if (mode !== 'replay') await proxyControl('flush', {});
  const { log } = await proxyControl('log');

  const result = { baseURL, path, device, mode, auth, url: page.url(), settled, mutationApplied, page: pageSize, footerTop, devicePixelRatio, inventory, dynamicRegions, requests: log, assets: assetLog, gtag: instrumented.gtag, toasts: instrumented.toasts, consoleErrors };
  writeFileSync(join(outDir, 'capture.json'), `${JSON.stringify(result, null, 2)}\n`);

  await browser.close();
  return result;
}
