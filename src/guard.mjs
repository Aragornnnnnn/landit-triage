// 분석을 돌릴지 정하는 로직 — 구독 사용량을 지키는 하루 상한과 같은 이슈 중복 분석 방지

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// triage.yml의 단계 이름 — 계약 테스트(guard.test.mjs)가 워크플로우와 맞는지 확인한다
export const ANALYZE_STEP = 'Claude 분석';
export const PUBLISH_STEP = '스레드 게시';

// 카드 없이 손으로 돌린 시험 실행의 run-name 꼬리표
export const DRY_RUN_LABEL = '시험';

export const SKIP_REASON = {
  duplicate: 'duplicate',
  dailyLimit: 'daily-limit',
};

// 하루는 한국 시각 자정부터 센다
export const kstDayStart = (now = new Date()) => {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) -
      KST_OFFSET_MS,
  );
};

// 실행 목록 조회 범위 — 어제 만든 실행을 오늘 다시 돌린 경우까지 보려고 하루 더 앞에서 받는다
export const runsQueryStart = (now = new Date()) =>
  new Date(kstDayStart(now).getTime() - DAY_MS)
    .toISOString()
    .replace('.000Z', 'Z');

// triage.yml run-name과 같은 형식 — 지난 실행에서 이슈와 카드를 찾는 열쇠다(계약 테스트로 확인)
export const runTitle = (issueId, messageId) =>
  `triage ${issueId} · ${messageId || DRY_RUN_LABEL}`;

const stepOf = (jobs, name) =>
  jobs.flatMap((job) => job.steps ?? []).find((step) => step.name === name);

// 스레드 게시까지 성공 = 카드에 분석 글이 이미 있다
export const didPublish = (jobs) =>
  stepOf(jobs, PUBLISH_STEP)?.conclusion === 'success';

// 분석 단계가 시작됐다 = 성공·실패와 상관없이 구독 사용량을 썼다
export const didStartAnalysis = (jobs) => {
  const step = stepOf(jobs, ANALYZE_STEP);
  return (
    Boolean(step) && step.status !== 'queued' && step.conclusion !== 'skipped'
  );
};

const isActive = (run) => run.status !== 'completed';

// 실행 순서는 시작 시각 기준 — 다시 실행한 실행은 id가 작아도 지금 시작한 것으로 본다
const startedAt = (run) =>
  new Date(run.run_started_at ?? run.created_at).getTime();

const isEarlier = (run, me) =>
  startedAt(run) < startedAt(me) ||
  (startedAt(run) === startedAt(me) && run.id < me.id);

/**
 * 같은 이슈를 이미 카드에 분석해 올렸거나, 먼저 들어온 같은 이슈 실행이 지금 도는 중인지 본다.
 * 시험 실행(카드 없음)은 글을 올리지 않았으니 세지 않는다.
 * @param {(runId: number) => Promise<Array>} listJobs 실행의 job·단계 목록 조회
 */
export const hasAnalyzed = async ({ runs, issueId, me, listJobs }) => {
  const prefix = `triage ${issueId} · `;
  const sameIssue = runs.filter(
    (run) =>
      run.id !== me.id &&
      run.display_title.startsWith(prefix) &&
      run.display_title !== runTitle(issueId),
  );
  if (sameIssue.some((run) => isActive(run) && isEarlier(run, me))) return true;
  for (const run of sameIssue.filter((r) => !isActive(r))) {
    if (didPublish(await listJobs(run.id))) return true;
  }
  return false;
};

/**
 * 오늘(한국 시각) 나보다 먼저 시작해 Claude를 불렀거나 부를 수 있는 실행 수.
 * 아직 도는 실행은 분석하는 것으로 친다 — 이슈가 몰리면 전부 가드 단계에 있어서, 시작한 것만 세면 상한이 안 걸린다.
 * 상한에 닿으면 더 세지 않는다(몰릴 때 API 호출이 늘지 않게).
 */
export const countTodayAnalyses = async ({
  runs,
  me,
  dayStart,
  dailyLimit,
  listJobs,
}) => {
  const earlier = runs
    .filter(
      (run) =>
        run.id !== me.id &&
        startedAt(run) >= dayStart.getTime() &&
        isEarlier(run, me),
    )
    .sort((a, b) => startedAt(a) - startedAt(b) || a.id - b.id);

  let count = 0;
  for (const run of earlier) {
    if (count >= dailyLimit) break;
    if (isActive(run) || didStartAnalysis(await listJobs(run.id))) count += 1;
  }
  return count;
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

// 허용 채널 목록(쉼표 구분)이 있으면 그 채널에만 글을 올린다. 비어 있으면 제한하지 않는다
export const isAllowedChannel = (channelId, allowList) => {
  if (!channelId || !allowList) return true;
  return allowList
    .split(',')
    .map((id) => id.trim())
    .includes(channelId);
};
