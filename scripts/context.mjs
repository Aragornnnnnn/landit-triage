// Claude에게 넘길 Sentry 데이터를 context/ 폴더에 모은다 — Claude는 Sentry에 직접 접근하지 않고 이 파일만 읽는다
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  DEPLOYED_REPOS,
  FRONTEND_REPO,
  nearbyWindow,
  pickDeployedRelease,
  pickNearbyIssues,
  resolveFrontendRef,
  sanitizeEvent,
  sanitizeTagSummary,
} from '../src/context.mjs';
import { optionalEnv, requireEnv, setOutput } from '../src/env.mjs';
import { isOnMain, listReleases } from '../src/github.mjs';
import { createSentryClient } from '../src/sentry.mjs';

const OUT_DIR = 'context';

const issueId = requireEnv('ISSUE_ID');
const githubToken = requireEnv('GH_TOKEN');
const sentry = createSentryClient(
  requireEnv('SENTRY_AUTH_TOKEN'),
  optionalEnv('SENTRY_ORG') ?? 'saynow',
  optionalEnv('SENTRY_API_BASE'),
);

const write = (name, data) =>
  writeFileSync(`${OUT_DIR}/${name}`, `${JSON.stringify(data, null, 2)}\n`);

// 부가 자료는 없어도 분석은 된다 — 실패를 기록만 하고 계속 간다
const optional = async (label, load) => {
  try {
    return await load();
  } catch (error) {
    console.warn(`[context] ${label} 수집 실패: ${error.message}`);
    return { error: error.message };
  }
};

mkdirSync(OUT_DIR, { recursive: true });

const issue = await sentry.getIssue(issueId);
const event = sanitizeEvent(
  await sentry.getEvent(issueId, optionalEnv('EVENT_ID')),
);
if (!event.dateCreated)
  console.warn('[context] 이벤트 시각이 없어 BE·AI는 main을 봐요');

const [recentEvents, tags, nearbyRows] = await Promise.all([
  optional('최근 이벤트', () => sentry.listRecentEvents(issueId)),
  optional('태그', () => sentry.listTags(issueId)),
  optional('같은 시간대 이벤트', () =>
    sentry.listEventsBetween(nearbyWindow(event.dateCreated)),
  ),
]);

// 릴리즈 해시가 main 히스토리에 없으면(포크 커밋, 지워진 커밋) main으로 떨어뜨린다
const frontendRef = await (async () => {
  const ref = resolveFrontendRef(event.release?.version ?? event.release);
  if (ref === 'main') return ref;
  const onMain = await optional('landit-fe 커밋 확인', () =>
    isOnMain(githubToken, FRONTEND_REPO, ref),
  );
  return onMain === true ? ref : 'main';
})();

// 릴리즈를 못 읽으면 main으로 — 코드 버전이 조금 어긋날 뿐 분석은 된다
const deployedRef = async ({ repository, tagPrefix }) => {
  const releases = await optional(`${repository} 릴리즈`, () =>
    listReleases(githubToken, repository),
  );
  return Array.isArray(releases) && event.dateCreated
    ? pickDeployedRelease(releases, tagPrefix, event.dateCreated)
    : 'main';
};
const [backendRef, aiRef] = await Promise.all([
  deployedRef(DEPLOYED_REPOS['landit-be']),
  deployedRef(DEPLOYED_REPOS['landit-ai']),
]);

write('issue.json', issue);
write('event.json', event);
write(
  'recent-events.json',
  Array.isArray(recentEvents) ? recentEvents.map(sanitizeEvent) : recentEvents,
);
write('tags.json', sanitizeTagSummary(tags));
write(
  'nearby.json',
  Array.isArray(nearbyRows)
    ? pickNearbyIssues(nearbyRows, issue.shortId)
    : nearbyRows,
);
// commits(실제 커밋 해시)는 체크아웃 뒤 워크플로우가 덧붙인다 — 여기는 체크아웃할 ref만 남긴다
write('meta.json', {
  shortId: issue.shortId,
  permalink: issue.permalink,
  project: issue.project?.slug,
  refs: {
    'landit-fe': frontendRef,
    'landit-be': backendRef,
    'landit-ai': aiRef,
  },
});

console.log(
  `이슈 ${issue.shortId} 수집 완료 · fe ${frontendRef} · be ${backendRef} · ai ${aiRef}`,
);
setOutput('frontend_ref', frontendRef);
setOutput('backend_ref', backendRef);
setOutput('ai_ref', aiRef);
