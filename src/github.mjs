// GitHub Actions API 클라이언트 — 가드가 오늘 실행 수와 같은 이슈의 지난 실행을 조회한다
import { requestJson } from './http.mjs';

const API = 'https://api.github.com';

/**
 * @param {string} token GITHUB_TOKEN (actions: read)
 * @param {string} repository owner/repo
 * @param {string} workflowFile 예: triage.yml
 */
export const createGithubClient = (token, repository, workflowFile) => {
  const get = (label, path) =>
    requestJson(`GitHub ${label}`, `${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

  /** createdFrom 이후 만들어진 이 워크플로우의 실행. 하루 상한(최대 수십 건)이라 한 페이지면 충분하다 */
  const listRunsSince = async (createdFrom) => {
    const query = new URLSearchParams({
      created: `>=${createdFrom}`,
      per_page: '100',
    });
    const data = await get(
      '실행 목록',
      `/repos/${repository}/actions/workflows/${workflowFile}/runs?${query}`,
    );
    return data.workflow_runs;
  };

  /** 중복 확인용 최근 실행 100건 */
  const listRecentRuns = async () => {
    const data = await get(
      '최근 실행',
      `/repos/${repository}/actions/workflows/${workflowFile}/runs?per_page=100`,
    );
    return data.workflow_runs;
  };

  const listJobs = async (runId) => {
    const data = await get(
      '실행 단계',
      `/repos/${repository}/actions/runs/${runId}/jobs`,
    );
    return data.jobs;
  };

  return { listRunsSince, listRecentRuns, listJobs };
};

/** 다른 레포(landit-be·landit-ai)의 최근 릴리즈 — 배포 태그를 고르는 데 쓴다 */
export const listReleases = async (token, repository) => {
  const data = await requestJson(
    `GitHub 릴리즈(${repository})`,
    `${API}/repos/${repository}/releases?per_page=30`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  return data;
};
