// 분석 결과를 디스코드 메시지로 바꾸는 순수 로직 — 제목 분리, 길이 분할, 이모지 치환, 사용량 줄

// 디스코드 상한 — 넘으면 요청 전체가 거절된다
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_THREAD_NAME_LENGTH = 100;

const stripMarkdown = (line) =>
  line
    .replace(/^#+\s*/, '')
    .replace(/\*\*|__|`/g, '')
    .trim();

const truncate = (text, max) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

// 첫 글줄은 스레드 제목, 나머지는 본문이다 — 지침이 이 형식을 강제한다
export const parseAnalysis = (text) => {
  const lines = text.split('\n');
  const titleIndex = lines.findIndex((line) => line.trim() !== '');
  if (titleIndex === -1) return null;
  return {
    title: truncate(stripMarkdown(lines[titleIndex]), MAX_THREAD_NAME_LENGTH),
    body: lines
      .slice(titleIndex + 1)
      .join('\n')
      .trim(),
  };
};

// 빈 줄로 문단을 나누되, 코드 블록 안의 빈 줄은 문단 경계로 보지 않는다
const toBlocks = (text) => {
  const blocks = [];
  let current = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    if (line.trim() === '' && !inFence) {
      if (current.length) blocks.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks;
};

const hardSplit = (block, max) => {
  const pieces = [];
  for (let i = 0; i < block.length; i += max)
    pieces.push(block.slice(i, i + max));
  return pieces;
};

// 상한 안에서 문단을 최대한 이어 붙인다. 한 문단이 상한보다 길 때만 강제로 자른다
export const splitMessage = (text, max = MAX_MESSAGE_LENGTH) => {
  const chunks = [];
  let current = '';
  for (const block of toBlocks(text)) {
    const joined = current ? `${current}\n\n${block}` : block;
    if (joined.length <= max) {
      current = joined;
      continue;
    }
    if (current) chunks.push(current);
    if (block.length <= max) {
      current = block;
    } else {
      chunks.push(...hardSplit(block, max));
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

// 본문의 판정 이모지를 토스페이스 앱 이모지(<:name:id>)로 바꾼다 — 스레드 제목은 앱 이모지를 못 써서 그대로 둔다
export const replaceVerdictEmoji = (text, emojiMap) =>
  Object.entries(emojiMap ?? {}).reduce(
    (result, [unicode, custom]) => result.replaceAll(unicode, custom),
    text,
  );

const formatDuration = (ms) => {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}분 ${seconds % 60}초` : `${seconds}초`;
};

// 캐시 읽기까지 더한 전체 토큰 — 구독 사용량을 어림하는 기준이다
export const totalTokens = (usage = {}) =>
  (usage.input_tokens ?? 0) +
  (usage.cache_creation_input_tokens ?? 0) +
  (usage.cache_read_input_tokens ?? 0) +
  (usage.output_tokens ?? 0);

// 캐시 읽기가 대부분이라 토큰 수만으로는 무게를 가늠하기 어렵다 — API 정가 환산 금액을 같이 붙인다(구독이라 실제 청구는 없다)
export const formatUsageLine = (result) => {
  const tokens = `토큰 ${(totalTokens(result.usage) / 10_000).toFixed(1)}만`;
  const cost =
    typeof result.total_cost_usd === 'number'
      ? ` (API 환산 $${result.total_cost_usd.toFixed(2)})`
      : '';
  return `-# 분석 ${formatDuration(result.duration_ms ?? 0)} · ${tokens}${cost}`;
};
