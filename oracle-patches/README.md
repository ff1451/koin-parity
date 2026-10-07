# 오라클 패치

오라클(order 앱)에 버그가 있으면 WEB_RECODE가 버그까지 옮기지 않도록 오라클 쪽을 고친다.
`prepareOrder()`가 고정 커밋을 체크아웃한 뒤 `order/*.patch`를 이름순으로 `git apply`하고 빌드한다.

- 패치는 **사람이 승인한 것만** 둔다. 루프 에이전트는 이 디렉터리를 수정할 수 없다
- 파일 하나에 버그 하나. 파일명 `NNNN-<요약>.patch`, 아래 목록에 이유를 남긴다
- Track B(주문 흐름)의 라우트 주석 해제도 같은 방식으로 둔다

| 패치 | 이유 |
|---|---|
| `0001-shop-events-thumbnail-images.patch` | API는 `thumbnail_images`를 주는데 order는 `thumbnail_image`를 읽어 이벤트 이미지가 항상 빠지고 대체 Lottie만 표시됨 |
