// 분석을 돌릴지 정한다 — 입력이 이상하거나, 같은 이슈를 이미 분석했거나, 오늘 상한에 닿았으면 Claude를 부르지 않는다
import { optionalEnv, requireEnv, setOutput } from '../src/env.mjs';
import { createGithubClient } from '../src/github.mjs';
import {
  countTodayAnalyses,
  decideRun,
  didPublish,
  hasAnalyzed,
  isAllowedChannel,
  kstDayStart,
  parseDailyLimit,
  runsQueryStart,
} from '../src/guard.mjs';
import { invalidInputs } from '../src/inputs.mjs';

const DEFAULT_DAILY_LIMIT = 10;

// 가드가 첫 단계라 여기서 한 번 막으면 뒤 단계는 검증된 값만 쓴다
const inputs = {
  issueId: optionalEnv('ISSUE_ID'),
  eventId: optionalEnv('EVENT_ID'),
  channelId: optionalEnv('CHANNEL_ID'),
  messageId: optionalEnv('MESSAGE_ID'),
};
const invalid = invalidInputs(inputs);
if (invalid.length)
  throw new Error(`입력 형식이 맞지 않아요: ${invalid.join(', ')}`);
if (!isAllowedChannel(inputs.channelId, optionalEnv('TRIAGE_CHANNELS')))
  throw new Error('허용 목록(TRIAGE_CHANNELS)에 없는 채널이에요');

const currentRunId = Number(requireEnv('GITHUB_RUN_ID'));
const dailyLimit = parseDailyLimit(
  optionalEnv('DAILY_LIMIT'),
  DEFAULT_DAILY_LIMIT,
);
const github = createGithubClient(
  requireEnv('GH_TOKEN'),
  requireEnv('GITHUB_REPOSITORY'),
  requireEnv('WORKFLOW_FILE'),
);

const [todayRuns, recentRuns] = await Promise.all([
  github.listRunsSince(runsQueryStart()),
  github.listRecentRuns(),
]);
// 지금 실행은 목록에 있다. 혹시 없으면 지금 시작한 것으로 본다
const me = todayRuns.find((run) => run.id === currentRunId) ?? {
  id: currentRunId,
  run_started_at: new Date().toISOString(),
};

// "다시 실행"은 같은 run id라 지난 실행 목록으로는 못 잡는다 — 직전 시도가 이미 글을 올렸으면 중복이다
const attempt = Number(optionalEnv('RUN_ATTEMPT') ?? 1);
const publishedBefore =
  attempt > 1 &&
  didPublish(await github.listAttemptJobs(currentRunId, attempt - 1));

const [analyzedElsewhere, todayCount] = await Promise.all([
  hasAnalyzed({
    runs: recentRuns,
    issueId: inputs.issueId,
    me,
    listJobs: github.listJobs,
  }),
  countTodayAnalyses({
    runs: todayRuns,
    me,
    dayStart: kstDayStart(),
    dailyLimit,
    listJobs: github.listJobs,
  }),
]);
const alreadyAnalyzed = publishedBefore || analyzedElsewhere;
const { proceed, reason } = decideRun({
  alreadyAnalyzed,
  todayCount,
  dailyLimit,
});

console.log(
  `이슈 ${inputs.issueId} · 오늘 앞선 분석 ${todayCount}/${dailyLimit}건 · ${proceed ? '분석해요' : `건너뛰어요(${reason})`}`,
);
setOutput('proceed', String(proceed));
setOutput('reason', reason ?? '');
setOutput('daily_limit', String(dailyLimit));
