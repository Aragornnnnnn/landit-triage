// 디스코드에 올릴 글을 만드는 로직의 테스트
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAnalysisPost,
  buildFailurePost,
  buildSkipPost,
  splitPrompt,
  verdictEmojiOf,
} from './post.mjs';

const success = (text) => ({
  subtype: 'success',
  is_error: false,
  result: text,
  duration_ms: 60_000,
  usage: { output_tokens: 100_000 },
});

describe('buildAnalysisPost', () => {
  it('성공한 분석을 제목과 메시지로 바꾸고 끝에 사용량 줄을 붙인다', () => {
    // Given 정상 분석 결과
    const result = success('👀 지켜봐요 · 웹뷰 종료\n\n**👀 지켜봐요** 본문');

    // When 글을 만들면
    const post = buildAnalysisPost(result, { '👀': '<:tosseyes:1>' });

    // Then 제목은 유니코드, 본문은 앱 이모지, 끝에 사용량
    assert.equal(post.title, '👀 지켜봐요 · 웹뷰 종료');
    assert.deepEqual(post.messages, [
      '**<:tosseyes:1> 지켜봐요** 본문\n\n-# 분석 1분 0초 · 토큰 10.0만',
    ]);
  });

  it('에러로 끝난 결과는 null', () => {
    // Given 로그인 실패처럼 is_error인 결과 (subtype은 success로 온다)
    const result = { ...success('Not logged in'), is_error: true };

    assert.equal(buildAnalysisPost(result, {}), null);
  });

  it('도구 사용 상한에 걸려 멈춘 결과는 null', () => {
    const result = { ...success(''), subtype: 'error_max_turns' };

    assert.equal(buildAnalysisPost(result, {}), null);
  });

  it('제목만 있고 본문이 없으면 null', () => {
    assert.equal(
      buildAnalysisPost(success('🚨 고쳐야 해요 · 제목만'), {}),
      null,
    );
  });
});

describe('프롬프트 분리', () => {
  const analysis = [
    '🔕 괜한 알림이에요 · 세션 만료 보고',
    '',
    '**🔕 괜한 알림이에요**',
    'FE에서 이 오류만 보고에서 빼면 돼요.',
    '',
    '---프롬프트---',
    '```',
    'landit-fe에서 같이 보자',
    '```',
  ].join('\n');

  it('본문과 프롬프트를 다른 메시지로 나누고, 판정 이모지를 카드 반응으로 고른다', () => {
    // When 분석 결과로 글을 만들면
    const post = buildAnalysisPost(success(analysis), {});

    // Then 첫 메시지는 본문, 두 번째는 프롬프트, 반응은 🔕
    assert.equal(post.reaction, '🔕');
    assert.equal(post.messages.length, 2);
    assert.ok(post.messages[0].startsWith('**🔕 괜한 알림이에요**'));
    assert.equal(post.messages[0].includes('```'), false);
    assert.match(post.messages[1], /Claude Code에서 이어 보려면/);
    assert.match(post.messages[1], /landit-fe에서 같이 보자/);
  });

  it('리플레이 링크가 있으면 본문 끝에 화면 녹화 링크를 붙인다', () => {
    const url = 'https://saynow.sentry.io/explore/replays/abc/';

    const post = buildAnalysisPost(success(analysis), {}, { replayUrl: url });

    assert.match(
      post.messages[0],
      /🎥 \[화면 녹화 보기\]\(https:\/\/saynow\.sentry\.io\/explore\/replays\/abc\/\)/,
    );
  });

  it('구분 줄이 없으면 첫 코드 블록부터 프롬프트로 본다', () => {
    const { main, prompt } = splitPrompt('본문\n\n```\nX\n```');

    assert.equal(main, '본문');
    assert.equal(prompt, '```\nX\n```');
  });

  it('프롬프트가 없으면 본문만', () => {
    assert.deepEqual(splitPrompt('본문만'), { main: '본문만', prompt: null });
  });
});

describe('verdictEmojiOf', () => {
  it('제목 첫 글자의 판정 이모지를 고른다', () => {
    assert.equal(verdictEmojiOf('🚨 고쳐야 해요 · x'), '🚨');
    assert.equal(verdictEmojiOf('✅ 문제없어요 · x'), '✅');
  });

  it('판정 이모지가 아니면 null', () => {
    assert.equal(verdictEmojiOf('🔎 Sentry 이슈 분석'), null);
  });
});

describe('buildSkipPost', () => {
  it('하루 상한이면 한도 안내를 만든다', () => {
    const post = buildSkipPost('daily-limit', 10);

    assert.equal(post.title, '⏭️ 분석 건너뜀');
    assert.match(post.messages[0], /오늘 분석 한도\(10건\)/);
  });

  it('중복이면 아무것도 올리지 않는다', () => {
    assert.equal(buildSkipPost('duplicate', 10), null);
  });
});

describe('buildFailurePost', () => {
  it('카드에 ⚠️ 반응을 단다', () => {
    assert.equal(buildFailurePost('u').reaction, '⚠️');
  });

  it('실행 기록 링크를 담는다', () => {
    const post = buildFailurePost('https://github.com/o/r/actions/runs/1');

    assert.match(post.messages[0], /actions\/runs\/1/);
  });
});
