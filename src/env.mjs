// 스크립트 공통 — 환경 변수 읽기와 GitHub Actions 출력·요약 쓰기
import { appendFileSync } from 'node:fs';

export const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`환경 변수 ${name}가 없어요`);
  return value;
};

export const optionalEnv = (name) => process.env[name] || null;

// 다음 단계가 steps.<id>.outputs.<key>로 읽는다. 로컬 실행이면 콘솔에만 찍는다
export const setOutput = (key, value) => {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${key}=${value}\n`);
  else console.log(`[output] ${key}=${value}`);
};

// 실행 기록 화면에 남는 요약 — 디스코드 없이 돌린 결과도 여기서 본다
export const appendSummary = (markdown) => {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
  else console.log(markdown);
};
