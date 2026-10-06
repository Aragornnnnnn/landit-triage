// Sentry 데이터를 분석 입력으로 다듬는 순수 로직의 테스트
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chooseFrontendRef,
  nearbyWindow,
  pickDeployedRelease,
  pickNearbyIssues,
  replayIdOf,
  replayUrlOf,
  resolveFrontendRef,
  sanitizeTagSummary,
  slimEvent,
  slimEventSummary,
  slimIssue,
  stripQuery,
} from './context.mjs';

describe('resolveFrontendRef', () => {
  it('웹 릴리즈(커밋 해시)면 그 커밋을 쓴다', () => {
    const sha = 'fc435ff5e471772023caef1a02a3e26e504532a7';

    assert.equal(resolveFrontendRef(sha), sha);
  });

  it('커밋 해시가 아닌 릴리즈(모바일 버전 등)나 빈 값이면 main을 쓴다', () => {
    assert.equal(resolveFrontendRef('im.landit.app@1.3.2+11'), 'main');
    assert.equal(resolveFrontendRef(null), 'main');
  });
});

// Sentry "Retrieve an Issue Event" 응답 모양 — 요청·breadcrumbs·예외가 entries 안에 있다
const sentryEvent = (overrides = {}) => ({
  eventID: 'c60fd1d7caed41109ac226968f4ec748',
  dateCreated: '2026-10-05T11:59:42.795Z',
  title: 'Error: 세션이 만료됐어요.',
  release: { version: 'fc435ff5e471772023caef1a02a3e26e504532a7' },
  user: { id: '42', email: 'a@b.c', ip_address: '1.2.3.4', username: 'kim' },
  tags: [
    { key: 'os', value: 'iOS 18.7' },
    { key: 'user', value: 'email:a@b.c' },
  ],
  contexts: { os: { name: 'iOS' }, culture: { locale: 'ko-KR' } },
  _meta: { big: true },
  sdk: { name: 'sentry.javascript.nextjs' },
  entries: [
    {
      type: 'request',
      data: {
        url: 'https://www.landit.im/scenario?code=secret',
        method: 'GET',
        headers: [['Authorization', 'Bearer x']],
        cookies: [['sid', '1']],
        query: [['code', 'secret']],
        data: { password: 'p' },
      },
    },
    {
      type: 'breadcrumbs',
      data: {
        values: [
          {
            category: 'fetch',
            data: {
              url: '/api/v1/me?token=abc',
              method: 'GET',
              status_code: 401,
              body: 'x',
            },
          },
        ],
      },
    },
    { type: 'debugmeta', data: { images: Array(100).fill({}) } },
    ...(overrides.entries ?? []),
  ],
  ...overrides,
});

describe('slimEvent', () => {
  it('사용자 정보는 id만 남긴다', () => {
    assert.deepEqual(slimEvent(sentryEvent()).user, { id: '42' });
  });

  it('요청 entry는 쿼리를 뗀 경로와 메서드만 남긴다', () => {
    // Given 인증 헤더·쿠키·쿼리·본문이 든 요청 entry
    // When 다듬으면
    const request = slimEvent(sentryEvent()).entries.find(
      (entry) => entry.type === 'request',
    );

    // Then 경로와 메서드만 남는다
    assert.deepEqual(request, {
      type: 'request',
      url: 'https://www.landit.im/scenario',
      method: 'GET',
    });
  });

  it('breadcrumb URL의 쿼리와 본문을 뗀다', () => {
    const crumbs = slimEvent(sentryEvent()).entries.find(
      (entry) => entry.type === 'breadcrumbs',
    );

    assert.equal(crumbs.values[0].data.url, '/api/v1/me');
    assert.equal(crumbs.values[0].data.status_code, 401);
    assert.equal('body' in crumbs.values[0].data, false);
  });

  it('사용자 태그와 고르지 않은 칸(_meta, sdk, debugmeta, culture)은 빠진다', () => {
    const result = slimEvent(sentryEvent());

    assert.deepEqual(result.tags, [{ key: 'os', value: 'iOS 18.7' }]);
    assert.deepEqual(Object.keys(result.contexts), ['os']);
    assert.equal('_meta' in result, false);
    assert.equal(
      result.entries.some((entry) => entry.type === 'debugmeta'),
      false,
    );
  });

  it('스택은 우리 코드 프레임과 맨 위 세 개만 남긴다', () => {
    // Given 라이브러리 프레임 10개 사이에 우리 코드 프레임 하나
    const frames = Array.from({ length: 10 }, (_, i) => ({
      filename: `lib${i}.js`,
      inApp: i === 2,
    }));
    const event = sentryEvent({
      entries: [
        {
          type: 'exception',
          data: { values: [{ type: 'Error', stacktrace: { frames } }] },
        },
      ],
    });

    // When 다듬으면
    const exception = slimEvent(event).entries.find(
      (entry) => entry.type === 'exception',
    );

    // Then 2번(우리 코드)과 마지막 세 개만 남는다
    assert.deepEqual(
      exception.values[0].frames.map((frame) => frame.filename),
      ['lib2.js', 'lib7.js', 'lib8.js', 'lib9.js'],
    );
  });

  it('릴리즈는 버전 문자열로 편다', () => {
    assert.equal(
      slimEvent(sentryEvent()).release,
      'fc435ff5e471772023caef1a02a3e26e504532a7',
    );
  });
});

describe('slimEventSummary', () => {
  it('목록 요약은 시각·메시지·사용자 아닌 태그만 남긴다', () => {
    const summary = slimEventSummary(sentryEvent());

    assert.deepEqual(Object.keys(summary), [
      'eventID',
      'dateCreated',
      'title',
      'message',
      'tags',
    ]);
    assert.deepEqual(summary.tags, [{ key: 'os', value: 'iOS 18.7' }]);
  });
});

