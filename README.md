# koin-parity

KOIN_ORDER_WEBVIEW(오라클) 화면과 KOIN_WEB_RECODE(후보) 화면을 같은 API 데이터로 띄워 게이트로 비교하는 하네스.
계획 전체는 `docs/order-migration-plan.md`.

마이그레이션이 끝나면 버리는 도구라 KOIN_WEB_RECODE와 분리했다. 루프 에이전트가 작업하는 저장소에 하네스가 없으므로
에이전트는 오라클(스펙·카세트·패치·게이트)에 손댈 수 없다.

## 준비

```bash
corepack yarn install
corepack yarn playwright install chromium
```

검증 대상 저장소는 `KOIN_WEB_REPO`(기본 `../KOIN_WEB_RECODE`). 후보는 그 저장소의 ref를 `.cache/web` 워크트리로 체크아웃해 빌드한다.

## 구성

| 파일 | 역할 |
|---|---|
| `proxy.mjs` | 기록·재생·보충(fill) API 프록시. 앱의 API 경로는 `http://localhost:4000/stage` |
| `capture.mjs` | 한 상태 캡처: 스크린샷·요소 목록·요청 로그·정적 리소스 기록/재생 |
| `compare.mjs` | 게이트 판정 (현재 G0·G2·G6) |
| `mutations.mjs` | 변이 세트. 하네스가 알려진 차이를 잡는지 검증 |
| `selftest.mjs` | order 대 order 자기 검증 + 변이 탐지 |
| `verify.mjs` | 단위 검증: order 대 WEB_RECODE, 상태별 게이트 + 상태 수 대조. 루프의 PASS/FAIL 근거 |
| `fill.mjs` | 루프 밖 전용: 후보가 추가로 부르는 GET을 카세트에 보충 |
| `ssr-check.mjs` | SSR 점검: 페이지 × 기기 × 쿠키(없음/무효 access)로 서버 HTML 응답이 5xx가 아닌지. 재생 프록시가 재현 못 하는 쿠키 의존 응답 때문에 stage에 직접(live) 붙는다. 목록은 `units/ssr-check.json` |
| `regress.mjs` | 회귀 게이트(G8): WEB_RECODE 기준 ref 대 후보 ref, 데스크톱·모바일. 판정 G0+G6, G2는 참고 |
| `lib/auth.mjs` | 로그인 상태 픽스처: 기록은 stage 실로그인(`.cache/credentials.env`), 재생은 더미 JWT 쿠키 |
| `lib/freeze-time.mjs` | `next start`에 주입해 서버 시계를 고정 시각 기준으로 맞추는 훅 |
| `lib/apps.mjs` | 프록시·앱 기동. order 고정 커밋 + 오라클 패치 빌드, WEB_RECODE 워크트리 프로덕션 빌드 |
| `oracle-patches/` | 오라클 버그 수정 패치 (사람 승인, 루프 에이전트 수정 금지) |
| `units/*.json` | 작업 단위 스펙 (사람이 작성, 루프 에이전트 수정 금지) |
| `units/_common.json` | 모든 단위 공통 허용 목록 (경로 정규화, 무시할 요청) |
| `fixtures/` | 단위별 API 카세트(저장 시 개인정보·인증 정보 가림), `_common.stubs.json`(항상 고정 응답) |

`.cache/`(order 클론, WEB_RECODE 워크트리, 정적 리소스, WEB_RECODE 빌드 시점 카세트)와 `runs/`(실행 결과)는 커밋하지 않는다.
저장소가 공개이므로 이미지(저작권)와 여러 화면 실데이터가 섞인 빌드 카세트는 로컬에만 둔다. 새 환경에서는 `--fill`로 stage에서 다시 받는다.

## 사용

```bash
# stage에서 기록 + order 대 order 재생 비교
node selftest.mjs A1-shop-events --record

# 재생만 (stage 미접속)
node selftest.mjs A1-shop-events

# 변이 탐지 (지정 상태들에서 적용 가능한 변이 전부가 기대 게이트에서 FAIL이어야 통과)
node selftest.mjs A1-shop-events --mutations with-events,empty

# WEB_RECODE 자기 검증 (워크트리에 HEAD를 프로덕션 빌드). --fill: 후보가 추가로 부르는 GET만 stage에서 보충
node selftest.mjs H2-web-store-list --app web --fill

# 단위 검증: order 대 WEB_RECODE (루프가 쓰는 판정)
node verify.mjs A1-shop-events --ref <branch>

# 루프 밖: 후보가 추가로 부르는 GET 보충
node fill.mjs A1-shop-events --ref <branch>

# 회귀 게이트: 이전 대상이 아닌 화면이 기준과 같은지 (units/R-regression.json)
node regress.mjs --base origin/develop --candidate <branch> [--fill] [--pages store-list,store-detail]
```

모드: `record`(stage 전달·저장) / `replay`(저장 응답만, 루프 기본) / `fill`(재생 + 없는 GET만 보충, 루프 밖 전용).
정적 리소스는 이미 기록된 것은 재사용한다. 갱신하려면 `.cache/assets`에서 해당 파일을 지운다.

`PARITY_VERBOSE=1`이면 프록시·앱 서버 로그를 출력한다.

## 게이트

| 게이트 | 판정 |
|---|---|
| G0 | 프록시·정적 리소스 miss 없음, 필수 텍스트 존재, 요소 존재, API 요청 존재 |
| G2 | 정규화한 API 요청 집합 일치 (`units/_common.json` 무시 목록 적용) |
| G3 | 토스트 문구가 같은 순서로 나옴 |
| G4 | 분석 이벤트(gtag·dataLayer `event` 호출의 team·category·label·value) 순서 일치 |
| G6 | 본문 영역(헤더 60px 아래~푸터 위) fuzz 5% 후 다른 픽셀 0 + 요소 목록 누락·추가 없음 |
| G8 | `regress.mjs`: 기준 ref 대 후보 ref 화면 동일 (G0+G6) |

## 판정 원칙

- PASS/FAIL은 `compare.mjs`만 낸다. 에이전트의 판단은 근거가 아니다
- 하네스 포트(프록시 4000, order 4100, WEB_RECODE 4101·4102)가 이미 쓰이고 있으면 기동하지 않는다(다른 서버에 붙어 캡처하는 사고 방지)
- 단위 비교는 기기 뷰포트를 유지한다(100vh 레이아웃이 실제 사용자와 같게). 회귀 비교만 뷰포트를 페이지 높이로 늘린다
- 재생 중 카세트에 없는 요청은 stage로 넘기지 않고 miss(G0 FAIL)로 처리한다
- 시각 판정은 fuzz 5% 후 다른 픽셀 0개 + 요소 목록 누락·추가 없음. 계산된 스타일·위치 차이는 진단 정보
- Lottie·canvas·video는 픽셀 비교에서 가리고, 존재·위치·식별 정보(viewBox·레이어 수)만 요소 목록으로 검증한다
- 상호작용으로 도달하는 상태(`states[].actions`)에 도달하지 못하면 그 상태는 실패다
- 캡처 전 뷰포트를 페이지 높이로 늘려 정착시킨다(전체 페이지 캡처 중 `100vh` 레이아웃 재계산 경합 방지). Next `<Link>` 프리페치는 막는다(보이는 링크 수에 따라 서버 렌더가 일어남)
- 하네스 자체를 검증할 때 넣는 변이는 실제로 화면을 바꿨는지 먼저 확인한다(보이지 않는 요소·뒤 규칙에 덮인 속성은 무효)
