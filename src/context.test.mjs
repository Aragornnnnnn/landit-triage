// Sentry 데이터를 분석 입력으로 다듬는 순수 로직의 테스트
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  nearbyWindow,
  pickNearbyIssues,
  resolveFrontendRef,
  sanitizeEvent,
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

describe('sanitizeEvent', () => {
  it('사용자 정보는 id만 남기고 이메일·IP·이름을 지운다', () => {
    // Given 개인정보가 든 이벤트
    const event = {
      eventID: 'e1',
      user: {
        id: '42',
        email: 'a@b.c',
        ip_address: '1.2.3.4',
        username: 'kim',
      },
    };

    // When 다듬으면
    const result = sanitizeEvent(event);

    // Then id만 남는다
    assert.deepEqual(result.user, { id: '42' });
  });

  it('분석에 쓸모없는 큰 필드는 뺀다', () => {
    const result = sanitizeEvent({
      eventID: 'e1',
      _meta: { big: 1 },
      sdk: { name: 'x' },
    });

    assert.equal('_meta' in result, false);
    assert.equal('sdk' in result, false);
    assert.equal(result.eventID, 'e1');
  });

  it('사용자가 없는 이벤트도 그대로 다룬다', () => {
    assert.equal(sanitizeEvent({ eventID: 'e1' }).user, undefined);
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
