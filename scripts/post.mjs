// 결과를 Sentry 카드의 스레드로 올린다 — 사용법: node scripts/post.mjs <analysis|skipped|failed>
// 카드 정보(CHANNEL_ID·MESSAGE_ID)가 없으면 디스코드 대신 실행 요약에만 남긴다(손으로 돌린 시험 실행)
import { readFileSync } from 'node:fs';
import { createDiscordClient } from '../src/discord.mjs';
import { appendSummary, optionalEnv, requireEnv } from '../src/env.mjs';
import { isAllowedChannel } from '../src/guard.mjs';
import { invalidInputs } from '../src/inputs.mjs';
import {
  buildAnalysisPost,
  buildFailurePost,
  buildSkipPost,
} from '../src/post.mjs';

const CLAUDE_RESULT_FILE = 'out/claude.json';
const META_FILE = 'context/meta.json';

// 수집 단계가 남긴 리플레이 링크 — 없으면 빼고 올린다
const readReplayUrl = () => {
  try {
    return JSON.parse(readFileSync(META_FILE, 'utf8')).replayUrl ?? null;
  } catch {
    return null;
  }
};

const readClaudeResult = () => {
  try {
    return JSON.parse(readFileSync(CLAUDE_RESULT_FILE, 'utf8'));
  } catch {
    return null;
  }
};

// 이모지 매핑이 깨져도 분석 글은 기본 이모지로 올린다
const readEmojiMap = () => {
  try {
    return JSON.parse(optionalEnv('TRIAGE_EMOJI') ?? '{}');
  } catch {
    console.warn('TRIAGE_EMOJI가 JSON이 아니라 기본 이모지를 써요');
    return {};
  }
};

const runUrl = requireEnv('RUN_URL');

const buildPost = (mode) => {
  if (mode === 'analysis') {
    return (
      buildAnalysisPost(readClaudeResult(), readEmojiMap(), {
        replayUrl: readReplayUrl(),
      }) ?? buildFailurePost(runUrl)
    );
  }
  if (mode === 'skipped')
    return buildSkipPost(
      requireEnv('SKIP_REASON'),
      Number(requireEnv('DAILY_LIMIT')),
    );
  if (mode === 'failed') return buildFailurePost(runUrl);
  throw new Error(`모르는 모드: ${mode}`);
};

const post = buildPost(process.argv[2]);
if (!post) {
  console.log('올릴 글이 없어요');
  process.exit(0);
}

appendSummary([`## ${post.title}`, ...post.messages].join('\n\n'));

const channelId = optionalEnv('CHANNEL_ID');
const messageId = optionalEnv('MESSAGE_ID');
if (!channelId || !messageId) {
  console.log('카드 정보가 없어 디스코드에는 올리지 않았어요(시험 실행)');
  process.exit(0);
}
// 가드가 실패한 뒤 실패 안내로 오는 경우도 있어서 여기서도 한 번 더 본다
if (
  invalidInputs({ issueId: '0', channelId, messageId }).length ||
  !isAllowedChannel(channelId, optionalEnv('TRIAGE_CHANNELS'))
) {
  console.warn(
    '카드 위치가 형식이나 허용 채널에 맞지 않아 디스코드에 올리지 않았어요',
  );
  process.exit(0);
}

const discord = createDiscordClient(requireEnv('DISCORD_BOT_TOKEN'));
const threadId = await discord.openThread(channelId, messageId, post.title);
try {
  for (const message of post.messages)
    await discord.sendMessage(threadId, message);
} catch (error) {
  // 글을 올리다 끊기면 반쪽 스레드가 남는다 — 끊겼다는 걸 그 스레드에 알리고 실패로 끝낸다
  await discord
    .sendMessage(threadId, buildFailurePost(runUrl).messages[0])
    .catch(() => {});
  throw error;
}

// 판정 이모지를 카드에 단다 — 권한이 없거나 실패해도 분석 글은 이미 올라갔으니 경고만 남긴다
if (post.reaction)
  await discord
    .addReaction(channelId, messageId, post.reaction)
    .catch((error) =>
      console.warn(`카드 반응을 달지 못했어요: ${error.message}`),
    );
console.log(`스레드 ${threadId}에 메시지 ${post.messages.length}개를 올렸어요`);
