const $=id=>document.getElementById(id);
const labels={read_pdf:'문단 읽기',expand_pdf:'문맥 확장',search_pdf:'문단 검색',query_pdf:'SQL 검색',render_pdf_page:'페이지 이미지'};
const deliveryLabel=item=>item.kind==='image'?item.delivery==='reference'?'이미지 참조 · PNG 없음':item.delivery==='resend'?'이미지 재전송':'이미지 반환':item.delivery==='reference'?'본문 참조 · 0자':item.delivery==='reread'?'본문 재읽기':item.kind==='search'?'검색 결과 반환':'본문 반환';
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
export const previousDelivery=(events,eventId,ref)=>events.slice(0,events.findIndex(event=>event.id===eventId)).reverse().find(event=>event.items.some(item=>item.ref===ref&&item.delivery!=='reference'));
export function createDeliveryUI({api,getDocumentId,onPage}){
  const dialog=$('delivery-dialog'),list=$('delivery-list'),status=$('delivery-status'),share=$('delivery-share'),filter=$('delivery-filter');
  let state=null,generation=0;
  function render(){
    list.replaceChildren();const events=state?.events||[];
    const counts={text:0,image:0,reference:0,recovery:0};for(const event of events)for(const item of event.items){if(item.delivery==='reference')counts.reference++;else if(item.kind==='image')counts.image++;else counts.text++;if(['reread','resend'].includes(item.delivery))counts.recovery++;}
    $('delivery-counts').textContent=`본문·검색 반환 ${counts.text}건 · 이미지 반환 ${counts.image}건 · 참조만 ${counts.reference}건 · 반환 중 재읽기·재전송 ${counts.recovery}건`;
    $('delivery-retention').textContent=`보관된 항목 기준 · 공유당 최근 40회 / 전체 160회 · 최대 24시간 · PNG 최대 32 MiB · 연결 해제 시 삭제${state?.dropped?' · 이 질문의 이전 '+state.dropped+'개 기록은 보관 한도로 제외됐습니다.':''}`;
    const visible=events.slice().reverse().filter(event=>filter.value==='all'||event.items.some(item=>filter.value==='reference'?item.delivery==='reference':filter.value==='recovery'?['reread','resend'].includes(item.delivery):filter.value==='image'?item.kind==='image':item.kind!=='image'&&item.delivery!=='reference'));
    if(!visible.length){list.append(element('p','delivery-empty',events.length?'선택한 종류의 기록이 없습니다.':'이 공유에 보관된 자료 반환 기록이 없습니다. 이 기능을 추가하기 전의 본문·PNG는 소급 기록하지 않습니다.'));return;}
    for(const event of visible){
      const card=element('article','delivery-event'),heading=element('div','delivery-event-heading');card.dataset.eventId=event.id;heading.append(element('strong','',labels[event.method]||event.method),element('time','',new Date(event.at).toLocaleString('ko-KR')));card.append(heading);
      if(event.state==='error')card.append(element('p','delivery-error','반환 실패 · 본문·이미지를 반환한 것으로 계산하지 않습니다.'));
      if(event.reason){const details=element('details','delivery-reason');details.append(element('summary','','재요청 이유'),element('p','',event.reason));card.append(details);}
      for(const item of event.items){
        const block=element('section','delivery-item'),line=element('div','delivery-item-heading');line.append(element('span','delivery-badge '+(item.delivery==='reference'?'is-reference':['reread','resend'].includes(item.delivery)?'is-recovery':''),deliveryLabel(item)));
        const pages=item.page?[item.page]:item.pages||[];for(const page of pages){const button=element('button','delivery-page','p. '+page);button.type='button';button.onclick=()=>{dialog.close();onPage?.(page);};line.append(button);}block.append(line);
        if(item.passageId)block.append(element('p','delivery-location',item.passageId+' · 원문 위치 '+item.start+'–'+item.end));
        if(item.region)block.append(element('p','delivery-location','영역 ['+item.region.join(', ')+']'+(item.width?' · '+item.width+' × '+item.height+' px':'')));
        if(item.delivery==='reference')block.append(element('p','delivery-reference-note','이 응답에는 원문·PNG가 없습니다. 아래 ID는 이전 전달 기록을 가리키며, ChatGPT가 지금 기억한다는 뜻이 아닙니다.'));
        else if(item.text!==undefined){block.append(element('p','delivery-location','반환한 원문·검색 결과 '+item.characters.toLocaleString()+'자'));const pre=element('pre','delivery-source',item.text);pre.tabIndex=0;block.append(pre);}
        if(item.ref)block.append(element('code','delivery-ref',item.ref));
        if(item.delivery==='reference'){
          const original=previousDelivery(events,event.id,item.ref);
          if(original){const button=element('button','delivery-preview','이전에 반환한 자료 보기');button.type='button';button.onclick=()=>{filter.value='all';render();const target=[...list.children].find(node=>node.dataset.eventId===original.id);target?.scrollIntoView({block:'center',behavior:'smooth'});target?.classList.add('delivery-highlight');};block.append(button);}
          else block.append(element('p','delivery-location','이전 상세 자료는 이 기록의 보관 범위에 없습니다.'));
        }
        if(item.kind==='image'&&item.sha256){
          block.append(element('p','delivery-location',(item.bytes/1024).toFixed(1)+' KiB · 당시 PNG의 SHA-256'),element('code','delivery-ref',item.sha256));
          const button=element('button','delivery-preview','전달한 이미지 보기');button.type='button';const preview=element('div','delivery-image-preview');
          button.onclick=async()=>{button.disabled=true;preview.replaceChildren(element('p','','보관한 PNG를 여는 중…'));const opened=generation,documentId=state.documentId,selectionId=state.selectionId;
            try{const result=await api('/api/link/delivery-image?'+new URLSearchParams({documentId,selectionId,eventId:event.id}));if(opened!==generation)return;const image=element('img');image.alt='Reader가 반환했던 p. '+item.page+' PNG';image.src='data:'+result.mimeType+';base64,'+result.data;preview.replaceChildren(element('p','delivery-preview-note','당시 반환한 PNG입니다. 여기서 열어도 ChatGPT에 재전송하거나 이미지 예산을 사용하지 않습니다.'),image);button.hidden=true;}
            catch(error){if(opened===generation)preview.replaceChildren(element('p','delivery-error',error.message));}finally{button.disabled=false;}
          };block.append(button,preview);
        }
        card.append(block);
      }
      list.append(card);
    }
  }
  async function refresh(){
    const documentId=getDocumentId(),current=++generation;status.textContent='자료 전달 기록을 불러오는 중…';$('delivery-refresh').disabled=true;
    try{
      if(!documentId){state=null;list.replaceChildren(element('p','delivery-empty','PDF를 열면 이 문서의 공유 질문별 자료 전달 기록을 확인할 수 있습니다.'));share.replaceChildren();$('delivery-counts').textContent='';$('delivery-retention').textContent='';status.textContent='PDF를 먼저 열어주세요.';return;}
      const selectionId=share.dataset.documentId===documentId?share.value:'';const value=await api('/api/link/deliveries?'+new URLSearchParams({documentId}));if(current!==generation||getDocumentId()!==documentId)return;
      const selected=value.shares.some(s=>s.selectionId===selectionId)?selectionId:value.shares.at(-1)?.selectionId;
      share.replaceChildren(...value.shares.slice().reverse().map(s=>{const option=element('option','',new Date(s.createdAt).toLocaleTimeString('ko-KR')+' · '+s.question);option.value=s.selectionId;return option;}));share.dataset.documentId=documentId;
      if(!selected){state={documentId,events:[]};render();status.textContent='이 문서를 공유한 질문이 없습니다.';return;}
      share.value=selected;const details=value.events&&value.selectionId===selected?value:await api('/api/link/deliveries?'+new URLSearchParams({documentId,selectionId:selected}));if(current!==generation||getDocumentId()!==documentId)return;
      state={...details,documentId};render();status.textContent='Reader 반환 기록을 확인했습니다. 새 요청은 「새로고침」으로 확인하세요.';
    }catch(error){if(current===generation){state=null;list.replaceChildren();$('delivery-counts').textContent='';status.textContent='기록 확인 실패: '+error.message;}}
    finally{if(current===generation)$('delivery-refresh').disabled=false;}
  }
  $('delivery-open').onclick=()=>{if(!dialog.open)dialog.showModal();refresh();};$('delivery-close').onclick=()=>dialog.close();$('delivery-refresh').onclick=refresh;share.onchange=refresh;filter.onchange=render;
  dialog.addEventListener('close',()=>{generation++;list.replaceChildren();state=null;});
  return {documentChanged(){if(dialog.open)refresh();}};
}
