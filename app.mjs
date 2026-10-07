import {retrieveCandidates} from './auto-context.mjs';
import {renderMarkdown} from './markdown.bundle.mjs';
import {pageWindow,historyFor,buildPrompt} from './context.mjs';
import {createAnnotationUI} from './annotation-ui.mjs';
import {createWebPanelUI} from './web-panel-ui.mjs';
const $ = id => document.getElementById(id);
const frame = $('viewer');
const annotationUI=createAnnotationUI({frame,api,getViewer:()=>viewer});
let viewer, selected = '', selectedPage = '', docGeneration = 0, textCache = new Map(), busy = false, fileName = '';
let authState = null, answerController = null, pollTimer = null, pollingUntil = 0, modelAccount = null;
let requestMode = null, savingSettings = false, openingChatGPT = false;
let usageState=null,loadingUsage=false;
let selectedEndPage='',promptRevision=0,prepared=null,pdfWindow='near1',historyTurns=3;
let chat=null,chatList=[],chatRevision=0,chatBusy=false,documentId='',tokenTimer,autoController=null,autoBudget=8000,answerRenderTimer=null;
const status = message => { $('status').textContent = message; };
const webPanelUI=createWebPanelUI({status});
const writeClipboard=text=>window.paperDesktop?.writeClipboard ? window.paperDesktop.writeClipboard(text) : navigator.clipboard.writeText(text);
function invalidatePrompt(schedule=true) {
  $('selection-hint').textContent=selected ? selected.slice(0,90) : 'PDF에서 문장을 선택하세요';
  autoController?.abort();promptRevision++;prepared=null;clearTimeout(tokenTimer);$('prompt').value='';$('copy').disabled=true;
  $('token-estimate').textContent=selected || pdfWindow==='auto'?'입력 토큰 · 질문을 입력하면 자동 계산합니다.':'입력 토큰 · 문장을 선택하면 계산합니다.';
  updateSend();
  $('auto-report').textContent='';
  if(schedule && (selected || (pdfWindow==='auto' && viewer?.pdfDocument)) && $('question').value.trim() && !answerController){
    const revision=promptRevision;
    const calculate=()=>{if(revision!==promptRevision)return;if(busy || autoController || savingSettings || chatBusy){tokenTimer=setTimeout(calculate,250);return;}$('prepare').onclick(true);};
    tokenTimer=setTimeout(calculate,450);
  }
}
function resetDocument() {
  annotationUI.reset();
  detachChat();documentId='';
  docGeneration++; textCache = new Map(); selected = ''; selectedPage = ''; selectedEndPage=''; busy = false;
  $('selection').textContent = 'PDF에서 문장을 선택하고 우클릭하세요.';
  $('page').textContent = ''; $('prepare').disabled = true;
  $('context').hidden = true; invalidatePrompt();
}
function documentReady() {
  resetDocument();
  fileName = viewer._docFilename || fileName || 'PDF 문서';
  $('document').textContent = `${fileName} · ${viewer.pdfDocument.numPages}페이지`;
  documentId=viewer.pdfDocument.fingerprints[0];
  annotationUI.ready(documentId);
  restoreDocumentChat();
  $('empty').hidden = true;
  status('문장을 선택하고 우클릭하거나, 오른쪽 질문 유형을 누르세요.');
}
let initializedViewerDocument;
async function initializeViewer() {
  const doc=frame.contentDocument,application=frame.contentWindow?.PDFViewerApplication;
  if(!application || initializedViewerDocument===doc)return;
  initializedViewerDocument=doc;
  try {
    viewer = application;
    await viewer.initializedPromise;
    if(frame.contentDocument!==doc)return;
    annotationUI.frameLoaded();
    viewer.eventBus.on('documentloaded', documentReady);
    viewer.eventBus.on('pagerendered',()=>annotationUI.redraw());
    viewer.eventBus.on('textlayerrendered',()=>annotationUI.redraw());
    viewer.eventBus.on('rotationchanging',()=>setTimeout(()=>annotationUI.redraw(),100));
    if (viewer.pdfDocument) documentReady();
    doc.addEventListener('contextmenu', event => {
      if (!captureSelection()) return;
      event.preventDefault();
      const bounds = frame.getBoundingClientRect();
      $('context').hidden = false;
      $('context').style.left = `${Math.max(0, Math.min(bounds.left + event.clientX, window.innerWidth - 230))}px`;
      $('context').style.top = `${Math.max(0, Math.min(bounds.top + event.clientY, window.innerHeight - 135))}px`;
    });
    doc.addEventListener('mouseup', captureSelection);
    doc.addEventListener('keyup', captureSelection);
    doc.addEventListener('pointerdown', () => { $('context').hidden = true; });
    doc.addEventListener('keydown', event => { if (event.key === 'Escape') $('context').hidden = true; });
    doc.addEventListener('scroll', () => { $('context').hidden = true; }, true);
  } catch (error) { status(`뷰어 초기화 실패: ${error.message}`); }
}
frame.addEventListener('load',initializeViewer);
if(frame.contentDocument?.readyState==='complete')initializeViewer();
function captureSelection() {
  const selection = frame.contentWindow.getSelection();
  const text = selection?.toString().trim();
  if (!text || !viewer?.pdfDocument) return false;
  const node = selection.anchorNode;
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  if (!element?.closest('.textLayer')) return false;
  const other=selection.focusNode?.nodeType===1?selection.focusNode:selection.focusNode?.parentElement;
  const canAnnotate=annotationUI.capture();$('highlight').disabled=!canAnnotate;$('add-note').disabled=!canAnnotate;
  const anchor=Number(element.closest('.page')?.dataset.pageNumber || viewer.page);
  const focus=Number(other?.closest('.page')?.dataset.pageNumber || anchor);
  const page=Math.min(anchor,focus),end=Math.max(anchor,focus);
  if (selected !== text || selectedPage !== page || selectedEndPage!==end) {
    selected = text; selectedPage = page;selectedEndPage=end; invalidatePrompt();
    $('selection').textContent = selected;
    $('page').textContent = page===end?`p. ${page}`:`p. ${page}–${end}`;
    updateSend();
  }
  return true;
}
async function openFile(file) {
  if (!viewer || !file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { status('PDF 파일을 선택해 주세요.'); return; }
  resetDocument(); $('empty').hidden = true; fileName = file.name;
  $('document').textContent = `${file.name} · 여는 중`;
  try { await viewer.open({data: new Uint8Array(await file.arrayBuffer()), originalUrl: file.name}); }
  catch (error) { status(`PDF를 열 수 없습니다: ${error.message}`); $('document').textContent = 'PDF 열기 실패'; }
}
$('open').onclick = () => $('file').click();
$('file').onchange = async () => { await openFile($('file').files[0]); $('file').value = ''; };
$('sample').onclick = async () => {
  if (!viewer) return;
  resetDocument(); $('empty').hidden = true;
  try { await viewer.open({url: new URL('pdfjs/web/compressed.tracemonkey-pldi-09.pdf', location.href).href}); }
  catch (error) { status(`샘플 열기 실패: ${error.message}`); }
};
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => { event.preventDefault(); openFile(event.dataTransfer.files[0]); });
document.addEventListener('pointerdown', event => { if (!$('context').contains(event.target)) $('context').hidden = true; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') $('context').hidden = true; });
$('ask').onclick = () => { $('context').hidden = true; $('question').focus(); $('question').scrollIntoView({block:'nearest', behavior:'smooth'}); };
function updateQuestionPreview(){renderMarkdown($('question-markdown-preview'),$('question').value);}
document.querySelectorAll('[data-question]').forEach(button => { button.onclick = () => { $('question').value = button.dataset.question;$('presets-popover').hidePopover();$('question').focus();updateQuestionPreview();invalidatePrompt(); }; });
$('question').oninput = ()=>{updateQuestionPreview();invalidatePrompt();};
updateQuestionPreview();
$('prepare').onclick = async automatic => {
  const notify=message=>{if(automatic!==true)status(message);};
  if ((!selected && pdfWindow!=='auto') || !viewer?.pdfDocument || busy || autoController || answerController || chatBusy) return;
  const question=$('question').value.trim();
  if (!question) { status('질문을 입력해 주세요.'); return; }
  if(chat && chat.documentId!==documentId){status('이 대화에 연결된 PDF를 열거나 새 대화를 시작하세요.');return;}
  const pdf=viewer.pdfDocument,generation=docGeneration,selection=selected,startPage=Number(selectedPage)||viewer.page,endPage=Number(selectedEndPage)||viewer.page;
  busy=true;invalidatePrompt(false);const revision=promptRevision;
  const history=historyFor(chat?.entries || [],historyTurns),numbers=pageWindow(pdfWindow==='auto'?'all':pdfWindow,startPage,endPage,pdf.numPages);
  try {
    const pages=[];
    for(const number of numbers) {
      if(generation!==docGeneration || revision!==promptRevision)return;
      if(!textCache.has(number)) {
        notify('필요한 페이지 추출 중 · '+number+'페이지');
        const page=await pdf.getPage(number),content=await page.getTextContent();
        if(generation!==docGeneration || revision!==promptRevision)return;
        textCache.set(number,content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('').trim());
      }
      pages.push({number,text:textCache.get(number)});
    }
    if(generation!==docGeneration || revision!==promptRevision)return;
    if(pdfWindow==='auto'){
      const retrieval=retrieveCandidates(pages,question,selection,startPage,endPage,history);
      const autoRequest={fileName,question,selection,startPage,endPage,history,candidates:retrieval.candidates,budget:autoBudget};
      const result=await api('/api/auto-context',autoRequest);
      if(revision!==promptRevision || generation!==docGeneration)return;
      prepared={question,selection,pdfWindow,pages:result.pages,historyCount:history.length,autoRequest,needsAgent:retrieval.needsAgent};
      applyAutoResult(result,retrieval.reason);
    }else{
      const result=buildPrompt({fileName,question,selection,startPage,endPage,pages,history});
      prepared={prompt:result.text,question,selection,pageLabel:result.pageLabel,pdfWindow,pages:numbers,historyCount:history.length};
      $('prompt').value=result.text;$('copy').disabled=false;
      $('token-estimate').textContent='입력 토큰 계산 중…';
      try{const estimate=await api('/api/tokens',{prompt:result.text});if(revision!==promptRevision || generation!==docGeneration)return;prepared.estimate=estimate;$('token-estimate').textContent='입력 약 '+estimate.tokens.toLocaleString()+' tokens · 추정';}
      catch(error){if(revision===promptRevision)$('token-estimate').textContent='입력 토큰 추정 불가 · 전송은 가능합니다.';}
    }
    notify(prepared.pages.length+'페이지 + 선택 문장 · 이전 대화 '+history.length+'회 · '+prepared.prompt.length.toLocaleString()+'자 준비 완료. 아직 전송하지 않았습니다.'+(pages.some(p=>!p.text)?' 텍스트 없는 페이지가 있습니다. OCR이 필요할 수 있습니다.':''));
  }catch(error){if(generation===docGeneration)status('문맥 준비 실패: '+error.message);}
  finally{if(generation===docGeneration){busy=false;updateSend();}}
};
$('copy').onclick = async () => {
  try {await writeClipboard($('prompt').value);}
  catch {$('preview').open=true;$('prompt').select();status('자동 복사가 제한되어 있습니다. 선택된 내용을 Ctrl+C로 복사하세요.');return;}
  try {await saveExport();status('준비된 질문을 복사하고 기록을 저장했습니다. 원하는 대화창에 붙여넣으세요.');}
  catch(error){status('복사는 완료했지만 기록을 저장하지 못했습니다: '+error.message);}
};

function applyAutoResult(result,localReason=''){
  Object.assign(prepared,{prompt:result.prompt,pageLabel:result.pageLabel,pages:result.pages,estimate:result.estimate,autoContext:{source:result.source,reason:localReason || result.reason,budget:autoBudget,clipped:result.clipped,omitted:result.omitted,agentUsage:result.agentUsage,selectorEstimate:result.selectorEstimate}});
  $('prompt').value=prepared.prompt;
  $('token-estimate').textContent='답변 입력 약 '+result.estimate.tokens.toLocaleString()+' / '+autoBudget.toLocaleString()+' tokens · 추정';
  $('auto-report').textContent=(result.source==='agent'?'에이전트 선택':'로컬 Auto')+' · p. '+(result.pages.join(', ') || '선택 문장만')+' · '+prepared.autoContext.reason+(result.source!=='agent' && prepared.needsAgent && requestMode==='plan'?' · 전송 시 선택 AI 1회 추가':'')+(result.clipped.length?' · 일부 발췌: '+result.clipped.join(', '):'')+(result.omitted.length?' · 예산으로 제외: '+result.omitted.join(', '):'')+((result.source==='agent'||(prepared.needsAgent && requestMode==='plan'))?' · 선택 입력 약 '+result.selectorEstimate.tokens.toLocaleString()+' 별도 · 합계 약 '+(result.estimate.tokens+result.selectorEstimate.tokens).toLocaleString()+' tokens':'')+(result.agentUsage?.inputTokens!=null?' · 선택용 실제 입력 '+result.agentUsage.inputTokens.toLocaleString()+' tokens':'');
  updateSend();
}
async function refineAuto(){
  if(!prepared?.autoRequest || busy || answerController || autoController)return false;
  const snapshot=prepared,revision=promptRevision,controller=new AbortController();autoController=controller;busy=true;updateSend();
  $('auto-report').textContent='에이전트가 후보 페이지에서 문맥을 고르고 있습니다…';
  try{
    const result=await api('/api/auto-context',{...snapshot.autoRequest,useAgent:true,model:$('model').value},controller.signal);
    if(revision!==promptRevision || prepared!==snapshot)return false;
    applyAutoResult(result);return true;
  }catch(error){if(revision===promptRevision){$('auto-report').textContent=controller.signal.aborted?'문맥 선택을 중지했습니다.':error.message;status('자동 전송하지 않았습니다. 다시 선택하거나 수동 범위로 바꾸세요.');}return false;}
  finally{if(autoController===controller){autoController=null;busy=false;updateSend();}}
}
$('auto-refine').onclick=refineAuto;

function turnMetadata(value) {
  const {question,selection,pageLabel,pdfWindow,pages,historyCount,test,autoContext}=value;
  return {question,selection,pageLabel,pdfWindow,pages,historyCount,test,autoContext};
}
function renderChat() {
  const log=$('answer'),scroll=log.scrollTop,follow=log.scrollHeight-scroll-log.clientHeight<80;
  const nodes=(chat?.entries || []).map(entry=>{
    const article=document.createElement('article');article.className='chat-turn';article.dataset.entry=entry.id;
    const title=document.createElement('div');title.className='chat-question markdown-body';renderMarkdown(title,entry.test?'연결 테스트':entry.question);
    const meta=document.createElement('p');meta.className='chat-meta';meta.textContent=entry.pageLabel+' · '+({complete:'완료',pending:'응답 중',interrupted:'중단된 응답',exported:'복사됨 · 답변 붙여넣기 대기'}[entry.status] || entry.status);
    const quote=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');summary.textContent='당시 선택 문장 · 문맥';text.textContent=entry.selection+'\nPDF 페이지: '+(entry.pages?.join(', ') || '선택 문장만')+' · 이전 대화 '+(entry.historyCount || 0)+'회';quote.append(summary,text);
    const answer=document.createElement('div');answer.className='chat-answer markdown-body';renderMarkdown(answer,entry.answer || (entry.status==='exported'?'ChatGPT에서 답변을 확인하세요.':''));
    if(entry.autoContext){text.textContent+='\nAuto: '+entry.autoContext.reason+' · '+entry.autoContext.source;if(entry.autoContext.agentUsage?.inputTokens!=null)text.textContent+=' · 선택용 실제 입력 '+entry.autoContext.agentUsage.inputTokens+' tokens';}
    article.append(title,meta,quote,answer);
    if(entry.status==='exported' || entry.source==='chatgpt-web') {
      const importButton=document.createElement('button');importButton.className='import-answer-button';importButton.textContent=entry.source==='chatgpt-web'?'가져온 답변 수정':'답변 붙여넣기';
      importButton.onclick=()=>openAnswerImport(entry);article.append(importButton);
    }
    if(entry.source==='chatgpt-web'){const source=document.createElement('p');source.className='chat-token-usage';source.textContent='ChatGPT 웹에서 가져온 답변';article.append(source);}
    if(entry.status==='complete' && entry.source!=='chatgpt-web'){const usage=document.createElement('p');usage.className='chat-token-usage';usage.textContent=entry.usage?.inputTokens!=null?'실제 입력 '+entry.usage.inputTokens.toLocaleString()+' tokens'+(entry.usage.cachedTokens!=null?' · 캐시 '+entry.usage.cachedTokens.toLocaleString():''):'실제 입력 토큰 · 서버 미제공';article.append(usage);}
    return article;
  });
  clearTimeout(answerRenderTimer);answerRenderTimer=null;
  log.replaceChildren(...nodes);log.scrollTop=follow?log.scrollHeight:scroll;
  $('history-status').textContent='저장된 질문 '+(chat?.entries.length || 0)+'개 · 다음 질문에 완료된 대화 '+historyFor(chat?.entries || [],historyTurns).length+'회 포함';
  if(chat && documentId!==chat.documentId)$('chat-status').textContent='저장된 대화: '+chat.fileName+' · 이어서 질문하려면 같은 PDF를 열어 주세요.';
  else $('chat-status').textContent=chat?'이 PC에 자동 저장 · '+chat.fileName:'새 대화 · 전송하거나 복사하면 이 PC에 자동 저장됩니다.';
  updateSend();
}
function queueAnswerRender(entry) {
  if(answerRenderTimer)return;
  answerRenderTimer=setTimeout(()=>{
    answerRenderTimer=null;
    const log=$('answer'),body=log.querySelector('[data-entry="'+entry.id+'"] .chat-answer');
    if(!body)return;
    const follow=log.scrollHeight-log.scrollTop-log.clientHeight<80;
    renderMarkdown(body,entry.answer);
    if(follow)log.scrollTop=log.scrollHeight;
  },80);
}
function detachChat() {
  answerController?.abort();chatRevision++;chat=null;chatBusy=false;
  $('chat-choice').value='';$('answer-status').textContent='';invalidatePrompt();renderChat();
}
async function refreshChats() {
  chatList=await api('/api/chats');
  $('chat-choice').replaceChildren(new Option('새 대화',''),...chatList.map(item=>new Option(item.fileName+' · '+new Date(item.createdAt).toLocaleString('ko-KR')+' · '+item.count+'개',item.id)));
  $('chat-choice').value=chat?.id || '';
}
async function loadChat(id) {
  detachChat();if(!id)return;
  const revision=chatRevision;chatBusy=true;updateSend();
  try{const saved=await api('/api/chat/get',{id});if(revision!==chatRevision)return;chat=saved;$('chat-choice').value=id;
      if(chat.documentId===documentId){const last=[...chat.entries].reverse().find(entry=>entry.selection);const pages=last?.pageLabel.match(/\d+/g);if(last && pages){selected=last.selection;selectedPage=Number(pages[0]);selectedEndPage=Number(pages[1] || pages[0]);$('selection').textContent=selected;$('page').textContent=last.pageLabel;}}
      renderChat();invalidatePrompt();}
  catch(error){if(revision===chatRevision)$('chat-status').textContent=error.message;}
  finally{if(revision===chatRevision){chatBusy=false;updateSend();}}
}
async function restoreDocumentChat() {
  const generation=docGeneration,revision=chatRevision;chatBusy=true;updateSend();
  try{await refreshChats();if(generation!==docGeneration || revision!==chatRevision)return;const match=chatList.find(item=>item.documentId===documentId);if(match)await loadChat(match.id);}
  catch(error){if(generation===docGeneration)$('chat-status').textContent='대화 복원 실패: '+error.message;}
  finally{if(generation===docGeneration){chatBusy=false;updateSend();}}
}
async function ensureChat() {
  if(chat)return chat;
  const revision=chatRevision;
  const created=await api('/api/chat/new',{documentId:documentId || 'connection-test',fileName:fileName || '연결 테스트'});
  if(revision===chatRevision){chat=created;await refreshChats();renderChat();}
  return created;
}
async function saveExport() {
  const snapshot=prepared,revision=chatRevision;
  if(!snapshot || snapshot.exported)return;
  chatBusy=true;updateSend();
  try {
    const current=await ensureChat();if(revision!==chatRevision)return;
    const entry=await api('/api/chat/export',{id:current.id,turn:turnMetadata(snapshot)});
    snapshot.exported=true;if(revision===chatRevision){current.entries.push(entry);renderChat();await refreshChats();}
  }finally{if(revision===chatRevision){chatBusy=false;updateSend();}}
}
$('chat-choice').onchange=()=>loadChat($('chat-choice').value);
$('new-chat').onclick=()=>{detachChat();status('새 대화를 시작했습니다. 기존 기록은 저장된 대화 목록에 남아 있습니다.');};
$('delete-chat').onclick=async()=>{
  if(!chat || chatBusy)return;
  const id=chat.id;answerController?.abort();chatBusy=true;updateSend();
  try{await api('/api/chat/delete',{id});detachChat();await refreshChats();status('현재 대화를 PC에서 삭제했습니다. ChatGPT 웹 대화는 변경하지 않습니다.');}
  catch(error){$('chat-status').textContent='삭제하지 못했습니다: '+error.message;}
  finally{chatBusy=false;updateSend();}
};
for(const id of ['pdf-window','history-window','auto-budget'])$(id).onchange=async()=>{
  if(savingSettings)return;
  savingSettings=true;invalidatePrompt();
  try{const saved=await api('/api/settings',{mode:requestMode || 'manual',pdfWindow:$('pdf-window').value,autoBudget:Number($('auto-budget').value),historyTurns:$('history-window').value==='all'?'all':Number($('history-window').value)});pdfWindow=saved.pdfWindow;historyTurns=saved.historyTurns;autoBudget=saved.autoBudget || 8000;status('문맥 범위를 저장했습니다. 질문을 다시 준비하세요.');}
  catch(error){status('설정 저장 실패: '+error.message);}
  finally{$('pdf-window').value=pdfWindow;$('history-window').value=String(historyTurns);$('auto-budget').value=String(autoBudget);savingSettings=false;renderChat();}
};

async function api(url, body, signal) {
  const response = await fetch(url,{signal,headers:{'X-Paper-Reader':'1',...(body!==undefined?{'Content-Type':'application/json'}:{})},method:body!==undefined?'POST':'GET',...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}
function renderHeaderAccount() {
  const connected=!!authState?.connected;
  const account=connected?authState.account:usageState?.account;
  const identity=account?.email || account?.name || (connected?'ChatGPT 계정':'로그인 필요');
  $('header-account').textContent=identity;
  $('header-account').title=identity;
  $('header-account-source').textContent=connected?'앱 연결':usageState?'Codex':'미연결';
  $('header-avatar').textContent=account?(identity[0] || 'P').toUpperCase():'P';
  $('reader-account-detail').textContent=connected?identity:'로그인되지 않음';
  if(requestMode==='manual' && webPanelUI.available){
    $('header-account').textContent='ChatGPT 웹';$('header-account').title='웹 로그인은 앱 연결 계정과 별개입니다.';
    $('header-account-source').textContent='웹 계정 별도';$('header-avatar').textContent='C';
    $('usage-summary').textContent='계정·사용량은 오른쪽 웹에서 확인';$('usage-summary').title=$('usage-summary').textContent;$('usage-summary').hidden=false;
  }
}
$('account-settings').onclick=()=>{$('usage-popover').hidePopover();$('settings-open').click();};
function renderUsage() {
  renderHeaderAccount();
  if(!usageState)return;
  $('usage-result').hidden=false;
  $('usage-account').textContent=`조회 계정 (Codex): ${usageState.account.email || '이메일 미제공'}${usageState.account.planType ? ' · '+usageState.account.planType : ''}`;
  const readerEmail=authState?.account?.email?.trim().toLowerCase(),sourceEmail=usageState.account.email?.trim().toLowerCase();
  const different=readerEmail && sourceEmail && readerEmail!==sourceEmail;
  $('usage-account-warning').hidden=!different;
  $('usage-account-note').textContent=different?'주의: PDF 앱 로그인과 다른 계정의 수치입니다. Codex와 PDF 앱에 같은 계정으로 로그인한 뒤 새로고침하세요.':readerEmail && sourceEmail?'PDF 앱과 이메일이 같은 계정입니다. 아래 수치는 다른 앱 사용량도 포함하는 계정 한도이며, 이 PDF 앱만의 사용량이 아닙니다.':'PDF 앱 로그인과의 계정 일치는 확인하지 않았습니다. 위 조회 계정의 전체 사용량입니다.';
  $('usage-account-note').classList.toggle('usage-warning',!!different);
  const nodes=[],summary=[];
  for(const bucket of usageState.buckets) {
    const section=document.createElement('section');section.className='usage-bucket';
    const title=document.createElement('strong');title.textContent=bucket.name;section.append(title);
    for(const window of bucket.windows) {
      const row=document.createElement('p'),mins=window.windowDurationMins;
      const label=mins===10080?'주간':mins===null?'기간 미제공':mins>=1440 && mins%1440===0?`${mins/1440}일`:mins>=60 && mins%60===0?`${mins/60}시간`:`${mins}분`;
      row.textContent=`${label} 한도: ${window.remainingPercent===null?'조회 불가':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(window.remainingPercent)+'% 남음'}`;
      summary.push(`${label} ${window.remainingPercent===null?'조회 불가':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(window.remainingPercent)+'% 남음'}`);
      section.append(row);
      if(window.remainingPercent!==null) {const meter=document.createElement('progress');meter.max=100;meter.value=window.remainingPercent;meter.setAttribute('aria-label',`${bucket.name} ${label} 남은 사용량`);section.append(meter);}
      if(window.resetsAt!==null) {const reset=document.createElement('p');reset.className='usage-time';reset.textContent=`리셋: ${new Date(window.resetsAt*1000).toLocaleString('ko-KR')}`;section.append(reset);}
    }
    if(!bucket.windows.length) {const note=document.createElement('p');note.textContent='남은 구독 한도: 서버에서 미제공';section.append(note);}
    const credits=document.createElement('p');credits.textContent=`추가 크레딧 잔액: ${bucket.credits.unlimited?'무제한':bucket.credits.balance===null?'서버에서 미제공':bucket.credits.balance}`;section.append(credits);nodes.push(section);
  }
  if(!nodes.length){const note=document.createElement('p');note.textContent='서버에서 조회 가능한 한도나 잔액을 제공하지 않았습니다.';nodes.push(note);}
  $('usage-buckets').replaceChildren(...nodes);
  $('usage-summary').textContent=summary.join(' · ') || '남은 구독 한도: 서버에서 미제공';
  $('usage-summary').title=$('usage-summary').textContent;
  $('usage-summary').hidden=false;
  $('usage-updated').textContent=`조회 시각: ${new Date(usageState.checkedAt).toLocaleString('ko-KR')} · 10초 이내 재조회는 직전 결과를 사용합니다.`;
  renderHeaderAccount();
}
$('refresh-usage').onclick=async()=>{
  if(loadingUsage)return;
  loadingUsage=true;$('refresh-usage').disabled=true;$('usage-result').hidden=true;$('usage-summary').hidden=true;$('usage-account-warning').hidden=true;
  usageState=null;$('usage-status').hidden=false;$('usage-status').textContent='확인 중…';$('usage-status').removeAttribute('title');
  try {usageState=await api('/api/usage',{});$('usage-status').hidden=true;renderUsage();}
  catch(error){$('usage-status').textContent='조회 불가';$('usage-status').title=error.message;}
  finally{loadingUsage=false;$('refresh-usage').disabled=false;renderHeaderAccount();}
};
function updateSend() {
  const working=busy || !!autoController;
  $('copy').disabled=!prepared || chatBusy || working || !!answerController;
  $('auto-controls').hidden=pdfWindow!=='auto';
  $('auto-refine').disabled=pdfWindow!=='auto' || requestMode!=='plan' || !authState?.planEnabled || !$('model').value || working || !!answerController || !prepared;
  $('prepare').disabled=(!selected && !(pdfWindow==='auto' && viewer?.pdfDocument)) || working || !!answerController || chatBusy || savingSettings || (!!chat && chat.documentId!==documentId);
  for(const id of ['pdf-window','history-window','auto-budget'])$(id).disabled=working || !!answerController || savingSettings;
  $('chat-choice').disabled=chatBusy; $('new-chat').disabled=chatBusy; $('delete-chat').disabled=chatBusy || !chat;
  const ready = !chatBusy && !working && requestMode==='plan' && !savingSettings && authState?.planEnabled && !!$('model').value && !answerController;
  const canAsk=(!!selected || (pdfWindow==='auto' && !!viewer?.pdfDocument)) && !!$('question').value.trim() && (!chat || chat.documentId===documentId) && !working && !chatBusy;
  $('send').disabled = !ready || !canAsk;
  $('send').title=!authState?.planEnabled?'환경 설정에서 ChatGPT 계정을 연결하세요.':!selected?'PDF에서 문장을 먼저 선택하세요.':'';
  $('connection-test').disabled = !ready;
  $('cancel-answer').hidden = !answerController && !autoController;
  $('open-chatgpt').disabled = requestMode!=='manual' || savingSettings || openingChatGPT || !canAsk;
  $('copy-manual').disabled=$('open-chatgpt').disabled;
  $('settings-save').disabled = working || savingSettings || !!answerController || openingChatGPT;
}
function applyMode(mode) {
  requestMode=mode;webPanelUI.setMode(mode);
  const direct=mode==='plan';
  $('account-card').hidden=!direct;
  $('model-settings').hidden=!direct;
  $('plan-controls').hidden=!direct;
  $('manual-controls').hidden=mode!=='manual';
  $('mode-title').textContent=direct?'앱에서 직접 요청':'ChatGPT에서 직접 질문';
  $('mode-description').textContent=direct?'앱 안에서 답변받습니다. Codex / ChatGPT Work 공유 사용량 또는 허용한 크레딧을 사용합니다.':'질문을 복사해 ChatGPT 대화창에서 직접 전송합니다. 앱에서 AI 요청은 보내지 않습니다.';
  renderUsage();
  updateSend();
}
$('settings-open').onclick=()=>{
  document.querySelectorAll('[name="request-mode"]').forEach(input=>{input.checked=input.value===(requestMode || 'manual');});
  $('settings-status').textContent=answerController?'응답을 완료하거나 중지한 뒤 저장할 수 있습니다.':'';
  $('account-card').hidden=requestMode!=='plan';$('model-settings').hidden=requestMode!=='plan';updateSend();$('settings-dialog').showModal();
};
$('settings-cancel').onclick=()=>{if(!savingSettings)$('settings-dialog').close();};
$('settings-dialog').addEventListener('cancel',event=>{if(savingSettings)event.preventDefault();});
$('settings-form').onsubmit=async event=>{
  event.preventDefault();
  if(busy || savingSettings || answerController || openingChatGPT) return;
  const mode=document.querySelector('[name="request-mode"]:checked')?.value;
  savingSettings=true;updateSend();$('settings-cancel').disabled=true;
  try {
    const saved=await api('/api/settings',{mode});applyMode(saved.mode);invalidatePrompt();
    $('settings-dialog').close();status('질문 모드를 저장했습니다. 다음 실행에도 유지됩니다.');
    await refreshAuth();
  } catch(error) {$('settings-status').textContent=error.message;}
  finally {savingSettings=false;$('settings-cancel').disabled=false;updateSend();}
};
async function exportToChatGPT(openBrowser) {
  if(requestMode!=='manual' || savingSettings || openingChatGPT || busy || chatBusy) return;
  if(!prepared)await $('prepare').onclick();
  if(!prepared)return;
  openingChatGPT=true;updateSend();$('chatgpt-fallback').hidden=true;
  try {
    try {await writeClipboard($('prompt').value);}
    catch {
      $('context-popover').showPopover();$('preview').open=true;$('prompt').focus();$('prompt').select();$('chatgpt-fallback').hidden=false;
      status('자동 복사를 사용할 수 없습니다. 선택된 내용을 Ctrl+C로 복사하세요.');return;
    }
    await saveExport();
    if(!openBrowser){status('질문을 복사했습니다. 열려 있는 ChatGPT 대화에 Ctrl+V로 붙여넣으세요. 답변은 앱 기록의 해당 질문 아래에서 가져올 수 있습니다.');return;}
    if(webPanelUI.available){await webPanelUI.show();status('복사 완료 · 오른쪽 ChatGPT 입력창을 클릭하고 Ctrl+V로 붙여넣어 전송하세요. 대화는 웹 탭에 유지됩니다.');return;}
    const result=await api('/api/open-chatgpt',{});
    $('chatgpt-fallback').hidden=result.opened;
    status(result.opened?'복사 완료 · ChatGPT에서 Ctrl+V → 전송. 받은 답변은 오른쪽의 ‘답변 붙여넣기’로 보관하세요.':'복사 완료 · ChatGPT 직접 열기를 누른 뒤 Ctrl+V로 붙여넣으세요.');
  } catch(error) {$('chatgpt-fallback').hidden=false;status('복사 이후 처리에 실패했습니다: '+error.message);}
  finally {openingChatGPT=false;updateSend();}
}
$('open-chatgpt').onclick=()=>exportToChatGPT(true);
$('copy-manual').onclick=()=>exportToChatGPT(false);
let importTarget=null,importSaving=false;
function openAnswerImport(entry) {
  if(chatBusy || answerController || !chat)return;
  importTarget={chatId:chat.id,entryId:entry.id};
  $('import-answer-question').textContent=entry.question;
  $('import-answer-text').value=entry.answer || '';$('import-answer-status').textContent='';
  $('import-answer-dialog').showModal();$('import-answer-text').focus();
}
$('import-answer-cancel').onclick=()=>{if(!importSaving)$('import-answer-dialog').close();};
$('import-answer-dialog').addEventListener('cancel',event=>{if(importSaving)event.preventDefault();});
$('import-answer-form').onsubmit=async event=>{
  event.preventDefault();if(importSaving || !importTarget)return;
  const target=importTarget;importSaving=true;$('import-answer-save').disabled=true;$('import-answer-cancel').disabled=true;
  try {
    const entry=await api('/api/chat/import-answer',{id:target.chatId,entryId:target.entryId,answer:$('import-answer-text').value});
    if(chat?.id===target.chatId){const index=chat.entries.findIndex(item=>item.id===entry.id);if(index>=0)chat.entries[index]=entry;invalidatePrompt();renderChat();}
    await refreshChats();$('import-answer-dialog').close();status('답변을 저장했습니다. 다음 질문의 이전 대화 문맥에 포함됩니다.');
  }catch(error){$('import-answer-status').textContent=error.message;}
  finally{importSaving=false;$('import-answer-save').disabled=false;$('import-answer-cancel').disabled=false;}
};
async function loadModels() {
  if(requestMode!=='plan') return;
  $('model').disabled=true;
  try {
    const data=await api('/api/models');
    const previous=$('model').value;
    $('model').replaceChildren(...data.models.map(m=>new Option(m.name,m.id)));
    if(data.models.some(m=>m.id===previous)) $('model').value=previous;
    $('model').disabled=!data.models.length;
    if(!data.models.length) $('auth-status').textContent='로그인했지만 사용 가능한 모델이 없습니다. 계정의 구독 사용 권한을 확인하세요.';
  } catch(error) { $('model').replaceChildren(new Option('모델을 가져오지 못했습니다','')); $('auth-status').textContent=error.message; }
  updateSend();
}
async function refreshAuth() {
  try {
    authState=await api('/api/auth/status');
    renderUsage();
    const previous=$('account-choice').value;
    const options=authState.profiles.map(p=>new Option(`${p.label} · ${p.suffix}`,p.id));
    $('account-choice').replaceChildren(...options,new Option('다른 계정 / 새 등록','new'));
    if(authState.profiles.some(p=>p.id===previous)) $('account-choice').value=previous;
    else if(authState.account?.profileId) $('account-choice').value=authState.account.profileId;
    $('disconnect').hidden=!authState.connected;
    $('account-state').textContent=authState.connected ? (authState.account.email || authState.account.name || 'ChatGPT 연결됨') : 'ChatGPT 연결';
    if(requestMode==='plan' && !authState.planEnabled && !busy && !answerController)status('상단 환경 설정에서 ChatGPT 계정을 연결하면 바로 질문할 수 있습니다.');
    $('auth-status').textContent=authState.error || (authState.pending ? '기본 브라우저에서 로그인과 구독 사용 승인을 완료하세요.' : authState.connected ? (authState.planEnabled ? 'Codex / ChatGPT Work 공유 사용량 연결됨' : '계정은 연결되었지만 구독 사용 권한이 없습니다.') : 'Continue with ChatGPT로 계정을 연결하세요.');
    if(authState.connected && !authState.pending) {$('login-link').hidden=true;pollingUntil=0;}
    const key=requestMode==='plan' && authState.planEnabled?authState.account.profileId:null;
    if(key!==modelAccount) {
      modelAccount=key;
      if(key) await loadModels();
      else {$('model').replaceChildren(new Option('ChatGPT 연결 후 선택',''));$('model').disabled=true;answerController?.abort();}
    }
    updateSend();
  } catch(error) {$('auth-status').textContent='로컬 서버 연결을 확인하세요. '+error.message;}
  clearTimeout(pollTimer);
  if(Date.now()<pollingUntil) pollTimer=setTimeout(refreshAuth,2500);
}
$('connect').onclick=async()=>{
  $('connect').disabled=true;
  try {
    const data=await api('/api/auth/start',{profileId:$('account-choice').value});
    $('login-link').href=data.launchUrl;$('login-link').hidden=false;
    pollingUntil=Date.now()+10*60*1000;
    await refreshAuth();
  } catch(error) {$('auth-status').textContent=error.message;}
  finally {$('connect').disabled=false;}
};
$('disconnect').onclick=async()=>{
  $('disconnect').disabled=true;answerController?.abort();
  try {const result=await api('/api/auth/logout',{});await refreshAuth();$('auth-status').textContent=result.message;}
  catch(error) {$('auth-status').textContent=error.message;}
  finally {$('disconnect').disabled=false;}
};
$('refresh-auth').onclick=refreshAuth;
$('refresh-models').onclick=loadModels;
$('model').onchange=()=>invalidatePrompt();
$('cancel-answer').onclick=()=>{answerController?.abort();autoController?.abort();};
async function sendQuestion(prompt,isTest=false) {
  if(requestMode!=='plan' || savingSettings || answerController || chatBusy || !prompt) return;
  const snapshot=isTest?{question:prompt,selection:'',pageLabel:'연결 테스트',test:true}:prepared;
  if(!snapshot)return;
  const controller=new AbortController(),revision=chatRevision;
  answerController=controller;updateSend();
  let current,entry;
  try {
    current=await ensureChat();
    if(revision!==chatRevision || controller.signal.aborted)return;
    $('answer-status').textContent='질문 전송 중…';
    const response=await fetch('/api/ask',{method:'POST',headers:{'X-Paper-Reader':'1','Content-Type':'application/json'},body:JSON.stringify({prompt,model:$('model').value,chatId:current.id,turn:turnMetadata(snapshot)}),signal:controller.signal});
    if(!response.ok) {const data=await response.json();throw new Error(data.error || '전송에 실패했습니다.');}
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',complete=false;
    while(true) {
      const {value,done}=await reader.read();if(done)break;
      buffer+=decoder.decode(value,{stream:true});let index;
      while((index=buffer.indexOf('\n'))!==-1) {
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line)continue;
        const event=JSON.parse(line);
        if(revision!==chatRevision)continue;
        if(event.type==='entry'){entry=event.entry;current.entries.push(entry);renderChat();}
        if(event.type==='delta' && entry){entry.answer+=event.text;queueAnswerRender(entry);$('answer-status').textContent='답변 작성 중 · 자동 저장 중…';}
        if(event.type==='complete'){complete=true;if(entry){entry.status='complete';entry.usage=event.usage;}}
        if(event.type==='error')throw new Error(event.message);
      }
    }
    if(revision!==chatRevision)return;
    if(!complete)throw new Error('응답이 완료되지 않았습니다. 부분 응답은 다음 질문에 포함하지 않습니다.');
    $('answer-status').textContent=isTest?'연결 테스트 완료 · 저장됨':'답변 완료 · 저장됨';
    renderChat();if(!isTest && $('question').value.trim()===snapshot.question){$('question').value='';updateQuestionPreview();}invalidatePrompt();status('후속 질문을 입력하고 보내세요. Ctrl+Enter로도 전송할 수 있습니다.');await refreshChats();
  }catch(error){
    if(revision===chatRevision){if(entry)entry.status='interrupted';renderChat();invalidatePrompt();$('answer-status').textContent=controller.signal.aborted?'응답 중지 · 수신한 부분까지 저장합니다.':error.message;await refreshChats().catch(()=>{});}
  }finally{controller.abort();if(answerController===controller)answerController=null;updateSend();}
}
$('send').onclick=async()=>{if($('send').disabled)return;if(!prepared)await $('prepare').onclick();if(prepared?.needsAgent && prepared.autoContext?.source!=='agent'){if(!await refineAuto())return;}if(prepared)await sendQuestion(prepared.prompt);};
$('question').onkeydown=event=>{if(event.key==='Enter' && (event.ctrlKey || event.metaKey)){event.preventDefault();$(requestMode==='plan'?'send':event.shiftKey?'copy-manual':'open-chatgpt').click();}};
$('connection-test').onclick=()=>sendQuestion("한국어로 '연결 확인 완료'라고만 답하세요.",true);
window.addEventListener('focus',refreshAuth);
const workspace=document.querySelector('main'),divider=$('panel-resizer');
let desiredPanelWidth=Math.round(Math.min(640,innerWidth*.44)),resizeSaveTimer;
function resizePanel(width=desiredPanelWidth){
  const maximum=Math.max(360,Math.min(1200,workspace.clientWidth-368));
  const actual=Math.round(Math.max(360,Math.min(width,maximum)));
  document.documentElement.style.setProperty('--panel-width',actual+'px');
  divider.setAttribute('aria-valuemin','360');divider.setAttribute('aria-valuemax',String(maximum));divider.setAttribute('aria-valuenow',String(actual));divider.setAttribute('aria-valuetext','대화 너비 '+actual+'픽셀');
  return actual;
}
function savePanelWidth(){clearTimeout(resizeSaveTimer);resizeSaveTimer=setTimeout(()=>api('/api/settings',{panelWidth:desiredPanelWidth}).catch(()=>status('패널 너비를 저장하지 못했습니다. 다시 조절하면 재시도합니다.')),300);}
divider.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();divider.setPointerCapture(event.pointerId);document.body.classList.add('resizing-panels');});
divider.addEventListener('pointermove',event=>{if(divider.hasPointerCapture(event.pointerId))desiredPanelWidth=resizePanel(workspace.getBoundingClientRect().right-event.clientX);});
const finishResize=()=>{document.body.classList.remove('resizing-panels');savePanelWidth();};
divider.addEventListener('pointerup',event=>{if(divider.hasPointerCapture(event.pointerId))divider.releasePointerCapture(event.pointerId);});
divider.addEventListener('lostpointercapture',finishResize);
divider.addEventListener('keydown',event=>{let width=Number(divider.getAttribute('aria-valuenow'));if(event.key==='ArrowLeft')width+=24;else if(event.key==='ArrowRight')width-=24;else if(event.key==='Home')width=360;else if(event.key==='End')width=1200;else return;event.preventDefault();desiredPanelWidth=resizePanel(width);savePanelWidth();});
divider.addEventListener('dblclick',()=>{desiredPanelWidth=resizePanel(Math.min(640,workspace.clientWidth*.44));savePanelWidth();});
new ResizeObserver(()=>resizePanel()).observe(workspace);resizePanel();
try {const saved=await api('/api/settings');if(saved.panelWidth){desiredPanelWidth=saved.panelWidth;resizePanel();}applyMode(saved.mode);pdfWindow=saved.pdfWindow || 'near1';historyTurns=saved.historyTurns ?? 3;autoBudget=saved.autoBudget || 8000;$('auto-budget').value=String(autoBudget);$('pdf-window').value=pdfWindow;$('history-window').value=String(historyTurns);}
catch(error) {$('mode-title').textContent='설정을 불러오지 못했습니다';$('mode-description').textContent='환경 설정에서 모드를 선택해 저장하세요. '+error.message;}
await refreshAuth();
$('refresh-usage').click();

try{await refreshChats();if(!documentId && chatList.length)await loadChat(chatList[0].id);}catch(error){$("chat-status").textContent="저장된 대화를 불러오지 못했습니다: "+error.message;}
