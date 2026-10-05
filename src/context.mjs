// Sentry 데이터를 분석 입력으로 다듬는 순수 로직 — 개인정보 제거, 코드 기준 커밋, 같은 사건 후보

const SHA_PATTERN = /^[0-9a-f]{40}$/;

// 웹 릴리즈는 landit-fe 커밋 해시다. 모바일처럼 해시가 아니면 배포 기준인 main으로 본다
export const resolveFrontendRef = (release) =>
  typeof release === 'string' && SHA_PATTERN.test(release) ? release : 'main';

const DROPPED_FIELDS = [
  '_meta',
  'sdk',
  'sdkUpdates',
  'userReport',
  'groupingConfig',
];

// 디스코드에 남을 수 있는 글을 쓰는 입력이라 사용자는 id만 넘긴다
export const sanitizeEvent = (event) => {
  const result = { ...event };
  for (const field of DROPPED_FIELDS) delete result[field];
  if (event.user) result.user = event.user.id ? { id: event.user.id } : {};
  return result;
};

const NEARBY_MS = 2 * 60 * 1000;

// 한 사건이 메시지가 다른 여러 이슈로 갈라져 올라온다 — 앞뒤 2분을 같은 사건 후보로 본다
export const nearbyWindow = (timestamp) => {
  const at = new Date(timestamp).getTime();
  return {
    start: new Date(at - NEARBY_MS).toISOString(),
    end: new Date(at + NEARBY_MS).toISOString(),
  };
};

export const pickNearbyIssues = (rows, currentIssue) => {
  const byIssue = new Map();
  for (const row of rows) {
    if (row.issue === currentIssue) continue;
    const entry = byIssue.get(row.issue) ?? {
      issue: row.issue,
      title: row.title,
      count: 0,
      traces: [],
    };
    entry.count += 1;
    if (row.trace && !entry.traces.includes(row.trace))
      entry.traces.push(row.trace);
    byIssue.set(row.issue, entry);
  }
  return [...byIssue.values()];
};
