# 진행 상태·인수인계

> 마지막 갱신: 2026-10-09 (Track A A1~A9 완료). 다른 기기·새 세션에서 이어갈 때 이 문서부터 읽는다.
> 전체 계획·선택 기록 `docs/order-migration-plan.md`, foundation 결정 `docs/foundation.md`, 하네스 사용법 `README.md`, 만난 문제·해결 기록(블로그 소재) `docs/engineering-log.md` — 새 문제를 해결하면 여기에 항목을 추가한다

## 1. 한 줄 요약

KOIN_ORDER_WEBVIEW(order.koreatech.in)의 모바일 상점 화면을 KOIN_WEB_RECODE로 옮기는 중. 화면 단위로 order 화면과 픽셀·요청·이벤트를 비교하는 하네스(이 저장소)로 판정하고, 단위마다 stacked PR을 쌓는다. **foundation·Track A(A1~A9) 완료, PR #1573~#1583. 다음은 Track B(주문 가능 상점 조회, 오라클 패치 승인 필요) 또는 P6 전환 — 사용자 결정 대기.**

## 2. 확정된 범위·결정 (다시 묻지 않는다)

- 데스크톱은 기존 WEB_RECODE 유지, **모바일만 통합**
- 주문은 **MVP**: 1차는 모바일 웹 상점·리뷰 + 주문 가능 상점 조회 전용 + "앱에서 주문하기" CTA, **웹 결제 없음**. 웹 주문 전체는 MVP 결과·CTA 로그 보고 2차 결정
- 앱은 결제만 웹뷰(`/order/checkout*`), 나머지 네이티브. 앱 협업은 **Android만**, iOS는 MVP 후
- 백엔드 API가 필요하면 사용자가 직접 작업
- order 모바일 웹 로그인은 #1526 이후 깨져 있음(확인됨). 이용자가 없어 핫픽스 없이 이전으로 해소
- 하네스는 KOIN_WEB_RECODE에 넣지 않고 이 private 저장소에 둔다(끝나면 버리는 도구, 공개 저장소 이력 보호)
- foundation 결정 D1~D7: `docs/foundation.md` §0 (헤더 60px로 시작해 전 단위 통과 후 통일, 폰트는 오라클 패치로 WEB_RECODE 파일 사용, 데스크톱 API 불변 등)

## 3. 작업 규칙 (사용자 지시)

- GitHub 작업은 **ff1451 계정**으로 (`gh auth status`로 확인, tse-junyoung으로 전환하지 않음)
- 커밋 메시지: **`type: 명사형 요약` 한 줄**. "~한다" 문장형·본문 금지 (예: `feat: 상점 이벤트·공지 모바일 화면 이전`)
- KOIN_WEB_RECODE 이슈·PR은 `.claude/skills/koin-pr` 규칙: 제목 `[비즈니스] …`, PR 템플릿, 라벨 `✨ Feature`·`💼 Business`
- 공유용 글(Slack 등)은 페이지·Artifact 만들지 말고 텍스트로
- 사람 개입 최소화(jobkorea 사례): 사람은 하네스 승인·foundation 승인 + 알림(기준 완화 요청, 단위 정체, 상태 탐색 불확정)만

## 4. 저장소·브랜치 현황

| 위치 | 상태 |
|---|---|
| `ff1451/koin-parity` (private) | 하네스·문서·단위 스펙·카세트·오라클 패치 0001~0007 |
| KOIN `refactor/order-integration` | 스택 trunk (develop `836acf78`에서 분기, 원격 push됨) |
| KOIN `feat/#1572/order-foundation` | PR **#1573** → refactor/order-integration |
| KOIN `feat/#1572/order-a1-shop-events` | PR **#1574** → foundation (GitHub stack #1575) |
| KOIN `feat/#1572/order-a2-store-list` | PR **#1576** → A1 |
| KOIN `feat/#1572/order-a3-store-search` | PR **#1577** → A2 |
| KOIN `feat/#1572/order-a4-store-detail` | PR **#1578** → A3 |
| KOIN `feat/#1572/order-a5-store-info` | PR **#1579** → A4 |
| KOIN `feat/#1572/order-a6-store-reviews` | PR **#1580** → A5 |
| KOIN `feat/#1572/order-a7-review-new` | PR **#1581** → A6 |
| KOIN `feat/#1572/order-a8-review-edit` | PR **#1582** → A7 |
| KOIN `feat/#1572/order-a9-review-report` | PR **#1583** → A8 |
| KOIN `feat/#1572/order-transition` | PR **#1584** → A9 (P6: 진입 링크 교체, Track A 헤더 통일, 아이콘 폴더 `Store/` 정리) |
| 이슈 **#1572** | `[비즈니스] 모바일 상점 화면 KOIN_ORDER_WEBVIEW 이전` (진행 체크리스트) |

