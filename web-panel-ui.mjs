export function webPanelObstructed({overlays,notesOpen,resizing,readingFocus,host}){
  return notesOpen||resizing||readingFocus||overlays.some(overlay=>{
    if(!overlay.readerEditor||overlay.modal)return true;
    const box=overlay.bounds;
    return box.right>host.x&&box.x<host.right&&box.bottom>host.y&&box.y<host.bottom;
  });
}
export function createWebPanelUI({status}) {
  const $=id=>document.getElementById(id),bridge=window.paperDesktop;
  let mode=null,showWeb=true,scheduled=false,lastLayout='';
  function schedule(){if(scheduled || !bridge)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;sync();});}
  async function sync(){
    if(!bridge)return;
    const rect=$('chatgpt-host').getBoundingClientRect();
    const overlays=[...document.querySelectorAll('dialog[open],:popover-open')].map(node=>({readerEditor:node.id==='annotation-dialog'&&node.dataset.readerEditor==='true',modal:node.matches(':modal'),bounds:node.getBoundingClientRect()}));
    const blocked=webPanelObstructed({overlays,notesOpen:!$('annotation-panel').hidden,resizing:document.body.classList.contains('resizing-panels'),readingFocus:document.body.classList.contains('reading-focus'),host:rect});
    const input={visible:mode==='manual' && showWeb && !blocked,x:rect.x,y:rect.y,width:rect.width,height:rect.height};
    const key=JSON.stringify(input);if(key===lastLayout)return;lastLayout=key;
    try{await bridge.setWebPanel(input);}catch{lastLayout='';$('web-state').textContent='웹 연결 실패 · 브라우저로 열 수 있습니다.';}
  }
  function render(){
    const available=!!bridge && mode==='manual',visible=available && showWeb;
    $('web-panel-tabs').hidden=!available;$('chatgpt-workspace').hidden=!visible;
    for(const id of ['document','answer','answer-status'])$(id).hidden=visible;
    $('chat-panel').classList.toggle('showing-web',visible);
    $('chat-panel').querySelector('h2').textContent=visible?'ChatGPT 대화':mode==='plan'?'AI 대화':'질문 기록';
    if(mode==='manual')$('manual-delivery').options[0].textContent=bridge?'ChatGPT 전송 + 노트 연결':'질문 복사 + 노트 연결';
    $('web-tab').setAttribute('aria-pressed',String(visible));$('records-tab').setAttribute('aria-pressed',String(!visible));
    $('open-chatgpt').textContent=available?'복사하고 ChatGPT 보기':'복사하고 ChatGPT 열기 ↗';
    schedule();
  }
  async function command(value){try{return await bridge.webCommand(value);}catch(error){status('ChatGPT 웹 동작을 완료하지 못했습니다. '+error.message);}}
  $('web-tab').onclick=()=>{showWeb=true;render();};$('records-tab').onclick=()=>{showWeb=false;render();};
  for(const [id,value] of [['web-back','back'],['web-reload','reload'],['web-home','home'],['web-external','external']])$(id).onclick=()=>command(value);
  if(bridge){
    bridge.onWebState(state=>{
      $('web-state').textContent=state.error || (state.loading?'불러오는 중…':'ChatGPT 웹');
      $('web-state').title=state.error || state.url;$('web-back').disabled=!state.canGoBack;
      $('chatgpt-host').firstElementChild.textContent=state.error || 'ChatGPT 웹을 유지하고 있습니다.';
    });
    new ResizeObserver(schedule).observe($('chatgpt-host'));
    new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['open','hidden','class'],subtree:true});
    document.addEventListener('toggle',schedule,true);document.addEventListener('close',schedule,true);document.addEventListener('scroll',schedule,true);
    window.addEventListener('resize',schedule);
  }
  async function show(){showWeb=true;render();await sync();await command('focus');}
  const cleanError=error=>new Error(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));
  return {available:!!bridge,canSend:typeof bridge?.sendWebQuestion==='function',setMode(value){mode=value;render();},show,async send(text,requestId){await show();try{return await bridge.sendWebQuestion({text,requestId});}catch(error){throw cleanError(error);}}};
}
