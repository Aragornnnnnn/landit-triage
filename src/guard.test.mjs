// 분석 실행 여부를 정하는 가드 로직의 테스트 — 하루 상한, 중복 분석, 워크플로우와의 계약
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  ANALYZE_STEP,
  countTodayAnalyses,
  decideRun,
  hasAnalyzed,
  kstDayStartIso,
  parseDailyLimit,
  runTitle,
} from './guard.mjs';

const ISSUE = '7773966015';

const run = (id, issueId, conclusion = 'success', status = 'completed') => ({
  id,
  display_title: runTitle(issueId),
  conclusion,
  status,
});

const jobsWith = (status, conclusion) => [
  {
    steps: [
      { name: '실행 여부 판단', status: 'completed', conclusion: 'success' },
      { name: ANALYZE_STEP, status, conclusion },
    ],
  },
];

// 실행 id → 분석 단계 상태
const fakeListJobs = (byRunId) => async (runId) => byRunId[runId];

describe('워크플로우 계약', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/triage.yml', import.meta.url),
    'utf8',
  );

  it('분석 단계 이름이 워크플로우와 같다', () => {
    assert.ok(workflow.includes(`- name: ${ANALYZE_STEP}\n`));
  });

  it('run-name이 runTitle 형식으로 시작한다', () => {
    assert.ok(workflow.includes(`run-name: ${runTitle('')}\${{`));
  });
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

describe('hasAnalyzed', () => {
  it('같은 이슈를 분석까지 마친 지난 실행이 있으면 true', async () => {
    const result = await hasAnalyzed({
      runs: [run(1, ISSUE), run(9, ISSUE, null, 'in_progress')],
      issueId: ISSUE,
      currentRunId: 9,
      listJobs: fakeListJobs({ 1: jobsWith('completed', 'success') }),
    });

    assert.equal(result, true);
  });

  it('지난 실행이 분석 단계를 건너뛰었으면 false', async () => {
    // Given 하루 상한으로 분석 없이 끝난 실행
    const result = await hasAnalyzed({
      runs: [run(1, ISSUE)],
      issueId: ISSUE,
      currentRunId: 9,
      listJobs: fakeListJobs({ 1: jobsWith('completed', 'skipped') }),
    });

    assert.equal(result, false);
  });

  it('지난 분석이 실패했으면 다시 분석하도록 false', async () => {
    const result = await hasAnalyzed({
      runs: [run(1, ISSUE, 'failure')],
      issueId: ISSUE,
      currentRunId: 9,
      listJobs: fakeListJobs({ 1: jobsWith('completed', 'failure') }),
    });

    assert.equal(result, false);
  });

  it('먼저 들어온 같은 이슈 실행이 아직 도는 중이면 true', async () => {
    // Given 같은 알림이 거의 동시에 두 번 와서 1번이 분석 중이다
    const result = await hasAnalyzed({
      runs: [run(1, ISSUE, null, 'in_progress')],
      issueId: ISSUE,
      currentRunId: 9,
      listJobs: fakeListJobs({}),
    });

    // Then 나중에 온 9번은 건너뛴다
    assert.equal(result, true);
  });

  it('나중에 들어온 같은 이슈 실행이 도는 중이어도 먼저 온 쪽은 분석한다', async () => {
    const result = await hasAnalyzed({
      runs: [run(12, ISSUE, null, 'queued')],
      issueId: ISSUE,
      currentRunId: 9,
      listJobs: fakeListJobs({}),
    });

    assert.equal(result, false);
  });

  it('이슈 id가 다른 이슈의 접두어여도 같은 이슈로 보지 않는다', async () => {
    const result = await hasAnalyzed({
      runs: [run(1, '7771')],
      issueId: '777',
      currentRunId: 9,
      listJobs: fakeListJobs({ 1: jobsWith('completed', 'success') }),
    });

    assert.equal(result, false);
  });
});

describe('countTodayAnalyses', () => {
  it('Claude를 부른 실행만 센다 — 성공·실패·진행 중은 세고 건너뜀은 뺀다', async () => {
    // Given 오늘 실행 다섯 개(지금 실행 포함)
    const runs = [1, 2, 3, 4, 9].map((id) => run(id, `${id}`));
    const listJobs = fakeListJobs({
      1: jobsWith('completed', 'success'),
      2: jobsWith('completed', 'failure'),
      3: jobsWith('in_progress', null),
      4: jobsWith('completed', 'skipped'),
    });

    // When 지금 실행(9)을 빼고 세면
    const count = await countTodayAnalyses({ runs, currentRunId: 9, listJobs });

    // Then 건너뛴 4번만 빠진다
    assert.equal(count, 3);
  });

  it('나보다 나중에 들어온 실행은 세지 않는다 — 몰려 들어와도 서로를 세지 않게', async () => {
    // Given 1번(지금)보다 늦게 들어와 분석 중인 2·3번
    const runs = [run(1, 'a'), run(2, 'b'), run(3, 'c')];
    const listJobs = fakeListJobs({
      2: jobsWith('in_progress', null),
      3: jobsWith('in_progress', null),
    });

    const count = await countTodayAnalyses({ runs, currentRunId: 1, listJobs });

    assert.equal(count, 0);
  });
});

describe('parseDailyLimit', () => {
  it('숫자면 그대로 쓴다', () => {
    assert.equal(parseDailyLimit('5', 10), 5);
  });

  it('비었거나 숫자가 아니면 기본값으로 돌려 상한이 꺼지지 않게 한다', () => {
    assert.equal(parseDailyLimit(null, 10), 10);
    assert.equal(parseDailyLimit('abc', 10), 10);
    assert.equal(parseDailyLimit('-1', 10), 10);
  });
});

describe('decideRun', () => {
  it('처음 보는 이슈이고 오늘 분석이 상한보다 적으면 분석한다', () => {
    assert.deepEqual(
      decideRun({ alreadyAnalyzed: false, todayCount: 9, dailyLimit: 10 }),
      { proceed: true, reason: null },
    );
  });

  it('오늘 분석이 상한에 닿으면 건너뛴다', () => {
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
