// stage 테스트 계정의 장바구니 상태를 저장·복구한다(루프 밖 전용).
// 장바구니에 쓰는 상태(수량 변경·담기 성공 등)를 기록하면 stage 장바구니가 바뀌어 다음 기록의 시작 상태가 달라진다.
// 단위 스펙 states[].prepare.cart에 저장 이름을 두면 selftest/fill이 그 상태를 기록하기 전에 복구한다.
//
// 실행: node cart-state.mjs show
//       node cart-state.mjs save <name>     → fixtures/_cart-states/<name>.json
//       node cart-state.mjs restore <name>  ('empty'면 비우기만)
import { restoreCart, saveCart, snapshot } from './lib/cart-state.mjs';

const line = (s) => `${s.shop_name ?? '(비어 있음)'} ${s.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}`;
const [cmd, name] = process.argv.slice(2);
if (cmd === 'show') console.log(line(await snapshot()));
else if (cmd === 'save' && name) console.log('saved', (await saveCart(name)).items.map((i) => `${i.name} x${i.quantity}`).join(', '));
else if (cmd === 'restore' && name) console.log('restored', line(await restoreCart(name)));
else {
  console.error('사용: node cart-state.mjs show | save <name> | restore <name>');
  process.exit(1);
}
