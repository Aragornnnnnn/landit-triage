// API 클라이언트 테스트 — 실제 네트워크 대신 가짜 fetch로 요청 모양과 실패 처리를 본다
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createDiscordClient } from './discord.mjs';
import { createGithubClient } from './github.mjs';
import { HttpError, requestJson } from './http.mjs';
import { createSentryClient } from './sentry.mjs';

const realFetch = globalThis.fetch;
let calls;

// 응답을 차례로 돌려주는 가짜 fetch
const stubFetch = (...responses) => {
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    const { status = 200, body = {}, headers = {} } = responses.shift();
    return new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      {
        status,
        headers,
      },
    );
  };
};

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('requestJson', () => {
  it('json을 주면 본문으로 직렬화하고 응답 JSON을 돌려준다', async () => {
    stubFetch({ body: { ok: 1 } });

    const result = await requestJson('시험', 'https://x', {
      method: 'POST',
      json: { a: 1 },
    });

    assert.deepEqual(result, { ok: 1 });
    assert.equal(calls[0].body, '{"a":1}');
    assert.equal(calls[0].headers['Content-Type'], 'application/json');
  });

  it('429면 한 번 기다렸다 다시 보낸다', async () => {
    // Given 처음엔 429, 다음엔 성공
    stubFetch(
      { status: 429, headers: { 'retry-after': '0' } },
      { body: { ok: 1 } },
    );

    // When 요청하면
    const result = await requestJson('시험', 'https://x');

    // Then 두 번 보내고 성공한다
    assert.equal(calls.length, 2);
    assert.deepEqual(result, { ok: 1 });
  });

  it('실패 응답이면 상태와 본문을 담은 HttpError를 던진다', async () => {
    stubFetch({ status: 403, body: 'Missing Permissions' });

    await assert.rejects(requestJson('시험', 'https://x'), (error) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 403);
      assert.match(error.message, /시험 실패 \(403\): Missing Permissions/);
      return true;
    });
  });

  it('빈 응답은 null', async () => {
    stubFetch({ status: 200, body: '' });

    assert.equal(await requestJson('시험', 'https://x'), null);
  });
});

describe('createDiscordClient', () => {
  it('카드 메시지에 스레드를 열고 그 id를 돌려준다', async () => {
    stubFetch({ body: { id: 'thread-1' } });

    const threadId = await createDiscordClient('token').openThread(
      'ch',
      'msg',
      '제목',
    );

    assert.equal(threadId, 'thread-1');
    assert.equal(
      calls[0].url,
      'https://discord.com/api/v10/channels/ch/messages/msg/threads',
    );
    assert.equal(calls[0].headers.Authorization, 'Bot token');
  });

  it('이미 스레드가 있는 메시지면 메시지 id를 스레드 id로 쓴다', async () => {
    // Given 다시 실행해서 스레드가 이미 있다
    stubFetch(
      {
        status: 400,
        body: { code: 160004, message: 'A thread has already been created' },
      },
      { body: {} },
    );

    // When 스레드를 열면
    const threadId = await createDiscordClient('token').openThread(
      'ch',
      'msg',
      '제목',
    );

    // Then 실패하지 않고 기존 스레드(=메시지 id)를 쓰고, 제목을 새로 바꾼다
    assert.equal(threadId, 'msg');
    assert.equal(calls[1].method, 'PATCH');
    assert.equal(calls[1].url, 'https://discord.com/api/v10/channels/msg');
    assert.deepEqual(JSON.parse(calls[1].body), { name: '제목' });
  });

  it('다른 실패는 그대로 던진다', async () => {
    stubFetch({ status: 403, body: { code: 50013 } });

    await assert.rejects(
      createDiscordClient('token').openThread('ch', 'msg', '제목'),
      HttpError,
    );
  });

  it('메시지는 멘션과 링크 미리보기를 막고 보낸다', async () => {
    stubFetch({ body: {} });

    await createDiscordClient('token').sendMessage('thread-1', '본문');

    assert.deepEqual(JSON.parse(calls[0].body), {
      content: '본문',
      flags: 4,
      allowed_mentions: { parse: [] },
    });
  });
});

describe('createGithubClient', () => {
  it('지정한 시각 이후의 이 워크플로우 실행을 조회한다', async () => {
    stubFetch({ body: { workflow_runs: [{ id: 1 }] } });

    const runs = await createGithubClient(
      'gh',
      'o/r',
      'triage.yml',
    ).listRunsSince('2026-10-04T15:00:00Z');

    assert.deepEqual(runs, [{ id: 1 }]);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/repos/o/r/actions/workflows/triage.yml/runs');
    assert.equal(url.searchParams.get('created'), '>=2026-10-04T15:00:00Z');
  });
});

describe('createSentryClient', () => {
  it('이벤트 id가 없으면 최신 이벤트를 조회한다', async () => {
    stubFetch({ body: {} });

    await createSentryClient('st', 'saynow').getEvent('123', null);

    assert.equal(
      calls[0].url,
      'https://sentry.io/api/0/organizations/saynow/issues/123/events/latest/',
    );
    assert.equal(calls[0].headers.Authorization, 'Bearer st');
  });

  it('같은 시간대 이벤트는 모든 프로젝트의 에러를 필요한 필드만 조회한다', async () => {
    stubFetch({ body: { data: [{ issue: 'WEB-PROD-1E' }] } });

    const rows = await createSentryClient('st', 'saynow').listEventsBetween({
      start: 'a',
      end: 'b',
    });

    assert.deepEqual(rows, [{ issue: 'WEB-PROD-1E' }]);
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('dataset'), 'errors');
    assert.equal(url.searchParams.get('project'), '-1');
    assert.deepEqual(url.searchParams.getAll('field'), [
      'issue',
      'title',
      'timestamp',
      'trace',
      'project',
      'release',
    ]);
  });
});
