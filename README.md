# Agentic PDF Reader

PDF.js 기반 Windows PDF 리더입니다. PDF와 대화를 한 화면에서 보고, 선택한 문장과 필요한 문맥을 이용해 질문할 수 있습니다.

## 기능

- PDF 문장 선택 후 질문, 이전 대화 포함 범위 선택
- PDF 옆 별도 패널의 형광펜 및 마크다운 주석, 문서별 자동 저장
- 수동 문맥 범위 및 Auto 문맥 선택, 입력 토큰 추정치 표시
- 대화 자동 저장, 새 대화 시작 및 명시적 삭제
- ChatGPT 웹에 질문 복사 또는 로그인 후 앱에서 직접 요청
- 계정 사용량 조회 및 외부 CSS 테마 지원

앱 내 요청은 계정에 제공된 Codex / ChatGPT Work 공유 사용량 또는 허용된 추가 크레딧을 사용할 수 있습니다. 일반 ChatGPT 대화 전용 한도로 처리된다고 보장하지 않습니다. Auto의 문맥 선택 요청은 답변 요청과 별도입니다.

## 개발 실행

Node.js 22 이상이 필요합니다.

```powershell
npm ci
npm start
```

브라우저에서 http://127.0.0.1:8767 을 엽니다. 데스크톱 창은 `npm run desktop`으로 실행합니다.

```powershell
npm test
npm run build
```

Windows x64 portable EXE를 빌드합니다. 현재 빌드 출력 경로는 `electron-builder.json`의 `directories.output`에 지정된 `../../work/electron-build`입니다. EXE 배포 파일은 소스 Git 저장소에 포함하지 않습니다.

## 데이터와 설정

개발 실행 데이터는 `.local/`, EXE 실행 데이터는 `%APPDATA%\Paper Reader`에 저장합니다. 로그인 토큰은 서버 메모리에 보관합니다. `.local/`의 등록 정보, 설정, 대화와 주석 기록을 저장소에 커밋하지 마세요.

기본 테마는 `app.css`, 기능별 스타일은 `ui.css`입니다. EXE 옆의 `Paper-Reader.css`로 테마를 덮어쓸 수 있습니다.

자세한 사용법과 제한 사항은 [README.txt](README.txt)를 참고하세요.

## 포함된 구성 요소

PDF.js 6.4.299 배포본을 `pdfjs/`에 포함합니다. 해당 구성 요소의 라이선스는 [pdfjs/LICENSE](pdfjs/LICENSE)에 있습니다.
