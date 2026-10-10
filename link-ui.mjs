const $=id=>document.getElementById(id);
export function createLinkUI({api,prepare,onAnnotations,status,updateSend,getDocumentId,openNote}){
  let busy=false,revision=-1,timer,polling=false,latest=null,notice=null;
  function render(){
    const current=getDocumentId(),shared=latest?.documentId===current?latest:null;
    const message=notice?.documentId===current?notice.message:shared?(shared.saved?'답변이 p. '+shared.pages.join(', ')+'의 논문 노트에 도착했습니다.':'p. '+shared.pages.join(', ')+' 준비 완료 · ChatGPT Link 카드에서 문장을 불러와 전송하세요.') : '';
    $('link-activity').hidden=!message;$('link-activity-text').textContent=message;
    $('link-activity').dataset.state=shared?.saved?'saved':'pending';
    $('link-open-note').hidden=!shared?.annotationId;
  }
  async function refresh(){
    if(polling)return;polling=true;clearTimeout(timer);
    try{
      const value=await api('/api/link/status');
      $('link-indicator').classList.toggle('is-connected',value.enabled);
      $('link-indicator').textContent=value.enabled?'Link 연결':'Link 설정';
      $('link-disconnect').disabled=!value.enabled;
      $('link-connection-status').textContent=!value.enabled?'공유할 때 연결이 켜집니다.':value.lastContactAt?'플러그인이 연결되었습니다.':'앱 연결 준비 완료 · ChatGPT 플러그인 연결을 기다립니다.';
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
    busy=true;notice={documentId:getDocumentId(),message:'선택 문장과 질문을 준비하고 있습니다…'};render();updateSend();
    $('link-share').textContent='준비 중…';
    try{
      const input=await prepare();if(!input)return;
      const result=await api('/api/link/share',{...input,allowSave:$('link-save-answer').checked});
      latest={...result,documentId:input.documentId};notice=null;render();
      $('link-share-status').textContent='p. '+result.pages.join(', ')+' 공유 완료 · ChatGPT의 Paper Reader Link에서 「선택 문장 불러오기」를 누르세요.';
      status('Link에 질문을 준비했습니다. ChatGPT의 Link 카드에서 전송하면 대화가 이어집니다.');
      await refresh();
    }catch(error){$('link-share-status').textContent=error.message;notice={documentId:notice?.documentId||getDocumentId(),message:error.message};render();status(error.message);}
    finally{busy=false;$('link-share').textContent='Link로 질문 준비';updateSend();}
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
