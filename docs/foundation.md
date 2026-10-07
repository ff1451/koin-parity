# P2 foundation (승인 ② 완료: 2026-10-07)

> 2026-10-07 · 스택 최하단 레이어 `order/foundation`에 들어갈 공통 작업과, 루프가 따를 결정 사항
> 근거: WEB_RECODE·order 코드 조사 (order는 `1b51c34`, 결제는 `7243571`)

## 0. 결정 사항

승인 결과: D1은 (a) 60px로 시작해 **전 단위 통과 후 WEB_RECODE 헤더(56.8px)와 통일**하는 후속 작업으로 처리, D2는 오라클 패치(폰트 파일 교체), D3~D7은 권장안대로.


| # | 결정 | 권장안 | 이유 |
|---|---|---|---|
| D1 | 화면 크롬(헤더·푸터) | **WEB_RECODE 크롬(`MobilePageHeader`·Footer)을 쓰고 본문만 비교 + 이전 화면의 헤더 높이를 60px로 맞춤** | 실측: order 본문 시작 60px(`pt-15`), `MobilePageHeader` 56.8px. 3.2px 차이는 본문 전체를 밀고, order가 `min-h-[calc(100vh-60px)]`로 화면 높이 기준 배치하는 요소(빈 상태 중앙 정렬 등)는 더 어긋나 본문만 잘라 비교해도 해결되지 않는다. 대안: (a) 이전 화면만 헤더 60px — 동등성 유지, 사이트 다른 화면과 3px 차이 (b) 단위별 위치 허용 오차 — 픽셀 0 기준이 약해짐 (c) order 헤더 재현 — 이 화면들만 모양이 달라짐. 헤더는 제목·뒤로가기 존재만 요소 목록으로 검증 |
| D2 | 폰트 | **오라클 패치로 order의 폰트를 WEB_RECODE와 같은 파일(Pretendard 서브셋 9개 굵기)로 교체**, WEB_RECODE는 의도한 굵기 그대로 | 실측: order는 전체 폰트 Regular·Bold 2개(약 780KB), WEB_RECODE는 서브셋 9개(약 270KB)로 400·700도 파일이 다르다. 파일이 다르면 글리프·메트릭 차이로 픽셀 0에 도달할 수 없고, order는 `font-medium`→400·`font-semibold`→700으로 그려져 디자인 의도와도 다르다. 서브셋에 없는 글자(사용자 리뷰의 드문 한자 등)는 두 앱 모두 대체 폰트로 떨어지며, 대체 폰트 체인 차이는 해당 픽셀만 영향 |
| D3 | 공용 UI | 본문 안 컴포넌트는 order 모양 재현. 없는 공용 컴포넌트(Badge·Button)는 `src/components/ui`에 신규. 토스트는 규칙대로 `showToast`, 토스트는 텍스트만 검증 | WEB_RECODE에 Button·Badge·Tabs 공용 컴포넌트가 없다. 토스트 모양(order 자체 구현 vs react-toastify)은 규칙상 바꿀 수 없음 |
| D4 | 데스크톱 접근 | 기존 경로(`/store`, `/store/[id]`, 리뷰 작성·수정·신고)는 서버에서 기기 분기. 모바일 전용 신규 경로는 데스크톱이면 서버 리다이렉트(`/store/[id]`로) | 규칙 10: 기기는 `serverRequest.device`로 서버가 확정 |
| D5 | API | 모바일은 order가 쓰는 엔드포인트 채택(`v3/shops`, `v2/shops/{id}`, `shops/{id}/summary`, `v2/shops/search/related`). **데스크톱 API는 이번에 건드리지 않음** | 데스크톱 정렬은 범위·회귀 위험만 키운다. 중복 API 정의는 이전 후 정리 |
| D6 | order 버그 | 아래 §6 표의 "패치"만 오라클 패치로 고치고 나머지는 이전하지 않음(데드 코드) | 버그까지 옮기지 않되, 동작이 바뀌는 수정은 사람이 고른 것만 |
| D7 | 분석 이벤트 | 모바일 화면은 order의 `event_label`을 그대로 유지(G4로 검증). 데스크톱 기존 라벨은 유지 | 이전 후 대시보드 지표 단절 방지 |

## 1. 라우트 (Track A + 1차 Track B)

