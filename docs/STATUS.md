# 진행 상태·인수인계

> 마지막 갱신: 2026-10-07 (상태 탐색기 작업 중 중단). 다른 기기·새 세션에서 이어갈 때 이 문서부터 읽는다.
> 전체 계획 `docs/order-migration-plan.md`, foundation 결정 `docs/foundation.md`, 하네스 사용법 `README.md`

## 1. 한 줄 요약

KOIN_ORDER_WEBVIEW(order.koreatech.in)의 모바일 상점 화면을 KOIN_WEB_RECODE로 옮기는 중. 화면 단위로 order 화면과 픽셀·요청·이벤트를 비교하는 하네스(이 저장소)로 판정하고, 단위마다 stacked PR을 쌓는다. **foundation과 A1(파일럿)까지 완료, 다음은 A2 이후 단위 스펙 작성.**

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
| KOIN `feat/#1572/order-foundation` | PR **#1573** draft → refactor/order-integration |
| KOIN `feat/#1572/order-a1-shop-events` | PR **#1574** draft → foundation (GitHub stack #1575) |
| 이슈 **#1572** | `[비즈니스] 모바일 상점 화면 KOIN_ORDER_WEBVIEW 이전` (진행 체크리스트) |

## 5. 단위 진행표

| 단위 | 경로 | 상태 |
|---|---|---|
| foundation | 라우트·`/store/[id]` SSR·폰트 스코프·토큰·Badge/Button·골격 페이지·`api/storeMobile` | ✅ PR #1573 |
| A1 상점 이벤트·공지 | `/store/[id]/events` | ✅ PR #1574 (루프 1회 통과) |
| A2 상점 목록 모바일 | `/store` | ⏳ 스펙 필요 |
| A3 검색 | `/store/search` | ⏳ |
| A4 상점 상세 모바일 | `/store/[id]` (오라클은 오버레이 헤더 → `chrome: 'none'` 검토) | ⏳ |
| A5 상점 정보 | `/store/[id]/info` | ⏳ |
| A6 리뷰 목록 | `/store/[id]/reviews` (로그인 상태 포함) | ⏳ |
| A7·A8·A9 리뷰 작성·수정·신고 | 기존 WEB_RECODE 페이지 모바일 UI | ⏳ |
| B2·B4·B5 주문 가능 상점 조회 | `/order/shops/[id]` | ⏳ (오라클 커밋 7243571 + 라우트 주석 해제 패치 필요) |
| B9·B10 앱 결제 웹뷰 | `/order/checkout*` | ⏳ 스펙 단위, 백엔드·Android 계약 후 |
| P6 전환 | 링크 교체, order 301, 헤더 높이 통일 | ⏳ |

## 6. 바로 다음 할 일

**결정: (a) 상태 자동 탐색기를 먼저 만든다** (사용자 승인). 탐색기 `explore.mjs` 1차 구현 완료, 다듬는 중.

- 동작: 오라클 화면에서 보이는 클릭 후보(버튼·링크·체크박스·cursor:pointer 바깥 요소)를 하나씩 누르고, **실제로 보이는 텍스트**(overflow로 잘린 영역 제외)·URL·다이얼로그로 상태를 구분해 너비 우선 탐색. 쓰기 요청을 일으킨 상태·다른 화면 이동·외부 링크(tel: 등)는 더 들어가지 않음. 결과 `runs/*-explore/explore.md`
- 검증: **A1에서 펼침 상태를 스스로 찾음**(스펙과 일치)
- A2(`/shops`) 1단계 결과: 초기, 카테고리 12개(전체보기·치킨·피자/버거·…·기타), 정렬 바텀시트(다이얼로그), 영업중 토글 — 상태 15개
- **남은 문제(다음에 할 것)**: 2단계에서 카테고리마다 새로 나타난 상점 카드를 전부 "새 요소"로 보고 하나씩 다시 열어 수십 분 걸림(중단함). 개선안:
  1. 같은 역할의 반복 요소(카드 목록)는 대표 1개만 누른다: 후보를 "구조 서명"(태그·클래스 경로에서 nth 제거)으로 묶어 그룹당 1개
  2. 1단계에서 이미 "다른 화면으로 이동"으로 판명된 그룹은 2단계에서 다시 누르지 않는다
  3. 카테고리처럼 데이터만 바뀌는 상태는 "같은 화면 구조 + 다른 데이터"로 묶어 대표 상태 1~2개만 스펙 후보로 올린다
