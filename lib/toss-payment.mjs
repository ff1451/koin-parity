// Toss 테스트 결제 준비(결정 38 변경: 테스트 결제까지 실제 흐름으로 검증).
//
// 결제 승인(payments/confirm)은 결제 하나에 한 번만 성공한다. 그래서 결제 승인 화면(B9)을 기록하기 직전에
// 1) stage에 임시 주문을 만들고  2) Toss 결제창 데모(퀵계좌이체, 테스트 비밀번호 000000)로 결제를 끝내
// successUrl로 돌아온 paymentKey·orderId·amount를 fixtures/_payments/<name>.json에 남긴다.
// 기록은 이 값으로 결제 승인 화면을 열어 실제 승인을 카세트에 남기고, 재생·검증은 같은 값과 카세트를 쓴다.
//
// Toss 결제창은 하네스 앱이 아니라 별도 출처의 빈 페이지에서 띄운다(테스트 키, 실제 출금 없음).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { stageOrderToken } from './auth.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const UPSTREAM = process.env.PARITY_UPSTREAM ?? 'https://api.stage.koreatech.in';
const DIR = join(new URL('..', import.meta.url).pathname, 'fixtures', '_payments');
// order TossWidget.tsx와 같은 Toss 문서용 공개 테스트 키
const CLIENT_KEY = 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm';
const CUSTOMER_KEY = 'RIjiDf_DbIaGaFMTcj3_v';
const ORIGIN = 'https://parity-payment.localtest.me';

async function api(method, path, body) {
  const token = await stageOrderToken();
  const res = await fetch(`${UPSTREAM}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// 포장 임시 주문(order 결제 화면의 useTemporaryTakeout과 같은 본문). 장바구니가 비어 있으면 실패한다
async function createTakeoutOrder() {
  const cart = await api('GET', 'cart?type=TAKE_OUT');
  if (!cart.items?.length) throw new Error('장바구니가 비어 있다(prepare.cart로 먼저 채울 것)');
  const me = await api('GET', 'user/student/me');
  const order = await api('POST', 'payments/takeout/temporary', {
    phone_number: me.phone_number,
    to_owner: '',
    provide_cutlery: false,
    total_menu_price: cart.items_amount,
    total_amount: cart.total_amount,
  });
  return { orderId: order.order_id, amount: cart.total_amount, orderName: cart.items.length === 1 ? cart.items[0].name : `${cart.items[0].name} 외 ${cart.items.length - 1}건` };
}

const PAGE = (orderId, orderName, amount) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://js.tosspayments.com/v2/standard"></script></head><body><div id="payment-method"></div><div id="agreement"></div><script>
(async () => {
  const widgets = TossPayments(${JSON.stringify(CLIENT_KEY)}).widgets({ customerKey: ${JSON.stringify(CUSTOMER_KEY)} });
  await widgets.setAmount({ currency: 'KRW', value: ${amount} });
  await Promise.all([widgets.renderPaymentMethods({ selector: '#payment-method', variantKey: 'DEFAULT' }), widgets.renderAgreement({ selector: '#agreement', variantKey: 'AGREEMENT' })]);
  window.__pay = () => widgets.requestPayment({ orderId: ${JSON.stringify(orderId)}, orderName: ${JSON.stringify(orderName)}, successUrl: '${ORIGIN}/success', failUrl: '${ORIGIN}/fail' }).catch((e) => { window.__err = String(e); });
  window.__ready = true;
})().catch((e) => { window.__err = String(e); });
</script></body></html>`;

// 퀵계좌이체 데모: 테스트 휴대폰번호(자동 입력) → 다음 → 비밀번호 000000(섞인 키패드) → 결제하기 → 비밀번호 000000 → successUrl
async function payWithTossDemo({ orderId, orderName, amount }) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ ...devices['Pixel 5'], locale: 'ko-KR' });
    await context.route(`${ORIGIN}/**`, (route) => {
      const url = route.request().url();
      return url === `${ORIGIN}/` ? route.fulfill({ contentType: 'text/html', body: PAGE(orderId, orderName, amount) }) : route.fulfill({ contentType: 'text/plain', body: 'done' });
    });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => window.__ready || window.__err, null, { timeout: 30000 });
    await page.frameLocator('#payment-method iframe').getByText('퀵계좌이체').first().click();
    await page.waitForTimeout(800);
    // 결제 요청은 Toss 결제창으로 이동하므로 프로미스를 기다리지 않는다
    await page.evaluate(() => {
      window.__pay();
    });
    for (let i = 0; i < 30; i += 1) {
      await page.waitForTimeout(1000);
      const url = new URL(page.url());
      if (url.origin === ORIGIN && url.pathname === '/success') {
        return { paymentKey: url.searchParams.get('paymentKey'), orderId: url.searchParams.get('orderId'), amount: Number(url.searchParams.get('amount')) };
      }
      if (url.origin === ORIGIN && url.pathname === '/fail') throw new Error(`Toss 결제 실패: ${url.search}`);
      if (/signin|pin/.test(url.pathname)) {
        const zero = page.getByText('0', { exact: true }).first();
        for (let k = 0; k < 6; k += 1) {
          await zero.click();
          await page.waitForTimeout(150);
        }
        continue;
      }
      const next = page.getByRole('button', { name: /^(다음|결제하기)$/ }).last();
      if (await next.count()) await next.click().catch(() => {});
    }
    throw new Error(`Toss 결제창에서 진행하지 못함: ${page.url().replace(/\?.*/, '')} ${await page.evaluate(() => window.__err ?? '')}`);
  } finally {
    await browser.close();
  }
}

// 새 테스트 결제를 만들어 저장한다(기록 직전, prepare.payment)
export async function createTestPayment(name) {
  const order = await createTakeoutOrder();
  const paid = await payWithTossDemo(order);
  if (paid.orderId !== order.orderId) throw new Error(`orderId 불일치 ${paid.orderId} ≠ ${order.orderId}`);
  const saved = { orderType: 'TAKE_OUT', orderId: paid.orderId, paymentKey: paid.paymentKey, amount: paid.amount };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, `${name}.json`), `${JSON.stringify(saved, null, 2)}\n`);
  return saved;
}

// 저장된 테스트 결제 값(재생·검증). 경로 템플릿 params에 합친다
export function savedPayment(name) {
  const file = join(DIR, `${name}.json`);
  if (!existsSync(file)) throw new Error(`테스트 결제 없음: ${file} (기록으로 먼저 만든다)`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

// 상태의 경로 params. prepare.payment가 있으면 저장된 테스트 결제 값(paymentKey·orderId·amount·orderType)을 합친다.
// fresh면(기록) 새 테스트 결제를 만든다. 같은 실행에서 같은 이름은 한 번만 만든다
const created = new Map();
export async function stateParams(state, { fresh = false } = {}) {
  const name = state.prepare?.payment;
  if (!name) return state.params ?? {};
  if (fresh && !created.has(name)) created.set(name, await createTestPayment(name));
  return { ...state.params, ...(created.get(name) ?? savedPayment(name)) };
}
