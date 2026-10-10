const guides=[
  ['#auto-refine','Auto 에이전트 문맥 선택','PDF 전체는 로컬에서 검색하고 최대 12개 후보 페이지의 짧은 발췌만 문맥 선택 모델에 전달합니다. 모델이 그중 필요한 페이지를 고르면 로컬에서 4천/8천/1만6천 입력 토큰 예산에 맞춥니다. 질문과 기존 대화도 답변 입력 예산에 포함됩니다. 문맥 선택용 AI 입력은 별도이며 화면에서 합계 추정치를 확인할 수 있습니다.\n입력 중에는 모델 요청이 없습니다. 번역·간단한 문장 설명은 로컬 Auto를 사용하고, 복합 질문은 전송 시 선택용 모델 요청 1회가 추가됩니다. 이 버튼으로 먼저 에이전트 선택을 확인하면 같은 준비 내용에 대해 다시 호출하지 않습니다.\n선택 결과는 추정이며 관련 근거를 빠뜨릴 수 있습니다. 필요하면 PDF 범위를 수동으로 바꾸세요. 예산 때문에 잘린 페이지는 표시합니다. 웹 모드에서는 로컬 검색만 사용합니다.'],
  ['#token-estimate','입력 토큰 수 안내','PDF 범위·이전 질문과 답변·현재 질문·앱의 고정 지시문을 o200k_base 토크나이저로 이 PC에서 계산한 추정치입니다. 계정의 실제 모델 인코딩과 메시지 포맷은 다를 수 있습니다. 모델별 최대 문맥 한도나 크레딧 차감액을 나타내지 않습니다.\n응답에 실제 input_tokens가 제공되면 답변 아래에 표시하고 대화와 함께 저장합니다. 캐시된 입력 토큰은 전체 입력 토큰에 포함된 수치입니다. 미제공 값은 0으로 표시하지 않습니다. 웹 모드는 복사할 텍스트만 추정하며 웹 대화 자체의 기존 문맥은 알 수 없습니다.'],
  ['label[for="pdf-window"]','PDF 문맥 범위 안내','선택 문장만 / 선택 페이지 / 앞뒤 1페이지 / 앞뒤 2페이지 / 전체 문서를 고를 수 있습니다. 여러 페이지에 걸쳐 선택하면 선택 범위 전체를 기준으로 앞뒤 페이지를 더합니다.\n선택 문장이 없으면 현재 읽는 페이지를 기준으로 준비합니다. 기본값은 앞뒤 1페이지입니다. 전체 문서는 매 질문에 전체 본문을 전달하므로 입력량이 커집니다.'],
  ['label[for="history-window"]','이전 대화 범위 안내','현재 대화의 완료된 질문과 답변 중 최근 3 / 6 / 12회 또는 전체를 포함합니다. 0회로 설정해도 저장 기록은 삭제되지 않습니다. 과거 질문에 붙였던 PDF 본문은 다시 쌓지 않습니다.\n가져오지 않은 웹 ChatGPT 답변, 연결 테스트, 중단된 답변은 문맥에서 제외됩니다. 포함한 과거 대화도 요청 입력량에 더해집니다.'],
  ['#new-chat','새 대화와 문맥 비우기','진행 중인 응답을 중지하고 빈 대화를 시작합니다. 기존 기록은 이 PC에 보관되며 저장된 대화에서 다시 열 수 있습니다. PDF를 다시 열면 같은 문서의 최근 대화를 복원합니다.'],
  ['#delete-chat','저장된 대화 삭제','현재 대화와 질문·답변을 PC의 저장소에서 삭제합니다. 복구 기능은 없습니다. 다른 대화와 PDF 원본은 유지합니다. ChatGPT 웹의 대화나 이미 발생한 사용량은 삭제하거나 되돌리지 않습니다.'],
  ['#settings-open','환경 설정 사용 방법','질문을 보내는 방식을 고르고 저장하세요.\n• 앱에서 직접 요청 (보조): 로그인과 모델 선택 후 앱에서 답변받습니다.\n• ChatGPT (기본): Link로 질문을 준비하고 ChatGPT에서 전송합니다. 답변은 원문 노트에 저장할 수 있습니다. 복사 후 붙여넣기도 지원합니다.\n설정은 다음 실행에도 유지됩니다. 응답 중에는 완료하거나 중지한 뒤 변경하세요.'],
  ['#open','PDF 열기 사용 방법','PDF 파일을 선택하거나 창에 끌어다 놓으세요.\n본문에서 문장을 드래그해 선택하면 아래 읽기 도구에서 설명·번역·수식 풀이, 형광펜, 노트를 추가할 수 있습니다. 선택 없이 현재 페이지로 질문할 수도 있습니다. 주석과 색상은 오른쪽 목록에서 수정·삭제합니다. PDF를 다시 열면 복원됩니다.\nPDF 처리는 로컬에서 이루어집니다. 스캔 이미지의 글자는 OCR 없이는 선택하거나 추출할 수 없습니다.'],
  ['#mode-title','질문 모드와 사용량 안내','두 모드는 전송 방식을 바꿉니다. 과금 항목을 지정하는 설정은 아닙니다.\n앱에서 직접 요청은 공식 안내상 Codex / ChatGPT Work 공유 사용량을 사용합니다. 구매 크레딧이 매번 차감된다는 뜻은 아닙니다.\n개별 요청의 실제 차감 내역은 아직 확인하지 못합니다. 웹 모드는 ChatGPT에서 선택한 기능과 플랜의 한도가 적용됩니다.'],
  ['#usage-heading','남은 사용량과 크레딧 안내','사용량 연결 / 새로고침을 누르면 이 PC에 로그인된 Codex 계정으로 읽기 전용 조회를 합니다. Codex 설치와 ChatGPT 로그인이 필요합니다. PDF 앱의 로그인 토큰을 복사하거나 AI 질문을 보내지 않습니다.\n표시된 조회 계정이 원하는 계정인지 확인하세요. 남은 구독 한도(%)와 추가 크레딧 잔액은 다른 항목입니다. 잔액 미제공은 0이라는 뜻이 아닙니다.\n다른 앱 사용량도 포함되는 계정 수치이며, PDF 질문 하나의 실제 차감 내역은 아닙니다. 값이 오래됐으면 새로고침하세요.'],
  ['#account-state','ChatGPT 계정 연결 안내','Continue with ChatGPT → 기본 브라우저에서 로그인 및 플랜 사용 승인 → 앱으로 돌아오세요.\n다른 계정은 계정 목록의 새 등록을 선택해 연결합니다. 로그인 토큰은 실행 중에만 유지되므로 재실행하면 다시 로그인해야 합니다.\n연결 확인 버튼은 상태를 갱신합니다. 짧은 연결 테스트는 실제 AI 요청입니다.'],
  ['label[for="question"]','질문 작성과 명령어 예시','선택 문장은 질문과 함께 포함됩니다. 질문 보내기를 누르면 선택한 문맥을 준비하고 전송합니다. Ctrl+Enter로도 보낼 수 있습니다.\n예시: “선택한 문장을 한국어로 번역하고, 이 주장을 뒷받침하는 근거와 페이지를 설명해 주세요.”\n답변은 한국어와 근거 페이지를 요청하며, 논문 본문 안의 지시는 따르지 않도록 구성합니다.'],
  ['#prepare','문맥과 질문 준비 안내','선택한 PDF 범위 + 선택 문장 + 이전 대화 + 현재 질문을 하나로 묶습니다. PDF 본문은 이번 요청에 한 번만 넣습니다. 이 단계는 외부 전송이나 AI 사용량을 발생시키지 않습니다.\n질문에 들어갈 내용 보기에서 내용을 확인하세요. 긴 문서는 입력 한도를 넘을 수 있고, 표·수식·이미지의 내용은 빠질 수 있습니다.'],
  ['label[for="model"]','응답 모델 선택 안내','계정에 제공되는 모델 중에서 선택합니다. 모델에 따라 응답 속도와 사용량이 달라질 수 있습니다.\n목록이 비어 있으면 계정 연결을 확인한 뒤 모델 새로고침을 누르세요. 모델 목록 조회만으로 답변 요청을 보내지는 않습니다.'],
  ['#send','앱에서 질문 전송 안내','선택한 문맥과 이전 대화를 자동으로 준비해 OpenAI로 보내고 앱 안에 답변을 표시합니다. 미리 확인하려면 전송 내용 미리보기를 여세요.\n공식 안내상 공유 구독 사용량을 쓰며, 한도 이후 계정에서 허용한 크레딧을 사용할 수 있습니다.\n응답 중지는 이후 처리를 중단하도록 요청합니다. 이미 처리된 사용량이 되돌아간다고 보장하지 않습니다.'],
  ['#connection-test','연결 테스트 명령어','논문을 보내지 않고 다음 문장만 요청합니다.\n“한국어로 \'연결 확인 완료\'라고만 답하세요.”\n실제 모델 요청이므로 사용량이 발생할 수 있습니다. 로그인 상태만 보려면 연결 확인을 누르세요.'],
  ['#open-chatgpt','ChatGPT에서 직접 질문하는 방법','준비된 질문을 클립보드에 복사하고 기본 브라우저에서 ChatGPT를 엽니다.\nChatGPT 입력란에 Ctrl+V → 내용 확인 → 직접 전송하세요. 앱이 자동으로 붙여넣거나 전송하지 않습니다.\n자동 복사가 제한되면 미리보기에서 Ctrl+C로 복사하세요. 본문이 너무 길면 PDF를 ChatGPT에 첨부하고 선택 문장과 질문만 보내세요.']
];
document.querySelectorAll('[data-question]').forEach((button,index)=>{
  button.id=`question-preset-${index}`;
  guides.push([`#${button.id}`,`${button.textContent} 명령어`,`이 버튼은 질문 입력란을 아래 내용으로 바꿉니다. 자동 전송하지 않습니다.\n“${button.dataset.question}”\n질문을 바꾼 뒤 질문 보내기를 누르세요. 자동으로 새 문맥을 준비합니다.`]);
});

