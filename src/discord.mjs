// 디스코드 봇 API 클라이언트 — Sentry 카드 메시지에 스레드를 만들고 글을 올린다
import { HttpError, requestJson } from './http.mjs';

const API = 'https://discord.com/api/v10';

// 메시지에 이미 스레드가 있을 때 돌아오는 에러 코드 — 그 스레드 id는 메시지 id와 같다
const THREAD_ALREADY_EXISTS = 160004;

// 코드 링크가 미리보기 카드로 펼쳐지면 스레드가 길어진다
const SUPPRESS_EMBEDS = 1 << 2;

// 하루 하나 넘게 볼 일은 없어서 24시간 뒤 자동 보관한다
const AUTO_ARCHIVE_MINUTES = 1440;

export const createDiscordClient = (botToken) => {
  const call = (label, path, json) =>
    requestJson(`디스코드 ${label}`, `${API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}` },
      json,
    });

  /** 카드 메시지에 스레드를 열고 스레드(채널) id를 돌려준다. 이미 있으면 그 스레드를 쓴다 */
  const openThread = async (channelId, messageId, name) => {
    try {
      const thread = await call(
        '스레드 생성',
        `/channels/${channelId}/messages/${messageId}/threads`,
        { name, auto_archive_duration: AUTO_ARCHIVE_MINUTES },
      );
      return thread.id;
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.body.includes(`${THREAD_ALREADY_EXISTS}`)
      )
        return messageId;
      throw error;
    }
  };

  /** 멘션은 전부 막는다 — 분석 글이 사람을 부르면 안 된다 */
  const sendMessage = (threadId, content) =>
    call('메시지 전송', `/channels/${threadId}/messages`, {
      content,
      flags: SUPPRESS_EMBEDS,
      allowed_mentions: { parse: [] },
    });

  /** 카드 메시지에 반응(이모지)을 단다. 이미 달려 있어도 성공으로 끝난다 */
  const addReaction = (channelId, messageId, emoji) =>
    requestJson(
      '반응 추가',
      `${API}/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
      { method: 'PUT', headers: { Authorization: `Bot ${botToken}` } },
    );

  return { openThread, sendMessage, addReaction };
};
