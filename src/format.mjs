// 분석 결과를 디스코드 메시지로 바꾸는 순수 로직 — 제목 분리, 길이 분할, 이모지 치환, 사용량 줄

// 디스코드 상한 — 넘으면 요청 전체가 거절된다
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_THREAD_NAME_LENGTH = 100;

const stripMarkdown = (line) =>
  line
    .replace(/^#+\s*/, '')
    .replace(/\*\*|__|`/g, '')
    .trim();

// 첫 줄이 기호뿐이라 제목이 비면 디스코드가 스레드 생성을 거절한다
const FALLBACK_TITLE = '🔎 Sentry 이슈 분석';

const truncate = (text, max) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

// 첫 글줄은 스레드 제목, 나머지는 본문이다 — 지침이 이 형식을 강제한다
export const parseAnalysis = (text) => {
  const lines = text.split('\n');
  const titleIndex = lines.findIndex((line) => line.trim() !== '');
  if (titleIndex === -1) return null;
  const title = stripMarkdown(lines[titleIndex]) || FALLBACK_TITLE;
  return {
    title: truncate(title, MAX_THREAD_NAME_LENGTH),
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

// 분석 글이 링크할 수 있는 곳 — 우리 레포 코드와 Sentry 이슈뿐이다
const ALLOWED_LINK_PREFIXES = [
  'https://github.com/Aragornnnnnn/',
  'https://saynow.sentry.io/',
  'https://sentry.io/organizations/saynow/',
];

const isAllowedLink = (url) =>
  ALLOWED_LINK_PREFIXES.some((prefix) => url.startsWith(prefix));

// 클릭되지 않게 주소를 무디게 만든다 — Sentry 데이터에 섞인 지시로 Claude가 낯선 링크를 써도 누를 수 없다
const defang = (url) => url.replace('://', '[:]//');

/**
 * 허용하지 않은 링크를 누를 수 없게 바꾼다.
 * 가린 링크 [글](주소)는 글 뒤에 무딘 주소를 붙이고, 맨 주소는 무디게만 한다. 코드 블록 안은 건드리지 않는다.
 */
export const sanitizeLinks = (text) =>
  text
    .split(/(```[\s\S]*?```)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\[([^\]]*)\]\((\S+?)\)/g, (match, label, url) =>
              isAllowedLink(url) ? match : `${label} (${defang(url)})`,
            )
            .replace(/(?<![(\[])\bhttps?:\/\/[^\s)>]+/g, (url) =>
              isAllowedLink(url) ? url : defang(url),
            ),
    )
    .join('');

// 비밀값처럼 생긴 문자열 — 분석 글에 섞여 나오면 게시 전에 가린다(Claude가 읽을 수 있는 곳에 토큰이 남는 경우를 대비한 마지막 그물)
const SECRET_PATTERNS = [
  /sk-ant-[\w-]{10,}/g,
  /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsntry[su]_[A-Za-z0-9_=-]{20,}/g,
  /\b[MNO][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/g,
];

export const redactSecrets = (text) =>
  SECRET_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, '[가림]'),
    text,
  );
