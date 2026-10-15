# Agentic PDF Reader 0.11.2 설치와 인증

## 설치

Windows x64용 `Agentic-PDF-Reader-0.11.2-install.exe`는 Electron 런타임, PDF.js, Markdown/KaTeX, MCP SDK와 공식 OpenAI tunnel-client를 함께 설치한다. 최종 사용자에게 Node.js나 Git 설치를 요구하지 않는다. 사용자 계정 범위의 설치이므로 관리자 권한을 요구하지 않으며 설치 위치를 선택할 수 있다.

설치 중 **지금 인증 설정 / 나중에 설정**을 선택한다. 기본값은 나중에 설정이다. 지금 인증 설정은 설치 완료 후 앱의 연결 화면을 열고, 나중에 설정은 곧바로 PDF 읽기 화면을 연다. 설치 프로그램은 비밀번호나 키를 받지 않는다. 완료 화면의 앱 실행을 해제하면 선택은 다음 실행에 적용된다.

나중에 설정을 선택해도 PDF 열기, 읽기 상태 복원, 하이라이트와 논문 노트를 사용할 수 있다. 상단 환경 설정에서 **인증·Link 설정 열기**을 다시 연다. 연결 화면의 나중에 설정 또는 읽기 시작 버튼으로 언제든 읽기로 돌아갈 수 있다.

## 입력란 옆의 설정 방법

Tunnel ID 옆의 **터널 만들기 · ID 찾는 방법**, Runtime API key 옆의 **키 발급 · 권한 설정 방법**으로 해당 단계의 설명을 연다. 플러그인 연결 방법도 같은 안내에 포함한다. 입력 중인 값은 유지되며 설명 닫기나 Esc로 돌아간다. 안내 안에는 터널·API 키 관리·플러그인 페이지와 공식 문서 링크가 있다.

## 두 가지 연결

1. **ChatGPT 웹 로그인:** 연결 화면에서 로그인 화면 열기를 누르고 오른쪽 ChatGPT에서 사용자가 로그인한다. 기존 앱 전용 웹 세션을 재사용한다. 기본 브라우저나 Codex 로그인에서 계정을 자동으로 가져오지 않는다.
2. **Paper Reader Link:** 논문 검색과 페이지 이미지 및 답변 노트 저장을 위한 Secure MCP Tunnel이다. 기존 Tunnel ID와 Tunnels Read + Use 권한의 실행 키를 앱의 마스킹된 입력란에 입력하고 저장·시작한다. ChatGPT 플러그인/작업 공간을 같은 터널에 연결해야 한다. 프로세스 실행 표시만으로 모델 도구 연결이 완료됐다고 판단하지 않는다.

키 저장은 Windows DPAPI CurrentUser를 사용한다. 키는 앱 화면에 다시 표시하지 않고 명령 인자·로그에도 기록하지 않는다. 같은 계정에서 저장된 키를 재사용하며 다른 PC에서는 새로 설정한다. 별도 Link 실행기가 이미 있으면 기존 연결을 사용하고 인증 설정을 덮어쓰거나 다른 프로세스를 종료하지 않는다. 앱이 시작한 터널만 앱 종료 시 종료한다.

## 데이터 위치와 업데이트

- 앱 프로필: `%APPDATA%\Paper Reader` — 웹 로그인, 읽던 위치, 질문 기록과 노트.
- Link 키: `%LOCALAPPDATA%\PaperReaderLink\credentials.json` — Windows 계정에 묶인 암호문.
- 설치 선택: 설치 폴더 `resources/installation-choice.ini` — now/later와 설치 버전만 저장.
- 설정 완료/유예: 앱 프로필 `onboarding.json`.

앱 ID와 프로필 위치를 유지하므로 기존 portable 버전의 사용자 데이터를 재사용한다. 설치/업데이트/제거는 사용자 프로필을 삭제하지 않는다. 서비스가 로그인 세션을 만료하면 다시 로그인해야 한다. 기존 앱이 실행 중이면 업데이트를 위해 먼저 닫는다.

## 개발 빌드와 검증

```powershell
npm ci
npm test
npm run build:installer
```

산출물은 `release/installer/Agentic-PDF-Reader-<version>-install.exe`이다. `build/tunnel-client.json`에서 공식 버전과 압축 파일·실행 파일·라이선스의 SHA-256을 고정한다. `scripts/prepare-desktop-runtime.mjs`는 검증된 자원만 `build/link-payload`에 준비한다. 개인 프로필이나 키를 가져오지 않는다.

NSIS 선택 경로를 자동 검증할 때는 `/S /AUTH=later /D=<소유한 테스트 설치 경로>` 또는 `/AUTH=now`를 사용한다. `/D`는 마지막 인자다. 앱 검증에는 `--user-data-dir=<분리된 테스트 프로필>`을 사용하여 실제 로그인과 노트를 보호한다. 이 옵션은 Link 키와 로컬 MCP 연결도 테스트 프로필로 격리한다.

질문 기록·논문 노트·입력 미리보기는 같은 Markdown/KaTeX 렌더러를 사용한다. `$...$`, `$$...$$`, `\(...\)`, `\[...\]` 수식을 지원한다. 과거 저장된 `(e^{-lambda_i t})`처럼 명확한 수식은 화면에서만 복구해 렌더링하며 저장 원문과 Markdown 내보내기는 바꾸지 않는다. 일반 괄호 문장과 코드 블록은 변환하지 않는다. 새 Link 답변에는 올바른 수식 구분자와 역슬래시를 보존하도록 요청한다.
