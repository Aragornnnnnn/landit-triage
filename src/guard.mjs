// 분석을 돌릴지 정하는 순수 로직 — 구독 사용량을 지키는 하루 상한과 같은 이슈 중복 분석 방지

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

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

// 워크플로우 run-name과 같은 형식이어야 지난 실행에서 이슈를 찾을 수 있다
export const runTitle = (issueId) => `triage ${issueId}`;

// 같은 이슈로 돈 지난 실행들 — 실제로 분석까지 했는지는 실행의 단계 기록을 따로 봐야 안다(건너뛴 실행도 success로 끝난다)
export const previousRunsFor = (runs, issueId, currentRunId) =>
  runs.filter(
    (run) =>
      run.id !== currentRunId &&
      run.display_title === runTitle(issueId) &&
      run.conclusion === 'success',
  );

// 실행의 단계 목록에서 분석 단계가 성공했는지 본다
export const didAnalyze = (jobs, stepName) =>
  jobs.some((job) =>
    (job.steps ?? []).some(
      (step) => step.name === stepName && step.conclusion === 'success',
    ),
  );

/**
 * @param {object} input
 * @param {boolean} input.alreadyAnalyzed 같은 이슈를 이미 분석한 적이 있는지
 * @param {number} input.todayCount 지금 실행을 뺀, 한국 시각 오늘의 실행 수
 * @param {number} input.dailyLimit 하루에 Claude를 부르는 최대 횟수
 */
export const decideRun = ({ alreadyAnalyzed, todayCount, dailyLimit }) => {
  if (alreadyAnalyzed) return { proceed: false, reason: 'duplicate' };
  if (todayCount >= dailyLimit)
    return { proceed: false, reason: 'daily-limit' };
  return { proceed: true, reason: null };
};
