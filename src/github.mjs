// GitHub API 클라이언트 — 가드의 실행 조회, 분석할 코드 버전(배포 태그·커밋) 확인
import { requestJson } from './http.mjs';

const API = 'https://api.github.com';

const githubGet = (token, label, path) =>
  requestJson(`GitHub ${label}`, `${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

/**
 * 이 레포의 워크플로우 실행 조회 — 가드가 하루 상한과 중복을 판단할 때 쓴다
 * @param {string} token GITHUB_TOKEN (actions: read)
 * @param {string} repository owner/repo
 * @param {string} workflowFile 예: triage.yml
 */
export const createGithubClient = (token, repository, workflowFile) => {
  const runsPath = `/repos/${repository}/actions/workflows/${workflowFile}/runs`;

  return {
    /** createdFrom 이후 실행. 하루 상한이 수십 건이라 한 페이지면 충분하다 */
    listRunsSince: async (createdFrom) => {
      const query = new URLSearchParams({
        created: `>=${createdFrom}`,
        per_page: '100',
      });
      const data = await githubGet(token, '실행 목록', `${runsPath}?${query}`);
      return data.workflow_runs;
    },

    /** 중복 확인용 최근 실행 100건 */
    listRecentRuns: async () => {
      const data = await githubGet(
        token,
        '최근 실행',
        `${runsPath}?per_page=100`,
      );
      return data.workflow_runs;
    },

    listJobs: async (runId) => {
      const data = await githubGet(
        token,
        '실행 단계',
        `/repos/${repository}/actions/runs/${runId}/jobs`,
      );
      return data.jobs;
    },
  };
};

/** 다른 레포(landit-be·landit-ai)의 최근 릴리즈 — 배포 태그를 고르는 데 쓴다 */
export const listReleases = (token, repository) =>
  githubGet(
    token,
    `릴리즈(${repository})`,
    `/repos/${repository}/releases?per_page=30`,
  );

/**
 * 커밋이 main 히스토리에 있는지 본다. Sentry 릴리즈 값은 앱이 보내는 값이라,
 * 포크 커밋처럼 main에 없는 해시를 그대로 체크아웃하지 않으려고 확인한다.
 */
export const isOnMain = async (token, repository, sha) => {
  const data = await githubGet(
    token,
    `커밋 확인(${repository})`,
    `/repos/${repository}/compare/${sha}...main`,
  );
  return data.status === 'ahead' || data.status === 'identical';
};
