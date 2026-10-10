# Paper Reader Link · 0.1.0 시제품

Paper Reader에서 선택한 문장을 ChatGPT 대화로 가져오고, 답변을 원래 PDF 위치의 주석으로 저장하는 MCP 플러그인입니다. 모델 호출은 ChatGPT 대화에서 이루어집니다. Link 서버는 모델 API나 Codex 추론 API를 호출하지 않습니다.

## 처음 연결하기

1. 기존 Paper Reader 창을 종료한 뒤, 함께 제공된 **Paper Reader 0.9.0 EXE**를 실행합니다. 이전 버전이 실행 중이면 새 EXE도 기존 창을 활성화하므로 먼저 종료해야 합니다.
2. [OpenAI Platform 터널 설정](https://platform.openai.com/settings/organization/tunnels)에 로그인하여 터널을 생성합니다. 사용할 **ChatGPT 워크스페이스를 연결**하고 터널 ID를 기록합니다. 생성에는 Tunnels **Read + Manage**, 실행에는 **Read + Use** 권한이 필요합니다.
3. Platform에서 터널 실행용 API 키를 준비합니다. 이 키는 **채팅에 붙여넣지 마세요**. Link 연결용이며 모델 요청 코드는 포함하지 않습니다.
4. [plugins/paper-reader-link/Start-Link.cmd](plugins/paper-reader-link/Start-Link.cmd)를 실행합니다. 저장소를 처음 받은 경우 먼저 루트에서 `npm ci`와 `npm run build:link`로 실행 번들을 생성하세요. 배포용 Link 패키지는 포함된 `Start-Link.cmd`를 실행하면 됩니다. 배포용 Link 실행은 Node.js 20 이상, 저장소 개발·빌드는 Node.js 22 이상이 필요합니다. 터널 ID와 실행 키를 입력합니다. 키는 가려서 입력받으며 파일에 저장하지 않고 현재 프로세스 환경에서만 사용합니다. 창을 닫으면 연결이 종료됩니다.
5. [ChatGPT 플러그인](https://chatgpt.com/plugins)에서 **+ → Add custom MCP server → Connection: Tunnel**을 선택합니다. 위 터널을 지정하고 이름을 **Paper Reader Link**로 설정합니다. 이 비공개 stdio 서버의 인증은 **No authentication**을 선택합니다. 터널 자체의 계정·워크스페이스 접근 제어가 적용됩니다. 공개 HTTP 서비스가 아닙니다.
6. 플러그인을 생성·활성화한 뒤, 사용할 ChatGPT 대화에서 **Paper Reader Link를 열어줘**라고 요청합니다. 지원하는 호스트에서는 대화 옆 패널에서도 열 수 있습니다.

Windows가 파일 실행을 차단하는 경우 보안 정책을 끄지 말고, 압축을 해제한 파일의 출처와 조직 정책을 확인하세요. 공식 터널 도구가 연결 오류를 표시하면 열린 관리 화면에서 상태를 확인할 수 있습니다.

## 기본 사용 흐름

ChatGPT를 기본 모드로 사용합니다. 앱에서 직접 요청하는 방식은 환경 설정의 보조 모드입니다. 현재 Link는 추출한 텍스트만 전달합니다. 수식·그림이 중요하면 **페이지 PNG**로 저장하여 ChatGPT에 함께 첨부하세요. 여러 페이지를 종합할 때는 원본 PDF와 대상 페이지·질문을 함께 제공할 수 있습니다.

## 매번 사용하는 순서

1. Paper Reader에서 PDF 문장을 선택하고 질문을 입력합니다. **문맥 설정**에서 함께 공유할 범위를 조절할 수 있습니다.
2. PDF 아래 전달 방식에서 **ChatGPT Link**를 선택하고 **Link로 질문 준비**를 누릅니다. 문장, 질문, 선택한 문맥과 포함된 앱 대화 기록이 공유됩니다. 파일 전체는 자동 공유하지 않습니다.
3. ChatGPT의 Link 카드에서 **선택 문장 불러오기**를 누릅니다. 문장을 확인하고 질문을 수정할 수 있습니다.
4. **이 ChatGPT 대화에서 질문하기**를 누릅니다. 질문이 현재 대화에 들어가고 ChatGPT가 답변합니다. 이후 질문은 ChatGPT 입력창에서 자연스럽게 이어갑니다.
5. **답변을 PDF 주석으로 저장**을 켜 두면 답변 뒤 `save_annotation` 도구로 저장을 요청합니다. 호스트의 도구 승인 창이 나타나면 저장 대상과 내용을 확인합니다. 성공한 경우 PDF 원래 위치에 파란 표시와 주석이 나타납니다. 앱의 답변 도착 안내에서 **답변 보기**를 누르면 해당 논문 노트를 엽니다. 도구 호출 없이 답변만 나온 경우, 대화에서 “이 답변을 같은 선택 ID의 PDF 주석으로 저장해줘”라고 요청할 수 있습니다.

## 시제품 범위

- 공유한 문장마다 고정된 선택 ID가 있습니다. 나중에 다른 PDF를 열어도 기존 답변은 원래 문서·페이지·선택 영역으로 저장됩니다.
- 동일 답변의 저장 재시도는 중복 주석을 만들지 않습니다. 한 선택 ID에는 한 답변을 저장합니다. 다른 답변은 문장을 다시 공유하거나 기존 주석을 앱에서 편집하세요.
- 공유 문장은 24시간, 앱 종료 또는 **연결 해제**까지 유효합니다. 해제하면 미처리 공유가 모두 폐기되고 연결 키가 바뀝니다. 이미 저장한 주석은 보관됩니다.
- 계정 로그인·ChatGPT 대화 기록·쿠키·로컬 파일 전체를 가져오는 기능은 없습니다. 선택한 자료의 문맥과 앱에서 이미 포함한 기록만 제공합니다.
- ChatGPT의 일반 Chat과 Work는 사용하는 호스트 모드가 다릅니다. 일반 Chat 대화에서 이 플러그인을 연결해야 의도한 ChatGPT 대화 흐름을 검증할 수 있습니다. 로컬 Codex MCP 도구 검증만으로 일반 Chat 지원을 확인한 것으로 간주하지 않습니다.
- ChatGPT 사용자 지정 MCP/패널 지원은 계정·워크스페이스 권한에 따라 달라집니다. 터널 생성 및 실계정의 ChatGPT 왕복은 별도로 확인해야 합니다.
- PDF 전체를 ChatGPT 패널에 표시하는 기능, 외부 EXE에서 ChatGPT 메시지를 자동 전송하는 기능, ChatGPT 대화 전체를 앱 기록에 동기화하는 기능은 이 시제품에 포함되지 않습니다.

## 개발 및 검증

저장소에서 `npm install`, `npm run build:link`, `npm test`로 빌드·검증합니다. `server.bundle.mjs`와 `widget.html`은 빌드 산출물입니다. MCP 도구는 `open_paper_reader`, `get_selection`, `save_annotation` 세 개입니다. 번들에는 MCP SDK를 포함하므로 배포 폴더에서 npm 설치는 필요하지 않습니다.

개발용 `npm start` 서버를 사용할 때는 stdio 실행 인자에 `--connection <저장소>/.local/link-connection.json`을 추가합니다. 기본 EXE는 `%APPDATA%/Paper Reader/link-connection.json`을 사용합니다. 이 파일은 연결 키를 포함하므로 공유하거나 커밋하지 마세요.

출처: [공식 MCP UI](https://developers.openai.com/plugins/build/chatgpt-ui), [대화 패널 확장](https://developers.openai.com/plugins/build/extensions), [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).
