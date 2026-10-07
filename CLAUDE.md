# koin-parity

KOIN_ORDER_WEBVIEW → KOIN_WEB_RECODE 모바일 화면 이전을 판정하는 하네스. **작업을 시작하면 `docs/STATUS.md`부터 읽는다** (현재 상태, 확정된 결정, 다음 할 일, 새 기기 세팅).

- 판정(PASS/FAIL)은 `verify.mjs`·`regress.mjs`·`compare.mjs`만 낸다. 에이전트의 주장은 근거가 아니다
- 루프 에이전트는 이 저장소의 스펙·카세트·오라클 패치·게이트를 수정하지 않는다. 기준 완화(마스크·무시 목록·임계값)는 사람이 승인한 것만
- 커밋 메시지는 `type: 명사형 요약` 한 줄 (문장형·본문 금지). GitHub 작업은 ff1451 계정
- `.cache/`·`runs/`·`.cache/credentials.env`는 커밋하지 않는다. 카세트는 저장 시 개인정보·토큰을 가린다
