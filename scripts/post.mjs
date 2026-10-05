// 결과를 Sentry 카드의 스레드로 올린다 — 사용법: node scripts/post.mjs <analysis|skipped|failed>
// 카드 정보(CHANNEL_ID·MESSAGE_ID)가 없으면 디스코드 대신 실행 요약에만 남긴다(손으로 돌린 시험 실행)
import { readFileSync } from 'node:fs';
import { createDiscordClient } from '../src/discord.mjs';
import { appendSummary, optionalEnv, requireEnv } from '../src/env.mjs';
import {
  buildAnalysisPost,
  buildFailurePost,
  buildSkipPost,
} from '../src/post.mjs';

const CLAUDE_RESULT_FILE = 'out/claude.json';

const readClaudeResult = () => {
  try {
    return JSON.parse(readFileSync(CLAUDE_RESULT_FILE, 'utf8'));
  } catch {
    return null;
  }
};

const runUrl = requireEnv('RUN_URL');

const buildPost = (mode) => {
  if (mode === 'analysis') {
    const emojiMap = JSON.parse(optionalEnv('TRIAGE_EMOJI') ?? '{}');
    return (
      buildAnalysisPost(readClaudeResult(), emojiMap) ??
      buildFailurePost(runUrl)
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

const discord = createDiscordClient(requireEnv('DISCORD_BOT_TOKEN'));
const threadId = await discord.openThread(channelId, messageId, post.title);
for (const message of post.messages)
  await discord.sendMessage(threadId, message);
console.log(`스레드 ${threadId}에 메시지 ${post.messages.length}개를 올렸어요`);
