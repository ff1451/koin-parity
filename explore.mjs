// 상태 자동 탐색기: 오라클(order) 화면에서 눌러 볼 수 있는 요소를 하나씩 눌러 도달 가능한 상태를 모은다.
// 결과는 단위 스펙 states[]의 초안이다. 사람이 쓴 플랜에서 상태가 빠지면 구현도 검증도 함께 놓치기 때문에,
// 검증 체크리스트를 플랜이 아니라 오라클 화면에서 직접 뽑는다.
//
// 실행: node explore.mjs <unit-id> [--state <name>] [--depth 2] [--max 30] [--fill]
//   --fill: 상호작용으로 생기는 조회(GET) 중 카세트에 없는 것을 stage에서 보충 (쓰기 요청은 항상 차단)
// 결과: runs/<ts>-<unit>-explore/explore.json, explore.md, 상태별 스크린샷
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openPage, performAction, proxyControl } from './capture.mjs';
import { APPS, PARITY_DIR, startOrder, startProxy } from './lib/apps.mjs';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const unitId = process.argv[2];
if (!unitId) {
  console.error('usage: explore.mjs <unit-id> [--state <name>] [--depth 2] [--max 30] [--fill]');
  process.exit(2);
}
const unit = JSON.parse(readFileSync(join(PARITY_DIR, 'units', `${unitId}.json`), 'utf8'));
const state = unit.states.find((s) => s.name === arg('--state', unit.states[0].name));
const maxDepth = Number(arg('--depth', '2'));
const maxStates = Number(arg('--max', '30'));
const mode = process.argv.includes('--fill') ? 'fill' : 'replay';
const runDir = join(PARITY_DIR, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${unitId}-explore`);
const fillPath = (template, params) => template.replace(/\{(\w+)\}/g, (_, k) => String(params[k]));
const path = fillPath(unit.oracle.path, state.params);
const cassette = join(PARITY_DIR, 'fixtures', unitId, `${state.cassette ?? state.name}.cassette.json`);

// 페이지 안: 실제로 보이는 텍스트 집합 + 열린 다이얼로그 수 → 상태 서명.
// innerText는 접힌 영역(높이 0 + overflow hidden) 안의 글자도 포함해 펼침 전후가 같아 보이므로 쓰지 않는다
function snapshot() {
  const clippedOut = (el) => {
    let r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return true;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
      if (/(hidden|clip|auto|scroll)/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
        const ar = a.getBoundingClientRect();
        const left = Math.max(r.left, ar.left);
        const right = Math.min(r.right, ar.right);
        const top = Math.max(r.top, ar.top);
        const bottom = Math.min(r.bottom, ar.bottom);
        if (right - left < 1 || bottom - top < 1) return true;
        r = { left, right, top, bottom };
      }
    }
    return false;
  };
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode.textContent.replace(/\s+/g, ' ').trim();
    const el = walker.currentNode.parentElement;
    if (t && el && !clippedOut(el)) texts.push(t);
  }
  const dialogs = document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]').length;
  return { url: location.pathname + location.search + location.hash, texts: [...new Set(texts)], dialogs };
}

// 페이지 안: 눌러 볼 후보. 버튼·링크·체크박스·탭·라벨·커서가 포인터인 요소 중 보이는 것(가장 바깥 클릭 요소만)
function listCandidates() {
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    // 접힌 영역(높이 0 조상, aria-hidden) 안의 요소는 사용자가 누를 수 없다
    return !el.closest('[aria-hidden="true"], [inert]');
  };
  const cssPath = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body) {
      const tag = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      const same = parent ? [...parent.children].filter((c) => c.tagName === cur.tagName) : [];
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag);
      cur = parent;
    }
    return `body > ${parts.join(' > ')}`;
  };
  // 구조 서명: 조상의 태그·클래스 경로(위치 nth 제외) + 요소 자신의 태그. 같은 역할의 반복 요소(카드·카테고리 목록)가 한 그룹이 된다.
  // 요소 자신의 클래스는 넣지 않는다(선택된 항목만 클래스가 달라 그룹이 쪼개지므로)
  const groupOf = (el) => {
    const parts = [el.tagName.toLowerCase()];
    for (let cur = el.parentElement; cur && cur !== document.body; cur = cur.parentElement) {
      parts.unshift(`${cur.tagName.toLowerCase()}${[...cur.classList].sort().map((c) => `.${c}`).join('')}`);
    }
    return parts.join(' > ');
  };
  const interactive = 'button, a[href], [role="button"], [role="tab"], [role="checkbox"], input[type="checkbox"], input[type="radio"], label, select, summary';
  const all = [...document.querySelectorAll('body *')].filter(
    (el) => el.matches(interactive) || getComputedStyle(el).cursor === 'pointer',
  );
  // 다른 후보 안에 들어 있는 요소는 제외 (가장 바깥 클릭 요소만)
  const outer = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
  return outer.filter(isVisible).map((el) => {
    const label = (el.getAttribute('aria-label') ?? el.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || el.querySelector('img')?.alt || `<${el.tagName.toLowerCase()}>`;
    const href = el.getAttribute('href');
    return { css: cssPath(el), group: groupOf(el), label, tag: el.tagName.toLowerCase(), href };
  });
}

// 반복 요소 그룹은 앞의 2개만 누른다(첫 항목이 이미 선택된 카테고리일 수 있으므로 2개).
// 형제 버튼 몇 개(정렬·토글)가 우연히 같은 서명이 되는 경우는 모두 누른다
const REPEAT_MIN = 4;
const REPEAT_PICK = 2;
function representatives(candidates) {
  const byGroup = new Map();
  for (const c of candidates) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
  return [...byGroup.values()].flatMap((members) => (members.length >= REPEAT_MIN ? members.slice(0, REPEAT_PICK).map((m) => ({ ...m, repeat: members.length })) : members));
}

const signature = (snap) => JSON.stringify([snap.url, snap.dialogs, [...snap.texts].sort()]);

const states = [];
const leaves = [];
const seen = new Set();
const stops = [];
mkdirSync(runDir, { recursive: true });

try {
  stops.push(await startProxy());
  stops.push(await startOrder());

  // 너비 우선. 노드 = 도달 경로(actions). 매번 새로 열어 경로를 재생한다(상태를 되돌릴 방법이 없으므로)
  const queue = [{ actions: [], labels: [], parentGroups: null, group: null }];
  // 다른 화면으로 이동한다고 판명된 그룹: 더 깊은 상태에서 다시 누르지 않는다
  const navigatingGroups = new Set();
  while (queue.length && states.length < maxStates) {
    const node = queue.shift();
    if (node.actions.length > 1 && navigatingGroups.has(node.group)) {
      leaves.push({ via: node.labels, kind: 'skipped', detail: '이동 판명 그룹' });
      continue;
    }
    await proxyControl('session', { mode, cassette, session: runDir });
    let opened;
    try {
      opened = await openPage({ baseURL: APPS.order.baseURL, path, assetsDir: join(PARITY_DIR, '.cache', 'assets'), mode, device: unit.device, auth: state.auth, actions: node.actions });
    } catch (error) {
      leaves.push({ via: node.labels, kind: 'unreachable', detail: String(error).split('\n')[0] });
      continue;
    }
    const { browser, page } = opened;
    try {
      const snap = await page.evaluate(snapshot);
      const { log } = await proxyControl('log');
      const writes = log.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);
      const misses = log.filter((r) => r.miss).map((r) => `${r.method} ${r.path}`);
      const toasts = await page.evaluate(() => window.__parity?.toasts ?? []);
      const sig = signature(snap);
      const root = states[0];
      const navigated = root && snap.url.split('?')[0] !== root.url.split('?')[0];

      if (node.actions.length > 0 && navigated) {
        leaves.push({ via: node.labels, kind: 'navigates', detail: snap.url });
        navigatingGroups.add(node.group);
      } else if (seen.has(sig)) {
        // 이미 본 상태(변화 없음 포함)
      } else {
        seen.add(sig);
        const id = `S${states.length}`;
        await page.screenshot({ path: join(runDir, `${id}.png`) });
        const rootTexts = new Set(root?.texts ?? []);
        const nowTexts = new Set(snap.texts);
        const entry = {
          id,
          depth: node.actions.length,
          via: node.labels,
          actions: node.actions,
          url: snap.url,
          dialogs: snap.dialogs,
          addedTexts: snap.texts.filter((t) => !rootTexts.has(t)).slice(0, 15),
          removedTexts: [...rootTexts].filter((t) => !nowTexts.has(t)).slice(0, 10),
          writes,
          misses,
          toasts,
          texts: snap.texts,
        };
        states.push(entry);
        console.warn(`[${id}] ${node.labels.join(' → ') || '(초기)'}  +${entry.addedTexts.length}/-${entry.removedTexts.length} 텍스트, 다이얼로그 ${snap.dialogs}${writes.length ? `, 쓰기 ${writes.join(',')}` : ''}${misses.length ? `, miss ${misses.length}` : ''}`);

        // 쓰기를 일으킨 상태는 더 들어가지 않는다. 깊이 제한도 지킨다
        if (!writes.length && node.actions.length < maxDepth) {
          const candidates = await page.evaluate(listCandidates);
          // 두 번째 깊이부터는 부모 상태에 없던(새로 나타난) 그룹만 누른다: 모달 안 선택지 등.
          // 카테고리를 바꿔 카드 목록 데이터만 바뀐 경우 카드 그룹은 부모에도 있으므로 다시 누르지 않는다
          const fresh = node.parentGroups ? candidates.filter((c) => !node.parentGroups.has(c.group)) : candidates;
          const own = new Set(candidates.map((c) => c.group));
          for (const c of representatives(fresh)) {
            const label = c.repeat ? `${c.label} (반복 ${c.repeat}개 중 대표)` : c.label;
            if (c.href && /^(tel:|mailto:|https?:\/\/(?!localhost))/.test(c.href)) {
              leaves.push({ via: [...node.labels, label], kind: 'external', detail: c.href });
              continue;
            }
            queue.push({ actions: [...node.actions, { click: { css: c.css }, label: c.label }], labels: [...node.labels, label], parentGroups: own, group: c.group });
          }
        }
      }
    } catch (error) {
      leaves.push({ via: node.labels, kind: 'error', detail: String(error).split('\n')[0] });
      console.warn(`  ! ${node.labels.join(' → ')}: ${String(error).split('\n')[0]}`);
    } finally {
      await browser.close().catch(() => {});
    }
  }
  if (queue.length) console.warn(`최대 상태 수 ${maxStates}에 도달: 탐색하지 못한 경로 ${queue.length}개 (--max로 늘릴 수 있음)`);
} finally {
  stops.reverse().forEach((stop) => stop());
}

const result = { unit: unitId, state: state.name, path, mode, maxDepth, states: states.map(({ texts, ...rest }) => rest), leaves };
writeFileSync(join(runDir, 'explore.json'), `${JSON.stringify(result, null, 2)}\n`);
const md = [
  `# ${unitId} 상태 탐색 (${state.name}, 깊이 ${maxDepth})`,
  '',
  '| 상태 | 도달 경로 | 추가된 텍스트 | 사라진 텍스트 | 다이얼로그 | 쓰기·miss |',
  '|---|---|---|---|---|---|',
  ...result.states.map((s) => `| ${s.id} | ${s.via.join(' → ') || '(초기)'} | ${s.addedTexts.join(' / ')} | ${s.removedTexts.join(' / ')} | ${s.dialogs} | ${[...s.writes, ...s.misses.map((m) => `miss ${m}`)].join(', ')} |`),
  '',
  '## 탐색 끝 (더 들어가지 않은 동작)',
  '',
  ...leaves.map((l) => `- ${l.kind}: ${l.via.join(' → ')} → ${l.detail}`),
].join('\n');
writeFileSync(join(runDir, 'explore.md'), `${md}\n`);
console.warn(`상태 ${states.length}개, 끝 ${leaves.length}개 → ${join(runDir, 'explore.md')}`);
