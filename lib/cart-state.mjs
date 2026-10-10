// stage 테스트 계정 장바구니 저장·복구(cart-state.mjs CLI, 기록 전 상태 준비 prepare.cart)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { stageOrderToken } from './auth.mjs';

const UPSTREAM = process.env.PARITY_UPSTREAM ?? 'https://api.stage.koreatech.in';
const DIR = join(new URL('..', import.meta.url).pathname, 'fixtures', '_cart-states');

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

// 장바구니 항목 하나의 선택값(가격·옵션 id)은 옵션 변경 화면용 API에서 얻는다
export async function snapshot() {
  const cart = await api('GET', 'cart?type=DELIVERY');
  const items = [];
  for (const item of cart.items) {
    const edit = await api('GET', `cart/item/${item.cart_menu_item_id}/edit`);
    items.push({ name: item.name, quantity: item.quantity, menuId: item.orderable_shop_menu_id, edit });
  }
  return { orderable_shop_id: cart.orderable_shop_id, shop_name: cart.shop_name, items };
}

const selected = (edit) => ({
  priceId: (edit.prices ?? []).find((p) => p.is_selected)?.id,
  options: (edit.option_groups ?? []).flatMap((g) => (g.options ?? []).filter((o) => o.is_selected).map((o) => ({ option_group_id: g.id, option_id: o.id }))),
});

export async function saveCart(name) {
  mkdirSync(DIR, { recursive: true });
  const s = await snapshot();
  const saved = { orderable_shop_id: s.orderable_shop_id, items: s.items.map((i) => ({ name: i.name, quantity: i.quantity, menuId: i.menuId, ...selected(i.edit) })) };
  if (saved.items.some((i) => !i.priceId)) throw new Error(`선택된 가격을 찾지 못함: ${JSON.stringify(s.items[0]?.edit).slice(0, 400)}`);
  writeFileSync(join(DIR, `${name}.json`), `${JSON.stringify(saved, null, 2)}\n`);
  return saved;
}

// 장바구니를 비우고 저장한 항목을 같은 가격·옵션·수량으로 다시 담는다. name이 'empty'면 비우기만 한다
export async function restoreCart(name) {
  // 장바구니가 없으면 404 NOT_FOUND_CART — 이미 빈 상태다
  await api('DELETE', 'cart/reset').catch((error) => {
    if (!String(error).includes('NOT_FOUND_CART')) throw error;
  });
  if (name === 'empty') return snapshot();
  const file = join(DIR, `${name}.json`);
  if (!existsSync(file)) throw new Error(`없음: ${file}`);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  for (const i of saved.items) {
    await api('POST', 'cart/add', {
      orderable_shop_id: saved.orderable_shop_id,
      orderable_shop_menu_id: i.menuId,
      orderable_shop_menu_price_id: i.priceId,
      orderable_shop_menu_option_ids: i.options,
      quantity: i.quantity,
    });
  }
  return snapshot();
}
