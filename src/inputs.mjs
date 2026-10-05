// 실행 입력값 검증 — 이 값들은 API 경로에 그대로 들어가서, 형식이 어긋나면 다른 엔드포인트를 부를 수 있다

const PATTERNS = {
  issueId: /^\d{1,20}$/,
  eventId: /^[0-9a-f]{32}$/,
  channelId: /^\d{17,20}$/,
  messageId: /^\d{17,20}$/,
};

// 이슈 id만 필수다. 나머지는 비어 있으면 최신 이벤트·시험 실행으로 처리한다
const REQUIRED = new Set(['issueId']);

/** 형식이 어긋난 입력 이름 목록. 비어 있으면 통과 */
export const invalidInputs = (inputs) =>
  Object.entries(PATTERNS)
    .filter(([name, pattern]) => {
      const value = inputs[name];
      if (!value) return REQUIRED.has(name);
      return !pattern.test(value);
    })
    .map(([name]) => name);
