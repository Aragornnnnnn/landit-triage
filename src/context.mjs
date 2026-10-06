// Sentry 데이터를 분석 입력으로 다듬는 순수 로직 — 필요한 칸만 고르기, 코드 기준 커밋, 같은 사건 후보

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

const isUserTag = (key) => key === 'user' || key.startsWith('user.');

// 이벤트 태그는 [{key, value}](REST) 또는 [[key, value]](웹훅) 모양이다
const normalizeTags = (tags) =>
  (tags ?? [])
    .map((tag) => (Array.isArray(tag) ? { key: tag[0], value: tag[1] } : tag))
    .filter((tag) => tag?.key && !isUserTag(tag.key));

// 쿼리·해시에는 토큰·인증 코드가 실리는 일이 많다 — 경로까지만 남긴다
export const stripQuery = (url) =>
  typeof url === 'string' ? url.split(/[?#]/)[0] : url;

const MAX_FRAMES = 30;
const TAIL_FRAMES = 3;
const MAX_BREADCRUMBS = 40;
const CONTEXT_KEYS = ['os', 'device', 'app', 'browser', 'runtime', 'trace'];

// 우리 코드 프레임과 맨 위(터진 곳) 몇 개만 — 라이브러리 깊은 프레임은 분석에 거의 쓰이지 않고 토큰만 든다
const pickFrames = (frames = []) =>
  frames
    .filter((frame, i) => frame.inApp || i >= frames.length - TAIL_FRAMES)
    .slice(-MAX_FRAMES)
    .map((frame) => ({
      filename: frame.filename,
      absPath: stripQuery(frame.absPath),
      function: frame.function,
      lineNo: frame.lineNo,
      colNo: frame.colNo,
      inApp: frame.inApp,
      ...(frame.inApp && frame.context && { context: frame.context }),
    }));

const pickBreadcrumb = (crumb) => {
  const data = crumb.data ?? {};
  return {
    timestamp: crumb.timestamp,
    type: crumb.type,
    category: crumb.category,
    level: crumb.level,
    message: crumb.message,
    data: {
      url: stripQuery(data.url),
      method: data.method,
      status_code: data.status_code,
      from: stripQuery(data.from),
      to: stripQuery(data.to),
    },
  };
};

const ENTRY_PICKERS = {
  exception: (data) => ({
    values: (data.values ?? []).map((value) => ({
      type: value.type,
      value: value.value,
      module: value.module,
      mechanism: value.mechanism && {
        type: value.mechanism.type,
        handled: value.mechanism.handled,
      },
      frames: pickFrames(value.stacktrace?.frames),
    })),
  }),
  breadcrumbs: (data) => ({
    values: (data.values ?? []).slice(-MAX_BREADCRUMBS).map(pickBreadcrumb),
  }),
  // 헤더·쿠키·쿼리·본문은 인증 정보가 섞일 수 있어 경로와 메서드만 넘긴다
  request: (data) => ({ url: stripQuery(data.url), method: data.method }),
  message: (data) => ({ formatted: data.formatted }),
};

/**
 * Claude에게 넘길 이벤트 — 필요한 칸만 골라 담는다(허용 목록 방식).
 * 받은 데이터를 지우는 대신 고르기 때문에 Sentry가 새 칸을 더해도 개인정보가 새지 않는다.
 */
export const slimEvent = (event) => ({
  eventID: event.eventID,
  dateCreated: event.dateCreated,
  title: event.title,
  message: event.message,
  culprit: event.culprit,
  platform: event.platform,
  release: event.release?.version ?? event.release ?? null,
  user: event.user?.id ? { id: event.user.id } : null,
  tags: normalizeTags(event.tags),
  contexts: Object.fromEntries(
    CONTEXT_KEYS.filter((key) => event.contexts?.[key]).map((key) => [
      key,
      event.contexts[key],
    ]),
  ),
  entries: (event.entries ?? [])
    .filter((entry) => ENTRY_PICKERS[entry.type])
    .map((entry) => ({
      type: entry.type,
      ...ENTRY_PICKERS[entry.type](entry.data ?? {}),
    })),
});

// 최근 이벤트 목록은 추이를 보는 용도라 요약만 — 자세한 내용은 event.json 한 건이면 된다
export const slimEventSummary = (event) => ({
  eventID: event.eventID,
  dateCreated: event.dateCreated,
  title: event.title,
  message: event.message,
  tags: normalizeTags(event.tags),
});

// 이슈 상세에는 담당자·열람자 이메일(assignedTo, seenBy)이 있다 — 분석에 쓸 칸만 고른다
export const slimIssue = (issue) => ({
  id: issue.id,
  shortId: issue.shortId,
  title: issue.title,
  culprit: issue.culprit,
  level: issue.level,
  status: issue.status,
  platform: issue.platform,
  project: issue.project?.slug,
  count: issue.count,
  userCount: issue.userCount,
  firstSeen: issue.firstSeen,
  lastSeen: issue.lastSeen,
  permalink: issue.permalink,
  metadata: issue.metadata,
  stats: issue.stats,
});

// 이슈 태그 분포에서 사용자 태그(이메일이 상위 값으로 올 수 있다)를 뺀다
export const sanitizeTagSummary = (tags) =>
  Array.isArray(tags) ? tags.filter((tag) => !isUserTag(tag.key ?? '')) : tags;

// 릴리즈 해시가 main 히스토리에 있을 때만 그 커밋을 본다. 확인 실패·main 밖이면 main
export const chooseFrontendRef = (ref, onMain) =>
  ref !== 'main' && onMain === true ? ref : 'main';

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

const sumBuckets = (buckets) =>
  Array.isArray(buckets)
    ? buckets.reduce((total, [, count]) => total + (Number(count) || 0), 0)
    : null;

const KST_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// 10/5 21:11 모양 — 디스코드 한 줄에 짧게 들어가게
const formatKst = (iso) => {
  const part = Object.fromEntries(
    KST_FORMAT.formatToParts(new Date(iso)).map(({ type, value }) => [
      type,
      value,
    ]),
  );
  return `${part.month}/${part.day} ${part.hour}:${part.minute}`;
};

/**
 * 스레드 맨 위에 고정할 사실 한 줄 — Claude가 아니라 Sentry 수치로 만든다(흔들리지 않게).
 * 없는 값은 빼고 남은 것만 잇는다.
 */
export const formatFactsLine = (issue) => {
  const last24h = sumBuckets(issue.stats?.['24h']);
  const parts = [
    issue.userCount != null && `${issue.userCount}명`,
    issue.count != null && `${issue.count}건`,
    last24h != null && `24시간 ${last24h}건`,
    issue.firstSeen && `${formatKst(issue.firstSeen)} 처음`,
  ].filter(Boolean);
  return parts.length ? `👥 ${parts.join(' · ')}` : null;
};
