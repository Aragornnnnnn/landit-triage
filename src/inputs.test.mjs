// 실행 입력값 검증 테스트
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { invalidInputs } from './inputs.mjs';

const valid = {
  issueId: '7773966015',
  eventId: 'c60fd1d7caed41109ac226968f4ec748',
  channelId: '1416012345678901234',
  messageId: '1416012345678909999',
};

describe('invalidInputs', () => {
  it('형식이 맞으면 빈 목록', () => {
    assert.deepEqual(invalidInputs(valid), []);
  });

  it('이슈 id만 있어도 통과한다 — 시험 실행', () => {
    assert.deepEqual(invalidInputs({ issueId: '7773966015' }), []);
  });

  it('이슈 id가 없으면 실패한다', () => {
    assert.deepEqual(invalidInputs({ ...valid, issueId: '' }), ['issueId']);
  });

  it('경로를 바꾸는 값은 거른다', () => {
    // Given 다른 Sentry 엔드포인트를 부르려는 이슈 id
    const inputs = { ...valid, issueId: '../../projects/saynow' };

    // Then 이슈 id가 걸린다
    assert.deepEqual(invalidInputs(inputs), ['issueId']);
  });

  it('디스코드 id와 이벤트 id 형식도 본다', () => {
    const inputs = { ...valid, channelId: 'abc', eventId: 'xyz' };

    assert.deepEqual(invalidInputs(inputs), ['eventId', 'channelId']);
  });
});