let active=null,closeTimer;
function hideHelp() {
  clearTimeout(closeTimer);
  if(!active) return;
  const {button,tip}=active;active=null;
  if(tip.matches(':popover-open')) tip.hidePopover();
  button.setAttribute('aria-expanded','false');
}
function positionHelp() {
  if(!active) return;
  const {button,tip}=active,anchor=button.getBoundingClientRect();
  const bounds=tip.getBoundingClientRect(),gap=8;
  const left=Math.max(gap,Math.min(anchor.right-bounds.width,innerWidth-bounds.width-gap));
  const top=anchor.bottom+gap+bounds.height<=innerHeight-gap ? anchor.bottom+gap : Math.max(gap,anchor.top-bounds.height-gap);
  tip.style.left=`${left}px`;tip.style.top=`${top}px`;
}
function showHelp(button,tip) {
  clearTimeout(closeTimer);
  if(active?.button===button) return;
  hideHelp();active={button,tip};tip.showPopover();
  button.setAttribute('aria-expanded','true');positionHelp();
}
function scheduleClose() {clearTimeout(closeTimer);closeTimer=setTimeout(hideHelp,180);}

guides.forEach(([selector,title,content],index)=>{
  const target=document.querySelector(selector);
  if(!target) return;
  const wrap=document.createElement('span');wrap.className='control-with-help';
  if(target.classList.contains('wide')) wrap.classList.add('wide-help');
  const button=document.createElement('button');button.type='button';button.className='info-button';
  button.textContent='ⓘ';button.setAttribute('aria-label',title);button.setAttribute('aria-expanded','false');
  const tip=document.createElement('span');tip.id=`help-${index}`;tip.className='info-tooltip';
  tip.setAttribute('role','tooltip');tip.setAttribute('popover','manual');
  button.setAttribute('aria-describedby',tip.id);button.setAttribute('aria-controls',tip.id);
  const heading=document.createElement('strong');heading.textContent=title;
  const body=document.createElement('span');body.textContent=content;
  tip.append(heading,body);target.replaceWith(wrap);wrap.append(target,button,tip);
  button.addEventListener('pointerenter',()=>showHelp(button,tip));
  button.addEventListener('focus',()=>showHelp(button,tip));
  button.addEventListener('click',()=>showHelp(button,tip));
  wrap.addEventListener('pointerleave',()=>{if(document.activeElement!==button)scheduleClose();});
  button.addEventListener('blur',scheduleClose);
  tip.addEventListener('pointerenter',()=>clearTimeout(closeTimer));
  tip.addEventListener('pointerleave',()=>{if(document.activeElement!==button)scheduleClose();});
});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && active){hideHelp();event.preventDefault();event.stopPropagation();}},true);
document.addEventListener('pointerdown',event=>{if(active && !active.button.contains(event.target) && !active.tip.contains(event.target))hideHelp();});
document.addEventListener('scroll',hideHelp,true);
window.addEventListener('resize',hideHelp);
document.getElementById('settings-open').addEventListener('click',hideHelp);
