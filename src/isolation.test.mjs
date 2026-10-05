// self-check 결과 해석 테스트
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseIsolationReport } from './isolation.mjs';

const report = (overrides = {}) =>
  Object.entries({
    'README.md': 'READ',
    '/etc/hostname': 'DENIED',
    '/proc/self/environ': 'DENIED',
    '~/.claude.json': 'DENIED',
    '/home/runner/work/_temp': 'DENIED',
    ...overrides,
  })
    .map(([path, access]) => `- \`${path}\`: ${access}`)
    .join('\n');

describe('parseIsolationReport', () => {
  it('기대와 같으면 통과', () => {
    assert.deepEqual(parseIsolationReport(report()), {
      ok: true,
      problems: [],
    });
  });

  it('시스템 경로가 읽혔으면 실패', () => {
    const result = parseIsolationReport(
      report({ '/proc/self/environ': 'READ' }),
    );

    assert.equal(result.ok, false);
    assert.match(
      result.problems[0],
      /proc\/self\/environ: 기대 DENIED, 실제 READ/,
    );
  });

  it('답이 빠진 경로도 실패', () => {
    const result = parseIsolationReport('README.md: READ');

    assert.equal(result.ok, false);
    assert.equal(result.problems.length, 4);
  });
});
