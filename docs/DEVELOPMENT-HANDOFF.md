# 개발 인수인계 · Paper Reader 0.10.0

> 2026-10-13 업데이트: 아래의 0.9.6 기록은 개발 당시 계획으로 보존합니다. 0.10.0에서는 명시적 AI 문맥 검색 모드, 질문 당시 SHA-256 PDF 고정본, 격리된 PDF.js 추출·렌더링, SQLite FTS5 읽기 전용 검색, 네 가지 MCP 읽기 도구와 근거 페이지 UI를 구현했습니다. NTK 19페이지로 로컬 MCP 전 구간을 검증해 `Figure 3`의 p.9 검색·본문 읽기·실제 PNG 반환을 확인했습니다. 자동 테스트 79개가 통과했습니다. 실제 ChatGPT 모델 호출 검증은 새 버전의 터널·플러그인 연결이 필요합니다. 0.10.0 소스의 구현 상태는 README와 코드를 기준으로 확인하세요.


작성일: 2026-10-12. 다른 Windows PC에서 이 문서부터 읽고 개발을 재개한다.

## 현재 상태와 다음 목표

현재 앱 버전은 **0.9.6**, MCP Link 버전은 **0.1.0**이다. 이번 인수인계 시점에 개발을 중단했다. **SQL 문맥 검색과 MCP 페이지 이미지 fetch는 아직 구현하지 않았다.** 해당 기능은 아래 계획과 로컬 실험으로 구체화한 상태다. 실제 모델이 새 SQL 도구와 이미지 도구를 호출하는 종단 검증도 아직 수행하지 않았다.

다음 목표는 사용자가 문맥 페이지를 미리 지정하는 대신, ChatGPT가 질문에 따라 연결된 PDF 안에서 SQL로 문맥을 찾고 필요한 페이지 이미지까지 읽는 MVP다. ChatGPT 자체의 context window를 조작하는 기능이 아니라, 모델이 MCP 도구로 자료를 단계적으로 가져오는 기능이다. 모델 추론은 기존 ChatGPT 대화에서 수행하며 Link 서버에 별도 추론 API 호출을 추가하지 않는 방향이다.

현재 구현되어 있는 기능:

- Windows Electron 앱과 PDF.js 뷰어, 내장 ChatGPT 웹 패널.
- 선택 문장 및 현재 페이지 질문 → 오른쪽 ChatGPT 현재 대화로 직접 전송.
- 현재 ChatGPT 입력창과 한국어 `보내기` 버튼 탐지, 전송된 사용자 메시지 확인, 중복 전송 방지. 작성 중인 초안·생성 중인 답변·전송 중 화면 이동을 보호한다. 결과가 불확실한 전송은 자동 재시도하지 않는다.
- `%APPDATA%\Paper Reader`의 고정 프로필, 앱 버전 정보가 제거된 웹 User-Agent, 쿠키 flush로 EXE 업데이트 사이 웹 로그인 유지.
- 문서별 읽던 페이지·배율·회전·질문 초안 복원.
- 문장 답변은 원문 위치, 페이지 답변은 페이지 노트에 저장. 논문 노트 검색·이동·Markdown 내보내기.
- 논문 노트 CSS와 메인 앱의 서체·색·구분선 정렬, 페이지 노트 마커 개선, 불필요한 PDF 편집 버튼 및 혼동되는 UI 문구 정리.
- 기존 MCP 도구 `open_paper_reader`, `get_selection`, `save_annotation`.
- 현재 Link 공유 범위는 선택한 문장과 앱이 준비한 텍스트 문맥이다. **PDF 전체 검색과 자동 이미지 반환은 지원하지 않는다.** `페이지 이미지 저장`은 PNG를 내려받아 사용자가 직접 첨부하는 기능이다.

## 다른 PC에서 실행하기

Git, Node.js 22 이상, Windows x64 환경을 준비한다. 기존에 설치된 Electron을 전역으로 사용할 필요는 없다.

```powershell
git clone https://github.com/tjdgh3946/Agentic-PDF-Reader.git
Set-Location Agentic-PDF-Reader
npm ci
npm test
npm run desktop
```

앱 개발의 기본 실행은 `npm run desktop`이다. `npm start`는 브라우저용 Node 서버이며 `http://127.0.0.1:8767`에서 실행된다. 브라우저 실행은 내장 ChatGPT 웹 패널 및 네이티브 직접 전송을 제공하지 않는다. Electron의 localhost 포트는 실행마다 바뀌므로 과거 포트 번호를 하드코딩하지 않는다.

