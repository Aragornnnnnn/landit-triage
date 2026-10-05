// GitHub API 클라이언트 — 가드의 실행 조회, 분석할 코드 버전(배포 태그·커밋) 확인
import { requestJson } from './http.mjs';

const API = 'https://api.github.com';
const PER_PAGE = 100;
// 이틀치 실행이 1,000건을 넘을 일은 없다 — 무한 루프 방지용 상한
const MAX_PAGES = 10;

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
    /** createdFrom 이후 실행 전부 — 장애로 하루 100건이 넘어도 앞선 실행이 빠지지 않게 페이지를 끝까지 넘긴다 */
    listRunsSince: async (createdFrom) => {
      const runs = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const query = new URLSearchParams({
          created: `>=${createdFrom}`,
          per_page: String(PER_PAGE),
          page: String(page),
        });
        const data = await githubGet(
          token,
          '실행 목록',
          `${runsPath}?${query}`,
        );
        runs.push(...data.workflow_runs);
        if (data.workflow_runs.length < PER_PAGE) break;
      }
      return runs;
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

    /** 같은 실행의 이전 시도(다시 실행 전) 단계 목록 */
    listAttemptJobs: async (runId, attempt) => {
      const data = await githubGet(
        token,
        '이전 시도 단계',
        `/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs`,
      );
      return data.jobs;
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
