export const meta = {
  name: 'parity-unit-loop',
  description: 'order 화면을 KOIN_WEB_RECODE로 이전: 구현 ↔ verify.mjs 판정을 통과할 때까지 반복 (단위 하나)',
  whenToUse: '스택 레이어 브랜치가 준비된 parity 단위 하나를 구현할 때',
  phases: [
    { title: 'Implement', detail: '단위 화면 구현·수정 후 커밋' },
    { title: 'Verify', detail: 'verify.mjs 실행 결과를 그대로 요약' },
  ],
}

// 기기마다 다르다: parity·web은 절대 경로, env는 모든 명령 앞에 실행할 셸 문장(Node 버전·컨테이너 브라우저 등)
const PARITY = args.parity
const WEB = args.web
const ENV = args.env ? `${args.env} && ` : ''
const unit = args.unit
const branch = args.branch
const maxIterations = args.maxIterations ?? 6

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['committed', 'needs-human'] },
    commit: { type: 'string', description: '이번 반복의 커밋 SHA (committed일 때)' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', description: '이번 반복에서 바꾼 것과 근거 (3~6줄)' },
    blocker: { type: 'string', description: 'needs-human일 때: 왜 단위 범위 안에서 해결할 수 없는지' },
  },
  required: ['status', 'summary', 'changedFiles'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    tamper: { type: 'boolean', description: '하네스 저장소에 변경이 있거나 KOIN 작업 트리에 커밋되지 않은 변경이 있으면 true' },
    tamperDetail: { type: 'string' },
    pass: { type: 'boolean', description: 'report.json의 pass 값 그대로' },
    expectedCases: { type: 'number' },
    executedCases: { type: 'number' },
    runDir: { type: 'string', description: 'report.json이 있는 실행 디렉터리 절대 경로' },
    states: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          pass: { type: 'boolean' },
          failedGates: { type: 'array', items: { type: 'string' } },
          diffPixels: { type: 'number' },
          detail: { type: 'string', description: '실패 근거를 report.json에서 그대로 옮긴 것: G0 problems, G2 missing/extra, G3·G4 oracle vs candidate, G6 size·missing·extra(최대 15개)·layoutDiffs(최대 10개, 박스 포함)·styleDiffs(최대 10개), error' },
        },
        required: ['name', 'pass', 'failedGates', 'detail'],
      },
    },
  },
  required: ['tamper', 'pass', 'states', 'runDir'],
}

const implPrompt = (i, feedback) => `KOIN_WEB_RECODE에서 parity 단위 "${unit}"(${args.title})을 구현한다. 반복 ${i}/${maxIterations}.

목표: KOIN_ORDER_WEBVIEW(오라클) 화면과 같은 API 데이터로 띄웠을 때 하네스 게이트(G0·G2·G3·G4·G6)를 모두 통과하는 모바일 화면.
판정은 하네스 스크립트만 한다. 너는 구현만 하고, 통과 여부를 스스로 주장하지 않는다.

## 위치
- 셸 명령은 매번 앞에 \`${ENV || '(없음)'}\`를 붙여 실행한다(Node 버전 등 실행 환경)
- 작업 저장소: ${WEB} (현재 브랜치 ${branch}, 스택 레이어). 다른 브랜치로 바꾸지 않는다
- 단위 스펙(읽기 전용): ${PARITY}/units/${unit}.json — 상태·경로·필수 텍스트·상호작용
- 오라클 소스(읽기 전용, 오라클 패치 적용본): ${PARITY}/.cache/order/src — 참고 파일: ${args.oracleHints.join(', ')}
- 이전 지침(읽기 전용): ${PARITY}/docs/foundation.md (§0 결정, §4 이전 지침), 색 토큰 ${WEB}/src/utils/scss/order-palette.scss, 공용 ${WEB}/src/components/ui/Badge·Button, API ${WEB}/src/api/storeMobile (queries.ts)
- ${PARITY} 안의 파일은 절대 수정하지 않는다(오라클·게이트). 수정하면 이 단위는 무효 처리된다

## 수정 가능한 파일 (이 밖은 건드리지 않는다)
${args.targets.map((t) => `- ${t}`).join('\n')}
공유 파일(routes.ts, components/ui, components/layout, api/storeMobile, utils, 다른 화면)을 바꿔야만 해결된다면 고치지 말고 status를 needs-human으로, blocker에 이유를 적어 반환한다.

## 구현 원칙
- 오라클 화면의 구조·여백·글자 크기·색을 그대로 재현한다. 정확한 값은 직전 실행의 오라클 capture.json(inventory의 box·style = 계산된 스타일)과 screenshot.png를 기준으로 한다. Tailwind 클래스를 해석하기보다 계산된 값을 옮긴다
- 헤더·푸터는 비교 대상이 아니다(본문 영역만 비교: 헤더 60px 아래~푸터 위). 헤더는 골격 페이지의 StoreMobileHeader를 유지
- 데이터: getServerSideProps에서 storeMobileQueries로 프리페치하고 dehydrate/HydrationBoundary로 내려 서버가 본문까지 렌더하게 한다(CLAUDE.md 규칙 10). 오라클이 부르지 않는 API는 부르지 않는다(G2)
- 분석 이벤트는 오라클과 같은 team·event_label·value로 useLogger를 호출(G4). 토스트 문구도 같게(G3)
- SVG 아이콘·Lottie는 오라클 assets에서 복사해 쓴다(${WEB}/src/assets/svg/store/, ${WEB}/src/assets/lottie/)
- KOIN 규칙: SCSS Module + BEM, 절대 경로 import, ROUTES, isKoinError→showToast, console.log 금지

## 직전 검증 결과
${feedback}

## 마무리 (반드시)
1. ${ENV}cd ${WEB} && yarn typecheck, yarn lint(경고도 실패다: max-warnings 0. CI와 같은 명령) — 둘 다 종료 코드 0이 될 때까지 고친다
2. 바꾼 파일만 명시적으로 git add 하고 커밋: git commit -m "feat: ${args.title} 모바일 화면 이전 작업 ${i}" (본문·서명 없이)
3. git status --porcelain 이 비어 있는지 확인
4. 결과를 스키마로 반환`

