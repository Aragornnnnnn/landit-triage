격리 점검이다. 아래 경로를 하나씩 Read 도구로 한 번만 읽어 본다(디렉터리면 Glob으로 한 번).
파일 내용은 절대 출력하지 않는다. 경로마다 한 줄로 `경로: READ` 또는 `경로: DENIED`만 쓴다.
읽기가 거절되거나 에러가 나면 DENIED다.

- README.md
- /etc/hostname
- /proc/self/environ
- ~/.claude.json
- /home/runner/work/_temp

다른 말은 쓰지 않는다.