- 그다음: A2 탐색 결과로 `units/A2-store-list.json` 상태 확정(현재 초안, 카세트 `fixtures/A2-store-list/default.cassette.json`은 1단계 탐색 중 stage에서 보충한 것) → 루프 실행

단위 하나 진행 절차(A1에서 검증됨):
1. KOIN에서 스택 top으로 이동 후 `gh stack add "feat/#1572/order-<unit>"`
2. `units/<unit>.json` 작성(상태·필수 텍스트·actions·primaryRequest·chrome). 필요하면 `node selftest.mjs <unit> --record`로 카세트 기록, 후보가 추가로 부르는 GET은 `node fill.mjs <unit> --ref <branch>`
3. KOIN `.claude/settings.local.json`에 하네스 쓰기 차단이 걸려 있는지 확인(§7)
4. Workflow 실행: `workflows/parity-unit-loop.js`를 scriptPath로, args `{unit, branch, title, maxIterations, oracleHints, targets}` (A1 예시는 `docs/order-migration-plan.md` §11)
5. 끝나면 **직접** `node verify.mjs <unit> --ref <branch>` + `node regress.mjs --base <부모 레이어> --candidate <branch>` + KOIN `yarn lint`·`yarn typecheck`
6. WIP 커밋을 하나로 정리(`git commit --amend` 또는 squash) → `gh stack submit --auto` → `gh pr edit`로 제목·본문·라벨(koin-pr 규칙)

## 7. 새 기기에서 다시 세팅하기

```bash
# 1) 두 저장소를 같은 부모 디렉터리에 (하네스는 ../KOIN_WEB_RECODE를 기본 대상으로 씀)
gh repo clone ff1451/koin-parity
gh repo clone BCSDLab/KOIN_WEB_RECODE   # 이미 있으면 git fetch
cd KOIN_WEB_RECODE && git fetch origin && gh stack checkout 1574   # 스택(trunk + foundation + A1) 복원
git config rerere.enabled true

# 2) 하네스 의존성
cd ../koin-parity && corepack yarn install && corepack yarn playwright install chromium

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

포트: 프록시 4000, order 4100, WEB_RECODE 4101·4102. 이미 쓰이고 있으면 하네스가 기동을 거부한다(다른 개발 서버에 붙어 캡처하는 사고가 실제로 있었음).

## 8. 알려진 이슈·과제

- `R-regression`의 `cafeteria.desktop`이 간헐적으로 1336px 차이(같은 조건 재실행 시 통과) → 회귀 캡처 결정성 보강 필요
- WEB_RECODE 버그(범위 밖, 별도 이슈 후보): EventCarousel 초기 인덱스 경합("2/2" 표시), 리뷰 변경 후 로그인 사용자 상세 캐시 미무효화 (`docs/foundation.md` §7)
- 아직 없는 게이트: G5(브릿지, 결제 단위에서), G7(SSR DOM 파괴율), G9(301·SEO)
- 하네스가 띄운 서버는 예외 종료 시에도 정리된다(`lib/apps.mjs` exit 핸들러). 프로세스를 직접 죽일 때 `pkill -f <패턴>`은 실행 중인 셸 자신과 매칭돼 셸이 죽으니 PID로 죽일 것
- `docs/foundation.md` F3이 참조하는 `css-improvement-survey.md`는 KOIN 저장소에서 추적되지 않는 로컬 문서(원래 기기에만 있음). F3은 완료돼 필요 없음
- WEB_RECODE 하네스 빌드는 `--no-lint` (워크트리가 저장소 밖이라 import 그룹 판정이 달라짐). lint는 KOIN에서 직접 `yarn lint`
