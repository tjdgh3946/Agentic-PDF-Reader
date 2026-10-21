import {linkQuestion} from './link-question.mjs';
const $=id=>document.getElementById(id);
export function createLinkUI({api,prepare,onAnnotations,status,updateSend,getDocumentId,openNote,onPage,onPdfAvailability,sendToChatGPT,writeClipboard,recordQuestion}){
  let busy=false,revision=-1,timer,polling=false,latest=null,notice=null;
  let lastRequest=null;
  const buttonLabel=sendToChatGPT?'ChatGPT에 질문 보내기':'질문 복사';
  $('link-share').textContent=buttonLabel;
  $('link-share').title=sendToChatGPT?'선택 문장과 질문을 오른쪽 ChatGPT 대화로 전송 · Ctrl+Enter':'선택 문장과 질문을 준비 · Ctrl+Enter';
  function render(){
    const current=getDocumentId(),shared=latest?.documentId===current?latest:null;
    const message=notice?.documentId===current && notice.state==='error'?notice.message:shared?.saved?'답변이 p. '+shared.pages.join(', ')+'의 논문 노트에 도착했습니다.':notice?.documentId===current?notice.message:shared?'p. '+shared.pages.join(', ')+' 공유됨 · ChatGPT에 복사한 질문을 붙여넣으세요.':'';
    $('link-activity').hidden=!message;$('link-activity-text').textContent=message+(shared?.historyError?' 노트는 저장됐지만 질문 기록 갱신에 실패했습니다. 같은 저장 요청으로 재시도할 수 있습니다.':'');
    $('link-activity').dataset.state=notice?.state==='error'?'error':shared?.saved?'saved':'pending';
    $('link-open-note').hidden=!shared?.annotationId;
    $('link-copy').hidden=!sendToChatGPT || lastRequest?.input.documentId!==current || lastRequest.result.allowSave!==$('link-save-answer').checked;
    const trace=shared?.trace||[];
    $('link-evidence').hidden=!trace.length;
    const labels={inspect_pdf:'문서 확인',query_pdf:'본문 검색',read_pdf:'페이지 읽기',render_pdf_page:'이미지 확인'};
    $('link-trace').textContent=trace.slice(-4).map(event=>`${labels[event.tool]} ${event.state==='running'?'중…':event.state==='error'?'실패':'완료'}`).join(' → ');
    const pages=[...new Set(trace.flatMap(event=>event.pages))].sort((a,b)=>a-b);
    $('link-evidence-pages').replaceChildren(...pages.map(page=>{const button=document.createElement('button');button.type='button';button.textContent='p. '+page;button.title='근거 페이지로 이동';button.onclick=()=>onPage?.(page);return button;}));
  }
  async function refresh(){
    if(polling)return;polling=true;clearTimeout(timer);
    try{
      const value=await api('/api/link/status');
      onPdfAvailability?.(value.pdfAvailable);
      $('pdf-search-description').textContent=value.pdfAvailable?'질문 당시 PDF 전체를 공유합니다. ChatGPT가 SQL로 검색하고 수식·도표를 이미지로 확인합니다. Link 플러그인 연결이 필요합니다.':'PDF 전체 검색은 Windows 앱을 실행한 뒤 사용할 수 있습니다.';
      const connected=value.enabled && !!value.lastContactAt;
      $('link-indicator').classList.toggle('is-connected',connected);
      $('link-indicator').textContent=connected?'Link 요청 수신':value.enabled?'Link 요청 대기':'Link 설정';
      $('link-disconnect').disabled=!value.enabled;
      $('link-connection-status').textContent=!value.enabled?'공유할 때 연결이 켜집니다.':value.lastContactAt?'Link 도구 요청을 받았습니다. ChatGPT 연결은 ChatGPT에서 확인하세요.':'앱 연결 준비 완료 · ChatGPT 플러그인 연결을 기다립니다.';
      if(revision!==value.revision){
        if((value.latest?.saved || revision>=0) && await onAnnotations()===false)return;
        if(value.latest?.saved)$('link-share-status').textContent=value.latest.fileName+' · p. '+value.latest.pages.join(', ')+'에 답변을 주석으로 저장했습니다.';
        revision=value.revision;
      }
      latest=value.latest;render();
    }catch(error){$('link-connection-status').textContent='연결 상태 확인 실패: '+error.message;}
    finally{polling=false;timer=setTimeout(refresh,document.hidden?10000:2000);}
  }
  $('link-share').onclick=async()=>{
    if(busy || $('link-share').disabled)return;
    busy=true;notice={documentId:getDocumentId(),message:'질문과 PDF 문맥을 준비하고 있습니다…'};render();updateSend();
    $('link-share').textContent='준비 중…';
    try{
      const input=await prepare();if(!input)return;
      const key=JSON.stringify({...input,allowSave:$('link-save-answer').checked});
      const result=lastRequest?.key===key && Date.parse(lastRequest.result.expiresAt)>Date.now()?lastRequest.result:await api('/api/link/share',{...input,allowSave:$('link-save-answer').checked});
      lastRequest={key,result,input};
      latest={...result,documentId:input.documentId};notice=null;render();
      $('link-share-status').textContent='p. '+result.pages.join(', ')+' 공유 완료 · ChatGPT의 Paper Reader Link에서 「선택 문장 불러오기」를 누르세요.';
      if(sendToChatGPT){
        $('link-share').textContent='전송 중…';
        await sendToChatGPT(linkQuestion(result),result.selectionId);
        notice={documentId:input.documentId,message:'p. '+result.pages.join(', ')+' 질문 전송 완료 · 오른쪽 ChatGPT에서 대화를 이어가세요.'};render();
        $('link-share-status').textContent=notice.message;status(notice.message);
      }else{
        await writeClipboard(linkQuestion(result));
        notice={documentId:input.documentId,message:'질문 복사 완료 · ChatGPT 입력창에 Ctrl+V로 붙여넣어 전송하세요.'};render();status(notice.message);
      }
      try{await recordQuestion?.(result,input);}catch{status(notice.message+' 질문 기록 저장에 실패했습니다.');}
      await refresh();
    }catch(error){$('link-share-status').textContent=error.message;notice={documentId:notice?.documentId||getDocumentId(),message:error.message,state:'error'};render();status(error.message);}
    finally{busy=false;$('link-share').textContent=buttonLabel;updateSend();}
  };
  $('link-copy').onclick=async()=>{
    if(lastRequest?.input.documentId!==getDocumentId())return;
    if(lastRequest.result.allowSave!==$('link-save-answer').checked){status('저장 옵션이 바뀌었습니다. 질문 보내기로 새 질문을 준비하세요.');return;}
    try{await writeClipboard(linkQuestion(lastRequest.result));status('준비한 질문을 복사했습니다. 중복 전송을 피하려면 오른쪽 대화를 먼저 확인한 뒤 붙여넣으세요.');}
    catch(error){status('질문 복사 실패: '+error.message);}
  };
  $('link-open-note').onclick=()=>{
    if(latest?.documentId!==getDocumentId())return;
    if(!openNote(latest.annotationId))status('현재 문서에서 이 노트를 찾을 수 없습니다. 삭제되었는지 논문 노트에서 확인하세요.');
  };
  $('link-disconnect').onclick=async()=>{
    try{await api('/api/link/enable',{enabled:false});notice=null;$('link-share-status').textContent='공유 문장을 모두 해제했습니다. 이미 저장한 주석은 보관됩니다.';await refresh();}
    catch(error){$('link-share-status').textContent=error.message;}
  };
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  refresh();
  return {render,get busy(){return busy;}};
}
