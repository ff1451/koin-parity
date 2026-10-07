// 하네스 자체 검증: order 대 order.
// 1) 단위의 각 상태를 stage에서 기록(--record)  2) 재생으로 두 번 캡처  3) 두 캡처가 모든 게이트를 통과해야 한다
//
// 실행: node selftest.mjs <unit-id> [--app order|web] [--record|--fill] [--mutations <state,...>]
//   --app web: 후보 앱(WEB_RECODE) 자기 검증. 경로는 unit.candidate.path, --fill로 후보가 추가로 부르는 GET을 보충
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { capture } from './capture.mjs';
import { compare } from './compare.mjs';
import { APPS, PARITY_DIR, startOrder, startProxy, startWeb } from './lib/apps.mjs';
import { MUTATIONS } from './mutations.mjs';

const unitId = process.argv[2];
const shouldRecord = process.argv.includes('--record');
const shouldFill = process.argv.includes('--fill');
const app = process.argv.includes('--app') ? process.argv[process.argv.indexOf('--app') + 1] : 'order';
const mutationStates = process.argv.includes('--mutations') ? process.argv[process.argv.indexOf('--mutations') + 1].split(',') : [];
if (!unitId) {
  console.error('usage: selftest.mjs <unit-id> [--record]');
  process.exit(2);
}

const unit = JSON.parse(readFileSync(join(PARITY_DIR, 'units', `${unitId}.json`), 'utf8'));
const runDir = join(PARITY_DIR, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${unitId}-${app}-selftest`);
// 정적 리소스(이미지)는 저작권·개인정보 때문에 공개 저장소에 올리지 않는다. 새 환경에서는 --fill로 다시 받는다
const assetsDir = join(PARITY_DIR, '.cache', 'assets');
const fillPath = (template, params) => template.replace(/\{(\w+)\}/g, (_, k) => String(params[k]));

const stops = [];
let failed = false;

try {
  stops.push(await startProxy());
  stops.push(app === 'web' ? await startWeb() : await startOrder());
  for (const state of unit.states) {
    const cassette = join(PARITY_DIR, 'fixtures', unitId, `${state.name}.cassette.json`);
    const path = fillPath(app === 'web' ? unit.candidate.path : unit.oracle.path, state.params);
    const common = { baseURL: APPS[app].baseURL, path, cassette, assetsDir, device: unit.device, actions: state.actions, masks: unit.masks };

    if (shouldRecord || shouldFill) {
      await capture({ ...common, mode: shouldRecord ? 'record' : 'fill', outDir: join(runDir, state.name, 'record') });
    }
    const runA = join(runDir, state.name, 'replay-1');
    const runB = join(runDir, state.name, 'replay-2');
    await capture({ ...common, mode: 'replay', outDir: runA });
    await capture({ ...common, mode: 'replay', outDir: runB });

    const report = compare({ oracleDir: runA, candidateDir: runB, outDir: join(runDir, state.name), spec: { ...unit, ...state } });
    const summary = Object.entries(report.gates)
      .map(([g, r]) => `${g}:${r.pass ? 'PASS' : 'FAIL'}`)
      .join(' ');
    console.warn(`[${state.name}] ${report.pass ? 'PASS' : 'FAIL'}  ${summary}  diffPixels=${report.gates.G6.diffPixels}`);
    if (!report.pass) {
      failed = true;
      console.warn(JSON.stringify(report.gates, null, 2));
    }

    // 변이 테스트: 기대한 게이트가 전부 FAIL이어야 탐지 성공
    if (mutationStates.includes(state.name)) {
      for (const m of MUTATIONS) {
        const out = join(runDir, state.name, `mutation-${m.name}`);
        let cap;
        try {
          cap = await capture({ ...common, mode: 'replay', outDir: out, mutate: m.mutate, beforeGoto: m.beforeGoto && ((ctx) => m.beforeGoto(ctx, unit)) });
        } catch (error) {
          // 상태에 도달하지 못함(예: 요청 누락으로 버튼이 안 생김) = 상태 실패로 탐지
          console.warn(`  mutation ${m.name.padEnd(18)} DETECTED failed=[unreachable] (${String(error).split('\n')[0].slice(0, 80)})`);
          continue;
        }
        if (cap.mutationApplied === false) {
          console.warn(`  mutation ${m.name.padEnd(18)} N/A      (이 상태에 적용 대상 없음)`);
          continue;
        }
        const r = compare({ oracleDir: runA, candidateDir: out, outDir: out, spec: { ...unit, ...state } });
        const failedGates = Object.entries(r.gates).filter(([, g]) => !g.pass).map(([g]) => g);
        const detected = m.expect.every((g) => failedGates.includes(g));
        console.warn(`  mutation ${m.name.padEnd(18)} ${detected ? 'DETECTED' : 'MISSED  '} failed=[${failedGates.join(',')}] expect=[${m.expect.join(',')}]`);
        if (!detected) failed = true;
      }
    }
  }
} finally {
  stops.reverse().forEach((stop) => stop());
}

console.warn(`run dir: ${runDir}`);
process.exit(failed ? 1 : 0);
