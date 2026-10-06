# 처음 설정

순서대로 하면 돼요. 1~4는 이 레포, 5는 landit-alerts 쪽이에요. 비밀값은 채팅이나 파일에 붙여넣지 말고 아래 명령으로 바로 등록해 주세요.

## 1. Claude 구독 토큰

관리자 맥에서 실행해요. 브라우저 로그인이 열리고, 끝나면 1년짜리 토큰이 출력돼요.

```bash
claude setup-token
```

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN -R Aragornnnnnn/landit-triage
```

붙여넣으라는 프롬프트가 나오면 토큰을 넣어요. 토큰은 발급한 사람의 구독 사용량을 써요.

## 2. Sentry 읽기 토큰

사람에게 묶이지 않게 기존 내부 연동의 토큰을 쓰는 걸 권해요.

1. Sentry → Settings → Developer Settings → Custom Integrations → `landit-alerts`
2. 권한에 **Issue & Event: Read**가 있는지 확인해요. **Project: Read**, **Organization: Read**도 켜 둬요.
3. Tokens → New Token으로 토큰을 만들어요.

```bash
gh secret set SENTRY_AUTH_TOKEN -R Aragornnnnnn/landit-triage
```

## 3. 디스코드 봇

landit-alerts가 쓰는 봇을 그대로 써요.

```bash
gh secret set DISCORD_BOT_TOKEN -R Aragornnnnnn/landit-triage
```

Sentry 알림 채널(`#sentry-web`, `#sentry-mobile`)에서 봇에게 아래 권한을 줘요.

- 채널 보기
- 메시지 기록 보기
- 공개 스레드 만들기
- 스레드에서 메시지 보내기

## 3-1. 코드 읽기 토큰 (landit-be·landit-ai가 프라이빗이라 필요)

1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
   - Resource owner: **Aragornnnnnn**
   - Repository access: **Only select repositories → landit-fe, landit-be, landit-ai**
   - Permissions → Repository → **Contents: Read-only** 하나만
2. 시크릿으로 넣어요.

```bash
gh secret set CODE_READ_TOKEN -R Aragornnnnnn/landit-triage
```

없으면 퍼블릭 레포(landit-fe)만 받고, 못 받은 레포는 분석 글에 밝혀요.

## 4. 토스페이스 판정 이모지 (선택)

없으면 본문에도 기본 이모지가 보여요.

1. 디스코드 개발자 포털 → 봇 애플리케이션 → Emojis에 4개를 올려요. 토스페이스 SVG는 브라우저 캔버스로 PNG로 바꿔야 투명 배경이 유지돼요.

   | 판정 | 이름 예시      |
   | ---- | -------------- |
   | 🚨   | `tosssiren`    |
   | 👀   | `tosseyes`     |
   | 🔕   | `tossbellmute` |
   | ✅   | `tosscheck`    |

2. 올린 이모지의 id로 레포 변수를 만들어요.

```bash
gh variable set TRIAGE_EMOJI -R Aragornnnnnn/landit-triage --body '{"🚨":"<:tosssiren:ID>","👀":"<:tosseyes:ID>","🔕":"<:tossbellmute:ID>","✅":"<:tosscheck:ID>"}'
```

스레드 제목에는 앱 이모지가 들어가지 않아서 제목은 항상 기본 이모지예요.

## 5. landit-alerts에서 분석 요청 켜기

1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
   - Resource owner: **Aragornnnnnn**
     (목록에 없으면 오가니제이션 설정 → Personal access tokens에서 허용)
   - Repository access: **Only select repositories → landit-triage**
   - Permissions → Repository → **Actions: Read and write** 하나만
2. landit-alerts PR을 머지해요.
3. landit-alerts Vercel 프로젝트에 `TRIAGE_DISPATCH_TOKEN`(Production)으로 등록해요.
4. landit-alerts 폴더에서 프로덕션에 다시 배포해요.

```bash
npx vercel deploy --prod
```

토큰이 없으면 landit-alerts는 지금처럼 카드만 올려요.
Contents 권한은 주지 마세요. 코드를 바꿀 수 있는 토큰이 돼요.

Actions 쓰기 권한으로는 이 레포 워크플로우를 실행·취소하고 실행 기록을 지울 수 있어요.
글을 올릴 채널을 Sentry 채널로 묶으려면 채널 id를 레포 변수로 넣어 주세요.

```bash
gh variable set TRIAGE_CHANNELS -R Aragornnnnnn/landit-triage --body '<#sentry-web id>,<#sentry-mobile id>'
```

## 6. 확인

디스코드에 올리지 않는 시험 실행부터 해요.

```bash
gh workflow run triage.yml -R Aragornnnnnn/landit-triage -f issue_id=<Sentry 이슈 숫자 id>
```

Actions 실행 요약에 분석 글이 나오면 성공이에요. 그다음 개인 테스트 서버의 메시지로 채널·메시지 id를 넣어 스레드가 붙는지 봐요.

## 7. 격리 점검

Actions → **self-check** → Run workflow.
Claude가 작업 폴더 밖(`/proc`, `/etc`, 러너 폴더)을 못 읽는지 실제 러너에서 확인해요.
Claude Code 버전이나 `config/claude-settings.json`을 바꿀 때마다 한 번 돌려 주세요.

## 토큰 만료

| 토큰                      | 유효 기간            | 만료되면                                                                       |
| ------------------------- | -------------------- | ------------------------------------------------------------------------------ |
| `CLAUDE_CODE_OAUTH_TOKEN` | 1년                  | 분석이 "Not logged in"으로 실패 → `claude setup-token` 다시                    |
| `TRIAGE_DISPATCH_TOKEN`   | 만들 때 정한 기간    | 분석 요청이 안 감(Vercel 로그 `분석 요청: failed`) → 새로 만들어 Vercel에 교체 |
| `SENTRY_AUTH_TOKEN`       | 만료 없음(연동 토큰) | —                                                                              |
| `CODE_READ_TOKEN`         | 만들 때 정한 기간    | BE·AI 코드 없이 분석(글에 "못 봐서" 표시) → 새로 만들어 시크릿 교체            |

발급일을 여기에 적어 두세요.

- `CLAUDE_CODE_OAUTH_TOKEN`: 2026-10-06
- `TRIAGE_DISPATCH_TOKEN`: 2026-10-06 (1년)
