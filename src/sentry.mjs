// Sentry REST API 클라이언트 — 분석에 넘길 이슈·이벤트·태그·같은 시간대 이벤트를 읽는다
import { requestJson } from './http.mjs';

/**
 * @param {string} token Sentry 인증 토큰 (event:read, project:read, org:read)
 * @param {string} org 조직 slug (saynow)
 * @param {string} [apiBase] 리전이 다르면 바꾼다
 */
export const createSentryClient = (
  token,
  org,
  apiBase = 'https://sentry.io/api/0',
) => {
  const get = (label, path) =>
    requestJson(`Sentry ${label}`, `${apiBase}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

  const issuePath = (issueId) => `/organizations/${org}/issues/${issueId}`;

  return {
    getIssue: (issueId) => get('이슈', `${issuePath(issueId)}/`),

    /** 알림을 일으킨 이벤트. id가 없으면 가장 최근 이벤트 */
    getEvent: (issueId, eventId) =>
      get('이벤트', `${issuePath(issueId)}/events/${eventId ?? 'latest'}/`),

    /** 최근 이벤트 요약(full 없이) — 같은 흐름이 반복되는지 보는 용도. 자세한 건 알림 이벤트 한 건으로 충분하다 */
    listRecentEvents: (issueId, limit = 10) =>
      get('최근 이벤트', `${issuePath(issueId)}/events/?per_page=${limit}`),

    /** 버전·OS·기기 분포 */
    listTags: (issueId) => get('태그', `${issuePath(issueId)}/tags/`),

    /** 같은 시간대에 생긴 모든 프로젝트의 에러 이벤트 */
    listEventsBetween: async ({ start, end }) => {
      const query = new URLSearchParams({
        dataset: 'errors',
        start,
        end,
        per_page: '100',
        project: '-1',
      });
      for (const field of [
        'issue',
        'title',
        'timestamp',
        'trace',
        'project',
        'release',
      ])
        query.append('field', field);
      const data = await get(
        '같은 시간대 이벤트',
        `/organizations/${org}/events/?${query}`,
      );
      return data.data;
    },
  };
};
