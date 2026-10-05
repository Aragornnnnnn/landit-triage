// 외부 API 호출 공통 헬퍼 — JSON 요청, 실패 시 응답 본문을 담은 에러, 429 한 번 재시도

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(label, status, body) {
    super(`${label} 실패 (${status}): ${body.slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {string} label 에러 메시지에 붙일 호출 이름
 * @param {string} url
 * @param {RequestInit & { json?: unknown }} [options] json을 주면 본문으로 직렬화한다
 * @returns 응답이 JSON이면 파싱한 값, 비어 있으면 null
 */
export const requestJson = async (
  label,
  url,
  { json, headers, ...rest } = {},
) => {
  const send = () =>
    fetch(url, {
      ...rest,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LanditTriage/1.0',
        ...(json !== undefined && { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(json !== undefined && { body: JSON.stringify(json) }),
    });

  let res = await send();
  // 디스코드·GitHub 모두 429에 기다릴 시간을 준다 — 한 번만 기다렸다 다시 보낸다
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? 1);
    await sleep(Math.min(retryAfter, 10) * 1000);
    res = await send();
  }

  const text = await res.text();
  if (!res.ok) throw new HttpError(label, res.status, text);
  return text ? JSON.parse(text) : null;
};
