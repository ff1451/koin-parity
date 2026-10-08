#!/bin/sh
# 캡처 브라우저를 Linux 컨테이너에서 띄운다 (macOS 등 Linux가 아닌 기기용).
# macOS Chromium은 글자·SVG 가장자리 안티앨리어싱이 앱마다 서브픽셀 단위로 달라져 G6(0픽셀)이 성립하지 않는다.
# 서버(프록시·order·WEB_RECODE)는 호스트에서 돌고, 브라우저만 컨테이너에서 돈다.
#
#   ./browser.sh start   → 이후 PARITY_BROWSER_WS=ws://localhost:3999/ 로 하네스 실행
#   ./browser.sh stop
set -eu
NAME=parity-browser
# @playwright/test 버전(package.json)과 반드시 같아야 한다
VERSION=1.63.0
PORT=3999

case "${1:-start}" in
start)
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --rm --init --name "$NAME" \
    -p "127.0.0.1:$PORT:$PORT" \
    --add-host=host.docker.internal:host-gateway \
    -v "$(cd "$(dirname "$0")" && pwd)/lib/browser-forward.cjs:/parity/browser-forward.cjs:ro" \
    -w /tmp \
    "mcr.microsoft.com/playwright:v$VERSION-noble" \
    sh -c "node /parity/browser-forward.cjs 4000 4100 4101 4102 & exec npx -y playwright@$VERSION run-server --port $PORT --host 0.0.0.0 --unsafe" >/dev/null
  i=0
  until docker logs "$NAME" 2>&1 | grep -q "Listening on"; do
    i=$((i + 1))
    [ "$i" -gt 120 ] && { docker logs "$NAME"; exit 1; }
    sleep 1
  done
  echo "PARITY_BROWSER_WS=ws://localhost:$PORT/"
  ;;
stop)
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  ;;
*)
  echo "usage: $0 start|stop" >&2
  exit 2
  ;;
esac
