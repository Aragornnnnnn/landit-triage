// 디스코드에 올릴 글을 만드는 순수 로직 — Claude 결과 해석, 건너뜀·실패 안내 문구

import {
  formatUsageLine,
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
export const buildAnalysisPost = (result, emojiMap) => {
  if (!result || result.is_error || result.subtype !== 'success') return null;
  const parsed = parseAnalysis(redactSecrets(result.result ?? ''));
  if (!parsed || !parsed.body) return null;
  const body = `${replaceVerdictEmoji(sanitizeLinks(parsed.body), emojiMap)}\n\n${formatUsageLine(result)}`;
  return { title: parsed.title, messages: splitMessage(body) };
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
  messages: [
    `분석 중에 문제가 생겨 끝내지 못했어요. 카드 내용으로 먼저 확인해 주세요.\n-# 실행 기록 ${runUrl}`,
  ],
});
