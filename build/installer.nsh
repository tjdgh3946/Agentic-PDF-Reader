!include "MUI2.nsh"
!include "nsDialogs.nsh"
!ifndef BUILD_UNINSTALLER
Var PaperAuthMode
Var PaperAuthNow
Var PaperAuthLater

!macro customInit
  StrCpy $PaperAuthMode "later"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/AUTH=" $R1
  ${IfNot} ${Errors}
    ${If} $R1 == "now"
      StrCpy $PaperAuthMode "now"
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom PaperAuthenticationPage PaperAuthenticationLeave
!macroend
Function PaperAuthenticationPage
  !insertmacro MUI_HEADER_TEXT "인증 설정" "지금 연결하거나 설치 후 환경 설정에서 연결할 수 있습니다."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 28u "PDF 읽기와 노트는 계정 없이 바로 사용할 수 있습니다. ChatGPT 로그인과 논문 검색용 Link 연결은 필요할 때 설정하세요."
  Pop $0
  ${NSD_CreateRadioButton} 8u 40u 94% 16u "지금 인증 설정 — 설치 후 계정 연결 화면 열기"
  Pop $PaperAuthNow
  ${NSD_CreateRadioButton} 8u 76u 94% 16u "나중에 설정 — 설치를 마치고 바로 읽기"
  Pop $PaperAuthLater
  ${If} $PaperAuthMode == "now"
    ${NSD_Check} $PaperAuthNow
  ${Else}
    ${NSD_Check} $PaperAuthLater
  ${EndIf}
  ${NSD_CreateLabel} 8u 108u 94% 28u "키와 비밀번호는 설치 프로그램에 입력하지 않습니다. 설치된 앱의 안전한 입력란 또는 ChatGPT 로그인 화면에서 설정합니다."
  Pop $0
  nsDialogs::Show
FunctionEnd
Function PaperAuthenticationLeave
  ${NSD_GetState} $PaperAuthNow $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $PaperAuthMode "now"
  ${Else}
    StrCpy $PaperAuthMode "later"
  ${EndIf}
FunctionEnd
!macro customInstall
  WriteINIStr "$INSTDIR\resources\installation-choice.ini" "authentication" "mode" "$PaperAuthMode"
  WriteINIStr "$INSTDIR\resources\installation-choice.ini" "authentication" "version" "${VERSION}"
!macroend
!macro customFinishPage
  Function PaperStartInstalledApp
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" "--setup=$PaperAuthMode"
  FunctionEnd
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "PaperStartInstalledApp"
  !insertmacro MUI_PAGE_FINISH
!macroend
!endif
