// 분석 결과에 구독 토큰 조각이 섞였는지 본다 — 섞였으면 실패로 끝내 게시하지 않는다(실패 안내만 나간다)
import { readFileSync, writeFileSync } from 'node:fs';
import { requireEnv } from '../src/env.mjs';
import { containsSecret } from '../src/format.mjs';

const RESULT_FILE = 'out/claude.json';
const result = JSON.parse(readFileSync(RESULT_FILE, 'utf8'));

if (
  containsSecret(result.result ?? '', requireEnv('CLAUDE_CODE_OAUTH_TOKEN'))
) {
  // 보관 파일(artifact)에도 남지 않게 본문을 지운다
  writeFileSync(
    RESULT_FILE,
    JSON.stringify({ ...result, result: '[토큰 노출로 지움]' }),
  );
  console.error(
    '분석 결과에 구독 토큰 조각이 있어 게시하지 않아요. 토큰을 재발급해 주세요(claude setup-token).',
  );
  process.exit(1);
}
console.log('토큰 노출 검사 통과');
