// 단위 검증: 오라클(order) 대 후보(WEB_RECODE)를 같은 카세트로 재생해 상태별로 게이트 판정한다.
// 루프가 PASS/FAIL 근거로 쓰는 유일한 결과는 이 스크립트의 종료 코드와 report.json 이다.
//
// 실행: node verify.mjs <unit-id> [--ref <git-ref>]
//   --ref: 후보로 빌드할 KOIN_WEB_RECODE ref (기본 HEAD). 저장소 위치는 KOIN_WEB_REPO (기본 ../KOIN_WEB_RECODE)
//   후보가 추가로 부르는 GET 보충은 루프 밖에서 fill.mjs 로 한다. 여기서는 재생만 한다
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { capture } from './capture.mjs';
import { compare } from './compare.mjs';
import { APPS, PARITY_DIR, startOrder, startProxy, startWeb, WEB_REPO } from './lib/apps.mjs';

const unitId = process.argv[2];
const ref = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1] : 'HEAD';
if (!unitId) {
  console.error('usage: verify.mjs <unit-id> [--ref <git-ref>]');
  process.exit(2);
}

const unit = JSON.parse(readFileSync(join(PARITY_DIR, 'units', `${unitId}.json`), 'utf8'));
const sha = execFileSync('git', ['rev-parse', ref], { cwd: WEB_REPO }).toString().trim();
const runDir = join(PARITY_DIR, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${unitId}-verify`);
const assetsDir = join(PARITY_DIR, '.cache', 'assets');
const fillPath = (template, params) => template.replace(/\{(\w+)\}/g, (_, k) => String(params[k]));
const firstLine = (error) => String(error).split('\n')[0].slice(0, 200);

const states = [];
const stops = [];

try {
  stops.push(await startProxy());
  stops.push(await startOrder());
  stops.push(await startWeb(sha));

  for (const state of unit.states) {
    const stateDir = join(runDir, state.name);
    mkdirSync(stateDir, { recursive: true });
    const common = {
      cassette: join(PARITY_DIR, 'fixtures', unitId, `${state.name}.cassette.json`),
      assetsDir,
      device: unit.device,
      actions: state.actions,
      masks: unit.masks,
      mode: 'replay',
    };
    const oracleDir = join(stateDir, 'oracle');
    const candidateDir = join(stateDir, 'candidate');

    try {
      await capture({ ...common, baseURL: APPS.order.baseURL, path: fillPath(unit.oracle.path, state.params), outDir: oracleDir });
    } catch (error) {
      // 오라클이 상태에 도달하지 못하면 단위 스펙·픽스처 문제다 (후보 탓 아님)
      states.push({ name: state.name, pass: false, error: `oracle capture failed: ${firstLine(error)}` });
      continue;
    }
    try {
      await capture({ ...common, baseURL: APPS.web.baseURL, path: fillPath(unit.candidate.path, state.params), outDir: candidateDir });
    } catch (error) {
      states.push({ name: state.name, pass: false, error: `candidate unreachable: ${firstLine(error)}` });
      continue;
    }
    const report = compare({ oracleDir, candidateDir, outDir: stateDir, spec: { ...unit, ...state } });
    states.push({ name: state.name, pass: report.pass, gates: report.gates });
  }
} catch (error) {
  console.error(`[verify] harness error: ${firstLine(error)}`);
} finally {
  stops.reverse().forEach((stop) => stop());
}

// 실행되지 않은 상태가 있으면 실패: 상태를 건너뛰어 통과하는 것을 막는다
const expectedCases = unit.states.length;
const executedCases = states.length;
const pass = executedCases === expectedCases && states.every((s) => s.pass);
const result = { unit: unitId, ref, sha, pass, expectedCases, executedCases, states };
mkdirSync(runDir, { recursive: true });
writeFileSync(join(runDir, 'report.json'), `${JSON.stringify(result, null, 2)}\n`);

states.forEach((s) => {
  const gates = s.gates ? Object.entries(s.gates).map(([g, r]) => `${g}:${r.pass ? 'PASS' : 'FAIL'}`).join(' ') : s.error;
  console.warn(`[${s.name}] ${s.pass ? 'PASS' : 'FAIL'}  ${gates}`);
});
console.warn(`${pass ? 'PASS' : 'FAIL'}  cases ${executedCases}/${expectedCases}  report: ${join(runDir, 'report.json')}`);
process.exit(pass ? 0 : 1);