실사용 검증에 사용한 외부 테마는 [themes/Paper-Reader.css](../themes/Paper-Reader.css)에 보관했다. 같은 디자인으로 개발 실행하려면 다음과 같이 복사한다. 기본 `app.css`, `ui.css`, `notes.css`도 유지되어 있다.

```powershell
Copy-Item .\themes\Paper-Reader.css .\Paper-Reader.css
npm run desktop
```

이 테마는 선택 사항이며 현재 PC의 폰트 설치 여부에 따라 대체 서체로 표시된다. Pretendard, Source Serif 4, Noto Serif KR, IBM Plex Mono 설치가 권장되어 있는 CSS이나 폰트 파일은 이 저장소에 새로 포함하지 않았다.

EXE 빌드:

```powershell
npm run build
```

출력 경로는 `electron-builder.json`의 `directories.output`에 지정된 **저장소 기준 `../../work/electron-build`**다. 다른 PC에서도 이 상대 경로를 확인한다. 필요하면 빌드 설정의 출력 경로를 작업 환경에 맞게 변경한다. EXE 옆에 `Paper-Reader.css`를 두면 외부 테마가 적용된다. 버전 변경 시 `package.json`, `package-lock.json`, UI 버전 표기와 관련 문서를 함께 갱신한다.

## 인증·터널·로컬 데이터

인증과 사용자 데이터는 Git에서 이전하지 않는다. 새 PC에서 다음을 별도로 준비한다.

1. 앱 오른쪽 ChatGPT 웹 화면에 로그인한다. 이 로그인은 해당 PC의 Paper Reader 전용 브라우저 세션이며 GitHub/Platform 로그인이나 다른 PC의 로그인에서 상속되지 않는다. 같은 PC에서 EXE를 업데이트할 때는 고정 프로필을 재사용한다.
2. 올바른 OpenAI Platform organization과 ChatGPT workspace에서 터널 접근 권한을 확인한다. 기존 터널을 재사용할 수 있는지는 계정 권한과 활성 클라이언트 상태를 확인해 판단한다. 같은 터널에 두 PC를 동시에 연결하는 운용은 이 작업에서 검증하지 않았다.
3. `npm run build:link`로 `plugins/paper-reader-link/server.bundle.mjs`, `widget.html` 등 생성물을 만든다.
4. 공식 Secure MCP Tunnel 클라이언트를 `plugins/paper-reader-link/tools/tunnel-client.exe`에 준비한다. 이 바이너리는 `.exe` 제외 규칙 때문에 Git에 포함되지 않는다. 기존 PC에서는 **v0.0.16**을 사용했다. 공식 배포와 설치 방법은 [Secure MCP Tunnel 안내](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)를 확인한다.
5. `node plugins/paper-reader-link/start-link.mjs --check`로 준비 상태를 확인한 뒤 `plugins/paper-reader-link/Start-Link.cmd`를 실행한다. 처음 한 번 터널 ID와 Runtime API Key를 입력한다. Windows DPAPI(CurrentUser) 암호화 저장 후 다음 실행부터 자동 재사용한다. 같은 PC에서 매번 입력을 요구하지 않는다.
6. ChatGPT의 사용자 지정 MCP 플러그인에서 해당 터널의 Paper Reader Link를 연결한다. 권한·등록 화면은 [한국어 연결 안내](../Paper-Reader-Link-연결안내.md)를 참고한다.
7. 앱에서 질문을 공유해야 현재 localhost와 새 capability token이 `link-connection.json`에 기록된다. 앱 재시작 직후 과거 연결 파일만으로 현재 연결 여부를 판단하지 않는다.

로컬 저장 위치:

| 항목 | 위치·수명 |
| --- | --- |
| Electron 로그인·쿠키·설정·대화·노트 | `%APPDATA%\Paper Reader` |
| Electron Link 연결 파일 | `%APPDATA%\Paper Reader\link-connection.json` |
| 브라우저용 Node 서버 데이터 | 저장소 `.local/` |
| 브라우저 서버용 MCP 연결 | `--connection <저장소>/.local/link-connection.json` |
| Tunnel 클라이언트 프로필 | `%LOCALAPPDATA%\PaperReaderLink\tunnel` |
| Tunnel Runtime API Key | `%LOCALAPPDATA%\PaperReaderLink\credentials.json`, Windows DPAPI CurrentUser 암호화 |
| 공유 선택 ID | 24시간, 연결 해제 또는 앱 종료까지 |

