// 분석 실행 여부를 정하는 가드 로직의 테스트 — 하루 상한, 중복 분석, 워크플로우와의 계약
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  ANALYZE_STEP,
  PUBLISH_STEP,
  countTodayAnalyses,
  decideRun,
  hasAnalyzed,
  isAllowedChannel,
  kstDayStart,
  parseDailyLimit,
  runTitle,
  runsQueryStart,
} from './guard.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const ISSUE = '7773966015';
const MESSAGE = '1416012345678901234';
const DAY_START = new Date('2026-10-04T15:00:00Z');

// 실행 — 분 단위로 시작 시각을 준다(오늘 0시 기준)
const run = (id, { minute = id, title, status = 'completed' } = {}) => ({
  id,
  display_title: title ?? runTitle(`${id}`, MESSAGE),
  status,
  conclusion: status === 'completed' ? 'success' : null,
  run_started_at: new Date(DAY_START.getTime() + minute * 60_000).toISOString(),
});

const jobsWith = (analyze, publish = 'success') => [
  {
    steps: [
      { name: '실행 여부 판단', status: 'completed', conclusion: 'success' },
      { name: ANALYZE_STEP, status: 'completed', conclusion: analyze },
      { name: PUBLISH_STEP, status: 'completed', conclusion: publish },
    ],
  },
];

const fakeListJobs = (byRunId) => {
  const calls = [];
  const listJobs = async (runId) => {
    calls.push(runId);
    return byRunId[runId] ?? jobsWith('success');
  };
  return { listJobs, calls };
};

