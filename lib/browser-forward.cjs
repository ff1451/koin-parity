// 브라우저 컨테이너 안에서 실행: 하네스 포트(localhost:<port>)를 호스트의 같은 포트로 넘긴다.
// 앱·프록시 URL을 localhost 그대로 두어야 CORS·쿠키·IS_STAGE 판정·G2 정규화가 로컬 실행과 같다
const net = require('node:net');

const HOST = process.env.FORWARD_HOST ?? 'host.docker.internal';
for (const port of process.argv.slice(2).map(Number)) {
  net
    .createServer((client) => {
      const upstream = net.connect(port, HOST);
      client.pipe(upstream).pipe(client);
      const close = () => {
        client.destroy();
        upstream.destroy();
      };
      client.on('error', close);
      upstream.on('error', close);
    })
    // localhost가 ::1로 풀려도 받도록 듀얼 스택으로 연다
    .listen(port);
}