| 단위 | order | WEB_RECODE | ROUTES 헬퍼 | 데스크톱 |
|---|---|---|---|---|
| A1 | `shop-events/:id` | `/store/[id]/events` | `StoreEvents({ id })` 신규 | → `/store/[id]` |
| A2 | `shops?category&sort&filter` | `/store` 모바일 | `Store()` 기존 | 기존 UI |
| A3 | `search` | `/store/search` | `StoreSearch()` 신규 | → `/store` |
| A4 | `shop/false/:id` | `/store/[id]` 모바일 | `StoreDetail({ id })` 기존 | 기존 UI |
| A5 | `shop-detail/false/:id` | `/store/[id]/info` | `StoreInfo({ id })` 신규 | → `/store/[id]` |
| A6 | `review/false/:id?sort` | `/store/[id]/reviews` | `StoreReviews({ id })` 신규 | → `/store/[id]` |
| A7 | `review/new/:id` | `/store/review/[id]` | `Review({ id })` 기존 | 기존 UI |
| A8 | `review/edit/:id/:rid` | `/store/review/edit/[id]/[reviewid]` | `ReviewEdit` 기존 | 기존 UI |
| A9 | `review/report/:id?reviewId` | `/report/review/shopid/[id]/reviewid/[reviewid]` | `ReviewReport` 기존 | 기존 UI |
| B2 | `shop/true/:id` | `/order/shops/[id]` | `OrderShop({ id })` 신규 | 안내 화면 |
| B4 | `shop-detail/true/:id` | `/order/shops/[id]/info` | `OrderShopInfo({ id })` 신규 | 안내 화면 |
| B5 | `review/true/:id` | `/order/shops/[id]/reviews` | `OrderShopReviews({ id })` 신규 | 안내 화면 |
| B9·B10 | `payment`, `payment/return` | `/order/checkout`, `/success`, `/fail` | 신규 | 앱 웹뷰 전용 |

- 쿼리 파라미터 이름은 order 것을 유지(`category`, `sort`, `filter=OPEN`, 리뷰 `sort`). 쓰기는 `router.replace`
- 리뷰 신고는 order가 `?reviewId=` 쿼리, WEB_RECODE는 경로 파라미터. WEB_RECODE 경로를 유지하고 단위 스펙의 `candidate.path`로 매핑
- 앱(네이티브 화면)이 Track A를 웹뷰로 열지 않으므로 웹뷰 레이아웃 모드는 만들지 않는다. 구버전 앱·외부 링크는 P6의 `order.` 301로 처리

## 2. 렌더링·레이아웃

- 이전 화면은 전부 `getServerSideProps` + `withCacheControl`(`STORE_PUBLIC_SSR_CACHE_CONTROL`) + `SSRLayout mobileHeader="page"` + 본문에서 `MobilePageHeader`
- **`/store/[id]` ISR → SSR 전환**(F2): `getStaticPaths`/`revalidate` 제거, `serverRequest.isLoggedIn`으로 프리페치 범위 결정(지금은 ISR 프리페치가 항상 guest라 클라이언트 쿼리 키와 어긋남), 비로그인일 때만 공개 캐시. M2에서 ISR은 요청 기록이 캐시 상태에 따라 달라짐을 확인함
- 기기 분기는 `serverRequest.device`로 서버에서 확정. `useMediaQuery()` 기본 쿼리만 서버 스냅샷이 맞으므로 다른 쿼리를 쓰지 않는다
- 상점 상세 상단은 order가 이미지 캐러셀 위에 투명 헤더를 겹치고 스크롤에 따라 배경이 진해진다. `MobilePageHeader`에 없는 동작이라 상세 전용 오버레이 헤더를 `components/Store/mobile`에 둔다(D1 예외: 이 헤더는 본문으로 보고 픽셀 비교)

## 3. 공통 코드 (foundation 레이어에 넣는 것)

| # | 작업 | 내용 |
|---|---|---|
| F1 | ROUTES | §1의 신규 헬퍼 전부. 이후 단위는 `routes.ts`를 수정하지 않는다 |
| F2 | `/store/[id]` SSR 전환 | §2. 데스크톱 화면은 변경 없음(데스크톱 회귀 확인) |
| F3 | 폰트 스코프 수정 | `css-improvement-survey` A-1: 포털(모달·바텀시트)이 Pretendard를 상속하지 못함 → `:root`에 변수, `html`에 font-family. 바텀시트 상태가 많아 이전 전 필수 |
| F4 | 색·그림자 토큰 | `src/utils/scss/order-palette.scss` 신규: primary 100~700(`#EAD3FE`…`#7d08a4`), neutral 100~800, info/danger/sub, 페이지 배경 `#f8f8fa`, 별 `#FFC62B`/`#D9D9D9`, shadow-1/2/4. Tailwind 기본(oklch) 색은 하네스가 뽑은 order 계산값(rgb)으로 고정 |
| F5 | 공용 UI | `components/ui/Badge`(variant·color·size·startIcon/endIcon), `components/ui/Button`(color·size·state·fullWidth). 기존 `ui/BottomModal`은 order 모양(`rounded-t-4xl`, `shadow-4`, 배경 70%)을 낼 수 있게 className·variant 확장 |
| F6 | 모바일 화면 골격 | 신규 경로의 빈 페이지 + `getLayout` + 데스크톱 리다이렉트. 단위는 본문 컴포넌트만 채운다 |
| F7 | API·쿼리 | `src/api/store`에 order 엔드포인트용 `APIRequest`: `v3/shops`, `shops/{id}/summary`, `v2/shops/{id}`, `v2/shops/search/related`, `shops/reviews/reports/categories`, `shops/{id}/reviews/{rid}`(상세), 이미지 업로드. 쿼리 키는 `getViewerScope()` 포함. 같은 `v2/shops/{id}`를 키 3개로 받던 order 구조는 하나로 합침 |
| F8 | 하네스 보강 | 아래 하위 항목 |

