// 회귀 게이트(G8): WEB_RECODE 기준 ref 대 후보 ref를 같은 카세트로 재생해 화면이 같은지 본다.
// 판정은 G0(정상 렌더) + G6(시각). G2는 참고 정보: foundation처럼 데이터 로딩 방식(ISR→SSR 등)을
// 의도적으로 바꾸는 변경에서는 요청이 달라지는 것이 정상이다.
//
// 실행: node regress.mjs --base <ref> --candidate <ref> [--fill] [--pages home,store-list]
//   --fill: 카세트에 없는 GET을 stage에서 보충 (루프 밖에서만)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { capture } from './capture.mjs';
import { compare } from './compare.mjs';
import { APPS, PARITY_DIR, startProxy, startWeb, WEB_REPO } from './lib/apps.mjs';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const baseRef = arg('--base', 'origin/develop');
const candidateRef = arg('--candidate', 'HEAD');
const shouldFill = process.argv.includes('--fill');
const only = arg('--pages', '')?.split(',').filter(Boolean) ?? [];

const DEVICES = { desktop: 'Desktop Chrome', mobile: 'Pixel 5' };
const spec = JSON.parse(readFileSync(join(PARITY_DIR, 'units', 'R-regression.json'), 'utf8'));
const pages = spec.pages.filter((p) => only.length === 0 || only.includes(p.name));
const rev = (ref) => execFileSync('git', ['rev-parse', ref], { cwd: WEB_REPO }).toString().trim();
const base = rev(baseRef);
const candidate = rev(candidateRef);
const runDir = join(PARITY_DIR, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-regress`);
const firstLine = (error) => String(error).split('\n')[0].slice(0, 200);

const cases = [];
const stops = [];
try {
  stops.push(await startProxy());
  stops.push(await startWeb(base, 'base'));
  stops.push(await startWeb(candidate, 'candidate'));

  for (const page of pages) {
    for (const device of page.devices) {
      const name = `${page.name}.${device}`;
      const caseDir = join(runDir, name);
      mkdirSync(caseDir, { recursive: true });
      const common = {
        path: page.path,
        cassette: join(PARITY_DIR, 'fixtures', 'R-regression', `${name}.cassette.json`),
        assetsDir: join(PARITY_DIR, '.cache', 'assets'),
        device: DEVICES[device],
        masks: spec.masks,
        mode: shouldFill ? 'fill' : 'replay',
      };
      try {
        await capture({ ...common, baseURL: APPS['web-base'].baseURL, outDir: join(caseDir, 'base') });
        await capture({ ...common, baseURL: APPS.web.baseURL, outDir: join(caseDir, 'candidate') });
      } catch (error) {
        cases.push({ name, pass: false, error: firstLine(error) });
        continue;
      }
      const report = compare({ oracleDir: join(caseDir, 'base'), candidateDir: join(caseDir, 'candidate'), outDir: caseDir, spec: { ...spec, ...page } });
      const pass = report.gates.G0.pass && report.gates.G6.pass;
      cases.push({ name, pass, gates: report.gates });
    }
  }
} catch (error) {
  console.error(`[regress] harness error: ${firstLine(error)}`);
} finally {
  stops.reverse().forEach((stop) => stop());
}

const expectedCases = pages.reduce((n, p) => n + p.devices.length, 0);
const pass = cases.length === expectedCases && cases.every((c) => c.pass);
mkdirSync(runDir, { recursive: true });
writeFileSync(join(runDir, 'report.json'), `${JSON.stringify({ base, candidate, pass, expectedCases, executedCases: cases.length, cases }, null, 2)}\n`);
cases.forEach((c) => {
  const detail = c.gates ? `G0:${c.gates.G0.pass ? 'PASS' : 'FAIL'} G6:${c.gates.G6.pass ? 'PASS' : 'FAIL'} diffPixels=${c.gates.G6.diffPixels}  (G2 참고:${c.gates.G2.pass ? 'same' : 'diff'})` : c.error;
  console.warn(`[${c.name}] ${c.pass ? 'PASS' : 'FAIL'}  ${detail}`);
});
console.warn(`${pass ? 'PASS' : 'FAIL'}  cases ${cases.length}/${expectedCases}  report: ${join(runDir, 'report.json')}`);
process.exit(pass ? 0 : 1);
