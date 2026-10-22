import {createWindowDrafts} from './draft-session.mjs';
import {retrieveCandidates} from './auto-context.mjs';
import {renderMarkdown} from './markdown.bundle.mjs';
import {pageWindow,historyFor,buildPrompt} from './context.mjs';
import {createAnnotationUI} from './annotation-ui.mjs';
import {createWebPanelUI} from './web-panel-ui.mjs';
import {createLinkUI} from './link-ui.mjs';
import {createDeliveryUI} from './delivery-ui.mjs';
import {questionContext,readingQuestion,pageNote} from './reading-tools.mjs';
import {waitForPdfLayout} from './reading-restore.mjs';
const $ = id => document.getElementById(id);
const frame = $('viewer');
const annotationUI=createAnnotationUI({frame,api,getViewer:()=>viewer,getFileName:()=>fileName});
let viewer, selected = '', selectedPage = '', docGeneration = 0, textCache = new Map(), busy = false, fileName = '';
let authState = null, answerController = null, pollTimer = null, pollingUntil = 0, modelAccount = null;
let requestMode = null, savingSettings = false, openingChatGPT = false,manualDelivery='link',linkUI=null;
let usageState=null,loadingUsage=false;
let pageImageTask=null,pageImageBusy=false;
let selectedEndPage='',promptRevision=0,prepared=null,pdfWindow='near1',historyTurns=3;
let chat=null,chatList=[],chatRevision=0,chatBusy=false,documentId='',tokenTimer,autoController=null,autoBudget=8000,answerRenderTimer=null;
let readingTimer,readingRestoring=false,openingPdf=false,questionInputRevision=0;
let lastReadingQuestion='';
let storageChecked=0,storageChecking=false;const answerDrafts=createWindowDrafts('paper-reader-answer-drafts',value=>typeof value==='string');
let pdfSearch=false,linkAllowSave=false;
let pdfSearchAvailable=false;
const searchingPDF=()=>pdfSearch && pdfSearchAvailable && requestMode==='manual' && manualDelivery==='link';
const status = message => { $('status').textContent = message; };
const webPanelUI=createWebPanelUI({status});
const deliveryUI=createDeliveryUI({api,getDocumentId:()=>documentId,onPage:page=>{if(viewer){viewer.page=page;frame.focus();}}});
$('desktop-setup-settings').hidden=!window.paperDesktop?.openSetup;
$('desktop-setup-open').onclick=()=>window.paperDesktop?.openSetup().catch(error=>status('인증 설정을 열지 못했습니다. '+error.message));
function currentContext(){return questionContext({selection:selected,startPage:selectedPage,endPage:selectedEndPage,currentPage:viewer?.page,total:viewer?.pdfDocument?.numPages,window:pdfWindow});}
function updateReadingContext(){
  const loaded=!!viewer?.pdfDocument,context=currentContext();
  $('reader-file').textContent=loaded?fileName:'읽을 논문을 열어주세요';$('reader-file').title=loaded?fileName:'';
  $('reader-position').textContent=loaded?`${viewer.page} / ${viewer.pdfDocument.numPages}페이지`:'';
  $('selection-label').textContent=selected?'선택 문장':'현재 페이지';
  const scope={auto:'Auto 문맥',selection:'선택 문장만',page:'현재 페이지',near1:'앞뒤 1페이지',near2:'앞뒤 2페이지',all:'전체 문서'}[context.window];
  $('selection-hint').textContent=selected?`p. ${context.startPage} · ${selected.slice(0,85)}`:loaded?`p. ${context.startPage} 기준 · ${scope}`:'PDF를 열어주세요';
  $('selection-clear').hidden=!selected;
  if(!selected)$('selection').textContent=loaded?'문장을 선택하지 않아도 이 페이지를 기준으로 질문할 수 있습니다.':'PDF를 열어주세요.';
  document.querySelectorAll('[data-reading-action]').forEach(button=>{button.disabled=!loaded;});
  const anchored=!!annotationUI.selectionSnapshot();
  $('selection-note').disabled=!anchored;$('selection-highlight').disabled=!anchored;
  $('page-image').disabled=!loaded || pageImageBusy;
  $('visual-context-hint').hidden=!loaded || !/수식|기호|그림|그래프|도식|도표|표\s|figure|equation|diagram|chart|table/i.test($('question').value);
  $('context-button').textContent=searchingPDF()?'AI가 문맥 찾기 · PDF 전체/이미지':loaded?`문맥 · ${scope}`:'문맥 설정';
  if(searchingPDF())$('visual-context-hint').hidden=true;
  $('reading-tools-hint').textContent='설명·번역·수식 버튼은 질문 초안을 만듭니다. Ctrl+Enter로 '+(webPanelUI.canSend?'전송':'복사')+'하세요.';
  linkUI?.render();
}
function closePopovers(){for(const popover of document.querySelectorAll(':popover-open'))popover.hidePopover();}
function setReadingFocus(value){
  document.body.classList.toggle('reading-focus',value);$('reading-focus').setAttribute('aria-pressed',String(value));
  $('reading-focus').textContent=value?'대화와 함께 보기':'집중 읽기';
}
$('reading-focus').onclick=()=>setReadingFocus(!document.body.classList.contains('reading-focus'));
$('page-image').onclick=async()=>{
  if(!viewer?.pdfDocument || pageImageBusy)return;
  const pdf=viewer.pdfDocument,generation=docGeneration,number=viewer.page,name=fileName;
  pageImageBusy=true;updateReadingContext();
  try{
    const page=await pdf.getPage(number);
    if(generation!==docGeneration)return;
    const base=page.getViewport({scale:1}),scale=Math.min(3,2200/Math.max(base.width,base.height));
    const viewport=page.getViewport({scale,rotation:(page.rotate+viewer.pdfViewer.pagesRotation)%360});
    // PDF.js registers embedded fonts in the viewer document, not the parent UI.
    const canvas=frame.contentDocument.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    pageImageTask=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'white'});
    await pageImageTask.promise;
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(generation!==docGeneration)return;
    if(!blob)throw new Error('페이지 이미지를 만들지 못했습니다.');
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;
    anchor.download=name.replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+`-p${number}.png`;
    anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status(`p. ${number} PNG를 저장했습니다. ChatGPT에 질문과 함께 첨부하세요. Link에는 이미지가 자동으로 포함되지 않습니다.`);
  }catch(error){if(generation===docGeneration)status('페이지 이미지 저장 실패: '+error.message);}
  finally{pageImageTask=null;pageImageBusy=false;updateReadingContext();}
};
function focusShortcut(event){if(event.key==='F8'){event.preventDefault();$('reading-focus').click();}}
document.addEventListener('keydown',focusShortcut);
$('selection-clear').onclick=()=>{
  selected='';selectedPage='';selectedEndPage='';annotationUI.clearSelection();frame.contentWindow.getSelection()?.removeAllRanges();
  invalidatePrompt();status('선택을 해제했습니다. 지금 보고 있는 페이지를 기준으로 질문합니다.');
};
document.querySelectorAll('[data-reading-action]').forEach(button=>{button.onclick=()=>{
  const question=readingQuestion(button.dataset.readingAction,!!selected);
  if($('question').value.trim() && $('question').value.trim()!==lastReadingQuestion && $('question').value.trim()!==question && !confirm('작성 중인 질문을 이 읽기 도구의 질문으로 바꿀까요?'))return;
  lastReadingQuestion=question;
  questionInputRevision++;
  $('question').value=question;updateQuestionPreview();invalidatePrompt();scheduleReading();$('question').focus();
  status('질문을 준비했습니다. 내용을 확인하고 Ctrl+Enter를 누르세요.');
};});
const writeClipboard=text=>window.paperDesktop?.writeClipboard ? window.paperDesktop.writeClipboard(text) : navigator.clipboard.writeText(text);
function invalidatePrompt(schedule=true) {
  updateReadingContext();
  autoController?.abort();promptRevision++;prepared=null;clearTimeout(tokenTimer);$('prompt').value='';$('copy').disabled=true;
  $('token-estimate').textContent=searchingPDF()?'질문만 전송 · ChatGPT가 필요한 페이지를 검색하고 이미지로 확인합니다.':'질문을 입력하면 문맥과 입력 토큰을 준비합니다.';
  updateSend();
  $('auto-report').textContent='';
  if(schedule && !searchingPDF() && viewer?.pdfDocument && $('question').value.trim() && !answerController){
    const revision=promptRevision;
    const calculate=()=>{if(revision!==promptRevision)return;if(busy || autoController || savingSettings || chatBusy){tokenTimer=setTimeout(calculate,250);return;}$('prepare').onclick(true);};
    tokenTimer=setTimeout(calculate,450);
  }
}
function resetDocument() {
  clearTimeout(readingTimer);
  pageImageTask?.cancel();
  annotationUI.reset();
  detachChat();documentId='';deliveryUI.documentChanged();
  docGeneration++; textCache = new Map(); selected = ''; selectedPage = ''; selectedEndPage=''; busy = false;
  $('question').value='';updateQuestionPreview();
  $('selection').textContent = 'PDF에서 문장을 선택하고 우클릭하세요.';
  $('page').textContent = ''; $('prepare').disabled = true;
  $('context').hidden = true; invalidatePrompt();
}
async function documentReady() {
  resetDocument();
  fileName = fileName || viewer._docFilename || 'PDF 문서';
  $('document').textContent = `${fileName} · ${viewer.pdfDocument.numPages}페이지`;
  documentId=viewer.pdfDocument.fingerprints[0];deliveryUI.documentChanged();
  annotationUI.ready(documentId);
  updateReadingContext();
  const generation=docGeneration;
  const questionRevisionAtRestore=questionInputRevision;
  readingRestoring=true;
  $('empty').hidden = true;
  try{
    const [saved]=await Promise.all([api('/api/reading?documentId='+encodeURIComponent(documentId)),restoreDocumentChat(),waitForPdfLayout(viewer)]);
    if(generation!==docGeneration)return;
    const questionEdited=questionInputRevision!==questionRevisionAtRestore;
    if(saved){viewer.pdfViewer.pagesRotation=saved.rotation;viewer.pdfViewer.currentScaleValue=saved.zoom;viewer.page=Math.min(saved.page,viewer.pdfDocument.numPages);if(!questionEdited)$('question').value=saved.question;updateQuestionPreview();}
    updateReadingContext();invalidatePrompt();
    status(saved?(questionEdited?`읽던 p. ${viewer.page}와 배율을 복원했습니다. 입력 중인 질문은 유지했습니다.`:`읽던 p. ${viewer.page}와 배율·질문 초안을 복원했습니다.`):'문장을 선택하거나 현재 페이지에 질문하세요. 노트는 이 PC에 자동 저장됩니다.');
  }catch(error){if(generation===docGeneration)status('읽던 위치 복원 실패: '+error.message);}
  finally{if(generation===docGeneration){readingRestoring=false;if(questionInputRevision!==questionRevisionAtRestore)scheduleReading();updateSend();}}
}
function readingSnapshot(){
  if(!documentId || !viewer?.pdfDocument || readingRestoring)return null;
  const zoom=viewer.pdfViewer.currentScaleValue;
  return {documentId,page:viewer.page,zoom:typeof zoom==='string' && /^\d/.test(zoom)?Number(zoom):zoom,rotation:viewer.pdfViewer.pagesRotation,question:$('question').value.slice(0,10000)};
}
function saveReading(){
  clearTimeout(readingTimer);const value=readingSnapshot();if(!value)return Promise.resolve();
  return api('/api/reading',value).catch(()=>status('읽던 위치를 저장하지 못했습니다. 앱 연결을 확인하세요.'));
}
function scheduleReading(){if(!readingRestoring && documentId){clearTimeout(readingTimer);readingTimer=setTimeout(saveReading,350);}}
window.addEventListener('pagehide',()=>{const value=readingSnapshot();if(value)fetch('/api/reading',{method:'POST',headers:{'Content-Type':'application/json','X-Paper-Reader':'1'},body:JSON.stringify(value),keepalive:true}).catch(()=>{});});
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
    viewer.eventBus.on('documentinit', documentReady);
    viewer.eventBus.on('pagerendered',()=>annotationUI.redraw());
    viewer.eventBus.on('textlayerrendered',()=>annotationUI.redraw());
    viewer.eventBus.on('rotationchanging',()=>{scheduleReading();setTimeout(()=>annotationUI.redraw(),100);});
    viewer.eventBus.on('scalechanging',scheduleReading);
    viewer.eventBus.on('pagechanging',()=>{scheduleReading();if(!selected)invalidatePrompt();else updateReadingContext();});
    doc.getElementById('pageNumber').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();const page=Number(event.target.value);if(Number.isInteger(page) && page>=1 && page<=viewer.pagesCount)viewer.page=page;}});
    if (viewer.pdfDocument && viewer.isInitialViewSet) documentReady();
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
    doc.addEventListener('pointerdown', () => { $('context').hidden = true;closePopovers(); });
    doc.addEventListener('keydown',focusShortcut);
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
  updateReadingContext();updateSend();
  return true;
}
async function openFile(file) {
  if (!viewer || !file || openingPdf) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { status('PDF 파일을 선택해 주세요.'); return; }
  openingPdf=true;$('open').disabled=true;await saveReading();resetDocument(); $('empty').hidden = true; fileName = file.name;
  $('document').textContent = `${file.name} · 여는 중`;
  try { await viewer.open({data: new Uint8Array(await file.arrayBuffer()), originalUrl: file.name}); }
  catch (error) { status(`PDF를 열 수 없습니다: ${error.message}`); $('document').textContent = 'PDF 열기 실패';$('empty').hidden=false; }
  finally{openingPdf=false;$('open').disabled=false;}
}
$('open').onclick = () => $('file').click();
$('file').onchange = async () => { await openFile($('file').files[0]); $('file').value = ''; };
$('sample').onclick = async () => {
  if (!viewer) return;
  await saveReading();resetDocument(); $('empty').hidden = true;
  fileName='compressed.tracemonkey-pldi-09.pdf';
  try { await viewer.open({url: new URL('pdfjs/web/compressed.tracemonkey-pldi-09.pdf', location.href).href}); }
  catch (error) { status(`샘플 열기 실패: ${error.message}`); }
};
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => { event.preventDefault(); openFile(event.dataTransfer.files[0]); });
document.addEventListener('pointerdown', event => { if (!$('context').contains(event.target)) $('context').hidden = true; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') $('context').hidden = true; });
$('ask').onclick = () => { $('context').hidden = true; $('question').focus(); $('question').scrollIntoView({block:'nearest', behavior:'smooth'}); };
function updateQuestionPreview(){renderMarkdown($('question-markdown-preview'),$('question').value);}
$('question').oninput = ()=>{questionInputRevision++;updateQuestionPreview();invalidatePrompt();scheduleReading();};
updateQuestionPreview();
$('prepare').onclick = async automatic => {
  if(searchingPDF()){status('AI가 문맥 찾기는 질문을 보낼 때 PDF를 등록합니다. 본문을 미리 질문에 붙이지 않습니다.');return;}
  const notify=message=>{if(automatic!==true)status(message);};
  if (!viewer?.pdfDocument || busy || autoController || answerController || chatBusy) return;
  const question=$('question').value.trim();
  if (!question) { status('질문을 입력해 주세요.'); return; }
  if(chat && chat.documentId!==documentId){status('이 대화에 연결된 PDF를 열거나 새 대화를 시작하세요.');return;}
  const pdf=viewer.pdfDocument,generation=docGeneration,selection=selected,{startPage,endPage,window:contextWindow}=currentContext();
  busy=true;invalidatePrompt(false);const revision=promptRevision;
  const history=historyFor(chat?.entries || [],historyTurns),numbers=pageWindow(contextWindow==='auto'?'all':contextWindow,startPage,endPage,pdf.numPages);
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
      prepared={prompt:result.text,question,selection,pageLabel:result.pageLabel,pdfWindow:contextWindow,pages:numbers,historyCount:history.length};
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
    const meta=document.createElement('p');meta.className='chat-meta';meta.textContent=entry.pageLabel+' · '+(entry.source==='chatgpt-link'?'완료 · 논문 노트 저장':({complete:'완료',pending:'응답 중',interrupted:'중단된 응답',exported:entry.linkSelectionId?'질문 기록 · Link 답변 대기':'질문 기록 · 웹 답변 미등록'}[entry.status] || entry.status));
    const quote=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');summary.textContent='당시 선택 문장 · 문맥';text.textContent=entry.selection+'\nPDF 페이지: '+(entry.pages?.join(', ') || '선택 문장만')+' · 이전 대화 '+(entry.historyCount || 0)+'회';quote.append(summary,text);
    const answer=document.createElement('div');answer.className='chat-answer markdown-body';renderMarkdown(answer,entry.answer || (entry.status==='exported'?'ChatGPT에서 답변을 확인하세요.':''));
    if(entry.autoContext){text.textContent+='\nAuto: '+entry.autoContext.reason+' · '+entry.autoContext.source;if(entry.autoContext.agentUsage?.inputTokens!=null)text.textContent+=' · 선택용 실제 입력 '+entry.autoContext.agentUsage.inputTokens+' tokens';}
    article.append(title,meta,quote,answer);
    if(!entry.test && chat?.documentId===documentId){
      const page=Number(entry.pageLabel.match(/\d+/)?.[0]);
      if(page>=1 && page<=viewer?.pdfDocument?.numPages){const source=document.createElement('button');source.type='button';source.className='chat-source';source.textContent='원문 '+entry.pageLabel+' ↗';source.onclick=()=>{viewer.page=page;};meta.append(' · ',source);}
    }
    if(entry.status==='exported' || entry.source==='chatgpt-web') {
      const importButton=document.createElement('button');importButton.className='import-answer-button';importButton.textContent=entry.source==='chatgpt-web'?'가져온 답변 수정':'답변 붙여넣기';
      importButton.onclick=()=>openAnswerImport(entry);article.append(importButton);
    }
    if(entry.source==='chatgpt-web'){const source=document.createElement('p');source.className='chat-token-usage';source.textContent='ChatGPT 웹에서 가져온 답변';article.append(source);}
    if(entry.source==='chatgpt-link'){
      const source=document.createElement('p');source.className='chat-token-usage';source.textContent='ChatGPT에서 Link로 저장한 답변';
      if(chat?.documentId===documentId){const note=document.createElement('button');note.type='button';note.textContent='논문 노트 보기 ↗';note.onclick=()=>{if(!annotationUI.open(entry.annotationId))status('이 노트는 수정되거나 삭제되었습니다. 질문 기록의 답변은 보관됩니다.');};source.append(' · ',note);}article.append(source);
    }
    if(entry.status==='complete' && !['chatgpt-web','chatgpt-link'].includes(entry.source)){const usage=document.createElement('p');usage.className='chat-token-usage';usage.textContent=entry.usage?.inputTokens!=null?'실제 입력 '+entry.usage.inputTokens.toLocaleString()+' tokens'+(entry.usage.cachedTokens!=null?' · 캐시 '+entry.usage.cachedTokens.toLocaleString():''):'실제 입력 토큰 · 서버 미제공';article.append(usage);}
    return article;
  });
  clearTimeout(answerRenderTimer);answerRenderTimer=null;
  log.replaceChildren(...nodes);
  if(!nodes.length){const hint=document.createElement('p');hint.className='chat-empty-hint';hint.textContent=requestMode==='plan'?'PDF 아래에서 질문을 보내면 답변이 여기에 표시됩니다.':'질문을 보내거나 복사하면 이곳에 기록됩니다. ChatGPT의 답변은 웹 대화에서 확인하세요. Link로 저장한 답변은 위의 논문 노트에 모입니다.';log.append(hint);}
  log.scrollTop=follow?log.scrollHeight:scroll;
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
async function refreshLinkChat(){
  if(!chat || chatBusy || answerController)return;
  const current=chat,revision=chatRevision;
  const saved=await api('/api/chat/get',{id:current.id});
  if(chat!==current || revision!==chatRevision || chatBusy || answerController)return;
  if(JSON.stringify(current.entries)!==JSON.stringify(saved.entries)){chat=saved;renderChat();await refreshChats();}
}
async function saveLinkExport(linked,input){
  const revision=chatRevision;
  let current=chat?.documentId===input.documentId?chat:null;
  if(!current){
    const records=await api('/api/chats'),match=records.find(item=>item.documentId===input.documentId);
    current=match?await api('/api/chat/get',{id:match.id}):await api('/api/chat/new',{documentId:input.documentId,fileName:input.fileName});
  }
  const turn={question:input.question,selection:linked.scope==='page'?'':input.quote,pageLabel:'p. '+linked.pages.join(', '),pages:linked.pages,pdfWindow:'page',historyCount:0,linkSelectionId:linked.selectionId};
  await api('/api/chat/export',{id:current.id,turn});
  current=await api('/api/chat/get',{id:current.id});
  // Recording belongs to the immutable share, even if the visible PDF changed
  // while ChatGPT's composer was receiving the question.
  if(revision===chatRevision && documentId===input.documentId && (!chat||chat.id===current.id)){
    chat=current;renderChat();await refreshChats();
  }
}
async function saveExport(linked,input) {
  if(linked?.selectionId&&input)return saveLinkExport(linked,input);
  const snapshot=prepared,revision=chatRevision;
  if(!snapshot || snapshot.exported)return;
  chatBusy=true;updateSend();
  try {
    const current=await ensureChat();if(revision!==chatRevision)return;
    snapshot.recordId??=crypto.randomUUID();
    const entry=await api('/api/chat/export',{id:current.id,turn:{...turnMetadata(snapshot),clientEntryId:snapshot.recordId,...(linked?.selectionId?{linkSelectionId:linked.selectionId}:{})}});
    snapshot.exported=true;if(revision===chatRevision){if(!current.entries.some(item=>item.id===entry.id))current.entries.push(entry);renderChat();await refreshChats();}
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
  finally{$('pdf-window').value=pdfWindow;$('history-window').value=String(historyTurns);$('auto-budget').value=String(autoBudget);savingSettings=false;invalidatePrompt();renderChat();}
};

async function api(url, body, signal) {
  const response = await fetch(url,{signal,headers:{'X-Paper-Reader':'1',...(body!==undefined?{'Content-Type':'application/json'}:{})},method:body!==undefined?'POST':'GET',...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data = await response.json();
  refreshStorage(!response.ok).catch(()=>{});
  if(!response.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}
async function refreshStorage(force=false){
  if(storageChecking||!force&&Date.now()-storageChecked<5000)return;storageChecking=true;storageChecked=Date.now();
  try{
    const response=await fetch('/api/storage/status',{headers:{'X-Paper-Reader':'1'}});if(!response.ok)return;
    const value=await response.json(),stores=(value.stores||[]).filter(Boolean),notices=stores.flatMap(store=>store.notices||[]);
    const total=stores.reduce((sum,store)=>sum+(store.quarantined||0),0);
    $('storage-notice-open').hidden=!notices.length&&!total;
    const messages=notices.map(notice=>notice.message);if(total)messages.push('별도로 보관한 손상 파일 '+total+'개가 있습니다.');
    $('storage-notices').replaceChildren(...messages.map(message=>{const item=document.createElement('li');item.textContent=message;return item;}));
  }finally{storageChecking=false;}
}
$('storage-retry').onclick=async()=>{
  $('storage-retry').disabled=true;
  try{await api('/api/storage/retry',{documentId:documentId||null});await refreshChats();if(documentId){await annotationUI.refresh();if(!chat)await restoreDocumentChat();}await refreshStorage(true);$('storage-retry-status').textContent='기록을 다시 확인했습니다.';}
  catch(error){$('storage-retry-status').textContent=error.message;}
  finally{$('storage-retry').disabled=false;}
};
function renderHeaderAccount() {
  const connected=!!authState?.connected;
  const account=connected?authState.account:usageState?.account;
  const identity=account?.email || account?.name || (connected?'ChatGPT 계정':'로그인 필요');
  $('header-account').textContent=identity;
  $('header-account').title=identity;
  $('header-account-source').textContent=connected?'앱 연결':usageState?'Codex':'미연결';
  $('header-avatar').textContent=account?(identity[0] || 'P').toUpperCase():'P';
  $('reader-account-detail').textContent=connected?identity:'로그인되지 않음';
  if(requestMode==='manual'){
    $('header-account').textContent='ChatGPT';$('header-account').title='현재 대화하는 ChatGPT의 계정과 한도를 사용합니다.';
    $('header-account-source').textContent='기본 모드';$('header-avatar').textContent='C';
    $('reader-account-detail').textContent='ChatGPT의 프로필 메뉴에서 확인';
    $('usage-status').hidden=true;$('usage-account-warning').hidden=true;
    $('usage-summary').textContent=webPanelUI.available?'계정·사용량은 오른쪽 ChatGPT에서 확인':'계정·사용량은 ChatGPT에서 확인';$('usage-summary').title=$('usage-summary').textContent;$('usage-summary').hidden=false;
  }
}
$('account-settings').onclick=()=>{$('usage-popover').hidePopover();$('settings-open').click();};
function renderUsage() {
  renderHeaderAccount();
  const manual=requestMode==='manual';
  $('usage-description').textContent=manual?'현재 ChatGPT에서 로그인한 계정과 선택한 모델을 사용합니다. Paper Reader는 ChatGPT의 로그인 이메일과 남은 한도를 읽지 않습니다. ChatGPT 프로필과 사용량 안내에서 확인하세요.':'이 PC에 로그인된 Codex 계정의 전체 사용량입니다. PDF 앱 로그인과 별도로 조회하며 AI 질문은 보내지 않습니다.';
  $('reader-account-label').textContent=manual?'ChatGPT 계정':'Paper Reader 앱 연결';
  $('refresh-usage').hidden=manual;$('usage-result').hidden=manual || !usageState;
  if(manual)return;
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
  $('prepare').disabled=!viewer?.pdfDocument || working || !!answerController || chatBusy || savingSettings || (!!chat && chat.documentId!==documentId);
  for(const id of ['pdf-window','history-window','auto-budget'])$(id).disabled=working || !!answerController || savingSettings;
  $('chat-choice').disabled=chatBusy; $('new-chat').disabled=chatBusy; $('delete-chat').disabled=chatBusy || !chat;
  const ready = !chatBusy && !working && requestMode==='plan' && !savingSettings && authState?.planEnabled && !!$('model').value && !answerController;
  const canAsk=!!viewer?.pdfDocument && !!$('question').value.trim() && (!chat || chat.documentId===documentId) && !working && !chatBusy && !readingRestoring;
  $('send').disabled = !ready || !canAsk;
  $('send').title=!authState?.planEnabled?'환경 설정에서 ChatGPT 계정을 연결하세요.':!viewer?.pdfDocument?'PDF를 먼저 열어주세요.':'Ctrl+Enter';
  $('connection-test').disabled = !ready;
  $('cancel-answer').hidden = !answerController && !autoController;
  $('open-chatgpt').disabled = requestMode!=='manual' || savingSettings || openingChatGPT || !canAsk;
  $('copy-manual').disabled=$('open-chatgpt').disabled;
  $('link-share').hidden=manualDelivery!=='link';
  $('copy-manual').hidden=manualDelivery==='link';$('open-chatgpt').hidden=manualDelivery==='link';
  $('manual-delivery').disabled=savingSettings || openingChatGPT || !!answerController || !!linkUI?.busy;
  $('pdf-search').disabled=!pdfSearchAvailable || savingSettings || busy || !!linkUI?.busy;
  $('link-save-answer').disabled=savingSettings || busy || !!linkUI?.busy;
  $('link-save-option').hidden=requestMode!=='manual' || manualDelivery!=='link';
  $('pdf-search-option').hidden=requestMode!=='manual' || manualDelivery!=='link';
  $('context-options-manual').hidden=searchingPDF();$('preview').hidden=searchingPDF();$('history-status').hidden=searchingPDF();
  const anchor=annotationUI.selectionSnapshot();
  $('link-share').disabled=requestMode!=='manual' || !canAsk || (selected && anchor?.quote!==selected) || savingSettings || !!linkUI?.busy;
  $('link-share').title=!viewer?.pdfDocument?'PDF를 먼저 열어주세요.':!$('question').value.trim()?'질문을 입력하거나 위의 질문 도구를 선택하세요.':`선택 문장 또는 현재 페이지 질문을 ${webPanelUI.canSend?'오른쪽 ChatGPT로 전송':'복사'} · Ctrl+Enter`;
  linkUI?.updateRecovery();
  $('settings-save').disabled = working || savingSettings || !!answerController || openingChatGPT;
}
function applyMode(mode) {
  requestMode=mode;webPanelUI.setMode(mode);renderChat();
  const direct=mode==='plan';
  $('account-card').hidden=!direct;
  $('model-settings').hidden=!direct;
  $('plan-controls').hidden=!direct;
  $('manual-controls').hidden=mode!=='manual';
  $('mode-title').textContent=direct?'앱에서 직접 요청':'ChatGPT에서 직접 질문';
  $('mode-description').textContent=direct?'앱 안에서 답변받습니다. Codex / ChatGPT Work 공유 사용량 또는 허용한 크레딧을 사용합니다.':'PDF 아래에서 ChatGPT Link 또는 복사 후 붙여넣기를 선택하세요. 저장 옵션을 켜면 Link 답변을 논문 노트로 받을 수 있습니다.';
  renderUsage();
  updateReadingContext();
  updateSend();
}
$('manual-delivery').onchange=async()=>{
  const next=$('manual-delivery').value;savingSettings=true;updateSend();
  try{const saved=await api('/api/settings',{mode:requestMode||'manual',manualDelivery:next});manualDelivery=saved.manualDelivery;
    status(manualDelivery==='link'?'문장 또는 현재 페이지로 질문할 수 있습니다. 저장을 원하면 질문창 옆의 저장 옵션을 체크하세요.':'질문을 복사해 ChatGPT에서 전송하세요.');}
  catch(error){status('전달 방식을 저장하지 못했습니다: '+error.message);}
  finally{$('manual-delivery').value=manualDelivery;savingSettings=false;updateReadingContext();updateSend();}
};
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
    if(webPanelUI.available){annotationUI.close();setReadingFocus(false);await webPanelUI.show();status('복사 완료 · 오른쪽 ChatGPT 입력창을 클릭하고 Ctrl+V로 붙여넣어 전송하세요. 대화는 웹 탭에 유지됩니다.');return;}
    const result=await api('/api/open-chatgpt',{});
    $('chatgpt-fallback').hidden=result.opened;
    status(result.opened?'복사 완료 · ChatGPT에서 Ctrl+V → 전송. 받은 답변은 오른쪽의 ‘답변 붙여넣기’로 보관하세요.':'복사 완료 · ChatGPT 직접 열기를 누른 뒤 Ctrl+V로 붙여넣으세요.');
  } catch(error) {$('chatgpt-fallback').hidden=false;status('복사 이후 처리에 실패했습니다: '+error.message);}
  finally {openingChatGPT=false;updateSend();}
}
$('open-chatgpt').onclick=()=>exportToChatGPT(true);
$('copy-manual').onclick=()=>exportToChatGPT(false);
linkUI=createLinkUI({api,status,updateSend,writeClipboard,onPdfAvailability:available=>{pdfSearchAvailable=available;updateReadingContext();updateSend();},onPage:page=>{viewer.page=page;frame.focus();},recordQuestion:saveExport,getDocumentId:()=>documentId,openNote:id=>annotationUI.open(id),onAnnotations:async()=>{const refreshed=await annotationUI.refresh();if(refreshed!==false)await refreshLinkChat();return refreshed;},sendToChatGPT:webPanelUI.canSend?async(text,id)=>{annotationUI.close();setReadingFocus(false);return webPanelUI.send(text,id);}:null,prepare:async()=>{
  if(busy || answerController || autoController || chatBusy)throw new Error('문맥 준비 또는 진행 중인 요청이 끝나면 다시 보내세요.');
  const generation=docGeneration,page=viewer.page,question=$('question').value.trim(),selection=selected,location=selected?annotationUI.selectionSnapshot():pageNote(viewer.page,viewer.pdfViewer.pagesRotation);
  if(!documentId || !location || (selected && (location.quote!==selected || location.anchors[0].page!==Number(selectedPage))))throw new Error('PDF에서 주석을 연결할 문장을 다시 선택하세요.');
  if(searchingPDF()){
    const pdf=viewer.pdfDocument,id=documentId,name=fileName,revision=promptRevision;
    status('질문 당시 PDF를 고정하고 검색 색인을 준비합니다…');
    const bytes=await pdf.getData();
    if(generation!==docGeneration || revision!==promptRevision)throw new Error('질문 또는 문서가 바뀌었습니다. 다시 보내세요.');
    if(bytes.byteLength>64*1024*1024)throw new Error('PDF 전체 공유는 최대 64 MiB입니다. 문맥 설정에서 발췌 모드를 선택하세요.');
    const result=await fetch('/api/link/pdf?'+new URLSearchParams({documentId:id,fileName:name}),{method:'POST',headers:{'X-Paper-Reader':'1','Content-Type':'application/pdf'},body:bytes});
    const registration=await result.json();if(!result.ok)throw new Error(registration.error);
    if(generation!==docGeneration || revision!==promptRevision || (!selection && page!==viewer.page))throw new Error('질문 또는 문서가 바뀌었습니다. 다시 보내세요.');
    prepared={question,selection,pages:[page],pageLabel:'p. '+page,pdfWindow:'page',historyCount:0,prompt:question};
    const quality=registration.textQuality;
    $('token-estimate').textContent=quality&&quality.status!=='searchable'?`${registration.pageCount}페이지 준비 · 텍스트 부족·손상 페이지가 있습니다. 관련 페이지는 AI가 이미지로 확인합니다.`:`${registration.pageCount}페이지 검색 준비 완료 · 본문/이미지는 ChatGPT가 요청할 때 전달`;
    return {documentId:id,fileName:name,...location,question,context:'',snapshotId:registration.snapshotId};
  }
  if(!prepared)await $('prepare').onclick();
  if(!prepared || generation!==docGeneration || prepared.selection!==selection || prepared.question!==question || (!selection && page!==viewer.page))throw new Error('질문 또는 문서가 바뀌었습니다. 내용을 확인하고 다시 보내세요.');
  return {documentId,fileName,...location,question:prepared.question,context:prepared.prompt};
}});
$('pdf-search').checked=pdfSearch;
async function saveSharePreference(key,control){
  const previous=key==='pdfSearch'?pdfSearch:linkAllowSave,next=control.checked;
  savingSettings=true;updateSend();
  try{const saved=await api('/api/settings',{[key]:next});if(key==='pdfSearch')pdfSearch=saved.pdfSearch;else linkAllowSave=saved.linkSaveAnswer;invalidatePrompt();}
  catch(error){control.checked=previous;status('공유 설정을 저장하지 못했습니다: '+error.message);}
  finally{savingSettings=false;updateReadingContext();updateSend();}
}
$('pdf-search').onchange=()=>saveSharePreference('pdfSearch',$('pdf-search'));
$('link-save-answer').onchange=()=>saveSharePreference('linkSaveAnswer',$('link-save-answer'));
let importTarget=null,importSaving=false;
function openAnswerImport(entry) {
  if(chatBusy || answerController || !chat)return;
  importTarget={chatId:chat.id,entryId:entry.id};
  $('import-answer-question').textContent=entry.question;
  $('import-answer-text').value=answerDrafts.get(chat.id+':'+entry.id)??entry.answer??'';$('import-answer-status').textContent='';
  $('import-answer-dialog').showModal();$('import-answer-text').focus();
}
$('import-answer-text').addEventListener('input',()=>{if(importTarget)answerDrafts.set(importTarget.chatId+':'+importTarget.entryId,$('import-answer-text').value);});
$('import-answer-copy').onclick=async()=>{try{await writeClipboard($('import-answer-text').value);$('import-answer-status').textContent='답변 초안을 복사했습니다.';}catch{$('import-answer-text').focus();$('import-answer-text').select();$('import-answer-status').textContent='Ctrl+C로 답변을 복사하세요.';}};
$('import-answer-cancel').onclick=()=>{if(!importSaving)$('import-answer-dialog').close();};
$('import-answer-dialog').addEventListener('cancel',event=>{if(importSaving)event.preventDefault();});
$('import-answer-form').onsubmit=async event=>{
  event.preventDefault();if(importSaving || !importTarget)return;
  const target=importTarget;importSaving=true;$('import-answer-text').disabled=true;$('import-answer-save').disabled=true;$('import-answer-cancel').disabled=true;
  try {
    const entry=await api('/api/chat/import-answer',{id:target.chatId,entryId:target.entryId,answer:$('import-answer-text').value});
    if(chat?.id===target.chatId){const index=chat.entries.findIndex(item=>item.id===entry.id);if(index>=0)chat.entries[index]=entry;invalidatePrompt();renderChat();}
    answerDrafts.delete(target.chatId+':'+target.entryId);await refreshChats();$('import-answer-dialog').close();status('답변을 저장했습니다. 다음 질문의 이전 대화 문맥에 포함됩니다.');
  }catch(error){$('import-answer-status').textContent=error.message;}
  finally{importSaving=false;$('import-answer-text').disabled=false;$('import-answer-save').disabled=false;$('import-answer-cancel').disabled=false;}
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
$('question').onkeydown=event=>{if(event.key==='Enter' && (event.ctrlKey || event.metaKey)){event.preventDefault();const button=$(requestMode==='plan'?'send':event.shiftKey?'copy-manual':manualDelivery==='link'?'link-share':'open-chatgpt');if(button.disabled)status(button.title || '문맥을 준비하고 있습니다. 잠시 후 다시 보내세요.');else button.click();}};
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
try {const saved=await api('/api/settings');if(saved.panelWidth){desiredPanelWidth=saved.panelWidth;resizePanel();}manualDelivery=saved.manualDelivery||'link';$('manual-delivery').value=manualDelivery;pdfSearch=saved.pdfSearch===true;linkAllowSave=saved.linkSaveAnswer===true;$('pdf-search').checked=pdfSearch;$('link-save-answer').checked=linkAllowSave;applyMode(saved.mode);pdfWindow=saved.pdfWindow || 'near1';historyTurns=saved.historyTurns ?? 3;autoBudget=saved.autoBudget || 8000;$('auto-budget').value=String(autoBudget);$('pdf-window').value=pdfWindow;$('history-window').value=String(historyTurns);updateReadingContext();}
catch(error) {$('mode-title').textContent='설정을 불러오지 못했습니다';$('mode-description').textContent='환경 설정에서 모드를 선택해 저장하세요. '+error.message;}
await refreshAuth();
if(requestMode==='plan')$('refresh-usage').click();

try{await refreshChats();if(!documentId && chatList.length)await loadChat(chatList[0].id);}catch(error){$("chat-status").textContent="저장된 대화를 불러오지 못했습니다: "+error.message;}
