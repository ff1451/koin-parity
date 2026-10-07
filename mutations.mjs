// 하네스 변이 세트: 오라클 화면에 알려진 차이를 하나씩 넣고, 기대한 게이트가 FAIL을 내는지 확인한다.
// 하네스가 놓친 실제 사례가 생기면 여기에 추가하고, 탐지될 때까지 하네스를 먼저 고친다.
//
// 변이는 특정 화면의 선택자에 묶이지 않도록 "화면에 실제로 보이는 첫 텍스트 요소"를 대상으로 삼는다.
// mutate는 실제로 화면을 바꿨는지 반환한다. false면 해당 상태에 적용 대상이 없음(N/A)

// 페이지 안에서 실행: 뷰포트 안에서 다른 요소에 가려지지 않은 첫 텍스트 요소에 fn을 적용한다
const onVisibleText = (fnSource) => async (page) =>
  page.evaluate((source) => {
    // eslint-disable-next-line no-new-func
    const apply = new Function('el', 'node', source);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const el = node.parentElement;
      if (node.textContent.trim().length > 1 && el) {
        const r = el.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const inViewport = r.width > 0 && r.height > 0 && cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight;
        const top = inViewport ? document.elementFromPoint(cx, cy) : null;
        if (top && (top === el || el.contains(top))) {
          apply(el, node);
          return true;
        }
      }
    }
    return false;
  }, fnSource);

const removeFirst = (selector) => async (page) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el?.remove();
    return !!el;
  }, selector);

export const MUTATIONS = [
  {
    name: 'shift-4px',
    description: '보이는 첫 텍스트를 4px 아래로 이동',
    expect: ['G6'],
    mutate: onVisibleText("el.style.position = 'relative'; el.style.top = '4px';"),
  },
  {
    name: 'color-subtle',
    description: '보이는 첫 텍스트 색을 약간 변경',
    expect: ['G6'],
    mutate: onVisibleText(`
      const [r, g, b] = getComputedStyle(el).color.match(/\\d+/g).map(Number);
      const shift = (v) => (v > 127 ? v - 26 : v + 26);
      el.style.color = 'rgb(' + shift(r) + ',' + shift(g) + ',' + shift(b) + ')';
    `),
  },
  {
    name: 'font-weight',
    description: '보이는 첫 텍스트 굵기를 400↔700으로 변경',
    // order 폰트는 400·700 두 굵기만 있어 600→700은 화면상 동일하다(계산된 스타일 진단에만 남음).
    // 사용자에게 보이는 굵기 변화로 검증한다
    expect: ['G6'],
    mutate: onVisibleText("el.style.fontWeight = Number(getComputedStyle(el).fontWeight) >= 600 ? '400' : '700';"),
  },
  {
    name: 'hide-icon',
    description: '본문 영역(헤더 60px 아래)의 첫 svg 아이콘 제거',
    expect: ['G6'],
    mutate: async (page) =>
      page.evaluate(() => {
        // 화면에 실제로 보이는 아이콘만: 본문 영역이면서 중심점이 다른 요소에 가려지지 않은 것
        const el = [...document.querySelectorAll('svg')].find((svg) => {
          const r = svg.getBoundingClientRect();
          if (r.width < 1 || r.height < 1 || r.top + scrollY < 60) return false;
          const cx = r.x + r.width / 2;
          const cy = r.y + r.height / 2;
          if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) return false;
          const top = document.elementFromPoint(cx, cy);
          return !!top && (top === svg || svg.contains(top));
        });
        el?.remove();
        return !!el;
      }),
  },
  {
    name: 'text-one-char',
    description: '보이는 첫 텍스트에 글자 하나 삽입',
    expect: ['G6'],
    mutate: onVisibleText("node.textContent = node.textContent.slice(0, 1) + ' ' + node.textContent.slice(1);"),
  },
  {
    name: 'remove-animation',
    description: '마스킹되는 Lottie 애니메이션을 통째로 제거 (마스킹이 누락을 숨기지 않는지)',
    expect: ['G6'],
    mutate: removeFirst('svg:has([id^="__lottie_element"])'),
  },
  {
    name: 'swap-animation',
    description: '마스킹되는 Lottie를 다른 애니메이션으로 교체 (레이어 하나 제거로 모사)',
    expect: ['G6'],
    mutate: removeFirst('svg:has([id^="__lottie_element"]) > g > g'),
  },
  {
    name: 'drop-analytics',
    description: '앱이 분석 이벤트를 보내지 않음 (gtag·dataLayer 무력화)',
    expect: ['G4'],
    // 오라클 상태에 분석 이벤트가 있어야 의미가 있다
    appliesTo: (oracle) => (oracle.gtag ?? []).some((args) => args[0] === 'event'),
    beforeGoto: async (context) => {
      await context.addInitScript(() => {
        const noop = () => 0;
        Object.defineProperty(window, 'gtag', { value: () => {}, writable: false, configurable: false });
        if (window.dataLayer) window.dataLayer.push = noop;
      });
      return true;
    },
  },
  {
    name: 'drop-request',
    description: '화면의 주 API 요청(단위 스펙 primaryRequest)을 보내지 않음',
    expect: ['G2'],
    beforeGoto: async (context, unit) => {
      if (!unit.primaryRequest) return false;
      await context.route(new RegExp(unit.primaryRequest), (route) => route.abort());
      return true;
    },
  },
];