## 5. 단위 진행표

| 단위 | 경로 | 상태 |
|---|---|---|
| foundation | 라우트·`/store/[id]` SSR·폰트 스코프·토큰·Badge/Button·골격 페이지·`api/storeMobile` | ✅ PR #1573 |
| A1 상점 이벤트·공지 | `/store/[id]/events` | ✅ PR #1574 (루프 1회 통과) |
| A2 상점 목록 모바일 | `/store` | ✅ PR #1576 (루프 2회 통과, 상태 6개. 빈 목록은 `shops`만 비운 파생 카세트 — 사용자 승인. 도중에 foundation `ShopListV3` undefined 파라미터 버그를 #1573에 수정) |
| A3 검색 | `/store/search` | ✅ PR #1577 (루프 1회, 상태 3개: 입력 전·결과·결과 없음. 입력은 `fill` 액션) |
| A4 상점 상세 모바일 | `/store/[id]` | ✅ PR #1578 (루프 2회, `chrome: none`, 상태 4개. 이미지 뷰어는 사용자 결정으로 Swiper — foundation에 `swiper ^11.2.10` 추가) |
| A5 상점 정보 | `/store/[id]/info` | ✅ PR #1579 (루프 1회, 상태 2개: 휴무일 유무) |
| A6 리뷰 목록 | `/store/[id]/reviews` | ✅ PR #1580 (루프 1회, 상태 8개: 비로그인 5·로그인 3) |
| A7·A8·A9 리뷰 작성·수정·신고 | 기존 WEB_RECODE 페이지 모바일 UI | ✅ PR #1581·#1582·#1583 (제출 직전까지만 검증. 데스크톱 기존 훅은 자체 토스트로 중복되어 모바일은 공용 mutation 직접 사용) |
| B2·B4·B5 주문 가능 상점 조회 | `/order/shops/[id]` | ⏳ (오라클 커밋 7243571 + 라우트 주석 해제 패치 필요) |
| B9·B10 앱 결제 웹뷰 | `/order/checkout*` | ⏳ 스펙 단위, 백엔드·Android 계약 후 |
| P6 전환 | 링크 교체, 헤더 높이 통일(Track A), 아이콘 폴더 정리 | ✅ PR #1584. order 301은 하지 않음(결정 33). Track B 헤더는 Track B 완료 때 통일. 남은 것: 스택 리뷰·머지 → develop |

## 6. 바로 다음 할 일

**다음: Track B 또는 P6 (사용자 결정)**. 로그인 상태 기록은 stage 테스트 계정 `.cache/credentials.env`(사용자 계정)로 한다. 테스트 계정 리뷰: 상점 21의 558·475, 다른 사용자 리뷰 466

- 상태 탐색기 `explore.mjs`: 후보를 구조 서명(조상 태그·클래스 경로 + 요소 태그)으로 묶어 반복 그룹(4개 이상)은 앞 2개만 누르고, 이동으로 판명된 그룹은 깊은 상태에서 다시 누르지 않는다. A2 깊이 2 탐색이 1분 34초
- 데이터만 다른 상태(카테고리 10개 등)는 사람이 대표 상태로 묶어 스펙에 올린다
- 같은 카세트를 여러 상태가 쓰면 스펙 상태에 `"cassette": "<이름>"`
- 단위가 의도적으로 바꾸는 회귀 케이스는 `regress.mjs --skip <페이지>.<기기>` (A2: `store-list.mobile`, A4: `store-detail.mobile`). 바꾼 뒤에는 회귀 카세트를 `--fill --pages <페이지>`로 보충해 다음 단위 회귀가 miss로 깨지지 않게 한다
- 아이콘 경로: develop에는 `src/assets/svg/Store/`(대문자), 이전 화면은 `src/assets/svg/store/`(소문자). Linux에서 두 폴더로 갈리므로 P6 전에 하나로 정리 필요(사용자에게 보고함)
- 변이 자기 검증은 단위마다 돌린다: A2에서 변이가 헤더 텍스트를 대상으로 잡아 탐지가 안 되는 결함을 발견해 고침(본문 영역만 대상)

