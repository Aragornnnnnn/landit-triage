// 분석을 돌릴지 정한다 — 같은 이슈를 이미 분석했거나 오늘 상한에 닿았으면 Claude를 부르지 않는다
import { optionalEnv, requireEnv, setOutput } from '../src/env.mjs';
import { createGithubClient } from '../src/github.mjs';
import {
  countTodayAnalyses,
  decideRun,
  hasAnalyzed,
  kstDayStartIso,
  parseDailyLimit,
} from '../src/guard.mjs';
import { invalidInputs } from '../src/inputs.mjs';

const DEFAULT_DAILY_LIMIT = 10;

// 가드가 첫 단계라 여기서 한 번 막으면 뒤 단계는 검증된 값만 쓴다
const invalid = invalidInputs({
  issueId: optionalEnv('ISSUE_ID'),
  eventId: optionalEnv('EVENT_ID'),
  channelId: optionalEnv('CHANNEL_ID'),
  messageId: optionalEnv('MESSAGE_ID'),
});
if (invalid.length)
  throw new Error(`입력 형식이 맞지 않아요: ${invalid.join(', ')}`);

const issueId = requireEnv('ISSUE_ID');
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
  github.listRunsSince(kstDayStartIso()),
  github.listRecentRuns(),
]);
const [alreadyAnalyzed, todayCount] = await Promise.all([
  hasAnalyzed({
    runs: recentRuns,
    issueId,
    currentRunId,
    listJobs: github.listJobs,
  }),
  countTodayAnalyses({
    runs: todayRuns,
    currentRunId,
    listJobs: github.listJobs,
  }),
]);
const { proceed, reason } = decideRun({
  alreadyAnalyzed,
  todayCount,
  dailyLimit,
});

console.log(
  `이슈 ${issueId} · 오늘 분석 ${todayCount}/${dailyLimit}건 · ${proceed ? '분석해요' : `건너뛰어요(${reason})`}`,
);
setOutput('proceed', String(proceed));
setOutput('reason', reason ?? '');
setOutput('daily_limit', String(dailyLimit));