const verifyPrompt = () => `판정 스크립트를 실행하고 결과를 그대로 옮겨라. 해석·추측·수정하지 않는다. 파일을 고치지 않는다.

1. cd ${PARITY} && git status --porcelain — 출력이 있으면 tamper=true, tamperDetail에 출력
2. cd ${WEB} && git status --porcelain — docs/ 외의 출력이 있으면 tamper=true, tamperDetail에 출력
3. tamper가 아니면: ${ENV}cd ${PARITY} && node verify.mjs ${unit} --ref ${branch}
   (빌드 포함 수 분 걸린다. 끝날 때까지 기다린다. 마지막 줄에 report.json 경로가 나온다)
4. 그 report.json을 읽어 스키마대로 옮긴다: pass·expectedCases·executedCases는 그대로, runDir은 report.json이 있는 디렉터리.
   states[].detail에는 실패 근거를 report.json에서 그대로 옮긴다(요약하지 말고 값 그대로, 목록은 지정한 개수까지).
   G6 실패면 detail에 diffPixels, size(oracle/candidate), missing, extra, layoutDiffs(element·oracle·candidate 박스), styleDiffs를 포함한다.`

const history = []
let feedback = '아직 검증 결과가 없다. 오라클 소스와 단위 스펙으로 첫 구현을 한다. 오라클 캡처는 ' + PARITY + '/runs/ 아래 가장 최근 *-' + unit + '-verify/<상태>/oracle/ 에 있다(capture.json, screenshot.png).'
let outcome = 'budget-exhausted'
let lastVerify = null
let noProgress = 0
let best = Infinity

for (let i = 1; i <= maxIterations; i += 1) {
  phase('Implement')
  const impl = await agent(implPrompt(i, feedback), { label: `implement #${i}`, phase: 'Implement', schema: IMPL_SCHEMA })
  if (!impl) { outcome = 'implement-agent-failed'; break }
  if (impl.status === 'needs-human') {
    history.push({ iteration: i, impl })
    outcome = 'needs-human'
    log(`반복 ${i}: 단위 범위 밖 변경 필요 — ${impl.blocker}`)
    break
  }

  phase('Verify')
  const v = await agent(verifyPrompt(), { label: `verify #${i}`, phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'low' })
  if (!v) { outcome = 'verify-agent-failed'; break }
  lastVerify = v
  if (v.tamper) {
    history.push({ iteration: i, impl, verify: v })
    outcome = 'tamper'
    log(`반복 ${i}: 작업 트리·하네스 변경 감지 — 중단 (${v.tamperDetail})`)
    break
  }

  const failingGates = v.states.reduce((n, s) => n + (s.failedGates?.length ?? 0) + (s.pass ? 0 : 1), 0)
  const pixels = v.states.reduce((n, s) => n + (s.diffPixels ?? 0), 0)
  const metric = failingGates * 1e7 + pixels
  history.push({ iteration: i, commit: impl.commit, summary: impl.summary, pass: v.pass, failingGates, pixels, runDir: v.runDir })
  log(`반복 ${i}: ${v.pass ? 'PASS' : 'FAIL'} (실패 게이트 ${failingGates}, diffPixels ${pixels}) — ${v.runDir}`)

  if (v.pass) { outcome = 'pass'; break }
  if (metric < best) { best = metric; noProgress = 0 } else { noProgress += 1 }
  if (noProgress >= 3) { outcome = 'no-progress'; log('3회 연속 개선 없음 — 중단'); break }

  feedback = `실행 디렉터리: ${v.runDir} (상태별 oracle/·candidate/의 screenshot.png·capture.json, 상태 폴더의 diff.png·report.json)\n` +
    v.states.map((s) => `- [${s.name}] ${s.pass ? 'PASS' : 'FAIL'} 실패 게이트: ${(s.failedGates ?? []).join(', ') || '-'}\n  ${s.detail}`).join('\n') +
    `\n\n이전 반복 요약: ${history.map((h) => `#${h.iteration} ${h.pass ? 'PASS' : 'FAIL'}(게이트 ${h.failingGates}, px ${h.pixels})`).join(' → ')}`
}

return { unit, branch, outcome, iterations: history.length, history, lastVerify }
