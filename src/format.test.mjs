// 분석 결과를 디스코드 메시지로 바꾸는 순수 로직의 테스트
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_MESSAGE_LENGTH,
  MAX_THREAD_NAME_LENGTH,
  formatUsageLine,
  parseAnalysis,
  replaceVerdictEmoji,
  splitMessage,
} from './format.mjs';

describe('parseAnalysis', () => {
  it('첫 줄을 스레드 제목으로, 나머지를 본문으로 나눈다', () => {
    // Given 첫 줄이 제목인 분석 결과
    const text = '🚨 고쳐야 해요 · 대화가 멈춰요\n\n**🚨 고쳐야 해요** 본문';

    // When 해석하면
    const { title, body } = parseAnalysis(text);

    // Then 제목과 본문이 나뉜다
    assert.equal(title, '🚨 고쳐야 해요 · 대화가 멈춰요');
    assert.equal(body, '**🚨 고쳐야 해요** 본문');
  });

  it('제목의 마크다운 기호를 걷어 낸다', () => {
    const { title } = parseAnalysis(
      '**🔕 괜한 알림이에요 · `STT` 끊김**\n본문',
    );

    assert.equal(title, '🔕 괜한 알림이에요 · STT 끊김');
  });

  it('제목이 스레드 이름 상한을 넘으면 말줄임표로 자른다', () => {
    const { title } = parseAnalysis(`${'가'.repeat(150)}\n본문`);

    assert.equal(title.length, MAX_THREAD_NAME_LENGTH);
    assert.ok(title.endsWith('…'));
  });

  it('앞쪽 빈 줄은 건너뛰고 첫 글줄을 제목으로 쓴다', () => {
    const { title } = parseAnalysis('\n\n✅ 문제없어요 · 세션 만료\n본문');

    assert.equal(title, '✅ 문제없어요 · 세션 만료');
  });

  it('내용이 비어 있으면 null을 돌려준다', () => {
    assert.equal(parseAnalysis('  \n '), null);
  });
});

describe('splitMessage', () => {
  it('상한 안이면 한 덩어리로 둔다', () => {
    assert.deepEqual(splitMessage('짧은 글'), ['짧은 글']);
  });

  it('문단 경계에서 나누고 각 덩어리는 상한을 넘지 않는다', () => {
    // Given 상한을 넘는 여러 문단
    const paragraph = '가'.repeat(900);
    const text = [paragraph, paragraph, paragraph].join('\n\n');

    // When 나누면
    const chunks = splitMessage(text);

    // Then 문단이 쪼개지지 않고 상한을 지킨다
    assert.equal(chunks.length, 2);
    assert.ok(chunks.every((chunk) => chunk.length <= MAX_MESSAGE_LENGTH));
    assert.equal(chunks.join('\n\n'), text);
  });

  it('코드 블록 안의 빈 줄에서는 나누지 않는다', () => {
    // Given 빈 줄이 든 코드 블록이 뒤에 붙은 글
    const code = ['```', 'a'.repeat(700), '', 'b'.repeat(700), '```'].join(
      '\n',
    );
    const text = ['가'.repeat(900), code].join('\n\n');

    // When 나누면
    const chunks = splitMessage(text);

    // Then 코드 블록은 한 덩어리에 통째로 들어간다
    assert.equal(chunks.length, 2);
    assert.equal(chunks[1], code);
  });

  it('한 문단이 상한보다 길면 상한 단위로 강제로 자른다', () => {
    const chunks = splitMessage('가'.repeat(MAX_MESSAGE_LENGTH * 2 + 10));

    assert.equal(chunks.length, 3);
    assert.ok(chunks.every((chunk) => chunk.length <= MAX_MESSAGE_LENGTH));
  });
});

describe('replaceVerdictEmoji', () => {
  it('판정 이모지를 등록된 앱 이모지로 바꾼다', () => {
    const map = { '🚨': '<:tosssiren:1>' };

    assert.equal(
      replaceVerdictEmoji('**🚨 고쳐야 해요** 본문 🚨', map),
      '**<:tosssiren:1> 고쳐야 해요** 본문 <:tosssiren:1>',
    );
  });

  it('등록되지 않은 이모지와 빈 맵은 그대로 둔다', () => {
    assert.equal(replaceVerdictEmoji('👀 지켜봐요', {}), '👀 지켜봐요');
    assert.equal(replaceVerdictEmoji('👀 지켜봐요', null), '👀 지켜봐요');
  });
});

describe('formatUsageLine', () => {
  it('걸린 시간과 토큰 수를 한 줄로 만든다', () => {
    // Given 2분 31초, 입력·캐시·출력 합계 152,300 토큰
    const result = {
      duration_ms: 151_000,
      usage: {
        input_tokens: 300,
        cache_creation_input_tokens: 2_000,
        cache_read_input_tokens: 148_000,
        output_tokens: 2_000,
      },
    };

    // When 줄을 만들면
    // Then 사람이 읽는 단위로 보인다
    assert.equal(formatUsageLine(result), '-# 분석 2분 31초 · 토큰 15.2만');
  });

  it('1분이 안 되면 초만 쓴다', () => {
    const result = { duration_ms: 42_000, usage: { output_tokens: 9_000 } };

    assert.equal(formatUsageLine(result), '-# 분석 42초 · 토큰 0.9만');
  });

  it('API 환산 금액이 있으면 함께 붙인다', () => {
    const result = {
      duration_ms: 68_110,
      total_cost_usd: 0.8480352,
      usage: { cache_read_input_tokens: 714_876, output_tokens: 6_379 },
    };

    assert.equal(
      formatUsageLine(result),
      '-# 분석 1분 8초 · 토큰 72.1만 (API 환산 $0.85)',
    );
  });
});
