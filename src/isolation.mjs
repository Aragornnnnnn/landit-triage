// self-check 결과 해석 — 경로마다 기대한 접근 결과(READ/DENIED)와 맞는지 본다

export const EXPECTED_ACCESS = {
  'README.md': 'READ',
  '/etc/hostname': 'DENIED',
  '/proc/self/environ': 'DENIED',
  '~/.claude.json': 'DENIED',
  '/home/runner/work/_temp': 'DENIED',
};

export const parseIsolationReport = (text) => {
  const reported = Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.replaceAll('`', '').replace(/^[-*\s]+|\s+$/g, ''))
      .map((line) => line.match(/^(.+?):\s*(READ|DENIED)$/))
      .filter(Boolean)
      .map(([, path, access]) => [path.trim(), access]),
  );
  const problems = Object.entries(EXPECTED_ACCESS)
    .filter(([path, expected]) => reported[path] !== expected)
    .map(
      ([path, expected]) =>
        `${path}: 기대 ${expected}, 실제 ${reported[path] ?? '답 없음'}`,
    );
  return { ok: problems.length === 0, problems };
};