**F0 (완료) — 데스크톱 회귀 게이트 G8** (`regress.mjs`, 홈·상점 목록·상점 상세·혜택·식단 × 데스크톱·모바일 10케이스. 같은 ref끼리 10/10 0픽셀, 데스크톱 상점 제목 1px 변경 시 해당 케이스만 FAIL 확인): foundation의 F2(ISR→SSR)·F3(전역 폰트)·F5(BottomModal 확장)는 공유·데스크톱 렌더를 바꾸는데 지금은 검증 게이트가 없다. `web@base` 대 `web@candidate`를 데스크톱 기기로 비교(`selftest --app web`을 두 ref로 확장)하고, F2·F3·F5를 이 게이트로 통과시킨 뒤에 단위 루프를 시작한다.

**F8 하위 항목**
- 본문 영역 비교: 헤더 아래~푸터 위로 잘라 비교, 크롬 요소는 요소 목록에서 제외하고 헤더 제목·뒤로가기 존재만 검증
- **서버 시계 고정 (완료, `lib/freeze-time.mjs`)**: `page.clock`은 브라우저만 멈춘다. WEB_RECODE는 시각 파생 값을 서버(`serverRequest.now`)에서 확정하므로 `next start`를 `node --import <시계 고정 훅>`으로 띄워 `Date`를 `FIXED_TIME` 기준으로 고정(하네스 쪽 훅, WEB_RECODE 코드는 건드리지 않음). 리뷰의 "N일 전" 등 A6~A9 필수
- **인증 픽스처**: WEB_RECODE 서버는 access JWT 만료를 확인한 뒤에만 세션을 믿는다. 기록 시 가린 쿠키는 `exp`가 먼 미래인 형식이 맞는 더미 JWT로 바꾸고, order에는 `AUTH_TOKEN_KEY`, WEB_RECODE에는 access·CSRF 쿠키로 주입. `/v2/web/auth/session` 응답도 기록. **stage 테스트 계정 필요**(환경변수로 전달, 커밋 금지)
- **토스트**: order 토스트 1.5초, react-toastify는 더 길어 같은 시점 캡처에서 한쪽만 남는다 → MutationObserver로 토스트 텍스트를 시간순 기록해 비교하고, 토스트 DOM은 픽셀·요소 목록에서 제외
- G4: `window.gtag` 기록 스텁으로 `event_label` 비교
- D2 폰트 오라클 패치 |

Android 브릿지 통합과 Toss SDK는 Track B 결제(B9·B10) 착수 때 별도 레이어로 넣는다.

## 4. 이전 지침 (구현 에이전트 입력)

- **파일 위치**
  - 모바일 상점 화면: `src/components/Store/mobile/<화면>/` (`StoreListPage`, `StoreSearchPage`, `StoreDetailPage`, `StoreInfoPage`, `StoreEventsPage`, `StoreReviewsPage`, `ReviewFormPage`, `ReviewReportPage`), 공유 조각은 `src/components/Store/mobile/common/`
  - 주문 상점: `src/components/Order/...`
  - 데스크톱 기존 `components/Store/*`는 수정하지 않는다(D5와 같은 이유)