API 키, 연결 파일의 token, identity 파일, 브라우저 프로필/쿠키, 사용자 대화와 노트를 커밋하거나 로그에 출력하지 않는다. 기존 PC의 인증 프로필을 복사해 새 PC 로그인 절차를 우회하지 않는다. 원본 PDF는 사용자 PC 파일이며 주석 저장이 원본 PDF를 수정하지 않는다.

## 재개할 때 볼 코드

| 영역 | 주요 파일 | 재개 시 작업 |
| --- | --- | --- |
| Electron 앱·프로필 | `desktop.mjs`, `desktop-profile.mjs` | 로컬 서버에 PDF 렌더 서비스 주입, 종료 시 리소스 정리 |
| HTTP API·보안 경계 | `server.mjs` | PDF 업로드·등록, 모델 검색/이미지 요청 라우팅 |
| 공유 capability | `paper-link.mjs` | 선택 ID를 불변 PDF snapshot에 연결, 만료·해제 |
| MCP 도구·stdio | `link/mcp-server.mjs`, `link/stdio.mjs`, `link/bridge-client.mjs` | 새 도구 등록, 이미지 ContentBlock, timeout |
| MCP 빌드·터널 | `scripts/build-link.mjs`, `plugins/paper-reader-link/start-link.mjs` | 번들 재생성 및 실행 중 MCP 프로세스/호스트 도구 목록 갱신 |
| 질문 준비·전송 | `app.mjs`, `link-ui.mjs`, `link-question.mjs` | 모델 검색 모드, 최소 질문 payload, 공유 범위 안내 |
| 네이티브 웹 전송 | `chatgpt-panel.mjs`, `web-panel-send.mjs`, `desktop-preload.cjs` | 기존 전송·로그인·초안 보호 동작 회귀 방지 |
| PDF 읽기 상태·주석 | `reading-state.mjs`, `reading-tools.mjs`, `annotation-ui.mjs`, `annotations.mjs` | 문서 변경 중 응답도 원래 PDF에 연결 |
| 스타일·패키징 | `app.css`, `ui.css`, `notes.css`, `electron-builder.json` | 검색 진행·근거 페이지 UI, 새 모듈 포함 |

현재 `paper-link.mjs`는 공유/도구 호출을 직렬 큐로 처리한다. 긴 검색·렌더를 그대로 큐 안에 넣으면 연결 해제가 지연될 수 있다. 읽기 요청은 취소·해제에 반응하도록 설계하고, 반환 직전에 공유가 여전히 유효한지 다시 확인한다.

## MVP 구현 계획

아래 인터페이스와 수치 제한은 **계획**이다. 구현하면서 실제 테스트로 확정한다. 다음 작업자는 순서대로 작은 변경으로 진행한다.

### 1. 질문 시점의 PDF snapshot 등록

- 명시적인 `AI가 문맥 찾기 · PDF 전체/이미지` 모드를 추가한다. 기존 선택 문맥 모드와 공유 범위가 구별되어야 한다. 전체 PDF를 모델이 검색할 수 있다는 점을 사용자에게 표시한다.
- PDF.js의 `pdfDocument.getData()`로 원본 bytes를 로컬 서버에 등록한다. 본문 추출과 이미지는 같은 bytes를 사용한다. 모델이 지정한 파일 경로나 임의 URL을 열지 않는다.
- SHA-256 snapshot ID, 파일명, 페이지 수, 추출 상태를 저장한다. 노트의 기존 PDF fingerprint/documentId와 연결하되 서로의 역할을 혼동하지 않는다.
- `selectionId`가 질문 당시 snapshot을 가리키게 한다. 사용자가 다른 PDF를 열어도 원래 질문의 검색/이미지/주석은 원래 문서로 귀속되어야 한다. 모델은 각 도구에 질문의 선택 ID를 명시한다.
- 초기 제한 후보: PDF 64 MiB, 1,000페이지, 전체 추출 12M자, 메모리 내 snapshot 최대 3개/총 192 MiB. 초과·암호·스캔 PDF·추출 실패에 구체적 안내를 제공한다. 활성 공유를 조용히 다른 문서로 바꾸지 않는다.
- 업로드에 기존 localhost Host/Origin/`X-Paper-Reader` 검사를 적용한다. bytes 업로드에는 JSON 1.5 MB 제한과 별도의 상한이 필요하다. 공유 해제·만료·앱 종료 시 snapshot과 작업 리소스를 정리한다.

### 2. 본문 추출 및 SQL 검색

