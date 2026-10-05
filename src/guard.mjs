// 분석을 돌릴지 정하는 로직 — 구독 사용량을 지키는 하루 상한과 같은 이슈 중복 분석 방지

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// triage.yml의 분석 단계 이름 — 계약 테스트(guard.test.mjs)가 워크플로우와 맞는지 확인한다
export const ANALYZE_STEP = 'Claude 분석';

export const SKIP_REASON = {
  duplicate: 'duplicate',
  dailyLimit: 'daily-limit',
};

// 하루는 한국 시각 자정부터 센다. GitHub 검색 필터에 넣을 UTC ISO 문자열로 돌려준다
export const kstDayStartIso = (now = new Date()) => {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const midnightKst = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate(),
  );
  return new Date(midnightKst - KST_OFFSET_MS)
    .toISOString()
    .replace('.000Z', 'Z');
};

// triage.yml run-name과 같은 형식 — 지난 실행에서 이슈를 찾는 열쇠다(계약 테스트로 확인)
export const runTitle = (issueId) => `triage ${issueId}`;

const analyzeStepOf = (jobs) =>
  jobs.flatMap((job) => job.steps ?? []).find((s) => s.name === ANALYZE_STEP);

// 분석 단계가 성공으로 끝났다 = 스레드 글이 이미 있다
export const didAnalyze = (jobs) =>
  analyzeStepOf(jobs)?.conclusion === 'success';

// 분석 단계가 시작됐다 = 성공·실패와 상관없이 구독 사용량을 썼다
export const didStartAnalysis = (jobs) => {
  const step = analyzeStepOf(jobs);
  return (
    Boolean(step) && step.status !== 'queued' && step.conclusion !== 'skipped'
  );
};

const isActive = (run) =>
  run.status === 'queued' || run.status === 'in_progress';

/**
 * 같은 이슈를 이미 분석했거나, 먼저 들어온 실행이 지금 분석 중인지 본다.
 * 건너뛴 실행도 success로 끝나서, 끝난 실행은 단계 기록까지 확인한다.
 * @param {(runId: number) => Promise<Array>} listJobs 실행의 job·단계 목록 조회
 */
export const hasAnalyzed = async ({
  runs,
  issueId,
  currentRunId,
  listJobs,
}) => {
  const sameIssue = runs.filter(
    (run) => run.id !== currentRunId && run.display_title === runTitle(issueId),
  );
  // 같은 이슈 알림이 거의 동시에 두 번 오면 먼저 온 쪽만 분석한다
  if (sameIssue.some((run) => run.id < currentRunId && isActive(run)))
    return true;
  for (const run of sameIssue.filter((r) => r.conclusion === 'success')) {
    if (didAnalyze(await listJobs(run.id))) return true;
  }
  return false;
};

/**
 * 나보다 먼저 들어온 오늘 실행 중 Claude를 부른 수. 건너뛴 실행은 사용량을 안 써서 세지 않는다.
 * 나중에 들어온 실행을 세면 이슈가 몰릴 때 서로를 세다가 전부 건너뛴다.
 */
export const countTodayAnalyses = async ({ runs, currentRunId, listJobs }) => {
  const earlier = runs.filter((run) => run.id < currentRunId);
  const jobsPerRun = await Promise.all(earlier.map((run) => listJobs(run.id)));
  return jobsPerRun.filter(didStartAnalysis).length;
};

/**
 * @param {object} input
 * @param {boolean} input.alreadyAnalyzed 같은 이슈를 이미 분석했는지
 * @param {number} input.todayCount 나보다 먼저 오늘 Claude를 부른 횟수
 * @param {number} input.dailyLimit 하루에 Claude를 부르는 최대 횟수
 */
export const decideRun = ({ alreadyAnalyzed, todayCount, dailyLimit }) => {
  if (alreadyAnalyzed) return { proceed: false, reason: SKIP_REASON.duplicate };
  if (todayCount >= dailyLimit)
    return { proceed: false, reason: SKIP_REASON.dailyLimit };
  return { proceed: true, reason: null };
};

// 레포 변수가 숫자가 아니면 상한이 꺼지지 않게 기본값으로 돌린다
export const parseDailyLimit = (value, fallback) => {
  if (value == null || value === '') return fallback;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 0 ? limit : fallback;
};
