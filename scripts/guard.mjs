// 분석을 돌릴지 정한다 — 같은 이슈를 이미 분석했거나 오늘 상한에 닿았으면 Claude를 부르지 않는다
import { optionalEnv, requireEnv, setOutput } from '../src/env.mjs';
import { createGithubClient } from '../src/github.mjs';
import {
  decideRun,
  didAnalyze,
  kstDayStartIso,
  previousRunsFor,
} from '../src/guard.mjs';

// 워크플로우의 분석 단계 이름과 같아야 한다
const ANALYZE_STEP = 'Claude 분석';
const DEFAULT_DAILY_LIMIT = 10;

const issueId = requireEnv('ISSUE_ID');
const currentRunId = Number(requireEnv('GITHUB_RUN_ID'));
const dailyLimit = Number(optionalEnv('DAILY_LIMIT') ?? DEFAULT_DAILY_LIMIT);

const github = createGithubClient(
  requireEnv('GH_TOKEN'),
  requireEnv('GITHUB_REPOSITORY'),
  requireEnv('WORKFLOW_FILE'),
);

const [todayRuns, recentRuns] = await Promise.all([
  github.listRunsSince(kstDayStartIso()),
  github.listRecentRuns(),
]);

let alreadyAnalyzed = false;
for (const run of previousRunsFor(recentRuns, issueId, currentRunId)) {
  if (didAnalyze(await github.listJobs(run.id), ANALYZE_STEP)) {
    alreadyAnalyzed = true;
    break;
  }
}

const todayCount = todayRuns.filter((run) => run.id !== currentRunId).length;
const { proceed, reason } = decideRun({
  alreadyAnalyzed,
  todayCount,
  dailyLimit,
});

console.log(
  `이슈 ${issueId} · 오늘 ${todayCount}/${dailyLimit}건 · ${proceed ? '분석해요' : `건너뛰어요(${reason})`}`,
);
setOutput('proceed', String(proceed));
setOutput('reason', reason ?? '');
setOutput('daily_limit', String(dailyLimit));
