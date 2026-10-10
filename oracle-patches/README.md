# 오라클 패치

오라클(order 앱)에 버그가 있으면 WEB_RECODE가 버그까지 옮기지 않도록 오라클 쪽을 고친다.
`prepareOrder()`가 고정 커밋을 체크아웃한 뒤 `order/*.patch`를 이름순으로 `git apply`하고 빌드한다.

- 패치는 **사람이 승인한 것만** 둔다. 루프 에이전트는 이 디렉터리를 수정할 수 없다
- 파일 하나에 버그 하나. 파일명 `NNNN-<요약>.patch`, 아래 목록에 이유를 남긴다
- Track B(주문 흐름)의 라우트 주석 해제도 같은 방식으로 둔다

| 패치 | 이유 |
|---|---|
| `0001-shop-events-thumbnail-images.patch` | API는 `thumbnail_images`를 주는데 order는 `thumbnail_image`를 읽어 이벤트 이미지가 항상 빠지고 대체 Lottie만 표시됨 |
| `0002-fonts-match-web-recode.patch` | order는 전체 폰트 400·700 두 파일, WEB_RECODE는 서브셋 9개 굵기라 파일이 달라 픽셀 0에 도달할 수 없고 500·600이 400·700으로 그려짐(foundation D2). 폰트 파일은 `prepareOrder()`가 KOIN_WEB_RECODE `origin/develop`의 `src/assets/font`에서 복사 |
| `0003-shop-picture-swipe-log.patch` | 스크롤 리스너가 `[]` 의존성으로 등록돼 `shop_picture_swipe` 이벤트가 한 번도 발생하지 않음 (foundation D6 #4) |
| `0004-unorderable-delivery-anchor.patch` | 주문 불가 상점의 배달금액 링크가 없는 영역(`#배달금액`)을 가리킴 (D6 #5). "최소주문 0원" 표시는 화면 결정이라 유지 |
| `0005-upload-error-status.patch` | 업로드 실패 시 상태 코드를 `error.response.status`에서 읽어 오류 유형이 항상 네트워크로 판정됨 (D6 #7) |
| `0006-report-all-reasons.patch` | 신고 사유를 다중 선택해도 첫 번째만 전송 → KOIN_WEB_RECODE 신고 페이지처럼 모두 전송 (D6 #9) |
| `0007-invalidate-reviews-after-write.patch` | 리뷰 작성·수정 후 목록이 갱신되지 않음 → KOIN_WEB_RECODE처럼 리뷰 쿼리 무효화 (D6 #11) |
| `0008-enable-orderable-shop-routes.patch` | Track B: 주문 가능 상점 상세·정보·리뷰 라우트(`shop/true`, `shop-detail/true`, `review/true`)와 import의 주석만 해제. 화면 코드는 그대로 (2026-10-10 사용자 승인) |
| `0009-enable-order-flow-routes.patch` | Track B: 주문 흐름 전체(주문 홈, 메뉴 상세, 장바구니, 배달지, 결제·결제 승인, 주문 완료·취소, 주문 내역) 라우트와 import 주석 해제. 화면 코드는 그대로 (2026-10-10 사용자 승인: 주문 관련 페이지·기능을 모두 그대로 이전하고 develop 머지 전에 진입을 막는다) |
| `0010-takeout-result-null-delivery-tip.patch` | 포장 주문은 `delivery_tip`이 null이라 주문 완료 화면·영수증의 `formatKRW(null)`이 오류를 내 화면 전체가 빈 화면. 없으면 0원으로 표시 (2026-10-10 사용자 승인: 고쳐서 이전) |
| `0011-result-map-marker-cleanup.patch` | 주문 완료 지도의 `useMarkers` 정리 함수가 지도가 null일 때만 마커를 지워, 가게 주소 지오코딩 후 다시 렌더될 때 집 마커가 같은 자리에 하나 더 쌓임(테두리가 진해짐). 항상 지우도록 (2026-10-10 사용자 승인) |