- **타입**: order `src/api/*/entity.ts`를 옮기되 `interface` 사용, 오라클 패치로 고친 필드명 기준
- **라우터 변환**: `useParams` → `router.query`(SSR props로 내린 값 우선), `useNavigate(-1)` → `useGoBack()`, `navigate(path)` → `router.push(ROUTES.X())`, `useSearchParams`·`useQueryState` → `router.query` + `router.replace`
- **스타일**: Tailwind 클래스 → SCSS Module + BEM. 색·그림자는 F4 변수, 간격·크기는 px 그대로(Tailwind 4px 스케일 환산). `leading-[1.6]` 등 임의값도 그대로
- **아이콘**: order SVG를 `src/assets/svg/store/`로 복사해 SVGR 컴포넌트로 사용. Lottie JSON은 `src/assets/lottie/`
- **상태·저장소**: `sessionStorage`(`enteredShopName` 등)·`localStorage` 직접 접근 금지 → `isomorphicSessionStorage` 등 `utils/ts/env` 래퍼. 헤더 제목을 sessionStorage에서 가져오던 구조는 SSR props(상점명)로 대체
- **규칙**: `isKoinError` → `showToast`, `useLogger`(team `BUSINESS`, order 라벨 유지), `ROUTES`, 절대 경로 import, `console.log` 금지, 쿠키 상수
- **인증**: `AUTH_TOKEN_KEY` 대신 `useIsLoggedIn()`. 로그인 요구 모달은 `components/modal/LoginRequiredModal` + 기존 로그인 리다이렉트
- **이미지 뷰어**: order `ImageViewer`(Swiper zoom) 대신 기존 `ImageModal` 재사용 여부는 A4 단위에서 판단 — 모양이 다르면 order 재현

## 5. 공통 허용 목록 (`units/_common.json`에 반영)

| 항목 | 처리 |
|---|---|
| `POST /abtest/assign` | 고정 응답 + G2 무시 (반영됨) |
| `GET /v2/web/auth/session` | 로그인 상태에서 WEB_RECODE만 호출 → G2 무시 |
| 헤더·푸터 | D1: 본문 영역만 픽셀 비교, 헤더 제목·뒤로가기 존재만 검증 |
| 토스트 | 텍스트만 검증, 픽셀 제외 |
| 동일 데이터 중복 요청 | order가 같은 `v2/shops/{id}`를 키 3개로 요청 → G2는 요청 집합 비교라 영향 없음 |
| 주문 가능 상점 CTA | B2의 장바구니 영역 → "앱에서 주문하기"로 대체 (스펙 차이로 선언) |

## 6. order 버그 처리 (D6)

| # | 버그 | 처리 |
|---|---|---|
| 1 | 이벤트 썸네일 필드명 | **패치(0001, 적용됨)** |
| 2 | 가로 스와이프 후 뒤로가기 탭이 무시됨 (`useSwipeToBack` 플래그 미초기화) | 이전 안 함. D1로 뒤로가기는 `useGoBack`이 담당하고 비교 대상이 아님 |
| 3 | 리뷰 작성 화면 이탈 확인 모달에 도달 불가 | 이전 안 함(동작 없음 유지). 필요하면 별도 기획 |
| 4 | `shop_picture_swipe` 이벤트가 발생하지 않음 | **패치**(로그 복구) |
| 5 | 주문 불가 상점의 `#배달금액` 링크가 없는 영역을 가리킴, "최소주문 0원" 하드코딩 | **패치**(링크 제거) |
| 6 | 페이지뷰 user_id가 localStorage 토큰을 읽어 전송 안 됨 | 이전 안 함. WEB_RECODE 기존 페이지뷰 체계를 따름 |
| 7 | 이미지 업로드 오류 유형 판정 오류, 수정 시 이미지 3장 초과 가능 | **패치** |
| 8 | 조기 return 뒤 hook 호출 | 이전 시 자연 해소(오라클 동작 영향 없음) |
| 9 | 신고 사유 다중 선택인데 첫 번째만 전송 | A9 대상은 WEB_RECODE 기존 신고 페이지(백엔드와 이미 맞춰진 동작). **기존 페이지가 보내는 형식에 맞춰 오라클을 패치** |
| 10 | 주문 가능 리뷰 화면이 주문 불가 상점 API로 상호명 조회 | B5에서 판단 |
| 11 | 리뷰 작성·수정 후 목록 갱신 안 됨 | A7·A8 대상은 WEB_RECODE 기존 페이지. **기존 페이지의 무효화 동작에 맞춰 오라클을 패치** |
| 12 | 결제: 테스트 clientKey 하드코딩 등 | B9에서 재작성(스펙 단위) |

패치 대상은 게이트가 비교하는 신호(화면·요청·이벤트)에 영향이 있는 버그로 한정한다. 패치 목록이 정해지면 `oracle-patches/order/`에 하나씩 추가하고, 패치마다 order 대 order 자기 검증을 다시 통과시킨다.

## 7. 별도 이슈로 보고할 WEB_RECODE 버그 (이번 범위 밖)

- `EventCarousel` 초기 인덱스 경합: `useState(1)`로 시작해 `slidesInView` 이전 등록 시 첫 슬라이드에서 "2/2" 표시
- 리뷰 변경 후 `detailPage(shopId)`를 `isLoggedIn` 없이 무효화 → 로그인 사용자의 상세 캐시가 갱신되지 않음 (`store/mutations.ts:17`, `review/mutations.ts:17`)
