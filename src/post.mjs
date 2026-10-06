// 디스코드에 올릴 글을 만드는 순수 로직 — Claude 결과 해석, 건너뜀·실패 안내 문구

import {
  formatUsageLine,
  guardCodeBlocks,
  parseAnalysis,
  redactSecrets,
  replaceVerdictEmoji,
  sanitizeLinks,
  splitMessage,
} from './format.mjs';
import { SKIP_REASON } from './guard.mjs';

/**
 * Claude Code `--output-format json` 결과를 스레드 제목과 메시지 묶음으로 바꾼다.
 * 분석이 실패했거나 형식이 깨졌으면 null — 호출하는 쪽이 실패 안내로 돌린다.
 */
// 지침이 본문과 프롬프트 사이에 넣는 구분 줄 — 프롬프트는 본문을 읽는 데 방해되지 않게 다음 메시지로 보낸다
export const PROMPT_DIVIDER = '---프롬프트---';

const PROMPT_HEADER =
  '-# 🧑‍💻 Claude Code에서 이어 보려면 아래 블록을 붙여넣어 주세요';

const VERDICT_EMOJIS = ['🚨', '👀', '🔕', '✅'];

// 스레드 제목 첫 글자가 판정 이모지다 — 카드에 반응으로 달아 채널만 훑어도 판정이 보이게 한다
export const verdictEmojiOf = (title) =>
  VERDICT_EMOJIS.find((emoji) => title.startsWith(emoji)) ?? null;

// 구분 줄이 있으면 거기서, 없으면 첫 코드 블록부터를 프롬프트로 본다
export const splitPrompt = (body) => {
  const lines = body.split('\n');
  let at = lines.findIndex((line) => line.trim() === PROMPT_DIVIDER);
  const skip = at === -1 ? 0 : 1;
  if (at === -1)
    at = lines.findIndex((line) => line.trimStart().startsWith('```'));
  if (at === -1) return { main: body, prompt: null };
  return {
    main: lines.slice(0, at).join('\n').trim(),
    prompt:
      lines
        .slice(at + skip)
        .join('\n')
        .trim() || null,
  };
};

/**
 * Claude Code `--output-format json` 결과를 스레드 제목·메시지·카드 반응으로 바꾼다.
 * 분석이 실패했거나 형식이 깨졌으면 null — 호출하는 쪽이 실패 안내로 돌린다.
 */
export const buildAnalysisPost = (result, emojiMap) => {
  if (!result || result.is_error || result.subtype !== 'success') return null;
  // 거르는 순서: 토큰 가림 → 링크 무디게 → (본문·프롬프트 나누기) → 프롬프트 머리말 → 이모지 → 2,000자 분할
  const parsed = parseAnalysis(
    sanitizeLinks(redactSecrets(result.result ?? '')),
  );
  if (!parsed || !parsed.body) return null;
  const { main, prompt } = splitPrompt(parsed.body);
  if (!main) return null;
  const mainText = `${replaceVerdictEmoji(main, emojiMap)}

${formatUsageLine(result)}`;
  return {
    title: parsed.title,
    reaction: verdictEmojiOf(parsed.title),
    messages: [
      ...splitMessage(mainText),
      ...(prompt
        ? splitMessage(`${PROMPT_HEADER}\n${guardCodeBlocks(prompt)}`)
        : []),
    ],
  };
};

const SKIP_MESSAGES = {
  [SKIP_REASON.dailyLimit]: (limit) =>
    `오늘 분석 한도(${limit}건)를 넘어서 이 이슈는 건너뛰었어요. 필요하면 실행 기록에서 손으로 다시 돌릴 수 있어요.`,
};

// 중복은 이미 스레드가 있는 이슈라 아무것도 올리지 않는다
export const buildSkipPost = (reason, dailyLimit) => {
  const message = SKIP_MESSAGES[reason];
  if (!message) return null;
  return { title: '⏭️ 분석 건너뜀', messages: [message(dailyLimit)] };
};

export const buildFailurePost = (runUrl) => ({
  title: '⚠️ 분석을 끝내지 못했어요',
  reaction: '⚠️',
  messages: [
    `분석 중에 문제가 생겨 끝내지 못했어요. 카드 내용으로 먼저 확인해 주세요.\n-# 실행 기록 ${runUrl}`,
  ],
});
