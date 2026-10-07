# KOIN_ORDER_WEBVIEW → KOIN_WEB_RECODE 모바일 통합 계획

> 2026-10-07 · 주문 기능 MVP 기준 · 방식: 하네스 + 루프 엔지니어링 (페이지 = 작업 단위, 스크립트 게이트 판정, 사람 개입 최소화)

## 1. 범위와 전제

| 구분 | 결정 |
|---|---|
| 데스크톱 | 현재 WEB_RECODE 유지. 주문 기능 없음 |
| 모바일 웹 (1차) | 상점·리뷰 이전 + 주문 가능 상점은 **조회 전용**(상점·정보·리뷰) + "앱에서 주문하기" CTA. **웹 결제 없음** |
| 모바일 웹 (2차, 보류) | MVP 결과·수요(CTA 로그)를 보고 웹 주문 전체(장바구니 → 배달지 → 결제 → 완료·내역) 추가 여부 결정 |
| 앱 | 결제만 웹뷰(WEB_RECODE `/order/checkout*`, 앱 웹뷰 전용), 나머지는 네이티브. MVP는 Android만 |
| 협업 | Android만 가능. iOS는 MVP 결과를 보고 추후 진행 — 그때까지 기존 동작을 깨지 않는 것만 보장 |
| 백엔드 | 필요한 API는 직접 작업 |
| `order.koreatech.in` | 이전 완료 후 301 → 접속 0이면 종료, 저장소 보관 |

### 선결 확인

- **order 모바일 웹 로그인 깨짐 (확인됨)**: #1526(2026-09-26)에서 `AUTH_TOKEN_KEY` 쿠키 발급이 사라져 모바일 웹에서 리뷰 작성·수정·신고 불가. 모바일 웹 상점 이용자가 사실상 없어 핫픽스 없이 Track A 이전으로 해소한다. 앱 웹뷰는 네이티브가 토큰을 주입하므로 영향 없음.
- **`scripts/hydration/dom-diff.mjs` 부재**: CLAUDE.md 규칙 10이 참조하지만 저장소·이력 어디에도 없다. 하네스에서 새로 만든다(G7).

## 2. 전체 흐름

```
P0 선결 확인 · 백엔드 API
P1 하네스 구축 ─────────────── [사람 승인 ①: 하네스 신뢰]
P2 foundation (에이전트 초안) ─ [사람 승인 ②: 구조·대응표·공통 허용 목록]
P3 파일럿 1단위 → 정답 예시 자동 등록
P4 Track A 루프 (상점·리뷰)   ┐ 배치 실행 → 실패 군집화 → 지침 보정 → 재실행
P5 Track B 루프 (조회 전용 주문 상점 + 앱 결제) ┘
P6 전환: 링크 교체 · 301 · order 종료
```

사람 개입은 ①② 두 번이 기본이다. 루프 중에는 아래 세 경우만 알림을 받는다.

1. 오라클 완화 요청(마스크·정규화·허용 차이 추가) — 자동 승인 금지
2. 단위 정체(예산 소진, 3회 연속 지표 개선 없음)
3. 상태 탐색 불확정(비결정적 상태, 픽스처 부족으로 도달 불가)

## 3. 작업 단위

단위는 두 종류다.

- **동등성 단위**: 오라클 = order 앱(고정 커밋). 대부분의 단위
- **스펙 단위**: 동작이 의도적으로 바뀌어 order 앱이 정답이 될 수 없는 단위. 오라클 = 승인된 계약(P0 Android 계약 + API 스펙). G2·G5는 계약 대비로 판정하고, 시각 오라클 여부는 단위별로 명시한다. 계약 승인은 사람 승인 ②에 포함한다