단위 하나 진행 절차(A1·A2에서 검증됨):
1. KOIN에서 스택 top으로 이동 후 `gh stack add "feat/#1572/order-<unit>"`
2. `units/<unit>.json` 작성(상태·필수 텍스트·actions·primaryRequest·chrome). 필요하면 `node selftest.mjs <unit> --record`로 카세트 기록, 후보가 추가로 부르는 GET은 `node fill.mjs <unit> --ref <branch>`
3. KOIN `.claude/settings.local.json`에 하네스 쓰기 차단이 걸려 있는지 확인(§7)
4. Workflow 실행: `workflows/parity-unit-loop.js`를 scriptPath로, args `{unit, branch, title, maxIterations, oracleHints, targets, parity, web, env}`. `parity`·`web`은 이 기기의 하네스·KOIN 작업 트리(레이어 브랜치가 체크아웃된 곳) 절대 경로, `env`는 에이전트가 모든 명령 앞에 실행할 셸 문장(§7의 Node·브라우저 설정). A1 예시(경로·env 생략):
   ```json
   {"unit": "A1-shop-events", "branch": "feat/#1572/order-a1-shop-events", "title": "상점 이벤트·공지", "maxIterations": 6,
    "oracleHints": ["pages/Shop/components/ShopEvents/index.tsx", "pages/Shop/components/ShopEvents/ShopEvent.tsx", "pages/Shop/components/ShopEvents/CollapsedEvent.tsx", "pages/Shop/components/ShopEvents/ExpandedEvent.tsx", "pages/Shop/hooks/useGetShopEvents.ts", "util/ts/formatDate.ts", "assets/Shop/sleeep-icon.svg", "assets/lottie/jumping.json", "components/Layout/index.tsx (AppLayout: 본문 pt-15)"],
    "targets": ["src/pages/store/[id]/events.tsx", "src/components/Store/mobile/StoreEventsPage/** (신규 하위 컴포넌트·SCSS 포함)", "src/assets/svg/store/** (신규 아이콘 추가만)", "src/assets/lottie/** (신규 추가만)"]}
   ```
   A1 결과: 루프 1회 통과(약 8.5분, 서브에이전트 약 15만 토큰), 독립 재검증 3/3 PASS
5. 끝나면 **직접** `node verify.mjs <unit> --ref <branch>` + `node regress.mjs --base <부모 레이어> --candidate <branch>` + `node ssr-check.mjs --ref <branch>`(쿠키 없음/무효 access × 기기로 서버 렌더 5xx 점검, stage 직접) + KOIN `yarn lint`·`yarn typecheck`
6. WIP 커밋을 하나로 정리(`git commit --amend` 또는 squash) → `gh stack submit --auto` → `gh pr edit`로 제목·본문·라벨(koin-pr 규칙)

## 7. 새 기기에서 다시 세팅하기

```bash
# 1) 두 저장소를 같은 부모 디렉터리에 (하네스는 ../KOIN_WEB_RECODE를 기본 대상으로 씀)
gh repo clone ff1451/koin-parity
gh repo clone BCSDLab/KOIN_WEB_RECODE   # 이미 있으면 git fetch
cd KOIN_WEB_RECODE && git fetch origin && gh stack checkout 1574   # 스택(trunk + foundation + A1) 복원
git config rerere.enabled true

# 2) 하네스 의존성. Node는 KOIN과 같은 24.14.1 (기본 Node가 다르면 nvm 경로를 PATH 앞에)
export PATH=$HOME/.nvm/versions/node/v24.14.1/bin:$PATH
cd ../koin-parity && corepack yarn install && corepack yarn playwright install chromium

# 2-1) Linux가 아닌 기기(macOS 등): 캡처 브라우저를 Linux 컨테이너에서 띄운다 (Docker 필요)
#   macOS Chromium은 글자·SVG 가장자리 안티앨리어싱이 앱마다 서브픽셀 단위로 달라 A1이 G6 8~196px로 실패했다.
#   컨테이너 브라우저로는 기준 변경 없이 아래 5)가 전부 PASS (2026-10-08 확인). 이후 모든 하네스 명령에 env를 붙인다
./browser.sh start && export PARITY_BROWSER_WS=ws://localhost:3999/

# 3) stage 테스트 계정 (커밋 금지, 권한 600) — 계정은 사용자에게 받는다
umask 077 && printf 'PARITY_TEST_USER_ID=...\nPARITY_TEST_USER_PASSWORD=...\n' > .cache/credentials.env

# 4) 로컬 전용 캐시 채우기 (이미지 자산·빌드 카세트는 커밋하지 않음). order 클론·WEB_RECODE 워크트리 빌드는 자동
node selftest.mjs A1-shop-events --fill
node selftest.mjs H2-web-store-list --app web --fill
node regress.mjs --base origin/develop --candidate origin/develop --fill

# 5) 하네스가 정상인지: 모두 PASS여야 한다
node selftest.mjs A1-shop-events --mutations with-events,with-events-expanded,empty
node verify.mjs A1-shop-events --ref "feat/#1572/order-a1-shop-events"
```

