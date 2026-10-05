// 분석 실행 여부를 정하는 가드 로직의 테스트 — 하루 상한과 중복 분석
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideRun,
  didAnalyze,
  kstDayStartIso,
  previousRunsFor,
  runTitle,
} from './guard.mjs';

const run = (id, title, conclusion = 'success') => ({
  id,
  display_title: title,
  conclusion,
});

describe('kstDayStartIso', () => {
  it('한국 시각 자정을 UTC ISO 문자열로 돌려준다', () => {
    // Given 한국 시각 10/5 22:00 (UTC 13:00)
    const now = new Date('2026-10-05T13:00:00Z');

    // Then 한국 10/5 0시 = UTC 10/4 15시
    assert.equal(kstDayStartIso(now), '2026-10-04T15:00:00Z');
  });

  it('UTC로는 전날이어도 한국 날짜 기준으로 자른다', () => {
    // Given 한국 시각 10/6 08:00 (UTC 10/5 23:00)
    const now = new Date('2026-10-05T23:00:00Z');

    assert.equal(kstDayStartIso(now), '2026-10-05T15:00:00Z');
  });
});

describe('runTitle', () => {
  it('실행 이름에 이슈 id를 넣어 중복을 찾을 수 있게 한다', () => {
    assert.equal(runTitle('WEB-PROD-6'), 'triage WEB-PROD-6');
  });
});

describe('previousRunsFor', () => {
  it('같은 이슈로 성공한 지난 실행만 고른다', () => {
    const runs = [
      run(1, 'triage WEB-PROD-6'),
      run(2, 'triage WEB-PROD-6', 'failure'),
      run(3, 'triage WEB-PROD-7'),
      run(9, 'triage WEB-PROD-6', null),
    ];

    assert.deepEqual(
      previousRunsFor(runs, 'WEB-PROD-6', 9).map((r) => r.id),
      [1],
    );
  });

  it('이슈 id가 다른 이슈의 접두어여도 같은 이슈로 보지 않는다', () => {
    const runs = [run(3, 'triage WEB-PROD-1D')];

    assert.deepEqual(previousRunsFor(runs, 'WEB-PROD-1', 9), []);
  });
});

describe('didAnalyze', () => {
  it('분석 단계가 성공한 실행이면 true', () => {
    const jobs = [{ steps: [{ name: 'Claude 분석', conclusion: 'success' }] }];

    assert.equal(didAnalyze(jobs, 'Claude 분석'), true);
  });

  it('분석 단계를 건너뛴 실행이면 false', () => {
    // Given 하루 상한으로 분석 단계가 skipped된 실행
    const jobs = [{ steps: [{ name: 'Claude 분석', conclusion: 'skipped' }] }];

    assert.equal(didAnalyze(jobs, 'Claude 분석'), false);
  });
});

describe('decideRun', () => {
  it('처음 보는 이슈이고 오늘 실행이 상한보다 적으면 분석한다', () => {
    assert.deepEqual(
      decideRun({ alreadyAnalyzed: false, todayCount: 9, dailyLimit: 10 }),
      { proceed: true, reason: null },
    );
  });

  it('오늘 실행이 상한에 닿으면 건너뛴다', () => {
    assert.deepEqual(
      decideRun({ alreadyAnalyzed: false, todayCount: 10, dailyLimit: 10 }),
      { proceed: false, reason: 'daily-limit' },
    );
  });

  it('이미 분석한 이슈면 상한보다 먼저 중복으로 건너뛴다', () => {
    assert.deepEqual(
      decideRun({ alreadyAnalyzed: true, todayCount: 10, dailyLimit: 10 }),
      { proceed: false, reason: 'duplicate' },
    );
  });
});
