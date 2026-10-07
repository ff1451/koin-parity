// next start 프로세스에 --import 로 주입해 서버 시계를 고정 시각 기준으로 맞춘다.
// WEB_RECODE는 시각 파생 값을 서버(serverRequest.now)에서 확정하므로 브라우저 page.clock만으로는 부족하다.
// 시간이 흐르는 것은 유지한다(타이머·캐시 만료가 멈추면 서버 동작이 달라진다): 고정 시각 + 기동 후 경과 시간
//
// Date를 하위 클래스로 바꾸면 번들 코드의 Date.UTC 호출이 깨졌다(홈 500). Proxy로 감싸 정적 메서드·instanceof를 보존한다
const FIXED = Date.parse(process.env.PARITY_FIXED_TIME ?? '2026-10-07T12:00:00+09:00');
const RealDate = Date;
const realNow = RealDate.now.bind(RealDate);
const offset = FIXED - realNow();
const now = () => realNow() + offset;

RealDate.now = now;
globalThis.Date = new Proxy(RealDate, {
  construct(target, args, newTarget) {
    return Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget);
  },
  apply() {
    return new RealDate(now()).toString();
  },
});