KOIN `.claude/settings.local.json` (git 추적 안 됨, 루프 실행 중 하네스 변조 방지. 하네스를 직접 고칠 땐 잠시 이름을 바꿔 해제):

```json
{ "permissions": { "deny": ["Edit(//<절대경로>/koin-parity/**)", "Write(//<절대경로>/koin-parity/**)"] } }
```

포트: 프록시 4000, order 4100, WEB_RECODE 4101·4102, 컨테이너 브라우저 3999(호스트 127.0.0.1만). 컨테이너 안에서 4000·4100·4101·4102는 호스트로 포워딩되어 앱 URL은 localhost 그대로다. 이미 쓰이고 있으면 하네스가 기동을 거부한다(다른 개발 서버에 붙어 캡처하는 사고가 실제로 있었음).

## 8. 알려진 이슈·과제

- **잘못된 상점 ID → 500 (별도 이슈 후보, 2026-10-09 사용자 결정으로 보류)**: 숫자가 아닌 ID(`/store/abc` 등)면 stage가 400을 주고 서버 렌더는 404만 '없음'으로 처리해 500이 된다. 모바일 이전 화면 6개(상세·정보·이벤트·리뷰 목록·작성·수정)와 데스크톱 `/store/[id]`. 존재하지 않는 숫자 ID는 정상 404. 해결안: 서버 렌더 시작에서 숫자 검증 후 404, 또는 공용 `isNotFoundKoinError`가 400도 '없음'으로 보기
- A4 `menu-group` G4 간헐 실패(2026-10-09) → **해결**: 분석 이벤트를 스크린샷 전에 읽고, 정착 대기의 가짜 시간 총량을 고정(engineering-log 31). A4 6회 반복 통과
- 헤더 통일(PR #1584) 이후 Track A 화면은 order와 픽셀 0이 아니다(본문 3.2px 위). order 대조는 #1584 직전 커밋까지, 이후 변경은 회귀(같은 앱)·SSR 점검으로 본다
- 회귀 `home.mobile` 간헐 실패(2026-10-09) → **원인 확인·해결**: 사람이 열어 둔 앱 탭의 재조회가 같은 포트의 하네스 프록시로 들어와 캡처 기록에 섞임. 캡처 태그(`x-parity-session`)가 없는 클라이언트 요청은 프록시가 409로 거절(engineering-log 30). 하네스 실행 중 거절 건수는 `[capture] 외부 클라이언트 요청 N건` 경고로 보인다
- 보기용 서버(`/private/tmp/.../serve.mjs`, 하네스 밖 임시 스크립트): `live` 모드는 stage에 그대로 반영(로그인 가능, 제출 시 실제 데이터 생성). 2026-10-09 사용자 확인 중 상점 251·252에 테스트 리뷰가 생겼고 사용자 결정으로 남겨 둠

- stage가 가끔 5xx·연결 끊김을 낸다. `--fill` 중 5xx가 빌드 카세트(`.cache/web-build.cassette.json`)에 저장되면 빌드 프리렌더가 계속 실패하므로 그 항목을 지우고 다시 채운다. `fetch failed`로 한 케이스만 실패하면 그 페이지만 `--fill --pages`로 다시 채운다

- `R-regression`의 `cafeteria.desktop`이 간헐적으로 1336px 차이(이전 기기, 같은 조건 재실행 시 통과). 이 기기에서는 재현되지 않음. 원인 후보: 정착 대기 부족(engineering-log 19, 500ms로 수정됨) 또는 외부 요청 혼입(30, 수정됨)
- WEB_RECODE 버그(범위 밖, 별도 이슈 후보): EventCarousel 초기 인덱스 경합("2/2" 표시), 리뷰 변경 후 로그인 사용자 상세 캐시 미무효화 (`docs/foundation.md` §7)
- 아직 없는 게이트: G5(브릿지, 결제 단위에서), G7(SSR DOM 파괴율), G9(301·SEO)
- 하네스가 띄운 서버는 예외 종료 시에도 정리된다(`lib/apps.mjs` exit 핸들러). 프로세스를 직접 죽일 때 `pkill -f <패턴>`은 실행 중인 셸 자신과 매칭돼 셸이 죽으니 PID로 죽일 것
- `docs/foundation.md` F3이 참조하는 `css-improvement-survey.md`는 KOIN 저장소에서 추적되지 않는 로컬 문서(원래 기기에만 있음). F3은 완료돼 필요 없음
- WEB_RECODE 하네스 빌드는 `--no-lint` (워크트리가 저장소 밖이라 import 그룹 판정이 달라짐). lint는 KOIN에서 직접 `yarn lint`
