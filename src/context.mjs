// Sentry 데이터를 분석 입력으로 다듬는 순수 로직 — 개인정보 제거, 코드 기준 커밋, 같은 사건 후보

const SHA_PATTERN = /^[0-9a-f]{40}$/;

// 웹 릴리즈는 landit-fe 커밋 해시다. 모바일처럼 해시가 아니면 배포 기준인 main으로 본다
export const resolveFrontendRef = (release) =>
  typeof release === 'string' && SHA_PATTERN.test(release) ? release : 'main';

// 분석할 레포와 배포 태그 접두어 — 체크아웃 단계(triage.yml)와 같은 목록이다
export const DEPLOYED_REPOS = {
  'landit-be': { repository: 'Aragornnnnnn/landit-be', tagPrefix: 'be-v' },
  'landit-ai': { repository: 'Aragornnnnnn/landit-ai', tagPrefix: 'ai-v' },
};
export const FRONTEND_REPO = 'Aragornnnnnn/landit-fe';

// BE·AI는 main에서 손으로 배포하며 be-v1.6.0 같은 태그를 남긴다 — 이벤트 시각에 돌고 있던 배포를 고른다
export const pickDeployedRelease = (releases, prefix, at) => {
  const eventTime = new Date(at).getTime();
  const deployed = releases
    .filter(
      (release) =>
        !release.draft &&
        !release.prerelease &&
        release.tag_name.startsWith(prefix) &&
        new Date(release.published_at).getTime() <= eventTime,
    )
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  return deployed[0]?.tag_name ?? 'main';
};

const DROPPED_FIELDS = [
  '_meta',
  'sdk',
  'sdkUpdates',
  'userReport',
  'groupingConfig',
];

// 요청 정보 중 인증·개인정보가 섞일 수 있는 칸 — 분석엔 경로와 메서드면 충분하다
const DROPPED_REQUEST_FIELDS = [
  'headers',
  'cookies',
  'data',
  'env',
  'query_string',
];

const isUserTag = (key) => key === 'user' || key.startsWith('user.');

const tagKeyOf = (tag) => (Array.isArray(tag) ? tag[0] : tag?.key);

// Claude 입력과 보관 파일에 남는 값이라 사용자는 id만, 요청은 경로만 넘긴다
export const sanitizeEvent = (event) => {
  const result = { ...event };
  for (const field of DROPPED_FIELDS) delete result[field];
  if (event.user) result.user = event.user.id ? { id: event.user.id } : {};
  if (event.request) {
    result.request = { ...event.request };
    for (const field of DROPPED_REQUEST_FIELDS) delete result.request[field];
  }
  if (Array.isArray(event.tags))
    result.tags = event.tags.filter((tag) => !isUserTag(tagKeyOf(tag) ?? ''));
  return result;
};

// 이슈 태그 분포에서 사용자 태그(이메일이 상위 값으로 올 수 있다)를 뺀다
export const sanitizeTagSummary = (tags) =>
  Array.isArray(tags) ? tags.filter((tag) => !isUserTag(tag.key ?? '')) : tags;

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