오라클 커밋: Track A는 order `1b51c34`(HEAD, 상점 이벤트 #251 포함), Track B는 `7243571`(#245 주석 처리 직전) + 라우트 주석 해제 패치. 두 커밋 사이 `src/api` 변경은 shop 쪽 21줄뿐이지만, Track B 착수 전 백엔드 계약 변경 여부를 확인한다.

### Track A — 상점·리뷰 (모바일 웹)

| # | order 경로 | WEB_RECODE 경로 | 비고 |
|---|---|---|---|
| A1 | `shop-events/:id` | `/store/:id/events` (신규) | **파일럿** |
| A2 | `shops` | `/store` 모바일 | HEAD의 NearbyShops는 주문 불가 상점만 다룸 → B2 머지 후 주문 가능 상점 포함해 Track B 오라클로 재검증 |
| A3 | `search` | `/store/search` (신규) | 결과의 주문 가능 상점·메뉴 링크(`shop/true`)는 HEAD에서 비활성 라우트 → B2 머지 후 재검증 |
| A4 | `shop/false/:id` | `/store/:id` 모바일 | ISR → SSR 전환 선행(P2) |
| A5 | `shop-detail/false/:id` | `/store/:id/info` (신규) | |
| A6 | `review/false/:id` | `/store/:id/reviews` (신규) | |
| A7 | `review/new/:id` | `/store/review/:id` | 기존 페이지 모바일 UI |
| A8 | `review/edit/:id/:rid` | `/store/review/edit/:id/:rid` | |
| A9 | `review/report/:id` | `/report/review/shopid/:id/reviewid/:rid` | |

### Track B — 주문 가능 상점 조회 (모바일 웹) + 결제 (앱 웹뷰 전용)

| # | order 경로 | WEB_RECODE 경로 | 비고 |
|---|---|---|---|
| B2 | `shop/true/:id` | `/order/shops/:id` | **조회 전용**. 공개 데이터, SSR + 기기별 캐시. 장바구니 담기·장바구니 바 자리에 "앱에서 주문하기" CTA (공통 허용 목록에 선언) |
| B4 | `shop-detail/true/:id` | `/order/shops/:id/info` | 조회 전용 |
| B5 | `review/true/:id` | `/order/shops/:id/reviews` | 조회 전용 |
| B9 | `payment` | `/order/checkout` | **스펙 단위, 앱 웹뷰 전용**. 얇은 결제 화면: 금액 요약 + Toss 위젯 + 약관 + 결제 버튼. 네이티브가 만든 임시 주문으로 진입, 금액은 서버 값. 시각 오라클 = 옛 Payment 화면의 해당 구역(`PaymentAmount`·`TossWidget`·`Agreement`·결제 버튼)만 요소 단위 비교, 나머지 구역은 대상 아님 |
| B10 | `payment/return` | `/order/checkout/success`, `/fail` | **스펙 단위, 앱 웹뷰 전용**. confirm 후 브릿지 `paymentCompleted`/`paymentFailed` |

**"앱에서 주문하기" CTA**: Android는 앱 링크(설치 안 됐으면 Play 스토어), iOS·기타는 "현재 Android 앱에서만 주문할 수 있어요" 안내. 클릭을 `useLogger`로 기기·OS별 기록 → 2차(웹 주문) 판단 근거.

**`/order/checkout*` 접근 제한**: 브릿지가 없으면(모바일 웹·데스크톱) 결제 대신 안내 화면.

**2차로 보류한 단위** (웹 주문 결정 시 추가): B1 `home` → `/order`, B3 메뉴 상세(옵션·담기), B6 장바구니, B7·B8 배달지, B11 결과, B12 취소, B13 주문 내역, 그리고 B9의 모바일 웹 주문서 버전(옛 Payment 화면 전체 이전 = (a)안).

경로명은 P2에서 확정한다.

## 4. P0 — 선결 확인 · 백엔드

- (후순위) 아래 백엔드·Android 항목은 B9·B10 착수 전까지만 끝내면 된다. Android 외부 결제 앱 스킴 처리 여부만 먼저 문의
- 백엔드 API (직접 작업)
  - `POST /auth/webview-code` — Bearer → 단기·일회용 code
  - `POST /auth/webview-session` — code → HttpOnly 세션 + CSRF 쿠키
  - 임시 주문 조회 — checkout이 금액을 서버 값으로 받기 위함
  - 임시 주문 만료 정책
  - `payments/confirm` **멱등 처리**(새로고침·재시도 시 기존 결과 반환), 금액 대조, confirm 시점 가격·품절 재검증
  - 결제 완료된 임시 주문으로 checkout 재진입 시 결과로 보내기 위한 상태 조회
  - 결제 앱에서 복귀 실패 대비: "결제 확인 중" 상태와 재확인 경로(Toss 승인은 confirm 없이 10분 후 만료)
- Android 계약: 결제 웹뷰 진입 URL·파라미터, 브릿지 `paymentCompleted(paymentId)` / `paymentFailed(reason)` / `navigateBack`, **외부 결제 앱 스킴(`intent://`·카드사/간편결제) 처리**(`shouldOverrideUrlLoading`) 구현 여부, "앱에서 주문하기" 앱 링크 수신
- 결제 페이지 보안: success URL의 `paymentKey`·`orderId`·`amount`를 confirm 직후 `history.replaceState`로 제거, 분석(GA)·Sentry 수집 제외, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`

## 5. P1 — 하네스 (별도 private 저장소 `ff1451/koin-parity`)

마이그레이션이 끝나면 버리는 도구라 KOIN_WEB_RECODE에 넣지 않는다. 공개 저장소 이력에 테스트 의존성 바이너리(Zero-Install `.yarn/cache`)·stage 데이터·오라클 패치를 남기지 않기 위함이다. 검증 대상은 `KOIN_WEB_REPO`(기본 `../KOIN_WEB_RECODE`)의 ref를 하네스의 `.cache/web` 워크트리로 체크아웃해 빌드한다.

### 5.1 구성 요소

| 구성 | 역할 |
|---|---|
| 기록·재생 프록시 | 두 앱의 API 경로(`VITE_API_PATH`, `NEXT_PUBLIC_API_PATH`)를 여기로. **기록** 모드: stage로 전달하며 요청·응답 저장(픽스처 생성, 백엔드 변경 시 해당 엔드포인트만 재기록). **재생** 모드(루프 기본): 저장 응답만 반환, stage 미접속 — 쓰기 요청도 stage를 건드리지 않음. **덮어쓰기**: 경계 상태(리뷰 0·이미지 없음·긴 상호명·영업 종료·품절·500)를 엔드포인트별로 주입. 모든 모드에서 요청을 SSR/클라이언트 구분해 기록. 정적 이미지도 로컬 제공. 세부는 §5.3 |
| 앱 러너 | order 고정 커밋 워크트리(pnpm, :3000) + WEB_RECODE 단위 브랜치(yarn, :3001) 기동 |
| 결정성 장치 | 브라우저 `page.clock` + **서버 고정 시각 주입**(프록시가 now 제공 또는 Next 서버 훅), 애니메이션·Swiper 자동재생 끔, 웹폰트 로드 대기, 기기 Pixel 5·UA 고정, Toss SDK·`window.Android`·`window.webkit` 스텁 |
| 상태 탐색기 | order 앱에서 인터랙티브 요소를 순회하며 도달 가능한 상태(모달·바텀시트·토스트·활성화 변화·단계 전이)를 픽스처 × 인증(guest/auth) × 환경(웹/앱 웹뷰) 조합으로 수집. 상태별 요소 목록과 계산된 스타일 추출 → 구현 입력이자 검증 체크리스트 |
| 게이트 실행기 | §5.2 게이트를 싼 순서로 실행, 실패한 축만 재실행, PR 직전 전체 재실행 |
| 리포트 | `report.json`(커밋 SHA·스펙 해시·기대/실행 케이스 수·게이트별 결과) + 상태별 3열 이미지(order │ WEB_RECODE │ diff) |
| 변이 세트 | order 복사본에 알려진 차이 주입 → 탐지율 측정 |

검증 체크리스트는 구현 플랜이 아니라 **상태 탐색기가 order 앱에서 직접 만든다**. 구현과 검증이 같은 플랜을 보면 플랜에서 빠진 상태를 둘 다 놓친다.

### 5.2 게이트

모든 게이트는 스크립트가 판정한다. LLM은 원인 설명·상태 탐색 보조만 하고 PASS를 낼 수 없다.

| 게이트 | 판정 |
|---|---|
| G0 오라클 무결성 | 스펙·픽스처·마스크·임계값 해시 일치. 양쪽 모두 픽스처 데이터가 실제로 렌더됐는지(필수 텍스트·요청 발생) — 둘 다 빈 화면이면 FAIL |
| G1 정적 검사 | `yarn typecheck`, `yarn lint`, KOIN 컨벤션 grep(ROUTES·showToast·isKoinError·console.log 금지·하드코딩 색) |
| G2 네트워크 계약 | 상태·시나리오별 요청 method·path·query·body 동일 (공통 정규화 적용) |
| G3 상태 도달·결과 | 상태 목록의 모든 상태에 WEB_RECODE에서도 도달. URL 전이·보이는 텍스트·활성화 여부 동일. 도달 불가 = FAIL |
| G4 분석 이벤트 | `event_label` 집합·순서 동일 |
| G5 브릿지 호출 | 메서드·인자·순서 동일 (결제·앱 웹뷰 상태) |
| G6 시각 | 상태별 스크린샷 **fuzz 5% 후 다른 픽셀 0개**. 요소 목록 짝 맞춤(텍스트+role)에서 누락·추가 = FAIL. 계산된 스타일 차이는 진단 정보로 리포트 |
| G7 SSR 결정성 | 하이드레이션 DOM 파괴율(신규 도구) 0, 콘솔 에러 0 |
| G8 데스크톱 자기 회귀 | `/store` 공유 페이지의 데스크톱이 **스택의 바로 아래 레이어**(최하위는 refactor tip)와 G2·G6 기준 동일. 단위는 모바일만 바꾸므로 데스크톱은 직전 상태와 같아야 한다. develop 동기화로 들어온 변경도 자동으로 기준에 반영된다 |
| G9 URL·SEO | order 옛 경로 → 새 경로 301 매핑 정확. SSR 페이지 메타·사이트맵이 바로 아래 레이어 대비 회귀 없음 |

### 5.3 프록시 · 포트 · 쿠키

```
order (vite, :3000) ─────┐
                          ├→ 프록시 (http://localhost:4000/stage) ─(기록 모드만)→ stage API
WEB_RECODE (next start, :3001) ┘
```

- **CORS는 프록시가 처리한다.** 브라우저는 stage가 아니라 프록시를 호출하므로 stage의 CORS 허용 출처(localhost:3000)와 무관하다. 프록시가 두 출처(`:3000`, `:3001`)에 `Access-Control-Allow-Origin`(명시 출처) + `Allow-Credentials`를 응답한다. stage로는 서버 간 요청이고 `Origin`/`Referer`를 stage 웹 출처로 고정한다(`src/pages/api/proxy`와 같은 방식)
- **WEB_RECODE는 프로덕션 빌드(`next build && next start -p 3001`)로 띄운다.** dev 모드는 브라우저 요청을 `/api/proxy`로 우회하고 StrictMode 이중 렌더·오버레이가 섞여 결정성이 떨어진다
- **`IS_STAGE` 판정 주의.** `IS_STAGE`는 `NEXT_PUBLIC_API_PATH`에 `stage`가 들어있는지로 정해지고, 쿠키 이름(`__Secure-koin-stage-web-csrf`)·도메인이 여기에 따라 갈린다. 프록시 주소를 `http://localhost:4000`으로 주면 프로덕션 쿠키 이름을 찾아 CSRF 쿠키를 못 읽고 비로그인으로 동작한다. 그래서 API 경로를 `http://localhost:4000/stage`로 주고 프록시가 `/stage` 접두사를 떼어 전달한다(`api.stage.localhost` 호스트는 Node fetch가 해석하지 못해 폐기)
- **Set-Cookie 재작성.** 기록·재생 모두 `Domain=` 제거 후 `Path=/` (`src/pages/api/proxy`의 `rewriteSetCookie`와 동일). `__Secure-` 접두사 쿠키는 Chromium이 localhost를 보안 컨텍스트로 보므로 유지된다
- **쿠키는 포트를 구분하지 않는다.** localhost의 쿠키는 :3000/:3001이 공유하므로 order 실행과 WEB_RECODE 실행은 **별도 브라우저 컨텍스트**로 돌린다
- **인증 픽스처.** 기록 모드에서 stage 테스트 계정으로 로그인해 order용 Bearer(`AUTH_TOKEN_KEY`)와 WEB_RECODE용 세션 응답(`/v2/web/auth/session`)을 함께 기록한다. 재생 시 두 앱 모두 같은 사용자로 보인다
- **stage 직접 사용처.** PR 직전 읽기 전용 스모크(기록과 실 API 불일치 감지), Toss 테스트 결제 수동 확인

### 5.3.1 결정성 장치 (M1에서 확인한 것)

- Chromium 래스터 고정 플래그(`--disable-gpu`, `--disable-partial-raster`, `--force-color-profile=srgb` 등)
- 가짜 시계: `page.clock.install` + `pauseAt(고정 시각)` → 로드 후 `runFor(2000ms)`. CSS 애니메이션 차단만으로는 rAF 기반 애니메이션(Lottie)이 멈추지 않는다
- **동적 영역 자동 마스킹**: Lottie(`svg:has([id^="__lottie_element"])`)·canvas·video는 가짜 시계로도 프레임이 완전히 고정되지 않아 픽셀 비교에서 가린다. 대신 요소 목록에 `animation` role로 남겨 존재·위치는 계속 검증한다(변이 `remove-animation`으로 확인). 마스킹 면적은 리포트 `maskedRatio`
- **계산된 스타일은 진단 전용**: order 폰트는 Pretendard 400·700만 있어 600 지정도 700으로 그려진다. WEB_RECODE에 실제 600 굵기가 있으면 "계산된 스타일 동일"과 "픽셀 동일"이 충돌하므로, 판정은 픽셀로만 한다
- **WEB_RECODE는 하네스의 워크트리(`.cache/web`)에서 `next build` → `next start`**. 빌드 시점 API(ISR 사전 렌더)는 `.cache/web-build.cassette.json`으로 fill 기록해 빌드 결과를 고정(여러 화면 실데이터가 섞여 커밋하지 않음). 준비 확인은 `/api/health`
- **ISR 페이지는 요청 기록이 캐시 상태에 따라 달라진다(M2에서 확인)**: 서버 기동 후 첫 캡처만 서버 요청 4건, 이후는 0건 → G2가 흔들리고 상태별 카세트도 반영되지 않는다. foundation의 `/store/[id]` SSR 전환이 필수
- **`next/image` 원격 이미지는 원본으로 대체**: `/_next/image?url=` 요청을 가로채 원본 자산을 기록·재생. 오라클(order)도 원본을 그리므로 공정하고, 서버 쪽 외부 요청도 없앤다
- **lazy 이미지는 eager로 전환** 후 로드 대기(두 앱 동일 적용). 페이지 안 타이머는 가짜 시계라 대기 제한은 Node 쪽에서 건다
- **공통 고정 응답**(`fixtures/_common.stubs.json`): `POST /abtest/assign`은 무작위 배정이라 `default` 변형으로 고정. order에 없는 요청이므로 `units/_common.json`의 G2 무시 목록에도 등록
- **오라클 패치**(`oracle-patches/order/`): order 버그는 패치로 고친 화면을 오라클로 쓴다(0001: 이벤트 썸네일 필드명)

### 5.4 하네스 수용 기준 → 사람 승인 ①

- order 대 order: 전 게이트 100% PASS (결정성 확인)
- order 대 변이본: 변이 전부 탐지. 최소 변이 목록 — 요소 4px 이동, 색 미세 변경, font-weight 변경, 아이콘 제거, 문구 한 글자, 모달 안 버튼 순서, 빈 상태 문구 누락, 요청 하나 제거, 로그 하나 제거, 2단계 버튼 비활성
- 사람이 나중에 하네스 PASS인데 차이를 발견하면 → 그 사례를 변이로 추가하고 탐지될 때까지 하네스를 먼저 고친다

## 6. P2 — foundation (에이전트 초안 → 사람 승인 ②)

- 라우트 확정, `ROUTES` 추가
- `/order/shops/*` (조회 전용): `getServerSideProps` + `withCacheControl`로 기기 판정, 데스크톱은 서버가 안내 화면 렌더
- `/order/checkout*`: 앱 웹뷰 전용. 사용자별 데이터는 클라이언트 조회, 브릿지가 없으면 안내 화면
- `/store/[id]` ISR → SSR + `withCacheControl` 전환 (기기별 캐시, 규칙 10)
- **폰트 스코프 수정** (`docs/css-improvement-survey.md` A-1): 포털 콘텐츠(모달·바텀시트)가 Pretendard를 상속하지 못함. 그대로 두면 G6(다른 픽셀 0)에서 모달 상태가 전부 폰트로 실패해 UI 축이 정체된다
- 상점 API 버전 정렬(`v3/shops`, `v2/shops/:id`, v2 검색) + 데스크톱 회귀 확인
- 공통 브릿지: `iosBridge.ts`를 iOS(`tokenBridge`)·Android(`postMessage` + 직접 호출 폴백) 공용으로 확장
- 앱 웹뷰 결제 인증: 일회용 code → 세션 진입점
- 의존성: `@tosspayments/tosspayments-sdk` (`.pnp.cjs`·`.yarn/cache` 포함 커밋). Playwright 등 검증 도구는 하네스 저장소에만 둔다
- **마이그레이션 지침 문서** (구현 에이전트 입력)
  - 파일 위치: `components/Store/...`, `components/Order/...`, `api/order/...`
  - order `entity.ts` 타입 재사용 규칙
  - **공용 UI 대응표**: order `BottomModal`·`CenterModal`·`Button`·`Badge`·Toast → WEB_RECODE 기존 컴포넌트(없으면 신규 공용으로 1회 생성)
  - **토큰 매핑표**: Tailwind 색·간격·타이포 → KOIN SCSS 토큰
  - react-router → Next 기계 변환 규칙(`useParams`·`useNavigate`·`useSearchParams` → `useRouter`·`ROUTES`)
  - (2차) 주문 상태: `useOrderStore`의 주소·전화번호 localStorage 영속 금지(서버 배달지 API 또는 메모리)
  - 쿼리 키 `getViewerScope()`, mutation `isKoinError` → `showToast`, 상호작용마다 `useLogger`
- **공통 허용 목록**: API 버전 경로 정규화, 인증 헤더·쿠키 제거, 레이아웃 헤더 마스크, 주문 가능 상점의 장바구니 담기·장바구니 바 → "앱에서 주문하기" CTA 대체. 단위별 허용 추가가 거의 없도록 여기서 끝낸다
- **스펙 단위 계약**: B9·B10의 요청·브릿지 계약을 스펙 파일로 확정 (승인 ②에 포함)

## 7. P3~P5 — 루프

### 7.1 단위 루프

```
analyze  상태 탐색 결과 + order 소스·import 그래프 + 대응 WEB_RECODE 파일 + 정답 예시 수집
pre      규칙 기반 사전 변환 (라우터 API, 토큰 매핑)
api      api/queries 구현 → G1·G2
ui       화면 구현 → G3~G9
fix      실패 축만: 실패 리포트(구체적 위치·원인) + diff 이미지 + 파일 최신본 재투입
final    전 게이트 재실행 (UI 수정이 다른 축을 깨는 회귀 방지)
pr       gh stack add/submit으로 스택에 레이어 추가(draft). PR 본문은 report.json에서 생성(gh pr edit), 3열 이미지 첨부
```

- 구현 에이전트는 `src/`만 수정. 하네스·스펙·픽스처는 읽기 전용
- 예산: 축별 상한(UI 6회, 나머지 4회), 3회 연속 무개선 시 정지·알림
- 구현은 Claude Code Workflow 스크립트(`.claude/workflows/order-migration-loop.js`)로 작성

### 7.2 배치 보정 (Sample → Tune → Sweep)

여러 단위를 한 번 돌린 뒤 실패를 게이트·원인별로 군집화 → 대표 사례로 **지침 문서·매핑표·공용 컴포넌트**를 보정 → 남은 단위 재실행. 에이전트가 자동 수행하되 **게이트·임계값·허용 목록은 수정 불가**.

### 7.3 순서

- P3: A1(상점 이벤트) 파일럿. 전 게이트 통과 결과를 정답 예시로 자동 등록, 예산·임계값 보정
- P4: A2~A9. A2·A3는 B2 머지 후 재검증
- P5: P0 백엔드 완료 후 B9·B10(결제) 우선 → Android 연동 → B2·B4·B5. 실제 Toss 테스트 키 결제는 스테이지 Android 앱에서 루프 밖 수동 확인

## 7.4 브랜치 전략 — 통합 브랜치 + stacked PR (`gh stack`)

```
develop ──●──────────────●(동기화 merge)────────────────────────● ← 최종 PR 1회
           \              \                                    /
            refactor/order-integration ●──────●───────●────────●     (스택의 trunk)
                                        \      ↑ 승인된 하위 레이어부터 머지
                                         order/foundation ← order/a1-shop-events ← order/a2-store-list ← …
```

- `gh stack init --base refactor/order-integration order/foundation`으로 통합 브랜치를 trunk로 삼는다. develop은 최종 머지 전까지 건드리지 않는다
- 화면 단위로 나누는 이유는 배포 단위가 아니라 **AI 정확도**(작업이 크면 놓치는 게 많아짐). 배포는 refactor → develop 최종 PR 한 번
- **승인된 하위 레이어는 바로 refactor에 머지**한다(`gh stack merge <n> --yes`). 스택에는 진행 중인 단위 몇 개만 남아 얕게 유지되고, 아래 레이어 수정에 따른 restack 범위도 작아진다
- **하네스는 KOIN_WEB_RECODE 밖(private 저장소 `koin-parity`)에 둔다.** refactor·스택에는 이전 코드만 들어간다
- **오라클 변조 방지**
  - 루프 에이전트가 작업하는 저장소에 하네스가 없으므로 스펙·카세트·패치·게이트를 바꿀 수 없다
  - 루프 에이전트 실행 설정에서 하네스 디렉터리 쓰기를 권한으로 차단(Claude Code `permissions.deny`의 `Edit`/`Write` 경로 규칙). 하네스 수정은 루프 밖에서 사람이 지시할 때만
  - 판정은 `verify.mjs`의 종료 코드와 `report.json`(상태 수 대조 포함)만 근거로 한다
- **공유 파일은 foundation에 몰아둔다**: `routes.ts` 전체 경로, 공용 UI, 의존성·`.pnp.cjs`·`.yarn/cache`. 단위 레이어는 자기 화면 디렉터리만 수정. 진행 중 공유 파일 수정이 필요하면 그 단위를 멈추고 공유 파일 보강 레이어를 먼저 처리
- **스택은 선형**이므로 단위는 순차 실행
- **누적 회귀 검사**: 레이어를 refactor에 머지하거나 restack할 때마다 이미 반영된 단위 전체의 게이트를 다시 실행. 싼 게이트(G0~G4)는 매번, 시각 게이트(G6~G8)는 머지·restack 시 또는 야간
- **develop 동기화**: 주 1회 + 공유 파일 변경 시 develop을 refactor에 **merge** → `gh stack sync`로 남은 스택을 refactor 위로 rebase → 누적 회귀 검사. `git config rerere.enabled true`. `.yarn/cache` 충돌은 손으로 풀지 않고 `yarn install`로 재생성
- **G8 기준 = 바로 아래 레이어**(최하위 레이어는 refactor tip): 단위 레이어는 모바일만 바꾸므로 데스크톱이 부모와 같아야 한다
- 착수 시 저장소에서 stacked PR 사용 가능 여부 확인(`gh stack` 종료 코드 9 = 미지원). 비대화 플래그(`view --json`, `submit --auto`, `merge <n> --yes`)만 사용
- **최종 머지 전**: develop 동기화 → 전 단위 전체 게이트 → stage 확인 → refactor → develop PR. 이 시점에 `order.` 301 일괄 전환

## 8. P6 — 전환

- WEB_RECODE의 `ORDER_BASE_URL` 링크 5곳(`MobileHomeRedesign`, `IndexStore`, `MobileHeader/Panel`, `category`, `CallvanCard`) → `ROUTES`
- `order.` nginx: refactor → develop 머지·배포 시점에 옛 경로 전체를 새 경로로 301 (일괄 전환)
- 접속 로그 0 확인 후 `order.` 종료, 배포 워크플로·`/usr/local/koin/webview-order` 정리, KOIN_ORDER_WEBVIEW 보관 처리

## 9. 리스크

| 리스크 | 대응 |
|---|---|
| 하네스가 차이를 놓침(과거 사례) | 스크립트 판정 · 기준 이미지 저장 안 함 · 변이 탐지 100% · 발견 사례 즉시 변이화 |
| Tailwind preflight vs KOIN 전역 CSS로 UI 축 정체 | 계산된 스타일을 구현 입력으로 제공, 축별 예산, 정체 시 알림 |
| SSR fetch를 `page.route`로 못 가로챔 | 기록·재생 프록시(P1 필수) |
| 루프가 stage 데이터 오염·실행마다 결과 변동 | 루프는 재생 모드만 사용. stage는 기록·PR 직전 읽기 전용 스모크에만 |
| 서버 시각 비결정성 | 서버 고정 시각 주입 |
| order HEAD에 주문 라우트 없음 | Track B는 `7243571` + 패치를 오라클로 |
| 구버전 iOS 앱의 하드코딩 경로 | 301 상시 유지 |

## 10. 2차(웹 주문) 착수 시 추가로 필요한 것

MVP 결과와 CTA 로그로 웹 주문을 결정하면 아래를 함께 진행한다. 하네스·단위 구조는 그대로 재사용하고 보류 단위만 루프에 추가한다.

- 결제 화면은 (a)안: 모바일 웹은 옛 Payment 화면(주소·연락처·요청사항 포함)을 그대로 이전해 시각 동등성 유지, 앱은 같은 페이지에서 입력 구역을 숨김
- **세션 없이 동작하는 confirm**: 결제 앱이 원래 탭이 아닌 다른 브라우저(예: 카카오톡 인앱 → 기본 브라우저)로 복귀하면 세션 쿠키가 없다. `orderId` + Toss 시크릿 검증으로 확정, 결과 화면은 비로그인도 완료 표시
- 인앱 브라우저(카카오톡·인스타그램·에브리타임) 외부 앱 호출 불안정 → 실기기 검증(iOS Safari·삼성 인터넷·카카오톡 인앱), 필요 시 외부 브라우저 열기 안내
- **Toss 가맹 범위 확인**: `koreatech.in` 웹 결제 채널·도메인 추가 심사, 사업자 정보·약관·환불 정책 표시 요건 — 개발보다 오래 걸릴 수 있어 2차 결정 즉시 착수
- iOS 앱 사용자는 웹 주문이 유일한 경로가 되므로 iOS Safari 결제는 필수 검증
