// self-check 결과 판정 — 작업 폴더 안은 읽히고, 시스템·러너 경로는 막혀야 통과다
import { readFileSync } from 'node:fs';
import { parseIsolationReport } from '../src/isolation.mjs';

const result = JSON.parse(readFileSync('out/claude.json', 'utf8'));
const { ok, problems } = parseIsolationReport(result.result ?? '');

if (!ok) {
  console.error(`격리 점검 실패:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('격리 점검 통과');
