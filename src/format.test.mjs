// 분석 결과를 디스코드 메시지로 바꾸는 순수 로직의 테스트
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_MESSAGE_LENGTH,
  MAX_THREAD_NAME_LENGTH,
  formatUsageLine,
  PROMPT_PREAMBLE,
  containsSecret,
  guardCodeBlocks,
  parseAnalysis,
  redactSecrets,
  replaceVerdictEmoji,
  sanitizeLinks,
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

  it('첫 줄이 기호뿐이면 기본 제목을 쓴다', () => {
    const { title } = parseAnalysis('**``**\n본문');

    assert.equal(title, '🔎 Sentry 이슈 분석');
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

describe('sanitizeLinks', () => {
  it('우리 레포와 Sentry 링크는 그대로 둔다', () => {
    const text =
      '[landit-fe client.ts:67](https://github.com/Aragornnnnnn/landit-fe/blob/abc/a.ts#L67) · https://saynow.sentry.io/issues/1/';

    assert.equal(sanitizeLinks(text), text);
  });

  it('가린 링크가 다른 곳을 가리키면 주소를 무디게 만든다', () => {
    assert.equal(
      sanitizeLinks('[landit-fe client.ts:67](https://evil.example/x)'),
      '[landit-fe client.ts:67](https[:]//evil.example/x)',
    );
  });

  it('괄호 안·중첩 대괄호·코드 블록 안의 주소도 무디게 만든다', () => {
    // Given 리뷰에서 찾은 우회 모양들
    const text = [
      '자세히 (https://evil.example/?x=1)',
      '[a [b] c](https://evil.example)',
      '```\ncurl https://evil.example\n```',
      '<https://evil.example>',
    ].join('\n');

    // Then 낯선 주소는 하나도 남지 않는다
    assert.equal(sanitizeLinks(text).includes('https://evil'), false);
  });

  it('경로를 꺾어 허용 목록을 벗어나는 주소도 거른다', () => {
    const text = 'https://github.com/Aragornnnnnn/../attacker/repo';

    assert.equal(
      sanitizeLinks(text),
      'https[:]//github.com/Aragornnnnnn/../attacker/repo',
    );
  });

  it('대문자 스킴도 거른다', () => {
    assert.equal(
      sanitizeLinks('HTTPS://evil.example'),
      'HTTPS[:]//evil.example',
    );
  });
});

describe('guardCodeBlocks', () => {
  it('코드 블록마다 고정 머리말을 넣는다', () => {
    const result = guardCodeBlocks('본문\n```\nlandit-fe에서 같이 보자\n```');

    assert.equal(
      result,
      `본문\n\`\`\`\n${PROMPT_PREAMBLE}\nlandit-fe에서 같이 보자\n\`\`\``,
    );
  });
});

describe('containsSecret', () => {
  const secret = 'sk-ant-oat01-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

  it('모양을 바꿔 섞어도 토큰 조각이 있으면 true', () => {
    // Given 접두어를 빼고 공백·대시를 섞은 토큰
    const leaked = '값: abcd efgh-ijkl mnop qrst uvwx yz01 2345';

    assert.equal(containsSecret(leaked, secret), true);
  });

  it('토큰과 무관한 글이면 false', () => {
    assert.equal(
      containsSecret('세션이 만료됐어요 client.ts:67', secret),
      false,
    );
  });

  it('비교할 토큰이 없으면 false', () => {
    assert.equal(containsSecret('아무 글', undefined), false);
  });
});

describe('redactSecrets', () => {
  it('토큰처럼 생긴 문자열을 가린다', () => {
    // Given 여러 서비스의 토큰 모양이 섞인 글
    const text = [
      'sk-ant-oat01-abcdefghijklmnop',
      'ghs_abcdefghijklmnopqrstuvwxyz0123',
      'sntrys_eyJpYXQiOjE3MjgwMDAwMDAuMH0abcdef',
      'MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.GaBcDe.abcdefghijklmnopqrstuvwxyz0123',
    ].join(' ');

    // Then 전부 가려진다
    assert.equal(redactSecrets(text), '[가림] [가림] [가림] [가림]');
  });

  it('평범한 글과 커밋 해시는 그대로 둔다', () => {
    const text = 'client.ts:67 · fc435ff5e471772023caef1a02a3e26e504532a7';

    assert.equal(redactSecrets(text), text);
  });
});
