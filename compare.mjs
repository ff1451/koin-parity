// 두 캡처(오라클 vs 후보)를 게이트로 판정한다. 판정은 이 스크립트만 한다 — LLM 판단은 PASS 근거가 아니다.
//
//   G0 오라클 무결성·정상 렌더: 양쪽 모두 프록시·리소스 miss 없음, 필수 텍스트 존재, 요소 존재
//   G2 네트워크 계약: 정규화한 API 요청 집합이 같음
//   G6 시각: fuzz 5% 후 다른 픽셀 0개 + 요소 목록 누락·추가 없음 (위치·스타일 차이는 진단 정보)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import pixelmatch from 'pixelmatch';
import pngjs from 'pngjs';

const { PNG } = pngjs;

const FUZZ = 0.05;
const BOX_TOLERANCE = 2;

function loadCapture(dir) {
  return JSON.parse(readFileSync(join(dir, 'capture.json'), 'utf8'));
}

function gateIntegrity(name, capture, spec) {
  const problems = [];
  const misses = capture.requests.filter((r) => r.miss);
  if (misses.length) problems.push(`${name}: 프록시 miss ${misses.map((m) => `${m.method} ${m.path}`).join(', ')}`);
  const assetMisses = capture.assets.filter((a) => a.action === 'miss');
  if (assetMisses.length) problems.push(`${name}: 정적 리소스 miss ${assetMisses.map((a) => a.url).join(', ')}`);
  if (capture.inventory.length === 0) problems.push(`${name}: 화면에 보이는 요소가 없음`);
  const texts = capture.inventory.map((i) => `${i.text} ${i.label}`).join('\n');
  (spec.requiredText ?? []).forEach((t) => {
    if (!texts.includes(t)) problems.push(`${name}: 필수 텍스트 "${t}" 없음`);
  });
  if ((spec.minRequests ?? 1) > 0 && capture.requests.length === 0) problems.push(`${name}: API 요청이 하나도 없음`);
  return problems;
}

function normalizeRequest(r, pathMap) {
  let path = r.path;
  for (const [from, to] of pathMap) path = path.replace(new RegExp(`^${from}$`), to);
  return `${r.method} ${path}${r.query ? `?${r.query}` : ''}${r.body ? ` ${r.body}` : ''}`;
}

function gateNetwork(oracle, candidate, spec) {
  const pathMap = Object.entries(spec.normalize?.paths ?? {});
  const ignored = spec.normalize?.ignoreRequests ?? [];
  const keep = (r) => !ignored.some((i) => i.method === r.method && i.path === r.path);
  const a = new Set(oracle.requests.filter(keep).map((r) => normalizeRequest(r, pathMap)));
  const b = new Set(candidate.requests.filter(keep).map((r) => normalizeRequest(r, pathMap)));
  const missing = [...a].filter((x) => !b.has(x));
  const extra = [...b].filter((x) => !a.has(x));
  return { pass: missing.length === 0 && extra.length === 0, missing, extra };
}

function matchInventory(oracleItems, candidateItems) {
  const key = (i) => `${i.role}|${i.text || i.label || i.tag}`;
  const used = new Set();
  const pairs = [];
  const missing = [];
  oracleItems.forEach((o) => {
    const idx = candidateItems.findIndex((c, ci) => !used.has(ci) && key(c) === key(o));
    if (idx < 0) {
      missing.push(o);
      return;
    }
    used.add(idx);
    pairs.push([o, candidateItems[idx]]);
  });
  const extra = candidateItems.filter((_, ci) => !used.has(ci));

  const layoutDiffs = [];
  const styleDiffs = [];
  pairs.forEach(([o, c]) => {
    const d = ['x', 'y', 'w', 'h'].filter((k) => Math.abs(o.box[k] - c.box[k]) > BOX_TOLERANCE);
    if (d.length) layoutDiffs.push({ element: key(o), oracle: o.box, candidate: c.box });
    const s = Object.keys(o.style).filter((k) => o.style[k] !== c.style[k]);
    if (s.length) styleDiffs.push({ element: key(o), diffs: Object.fromEntries(s.map((k) => [k, [o.style[k], c.style[k]]])) });
  });
  return { missing: missing.map(key), extra: extra.map(key), layoutDiffs, styleDiffs };
}

function gateVisual(oracleDir, candidateDir, outDir, oracle, candidate) {
  const a = PNG.sync.read(readFileSync(join(oracleDir, 'screenshot.png')));
  const b = PNG.sync.read(readFileSync(join(candidateDir, 'screenshot.png')));
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pad = (img) => {
    if (img.width === width && img.height === height) return img;
    const out = new PNG({ width, height, fill: true });
    out.data.fill(255);
    PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
    return out;
  };
  const pa = pad(a);
  const pb = pad(b);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(pa.data, pb.data, diff.data, width, height, { threshold: FUZZ, includeAA: false });
  writeFileSync(join(outDir, 'diff.png'), PNG.sync.write(diff));

  // 선언된 마스크 안의 요소는 짝 맞추기에서 제외한다 (마스크 면적은 리포트에 남는다)
  const unmasked = (items) => items.filter((i) => !i.masked);
  const inventory = matchInventory(unmasked(oracle.inventory), unmasked(candidate.inventory));
  const sizeMismatch = a.width !== b.width || a.height !== b.height;
  const area = (regions) => regions.reduce((sum, r) => sum + r.w * r.h, 0);
  const pageArea = oracle.page.width * oracle.page.height;
  return {
    pass: diffPixels === 0 && !sizeMismatch && inventory.missing.length === 0 && inventory.extra.length === 0,
    diffPixels,
    maskedRatio: Number((area(oracle.dynamicRegions ?? []) / pageArea).toFixed(4)),
    declaredMaskedElements: oracle.inventory.filter((i) => i.masked).length,
    size: { oracle: [a.width, a.height], candidate: [b.width, b.height] },
    ...inventory,
  };
}

/**
 * @param {{ oracleDir: string, candidateDir: string, outDir: string, spec: object }} opts
 */
const COMMON = JSON.parse(readFileSync(new URL('./units/_common.json', import.meta.url), 'utf8'));

// 단위 스펙에 공통 허용 목록을 합친다
function withCommon(spec) {
  return {
    ...spec,
    normalize: {
      paths: { ...COMMON.normalize.paths, ...spec.normalize?.paths },
      ignoreRequests: [...COMMON.normalize.ignoreRequests, ...(spec.normalize?.ignoreRequests ?? [])],
    },
  };
}

export function compare({ oracleDir, candidateDir, outDir, spec: unitSpec }) {
  const spec = withCommon(unitSpec);
  const oracle = loadCapture(oracleDir);
  const candidate = loadCapture(candidateDir);

  const integrity = [...gateIntegrity('oracle', oracle, spec), ...gateIntegrity('candidate', candidate, spec)];
  const gates = {
    G0: { pass: integrity.length === 0, problems: integrity },
    G2: gateNetwork(oracle, candidate, spec),
    G6: gateVisual(oracleDir, candidateDir, outDir, oracle, candidate),
  };
  // 상태 하나의 판정. 상태 수 대조(expected/executed)는 verify.mjs가 단위 전체에서 한다
  const report = { pass: Object.values(gates).every((g) => g.pass), gates };
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
