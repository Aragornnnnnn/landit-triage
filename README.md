# landit-triage

Sentry에 새 이슈가 생기면 Claude Code가 원인을 분석해서
디스코드 알림 카드 아래에 스레드로 남겨요.

![시스템 아키텍처](docs/system-architecture.svg)

## 흐름

| #   | 어디서 어디로           | 무엇을                                   |
| --- | ----------------------- | ---------------------------------------- |
| ①   | Sentry → landit-alerts  | 새 이슈 웹훅                             |
| ②   | landit-alerts → Discord | 카드 (지금처럼 바로)                     |
| ③   | landit-alerts → GitHub  | 분석 요청 (이슈 id, 카드 위치)           |
| ④   | landit-triage → Sentry  | 이벤트·breadcrumbs·태그·같은 시간대 이슈 |
| ⑤   | GitHub → landit-triage  | landit-fe·be·ai 코드                     |
| ⑥   | Claude Code ↔ Anthropic | 분석                                     |
| ⑦   | landit-triage → Discord | 카드에 스레드로 게시                     |

- 카드는 바로, 분석은 1~4분 뒤에 와요.
- 분석이 실패해도 카드는 그대로 와요.
- 코드는 이슈가 났을 때 돌던 버전을 봐요.
  웹은 릴리즈 커밋, BE·AI는 그때의 배포 태그, 모바일 셸은 `main`이에요.

<details>
<summary>단계별 흐름 그림</summary>

![단계별 흐름](docs/architecture.svg)

</details>

## 판정

| 판정               | 뜻                              |
| ------------------ | ------------------------------- |
| 🚨 고쳐야 해요     | 사용자가 실제로 막혀요          |
| 👀 지켜봐요        | 지금은 괜찮지만 늘면 문제예요   |
| 🔕 괜한 알림이에요 | 정상이고, 앞으로 안 받아도 돼요 |
| ✅ 문제없어요      | 정상이고, 알림은 계속 와도 돼요 |

🚨 👀 🔕에는 Claude Code에 붙여넣을 프롬프트가 같이 와요.
"고쳐 줘"가 아니라 "같이 보자"로 시작해요.

글 형식과 말투는 [`prompts/triage.md`](prompts/triage.md) 하나만 고치면 돼요.

## 왜 별도 프라이빗 레포인가

- **실행 시간**
  분석에 몇 분이 걸려서 Vercel 함수(landit-alerts)에 넣을 수 없어요.
- **장애 격리**
  분석이 실패해도 카드 알림은 늦어지면 안 돼요.
- **데이터 노출**
  실행 기록에 Sentry 이벤트와 분석 결과가 남아요.
  다른 레포는 모두 퍼블릭이라 이 레포만 프라이빗이에요.

GitHub Actions는 맥이 꺼져도 돌고, 무료 한도(월 2,000분) 안이고,
Claude Code 구독 토큰을 공식 지원해서 골랐어요.

## 사용량

관리자 개인 구독(Max)으로 돌아요. API 결제는 없어요.

| 제한                       | 기본값 | 바꾸는 곳               |
| -------------------------- | ------ | ----------------------- |
| 하루 분석 (한국 시각 기준) | 10건   | 레포 변수 `DAILY_LIMIT` |
| 한 번에 도구 사용          | 50번   | 레포 변수 `MAX_TURNS`   |
| 분석 시간                  | 12분   | `triage.yml`            |
| 같은 이슈 다시 분석        | 안 함  | `src/guard.mjs`         |

- 상한을 넘으면 "건너뛰었어요"만 남겨요.
- 스레드 끝에 걸린 시간·토큰·API 환산 금액이 찍혀요.
- 첫 실행은 1분 8초, API 환산 $0.85였어요.

## 보안

- 분석 요청 토큰은 **이 워크플로우 실행 권한만** 있어요.
  새도 코드를 바꾸거나 시크릿을 읽을 수 없어요.
- Claude는 **읽기 도구만** 쓰고, 구독 토큰 말고는 환경 변수를 못 봐요.
- 입력 id는 형식을 검사한 뒤에만 API 경로에 넣어요.
- 사용자 정보는 id만, 요청 정보는 경로만 Claude에게 넘겨요.
- 게시 전에 낯선 링크는 누를 수 없게, 토큰 모양 문자열은 가려요.
- 스레드는 아무도 멘션하지 않아요.

## 설정

처음 설정은 [docs/setup.md](docs/setup.md)에 순서대로 있어요.

| Secret                    | 내용                    |
| ------------------------- | ----------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token`    |
| `SENTRY_AUTH_TOKEN`       | Sentry 연동 토큰 (읽기) |
| `DISCORD_BOT_TOKEN`       | landit-alerts 봇 토큰   |

선택 변수: `CLAUDE_MODEL`(기본 Opus 5.5), `DAILY_LIMIT`, `MAX_TURNS`,
`CLAUDE_CODE_VERSION`, `TRIAGE_EMOJI`

## 손으로 실행하기

```bash
gh workflow run triage.yml -R Aragornnnnnn/landit-triage -f issue_id=<Sentry 이슈 숫자 id>
```

채널·메시지 id를 비우면 디스코드에 안 올리고 실행 요약에만 남겨요.
지침을 고친 뒤 시험할 때 쓰면 돼요.

## 구조

```
prompts/triage.md   분석 지침
scripts/            워크플로우가 부르는 진입점 (guard · context · post)
src/                판단 로직과 API 클라이언트, 테스트
docs/               설정 절차 · 설계 결정 · 그림
```

```bash
npm test
```

## 문제 해결

| 증상               | 볼 곳                                                    |
| ------------------ | -------------------------------------------------------- |
| 스레드가 안 붙음   | Actions 실행이 있는지 → 없으면 landit-alerts Vercel 로그 |
| "끝내지 못했어요"  | `Claude 분석` 단계 출력. `Not logged in`이면 토큰 재발급 |
| `error_max_turns`  | `MAX_TURNS`를 올리거나 다시 실행                         |
| 스레드 생성 403    | 봇의 채널 스레드 권한                                    |
| 분석 원문이 필요함 | 실행의 Artifacts (14일 보관)                             |

설계 결정과 이유는 [docs/decisions.md](docs/decisions.md)에 있어요.