describe('slimIssue', () => {
  it('담당자·열람자처럼 이메일이 든 칸은 넘기지 않는다', () => {
    const issue = slimIssue({
      shortId: 'WEB-PROD-1E',
      count: '1',
      assignedTo: { email: 'dev@landit.im' },
      seenBy: [{ email: 'dev@landit.im' }],
      project: { slug: 'web-prod' },
    });

    assert.equal(issue.shortId, 'WEB-PROD-1E');
    assert.equal(issue.project, 'web-prod');
    assert.equal(JSON.stringify(issue).includes('@'), false);
  });
});

describe('stripQuery', () => {
  it('쿼리와 해시를 뗀다', () => {
    assert.equal(stripQuery('/a?b=1#c'), '/a');
    assert.equal(stripQuery(undefined), undefined);
  });
});

describe('chooseFrontendRef', () => {
  const sha = 'fc435ff5e471772023caef1a02a3e26e504532a7';

  it('main 히스토리에 있는 커밋이면 그 커밋', () => {
    assert.equal(chooseFrontendRef(sha, true), sha);
  });

  it('main 밖이거나 확인에 실패하면 main', () => {
    assert.equal(chooseFrontendRef(sha, false), 'main');
    assert.equal(chooseFrontendRef(sha, { error: 'x' }), 'main');
  });
});

describe('nearbyWindow', () => {
  it('이벤트 시각 앞뒤 2분을 돌려준다', () => {
    assert.deepEqual(nearbyWindow('2026-10-05T11:59:42.795Z'), {
      start: '2026-10-05T11:57:42.795Z',
      end: '2026-10-05T12:01:42.795Z',
    });
  });
});

describe('pickNearbyIssues', () => {
  it('지금 이슈를 빼고 이슈별로 한 줄씩 묶는다', () => {
    // Given 같은 시간대의 이벤트들
    const rows = [
      {
        issue: 'WEB-PROD-1D',
        title: 'Load failed',
        timestamp: 't1',
        trace: 'a',
      },
      { issue: 'WEB-PROD-1E', title: '세션 만료', timestamp: 't2', trace: 'b' },
      { issue: 'WEB-PROD-1E', title: '세션 만료', timestamp: 't3', trace: 'c' },
    ];

    // When 지금 이슈 WEB-PROD-1D 기준으로 고르면
    const result = pickNearbyIssues(rows, 'WEB-PROD-1D');

    // Then 다른 이슈만 건수와 함께 남는다
    assert.deepEqual(result, [
      {
        issue: 'WEB-PROD-1E',
        title: '세션 만료',
        count: 2,
        traces: ['b', 'c'],
      },
    ]);
  });
});

describe('pickDeployedRelease', () => {
  const release = (tag, publishedAt, extra = {}) => ({
    tag_name: tag,
    published_at: publishedAt,
    draft: false,
    prerelease: false,
    ...extra,
  });

  it('이벤트 시각에 돌고 있던 가장 최근 배포 태그를 고른다', () => {
    // Given 10/5 배포 전에 난 이벤트
    const releases = [
      release('be-v1.6.0', '2026-10-05T04:54:57Z'),
      release('be-v1.5.2', '2026-09-25T07:53:35Z'),
    ];

    // When 10/1 이벤트 기준으로 고르면
    const tag = pickDeployedRelease(releases, 'be-v', '2026-10-01T00:00:00Z');

    // Then 그때 배포돼 있던 1.5.2다
    assert.equal(tag, 'be-v1.5.2');
  });

  it('초안·사전 릴리즈와 접두어가 다른 태그는 건너뛴다', () => {
    const releases = [
      release('be-v1.7.0', '2026-10-02T00:00:00Z', { draft: true }),
      release('be-v1.6.9', '2026-10-02T00:00:00Z', { prerelease: true }),
      release('ai-v1.6.0', '2026-10-02T00:00:00Z'),
      release('be-v1.5.2', '2026-09-25T00:00:00Z'),
    ];

    assert.equal(
      pickDeployedRelease(releases, 'be-v', '2026-10-05T00:00:00Z'),
      'be-v1.5.2',
    );
  });

  it('고를 배포가 없으면 main을 쓴다', () => {
    assert.equal(
      pickDeployedRelease([], 'be-v', '2026-10-05T00:00:00Z'),
      'main',
    );
  });
});

describe('sanitizeTagSummary', () => {
  it('이슈 태그 분포에서 사용자 태그를 뺀다', () => {
    const tags = [{ key: 'user' }, { key: 'release' }];

    assert.deepEqual(sanitizeTagSummary(tags), [{ key: 'release' }]);
  });

  it('수집 실패 기록은 그대로 둔다', () => {
    assert.deepEqual(sanitizeTagSummary({ error: 'x' }), { error: 'x' });
  });
});

describe('replayIdOf · replayUrlOf', () => {
  const id = 'a0c781558593470a99b68cba300772ad';

  it('contexts.replay나 replayId 태그에서 리플레이 id를 찾아 링크로 만든다', () => {
    assert.equal(replayIdOf({ contexts: { replay: { replay_id: id } } }), id);
    assert.equal(replayIdOf({ tags: [{ key: 'replayId', value: id }] }), id);
    assert.equal(
      replayUrlOf('saynow', id),
      `https://saynow.sentry.io/explore/replays/${id}/`,
    );
  });

  it('형식이 이상하거나 없으면 null — 링크를 만들지 않는다', () => {
    assert.equal(
      replayIdOf({ tags: [{ key: 'replayId', value: '../x' }] }),
      null,
    );
    assert.equal(replayIdOf({}), null);
    assert.equal(replayUrlOf('saynow', null), null);
  });
});
