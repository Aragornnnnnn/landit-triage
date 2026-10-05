// Claude에게 넘길 Sentry 데이터를 context/ 폴더에 모은다 — Claude는 Sentry에 직접 접근하지 않고 이 파일만 읽는다
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  nearbyWindow,
  pickNearbyIssues,
  resolveFrontendRef,
  sanitizeEvent,
} from '../src/context.mjs';
import { optionalEnv, requireEnv, setOutput } from '../src/env.mjs';
import { createSentryClient } from '../src/sentry.mjs';

const OUT_DIR = 'context';

const issueId = requireEnv('ISSUE_ID');
const eventId = optionalEnv('EVENT_ID');
const sentry = createSentryClient(
  requireEnv('SENTRY_AUTH_TOKEN'),
  optionalEnv('SENTRY_ORG') ?? 'saynow',
  optionalEnv('SENTRY_API_BASE') ?? undefined,
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
const event = sanitizeEvent(await sentry.getEvent(issueId, eventId));

const [recentEvents, tags, nearbyRows] = await Promise.all([
  optional('최근 이벤트', () => sentry.listRecentEvents(issueId)),
  optional('태그', () => sentry.listTags(issueId)),
  optional('같은 시간대 이벤트', () =>
    sentry.listEventsBetween(nearbyWindow(event.dateCreated)),
  ),
]);

const frontendRef = resolveFrontendRef(event.release?.version ?? event.release);

write('issue.json', issue);
write('event.json', event);
write(
  'recent-events.json',
  Array.isArray(recentEvents) ? recentEvents.map(sanitizeEvent) : recentEvents,
);
write('tags.json', tags);
write(
  'nearby.json',
  Array.isArray(nearbyRows)
    ? pickNearbyIssues(nearbyRows, issue.shortId)
    : nearbyRows,
);
write('meta.json', {
  shortId: issue.shortId,
  permalink: issue.permalink,
  project: issue.project?.slug,
  commits: {
    'landit-fe': frontendRef,
    'landit-be': 'main',
    'landit-ai': 'main',
  },
});

console.log(`이슈 ${issue.shortId} 수집 완료 · landit-fe 기준 ${frontendRef}`);
setOutput('short_id', issue.shortId);
setOutput('frontend_ref', frontendRef);