describe('워크플로우 계약', () => {
  const workflow = read('../.github/workflows/triage.yml');

  it('가드가 보는 단계 이름이 워크플로우에 있다', () => {
    assert.ok(workflow.includes(`- name: ${ANALYZE_STEP}\n`));
    assert.ok(workflow.includes(`- name: ${PUBLISH_STEP}\n`));
  });

  it('run-name이 runTitle과 같은 형식이다', () => {
    assert.ok(
      workflow.includes(
        "run-name: triage ${{ inputs.issue_id }} · ${{ inputs.message_id || '시험' }}",
      ),
    );
    assert.equal(runTitle('1', ''), 'triage 1 · 시험');
  });

  it('스크립트가 내보내는 출력을 워크플로우가 같은 이름으로 읽는다', () => {
    // Given 스크립트별 setOutput 키와 워크플로우 step id
    const scripts = { guard: 'guard.mjs', context: 'context.mjs' };
    for (const [stepId, file] of Object.entries(scripts)) {
      const keys = [
        ...read(`../scripts/${file}`).matchAll(/setOutput\('(\w+)'/g),
      ].map((m) => m[1]);

      // Then 키마다 steps.<id>.outputs.<key>로 쓰인다
      assert.ok(keys.length > 0);
      for (const key of keys)
        assert.ok(
          workflow.includes(`steps.${stepId}.outputs.${key}`),
          `${stepId}.${key}`,
        );
    }
  });
});

describe('kstDayStart · runsQueryStart', () => {
  it('한국 시각 자정을 하루의 시작으로 본다', () => {
    // Given 한국 시각 10/6 08:00 (UTC 10/5 23:00)
    const now = new Date('2026-10-05T23:00:00Z');

    assert.equal(kstDayStart(now).toISOString(), '2026-10-05T15:00:00.000Z');
  });

  it('조회는 어제 0시부터 — 어제 만든 실행을 오늘 다시 돌린 것까지 본다', () => {
    const now = new Date('2026-10-05T23:00:00Z');

    assert.equal(runsQueryStart(now), '2026-10-04T15:00:00Z');
  });
});

describe('hasAnalyzed', () => {
  const me = run(9, { title: runTitle(ISSUE, '2'), status: 'in_progress' });

  it('같은 이슈를 카드에 올린 지난 실행이 있으면 true', async () => {
    const { listJobs } = fakeListJobs({ 1: jobsWith('success', 'success') });

    const result = await hasAnalyzed({
      runs: [run(1, { title: runTitle(ISSUE, MESSAGE) }), me],
      issueId: ISSUE,
      me,
      listJobs,
    });

    assert.equal(result, true);
  });

  it('지난 실행이 게시까지 못 갔으면 다시 분석하도록 false', async () => {
    // Given 분석은 했지만 게시가 실패한 실행
    const { listJobs } = fakeListJobs({ 1: jobsWith('success', 'failure') });

    const result = await hasAnalyzed({
      runs: [run(1, { title: runTitle(ISSUE, MESSAGE) })],
      issueId: ISSUE,
      me,
      listJobs,
    });

    assert.equal(result, false);
  });

  it('시험 실행은 카드에 올리지 않았으니 세지 않는다', async () => {
    const { listJobs, calls } = fakeListJobs({});

    const result = await hasAnalyzed({
      runs: [run(1, { title: runTitle(ISSUE, '') })],
      issueId: ISSUE,
      me,
      listJobs,
    });

    assert.equal(result, false);
    assert.deepEqual(calls, []);
  });

  it('먼저 들어온 같은 이슈 실행이 도는 중이면 true — 같은 알림이 거의 동시에 두 번 온 경우', async () => {
    const result = await hasAnalyzed({
      runs: [
        run(1, { title: runTitle(ISSUE, MESSAGE), status: 'in_progress' }),
      ],
      issueId: ISSUE,
      me,
      listJobs: fakeListJobs({}).listJobs,
    });

    assert.equal(result, true);
  });

  it('나중에 들어온 같은 이슈 실행이 도는 중이어도 먼저 온 쪽은 분석한다', async () => {
    const result = await hasAnalyzed({
      runs: [run(12, { title: runTitle(ISSUE, MESSAGE), status: 'queued' })],
      issueId: ISSUE,
      me,
      listJobs: fakeListJobs({}).listJobs,
    });

    assert.equal(result, false);
  });

  it('이슈 id가 다른 이슈의 접두어여도 같은 이슈로 보지 않는다', async () => {
    const result = await hasAnalyzed({
      runs: [run(1, { title: runTitle('7771', MESSAGE) })],
      issueId: '777',
      me,
      listJobs: fakeListJobs({}).listJobs,
    });

    assert.equal(result, false);
  });
});

describe('countTodayAnalyses', () => {
  const count = (runs, me, byRunId = {}, dailyLimit = 10) => {
    const fake = fakeListJobs(byRunId);
    return countTodayAnalyses({
      runs,
      me,
      dayStart: DAY_START,
      dailyLimit,
      listJobs: fake.listJobs,
    }).then((value) => ({ value, calls: fake.calls }));
  };

  it('끝난 실행은 분석 단계를 시작한 것만 센다', async () => {
    const me = run(9, { status: 'in_progress' });
    const { value } = await count([run(1), run(2), me], me, {
      1: jobsWith('success'),
      2: jobsWith('skipped', 'skipped'),
    });

    assert.equal(value, 1);
  });

  it('이슈가 몰려 앞선 실행이 아직 가드 단계여도 분석하는 것으로 센다', async () => {
    // Given 1분 안에 들어온 실행 12개, 전부 아직 도는 중
    const runs = Array.from({ length: 12 }, (_, i) =>
      run(i + 1, { minute: 0, status: 'in_progress' }),
    );

    // When 11번째 실행이 세면
    const { value, calls } = await count(runs, runs[10], {});

    // Then 앞선 10개를 세서 상한에 닿고, API는 부르지 않는다
    assert.equal(value, 10);
    assert.deepEqual(calls, []);
  });

  it('상한에 닿으면 더 세지 않는다 — 몰릴 때 API 호출이 늘지 않게', async () => {
    const runs = Array.from({ length: 30 }, (_, i) => run(i + 1));
    const me = run(31, { status: 'in_progress' });

    const { value, calls } = await count([...runs, me], me, {}, 3);

    assert.equal(value, 3);
    assert.equal(calls.length, 3);
  });

  it('나보다 나중에 시작한 실행과 어제 실행은 세지 않는다', async () => {
    const me = run(5, { status: 'in_progress' });
    const yesterday = run(1, { minute: -10 });

    const { value } = await count([yesterday, run(8), me], me);

    assert.equal(value, 0);
  });

  it('어제 만든 실행을 오늘 다시 돌렸으면 오늘 시작한 것으로 센다', async () => {
    // Given id는 작지만 오늘 다시 시작한 실행
    const rerun = run(1, { minute: 30 });
    const me = run(50, { minute: 40, status: 'in_progress' });

    const { value } = await count([rerun, me], me);

    assert.equal(value, 1);
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

describe('parseDailyLimit', () => {
  it('숫자면 그대로 쓴다', () => {
    assert.equal(parseDailyLimit('5', 10), 5);
  });

  it('비었거나 숫자가 아니면 기본값으로 돌려 상한이 꺼지지 않게 한다', () => {
    assert.equal(parseDailyLimit(undefined, 10), 10);
    assert.equal(parseDailyLimit('abc', 10), 10);
    assert.equal(parseDailyLimit('-1', 10), 10);
  });
});

describe('isAllowedChannel', () => {
  it('허용 목록이 있으면 그 채널만 통과한다', () => {
    assert.equal(isAllowedChannel('111', '111, 222'), true);
    assert.equal(isAllowedChannel('333', '111,222'), false);
  });

  it('목록이 없거나 채널이 없으면(시험 실행) 통과한다', () => {
    assert.equal(isAllowedChannel('333', undefined), true);
    assert.equal(isAllowedChannel(undefined, '111'), true);
  });
});
