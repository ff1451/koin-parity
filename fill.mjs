// 루프 밖 전용: 후보(WEB_RECODE)가 오라클보다 추가로 부르는 GET을 stage에서 받아 단위 카세트에 보충한다.
// 쓰기 요청은 보충하지 않는다. 루프 에이전트는 이 스크립트를 실행할 수 없다(카세트는 오라클 데이터)
//
// 실행: node fill.mjs <unit-id> [--ref <git-ref>] [--no-actions]
//   --no-actions: 상호작용 없이 페이지 로드만 보충(구현 전 골격에서 세션 등 공통 요청을 미리 채울 때)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { capture } from './capture.mjs';
import { APPS, PARITY_DIR, startProxy, startWeb, WEB_REPO } from './lib/apps.mjs';

const unitId = process.argv[2];
const ref = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1] : 'HEAD';
if (!unitId) {
  console.error('usage: fill.mjs <unit-id> [--ref <git-ref>]');
  process.exit(2);
}

const unit = JSON.parse(readFileSync(join(PARITY_DIR, 'units', `${unitId}.json`), 'utf8'));
const sha = execFileSync('git', ['rev-parse', ref], { cwd: WEB_REPO }).toString().trim();
const runDir = join(PARITY_DIR, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${unitId}-fill`);
const noActions = process.argv.includes('--no-actions');
const fillPath = (template, params) => template.replace(/\{(\w+)\}/g, (_, k) => String(params[k]));
const stops = [];

try {
  stops.push(await startProxy());
  stops.push(await startWeb(sha));
  for (const state of unit.states) {
    // 한 상태가 도달 불가여도 나머지 상태는 보충한다
    const result = await capture({
      baseURL: APPS.web.baseURL,
      path: fillPath(unit.candidate.path, state.params),
      outDir: join(runDir, state.name),
      cassette: join(PARITY_DIR, 'fixtures', unitId, `${state.cassette ?? state.name}.cassette.json`),
      assetsDir: join(PARITY_DIR, '.cache', 'assets'),
      device: unit.device,
      actions: noActions ? [] : state.actions,
      auth: state.auth,
      masks: unit.masks,
      mode: 'fill',
    }).catch((error) => {
      console.warn(`[${state.name}] 보충 실패: ${String(error).split('\n')[0]}`);
      return null;
    });
    if (!result) continue;
    const filled = result.requests.filter((r) => r.filled).map((r) => `${r.method} ${r.path}`);
    const misses = result.requests.filter((r) => r.miss).map((r) => `${r.method} ${r.path}`);
    console.warn(`[${state.name}] filled=${filled.length} ${filled.join(', ')}${misses.length ? `  miss(쓰기 요청)=${misses.join(', ')}` : ''}`);
  }
} finally {
  stops.reverse().forEach((stop) => stop());
}