- Electron의 별도 격리된 PDF.js 렌더러에서 본문을 추출한다. `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, 인증 세션 미사용, trusted local 코드만 실행한다. 원격 요청과 임의 탐색을 제한한다.
- 페이지 번호는 **1부터 시작하는 PDF 뷰어 페이지 번호**로 통일한다. 논문 인쇄 페이지 번호와 구별한다.
- 원문은 `pages(page_no INTEGER PRIMARY KEY, raw_text TEXT)`에 보존한다. `page_fts(page_no UNINDEXED, text)` FTS5 인덱스는 NFKC 정규화하고 soft hyphen을 제거한다. `ﬁ` 같은 합자로 검색이 누락되는 문제를 로컬 실험에서 확인했다.
- worker thread 안의 문서별 SQLite DB를 사용한다. 모델 SQL은 단일 read-only SELECT/CTE만 허용한다. 파라미터 바인딩, 허용 테이블·함수, SQLite authorizer, `query_only`, worker 강제 timeout을 함께 사용한다. SELECT 시작 문자열 검사나 `PRAGMA query_only` 하나를 보안 경계로 삼지 않는다.
- ATTACH, 파일 읽기, 확장 로딩, write/DDL/PRAGMA, 다중 statement, 과도한 recursive CTE·결과 생성 등을 거부하는 검증을 추가한다. 실제 SQL 오류와 차단 원인을 모델에게 간결하게 반환한다.
- 초기 제한 후보: 한 번에 20행/12,000자, 실행 1–1.5초. 잘림 여부를 반환하고 본문 전체는 `read_pdf`로 읽게 한다. 무제한 query/all 호출로 메인 프로세스를 막지 않는다.
- **런타임 검증 결과:** 이 PC의 일반 Node **22.14.0**에는 FTS5가 없었다. Electron **43.7.8**의 내장 Node **24.21.0**/SQLite **3.53.4**에서는 FTS5와 `DatabaseSync.setAuthorizer`를 확인했다. `Node >=22`라는 조건만으로 새 SQL 기능을 보장하면 안 된다. capability 탐지와 지원되지 않는 실행 방식 안내가 필요하다.

### 3. MCP 도구 추가

| 예정 도구 | 입력 | 반환 |
| --- | --- | --- |
| `inspect_pdf` | `selectionId` | 고정된 문서 정보·페이지 수·스키마·검색 예시·제한 |
| `query_pdf` | `selectionId`, `sql`, `params?` | 제한된 rows·잘림 여부·근거 페이지 |
| `read_pdf` | `selectionId`, `pages` (최대 3개) | 원문 페이지 텍스트·페이지 번호·잘림 여부 |
| `render_pdf_page` | `selectionId`, `page`, `region?` | 실제 PNG 이미지 ContentBlock과 페이지·영역 metadata |

- 전체 PDF를 한 번에 prompt에 넣지 않는다. `inspect → query → read → render` 순서로 필요한 자료만 가져오도록 질문과 도구 설명을 작성한다.
- PDF 본문과 캡션은 신뢰하지 않는 자료로 처리하고 자료 안의 지시를 실행하지 않도록 한다. 실제 접근 제한은 서버에서 구현한다.
- 이미지 base64를 text JSON에만 넣으면 모델이 그림으로 읽는 것이 아니다. MCP 어댑터에서 `{type:'image', data:<base64>, mimeType:'image/png'}`로 반환한다. metadata만 structuredContent에 두고 base64를 중복하지 않는다. 실제 ChatGPT 호스트에서 시각 입력으로 수신되는지 별도 확인한다.
- MCP bridge의 현재 10초 timeout은 이미지 작업에 맞춰 검토한다. 렌더 자체의 제한 시간·취소와 별도로 무한 대기하지 않게 한다.
- 번들 재생성만으로 실행 중 터널의 stdio 프로세스나 ChatGPT의 도구 목록이 갱신되는 것은 아니다. 안전하게 터널/MCP 프로세스를 재시작하고 호스트에 새 도구가 실제 노출되는지 확인한다. 저장된 키는 launcher의 credential-store에서 복호화하여 자식 터널 환경에만 전달한다. 키를 출력하거나 로그에서 재사용하지 않는다.

### 4. 페이지 이미지 및 영역 crop

- MVP는 **페이지 이미지 fetch**를 우선 구현한다. 자동 Figure 경계 탐지와 별도 `fetch_figure`는 후속 기능으로 둔다.
- 전체 페이지의 최대 변을 약 2,000px로 제한하고, 선택적 `region:[x,y,width,height]`를 좌상단 기준 0–1 정규화 좌표로 정의한다. crop 전후 좌표와 회전 처리 규칙을 명확히 한다.
- 모델은 캡션·참조를 검색하고 전체 페이지를 본 뒤 필요한 Figure/panel 영역만 다시 요청할 수 있다. Figure와 관련 본문은 다른 페이지에 있을 수 있다.
- PDF bytes, 현재 뷰어 문서, 페이지 번호가 바뀌는 동안 이미지가 잘못 연결되지 않게 snapshot으로 렌더한다. 잘못된 페이지/영역과 너무 작은 crop을 거부한다.

### 5. UI·관찰 가능성

- 새로운 모드가 켜졌을 때 기존 수동 Auto 문맥 준비를 무조건 실행하지 않는다. 질문·선택 인용·문서 정보·선택 ID 중심으로 보낸다.
- 등록/색인 중·검색 중·본문 읽기·이미지 가져오기와 실패 상태를 보여준다. 모델이 읽은 페이지를 확인하고 클릭해 원문으로 이동할 수 있게 한다.
- 도구 호출 trace에는 선택 ID, 도구, 페이지, 제한/실행 결과를 남긴다. 인증·본문 전체·대화를 불필요하게 로그에 남기지 않는다.
- 질문/문서가 업로드 중 바뀌면 전송을 중단하고 재준비한다. 저장되는 질문 기록과 노트도 원래 질문 snapshot을 유지한다.

## 1806.07572v4.pdf 검증 계획과 실제 검색 예시

대상은 Jacot, Gabriel, Hongler의 **Neural Tangent Kernel: Convergence and Generalization in Neural Networks**, arXiv **1806.07572v4**, PDF **19페이지**다. 기존 PC 파일은 `C:\Users\jsh\Downloads\1806.07572v4.pdf`였다. 파일은 Git에 포함하지 않았다. 새 PC에서는 [동일 버전 PDF](https://arxiv.org/pdf/1806.07572v4)를 준비하고 페이지 수와 첫 페이지를 확인한다.

로컬 실험은 pypdf 본문 추출 + NFKC FTS5를 사용했다. 앱의 PDF.js 추출로 바꾸면 snippet과 순위가 달라질 수 있으므로 아래 순위 자체를 고정된 정답으로 삼지 않는다. 참고 SQL은 [ntk-context-query-examples.sql](ntk-context-query-examples.sql)에 보관했다. 이 SQL 파일은 실행 예시이며 앱/MCP 구현이 아니다.

| 검증 질문·검색어 | 로컬 실험의 검색 페이지 | 실제로 읽을 근거 |
| --- | --- | --- |
| `"Theorem 2"` | 15, 13, 14, 6 | p.6 진술, p.13 이후 증명 |
| `Lipschitz AND "second derivative"` | 13, 6, 2 | p.6/13 가정 |
| `ReLU` | 7 | 실험의 activation과 정리 가정을 구별 |
| `sequentially` | 11, 13, 12, 14 | 순차 너비 극한, 일반 최소 너비 극한으로 과장하지 않음 |
| `"early stopping"` | 7, 1, 9, 2 | p.6–7 최소제곱·고유값 설명 |
| `eigenvalues AND eigenspaces` | 7 | 고유공간별 수렴 속도 |
| `"Proposition 2"` | 18, 17, 19, 6 | p.6 명제, p.17–19 부록 |
| `"Theorem 3" OR "Lemma 2"` | 18, 19, 17 | positive definiteness 증명 의존성 |
| `무한 너비` | 없음 | 영어 원문에 맞는 검색어로 재검색 |
| `"minimum width" OR "minimal width"` | 없음 | 0건을 논문에 개념이 없다는 증거로 사용하지 않음 |

원문 전체 추출의 기존 토큰 추정치는 18,310이었다. p.6–7은 2,008, p.6/7/11/13은 3,946, p.6/17/18/19는 3,369였다. 이는 로컬 텍스트 추출과 tokenizer에 대한 참고 값이고, 도구 metadata·대화·이미지 비용을 포함한 실제 ChatGPT 사용량이 아니다.

### 종단 테스트 A: 가정과 실험 대조

질문: “Theorem 2는 어떤 activation과 너비 극한을 가정하는가? ReLU 실험이 정리의 가정을 그대로 만족한다고 봐도 되는가?”

기대 흐름: 모델이 스키마 확인 → Theorem 2/가정 검색 → p.6/13 읽기 → ReLU/순차 극한 검색 → p.7/11 읽기 → 근거 페이지를 붙여 답한다. p.6의 Lipschitz·두 번 미분 가능·유계 2차 미분 조건, 학습 방향 적분 조건 및 finite-T 범위를 확인하고 ReLU 실험과 혼동하지 않아야 한다.

### 종단 테스트 B: Figure 3(c) → Figure 1

질문: “Figure 3(c)에서 작은 네트워크가 더 빨리 수렴하는 것처럼 보이는 이유는 무엇인가? Figure 1과 연결해 곡선, 축, 범례를 실제 그림을 보고 설명해줘.”

모델이 스스로 다음 자료를 찾도록 한다. 테스트 실행 코드가 검색 결과나 도구 순서를 답변에 미리 주입해서 모델 검색을 흉내 내지 않는다.

1. `"Figure 3"`, `convergence`, `inflation` 등으로 본문·캡션을 검색한다.
2. p.9의 Figure 3와 설명, 필요하면 p.8의 §6.3 실험 설정을 읽는다.
3. `render_pdf_page(page:9)`로 Figure 3(a/b/c)를 실제로 읽는다. 필요하면 3(c) 영역을 crop해 다시 받는다.
4. Figure 1 참조를 따라 p.8 본문을 읽고 `render_pdf_page(page:8)`로 Figure 1을 실제 확인한다.
5. Figure 3(c)의 너비 100/1,000/10,000 및 무한 너비 곡선, Figure 1의 너비 500/10,000·학습 전후 NTK 비교를 확인한다. 작은 네트워크의 빠른 수렴을 NTK inflation과 연결하는 저자의 설명과 관찰을 구별한다. 시간/step과 learning rate를 혼동하지 않는다.
6. 이미지로 확인한 축·범례·곡선 정보와 본문 근거를 함께 제시한다. 캡션만 읽고 그림을 봤다고 주장하지 않는다.

Figure 위치 지도: **p.8 Figure 1·2, p.9 Figure 3(a/b/c)**. p.7은 실험 설정/§6 시작, p.8–9는 관련 본문이다.

성공 증거는 실제 ChatGPT 대화와 서버 trace 양쪽에 남겨야 한다. trace에 모델이 선택한 SQL, 읽은 페이지, 반환된 PNG의 페이지/영역/크기를 확인하고, 답변이 실제 이미지에 근거하는지 점검한다. 로컬 MCP client의 고정 SQL 호출 성공만으로 실제 모델/ChatGPT 이미지 왕복 완료라고 보고하지 않는다.

### 회귀·경계 검증

- 단일 statement/SELECT만 허용, write/ATTACH/PRAGMA/extension/파일 접근 차단, 파라미터와 결과 제한, 긴 recursive query timeout 및 후속 요청 복구.
- 스캔 PDF의 텍스트 0건 안내, 영어 원문에 대한 한글 literal 검색 0건에서 재검색, 합자 정규화.
- 다른 PDF를 열어도 기존 선택 ID는 원래 PDF만 읽기/렌더/저장. 공유 해제·만료 후 진행 중 결과도 반환하지 않기.
- 페이지 범위·crop·회전·동시 작업·등록 중 질문 변경 검증. 앱 종료 후 renderer/worker/tunnel 연결 잔류 여부 확인.
- 기존 직접 전송, 초안 보호, 생성 중 보호, 불확실 전송 재시도 방지, 같은 요청의 중복 전송 방지, 노트 저장의 idempotency와 로그인 유지 회귀 검증.

## 현재 검증 기록과 인수인계 범위

- 인수인계 직전 `npm test`: **71개 통과, 실패 0, skip 0**. Markdown/MCP 번들 재생성을 포함한다.
- 이전 0.9.6 세션에서 실제 로그인된 내장 ChatGPT에 여러 줄 한글/영어 질문을 보내고 실제 답변을 확인했다. 한국어 전송 버튼, preload IPC, 전송 확인과 중복 방지도 확인했다. 이 기록은 **기존 웹 전송 기능**의 검증이며 새 SQL/이미지 MCP 기능의 검증이 아니다.
- 기존 0.9.6 EXE와 소스 CSS/UI/웹 전송 모듈의 패키지 일치를 확인했다. 이번 인수인계는 추가 EXE 빌드 없이 현재 소스와 계획을 커밋한다.
- 로컬 0.9.6 portable EXE SHA-256: `94B97E1905A120C579E91F7BBC42617CF80110C0656CDBD045CCAE0D2CB55F7B`. 바이너리는 소스 Git에 포함하지 않는다. 새 PC에서는 위 명령으로 재빌드한다.
- 기존 작업 디렉터리 바깥의 임시 SQLite DB, 본문 추출 JSON, 사용자 세션을 사용하는 일회성 라이브 테스트 스크립트, 스크린샷·로그·EXE는 Git에 포함하지 않는다. SQL 예시와 외부 테마만 재사용 가능한 형태로 보관했다.

다음 개발은 snapshot/SQL isolation부터 시작하고, MCP 도구 → 이미지 → UI → **실제 ChatGPT 종단 테스트** → EXE 빌드 순서로 진행한다. MVP 완료 전 README에 전체 PDF 검색이나 Figure 자동 읽기를 현재 기능으로 표기하지 않는다.

## 2026-10-13 NTK 실제 문맥 검색 평가

위 계획 이후 snapshot/SQL/MCP 이미지 MVP를 구현하고, 실행 중인 0.10.0 portable 앱에 공유한 `1806.07572v4.pdf`로 평가했다. SHA-256은 `e052eb972f646747ac4554a294eb62874077e59a5f585f459e2dbd5cb2a0975d`, 19페이지다.

- Codex가 질문별 검색어를 선택하고 결과에 따라 재검색했다. **17가지 질문, SQL 28회, 본문 읽기 7회, PNG 확인 5회**. 기존 개발 예시를 참고했으므로 blind benchmark가 아니다. 별도의 ChatGPT 웹 모델이 수행한 종단 평가와 구별한다.
- 첫 검색의 상위 5개 안에 관련 본문 페이지가 있었던 질문은 **11/17**이다. 나머지는 0건 4개, 참고문헌만 1개, FTS 구문 오류 1개다. 이 수치는 답변 정확도가 아니다. 본문/인접 페이지와 이미지를 읽어 가정, 반례성 질문, 증명, 실험을 대조했다.
- 특히 ReLU 실험을 Theorem 2의 매끄러움 가정 충족으로 오인하지 않고, 순차 폭 극한과 동시 극한을 구별했다. Figure 2의 함수 분포를 오차 그래프로 오인하지 않았으며, 폭 100의 정확성 보장이나 CNN/Transformer에 대한 증명을 근거 없이 주장하지 않았다.
- 발견한 오류: PDF.js의 `Gr¨ onwall` 추출 때문에 `Gronwall`이 참고문헌 p.10만 찾았다. **검색 색인만** 분리된 diaeresis를 정규화하도록 수정했다. 실행 앱에서 읽은 19페이지를 수정 소스에 재색인하여 p.14/17 증명도 검색되는 것을 확인했고 raw_text는 그대로 보존된다. 참고문헌이 여전히 첫 순위일 수 있으므로 순위를 정답으로 취급하면 안 된다.
- `non-polynomial`의 FTS 오류에 따옴표 복구 안내를 추가했다. MCP 검색 설명에 원문 언어/동의어 재검색, FTS 따옴표, 숫자 구두점 매칭, 참고문헌·본문 구별 및 인접 페이지 읽기를 명시했다.
- 전체 테스트 **80개 통과**. 이번 검색 보완은 소스와 개발 MCP 번들에 반영했다. 실행 중 portable EXE와 기존 배포 ZIP은 이 보완 이후 다시 빌드하지 않았다.
- 상세 질문, 최초/후속 검색, 근거 페이지, 판정, 41개 읽기 전용 재생 요청은 [ntk-retrieval-evaluation.json](ntk-retrieval-evaluation.json)에 있다. NTK PDF 전체 공유가 켜진 앱에서 `node scripts/ntk-query-eval.mjs docs/ntk-retrieval-evaluation.json ../outputs/ntk-eval-replay.json`으로 재생할 수 있다. 고정 요청 재생은 모델의 자율 검색 품질을 다시 측정하는 것이 아니다.

남은 검증은 실제 ChatGPT 호스트의 새 도구 목록 갱신 후 동일 질문을 독립적으로 수행하는 것이다. 한국어·동의어 처리는 모델의 재검색에 의존하며, 현재 검색은 페이지 단위 lexical FTS5다. 숫자는 원문으로, 그림·수식은 PNG로 검증해야 한다.

## 2026-10-13 인증 저장 및 EXE 재빌드

- 사용자는 키/로그인을 매번 다시 입력하지 않도록 저장하고 재연결 정보를 기록하도록 명시적으로 요청했다. 같은 PC에서 저장소를 먼저 확인하고, 이미 저장된 키를 다시 요구하지 않는다.
- Link launcher는 터널 ID와 실행 키를 `%LOCALAPPDATA%\PaperReaderLink\credentials.json`에 저장한다. 키는 Windows DPAPI `CurrentUser`로 암호화한다. 암호화/복호화 데이터는 private stdin/stdout pipe로만 전달하며 키를 명령 인자나 로그에 넣지 않는다. 저장은 임시 파일 작성 후 교체한다.
- `Start-Link.cmd`는 저장된 인증을 자동 사용한다. 기존 프로필의 터널 ID도 복구한다. `--reset-key`는 숨김 입력으로 키를 교체하고, `--forget-key`는 암호화 저장 파일만 제거한다. Platform의 키 자체를 폐기하지는 않는다. 다른 Windows 계정/PC에서는 새로 입력한다.
- 현재 사용자가 입력한 실제 터널 키의 암호화 저장을 완료했고, 실행 중 터널을 종료한 뒤 새 launcher가 추가 입력 없이 연결되는 것을 확인했다. 기존 ChatGPT 로그인 프로필은 유지한다. 개인 터널 ID와 실행 경로는 Git 제외 `.local/LOCAL-HANDOFF.md`에 기록했다. 키 원문은 어느 문서에도 기록하지 않는다.
- `npm test`: **81개 통과**, 실패/skip 0. 실제 Windows DPAPI로 더미 키 저장·복호화·교체·손상·삭제를 검증한다.
- 새 portable EXE SHA-256: `C7E802DDBC7197CD3D9CF1FF797CCAEA12480A18A3C73E70464719D8F3EDB1F7`. 패키지 내부 SQL worker/snapshot 모듈과 소스 일치 확인. NTK를 다시 열고 `Gronwall` 검색이 p.10/17/14를 반환하는 것을 확인했다.
- ChatGPT 웹의 기존 플러그인 도구 갱신과 실제 모델 검증도 완료했다. 아래 기록을 참고한다.

## 2026-10-13 실제 ChatGPT 웹 종단 검증 완료

- 로그인된 ChatGPT **일반 Chat**에서 Paper Reader Link를 명시적으로 선택하고, 새 EXE가 공유한 NTK 고정본으로 세 질문을 실행했다. 별도 Codex 인앱 브라우저를 사용했으며 EXE 내장 패널의 직접 전송 자체를 이번에 재검증한 것은 아니다.
- 호스트의 도구 새로 고침이 처음에는 실패했다. 이미지 `region` 스키마를 tuple의 `items: [...]` 대신 길이 4의 동질 숫자 배열로 수정하고 터널 재시작 및 관리 화면 새로고침 후 **Write 1 / Read 6**을 확인했다. 이 순서를 재현했지만 호스트의 상세 실패 원인은 제공되지 않아 단일 원인으로 확정하지 않는다.
- 실제 모델이 **inspect 1회, SQL 검색 8회, 본문 읽기 4회, PNG 반환 6회 = 19회** 호출했고 앱 trace에서 모두 complete였다. 로컬 사전 확인 호출은 집계에서 제외했다. UI에는 도구 상태와 근거 페이지가 표시됐다.
- Theorem 2: p.6/13의 가정, p.7 ReLU, p.13/14의 순차 너비 극한을 대조했다. p.6/7/13/14 PNG도 읽었다. ReLU 미분 가능성 가정의 불충족, finite-T 범위, 실험과 정리의 차이를 구별했다.
- Figure 3(c) → Figure 1: p.8/9를 검색하고 읽은 뒤 두 페이지 PNG를 확인했다. 폭·축·범례, NTK inflation 설명을 올바르게 연결했다. 가능한 설명을 확정된 인과관계로 표현하지 않았고 learning rate 비교의 한계도 언급했다.
- Gronwall/유한 너비: 검색이 p.10/14/17을 반환했고 모델은 p.14/16/17 본문을 읽었다. 참고문헌만으로 결론 내리지 않았으며, 폭 100에서 NTK가 정확히 불변이라는 잘못된 전제를 거부했다.
- 테스트는 `allowSave:false`로 수행해 노트를 생성하지 않았다. 세 질문은 같은 대화에서 순차 진행하여 후속 질문은 앞선 문맥을 재사용했다. 세 사례의 성공은 일반적인 정확도 보장이 아니다.
- 재사용 가능한 집계는 [ntk-chatgpt-web-evaluation.json](ntk-chatgpt-web-evaluation.json). 사용자 대화 URL·화면·본문·trace는 Git 바깥 `outputs/chatgpt-ntk-*`에 보관한다. trace는 도구명·상태·페이지·시각을 보관하며 SQL 원문이나 이미지 바이트는 포함하지 않는다.
