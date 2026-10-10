import {renderMarkdown} from './markdown.bundle.mjs';
import {findNotes,notesMarkdown,notesFileName} from './reading-tools.mjs';
import {capturePage,contentBox,resolveRects} from './annotation-geometry.mjs';
const $=id=>document.getElementById(id);
const shades={yellow:'#ffe35c',green:'#8fe4a5',pink:'#ff9cc7',blue:'#8ecbff'};

export function createAnnotationUI({frame,api,getViewer,getFileName}){
  let documentId='',items=[],selection=null,editing=null,revision=0,saving=false,activeId='';
  const status=message=>{$('annotation-status').textContent=message;};
  const fail=error=>status(error.message || String(error));
  function setPanel(open){$('annotation-panel').hidden=!open;document.querySelector('main').classList.toggle('has-annotations',open);$('annotations-toggle').setAttribute('aria-expanded',String(open));}
  $('annotations-toggle').onclick=()=>setPanel($('annotation-panel').hidden);
  $('annotations-close').onclick=()=>setPanel(false);
  $('annotation-search').oninput=drawList;
  $('annotations-export').onclick=()=>{
    if(!items.length)return;
    const url=URL.createObjectURL(new Blob([notesMarkdown(getFileName(),items)],{type:'text/markdown;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=notesFileName(getFileName());link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);status('이 논문의 전체 노트를 Markdown 파일로 내보냈습니다.');
  };
  function jumpTo(item){
    activeId=item.id;getViewer().page=item.anchors[0].page;redraw();
    const mark=[...frame.contentDocument.querySelectorAll('.reader-highlight')].find(mark=>mark.dataset.annotationId===item.id);
    mark?.scrollIntoView({block:'center',inline:'nearest'});
  }
  function focusAnnotation(item){
    $('annotation-search').value='';
    activeId=item.id;setPanel(true);redraw();drawList();
    const row=[...$('annotation-list').children].find(row=>row.dataset.annotationId===item.id);
    row?.scrollIntoView({block:'nearest'});row?.focus({preventScroll:true});
    status('PDF 본문에 연결된 주석입니다.');
  }
  function frameLoaded(){
    const doc=frame.contentDocument;if(!doc || doc.getElementById('reader-highlight-style'))return;
    const style=doc.createElement('link');style.id='reader-highlight-style';style.rel='stylesheet';style.href=new URL('annotation-overlay.css',location.href).href;doc.head.append(style);
    doc.addEventListener('click',event=>{
      if(doc.defaultView.getSelection()?.toString().trim() || event.target.closest?.('button,a,input,select,textarea'))return;
      const page=event.target.closest?.('.pdfViewer .page[data-page-number]'),viewer=getViewer();if(!page || !viewer)return;
      const box=contentBox(page),x=(event.clientX-box.left)/box.width,y=(event.clientY-box.top)/box.height;
      const item=[...items].reverse().find(item=>item.note && item.anchors.some(anchor=>anchor.page===Number(page.dataset.pageNumber) && resolveRects(anchor,item,page,viewer.pdfViewer?.pagesRotation||0).some(rect=>{
        const [left,top,width,height]=rect;
        return x>=left && x<=left+width && y>=top && y<=top+height;
      })));
      if(item)focusAnnotation(item);
    });
  }
  function redraw(){
    const doc=frame.contentDocument,viewer=getViewer();if(!doc || !viewer?.pdfDocument)return;
    for(const page of doc.querySelectorAll('.pdfViewer .page[data-page-number]')){
      let layer=page.querySelector(':scope > .reader-highlights');
      if(!layer){layer=doc.createElement('div');layer.className='reader-highlights';page.append(layer);}
      layer.replaceChildren();
      let markers=page.querySelector(':scope > .reader-note-markers');
      if(!markers){markers=doc.createElement('div');markers.className='reader-note-markers';page.append(markers);}
      markers.replaceChildren();
      const number=Number(page.dataset.pageNumber);
      for(const item of items)for(const anchor of item.anchors)if(anchor.page===number){
        const rects=resolveRects(anchor,item,page,viewer.pdfViewer?.pagesRotation||0);
        for(const rect of rects){
          const [x,y,w,h]=rect,mark=doc.createElement('span');
          mark.dataset.annotationId=item.id;
          mark.className='reader-highlight'+(item.id===activeId?' is-active':'');mark.style.backgroundColor=shades[item.color]||shades.yellow;
          mark.style.left=x*100+'%';mark.style.top=y*100+'%';mark.style.width=w*100+'%';mark.style.height=h*100+'%';
          layer.append(mark);
        }
        if(item.note && rects.length){
          const [x,y,w,h]=rects[rects.length-1],marker=doc.createElement('button');
          marker.type='button';marker.className='reader-note-marker'+(item.id===activeId?' is-active':'');marker.textContent='✎';
          marker.title=item.note;marker.setAttribute('aria-label','주석 보기: '+item.quote.slice(0,100));
          marker.style.left=`calc(${Math.min(x+w,1)*100}% - ${x+w>.95?24:-4}px)`;marker.style.top=(y+h/2)*100+'%';
          marker.onclick=event=>{event.stopPropagation();focusAnnotation(item);};markers.append(marker);
        }
      }
    }
  }
  function drawList(){
    $('annotation-count').textContent=String(items.length);const list=$('annotation-list');list.replaceChildren();
    $('annotations-export').disabled=!items.length;
    const visible=findNotes(items,$('annotation-search').value);
    if(!visible.length){const empty=document.createElement('p');empty.className='notes-empty';empty.textContent=items.length?'검색과 일치하는 노트가 없습니다.':'문장을 선택해 노트를 추가하세요. Link로 받은 답변도 여기에 쌓입니다.';list.append(empty);}
    for(const item of visible){
      const row=document.createElement('article');row.className='annotation-item'+(item.id===activeId?' is-active':'');row.dataset.annotationId=item.id;row.tabIndex=-1;
      const jump=document.createElement('button');jump.type='button';jump.className='annotation-jump';jump.textContent='p. '+item.anchors.map(a=>a.page).join(', ')+' · '+item.quote.slice(0,140);
      jump.style.borderLeftColor=shades[item.color]||shades.yellow;
      jump.title='원문의 정확한 위치로 이동';jump.onclick=()=>{jumpTo(item);drawList();};row.append(jump);
      if(item.note){const preview=document.createElement('div');preview.className='annotation-item-note markdown-body';renderMarkdown(preview,item.note);row.append(preview);}
      const actions=document.createElement('div');actions.className='annotation-actions';
      const edit=document.createElement('button');edit.type='button';edit.textContent='수정';edit.onclick=()=>openEditor(item);
      const remove=document.createElement('button');remove.type='button';remove.textContent='삭제';remove.onclick=async()=>{
        if(saving || !confirm('이 형광펜과 주석을 삭제할까요?'))return;
        const id=documentId,current=revision;
        saving=true;try{await api('/api/annotations/delete',{documentId:id,id:item.id});if(current!==revision)return;items=items.filter(value=>value.id!==item.id);redraw();drawList();status('삭제했습니다.');}
        catch(error){fail(error);}finally{saving=false;}
      };actions.append(edit,remove);row.append(actions);list.append(row);
    }
  }
  function capture(){
    const win=frame.contentWindow,viewer=getViewer(),range=win?.getSelection()?.rangeCount?win.getSelection().getRangeAt(0):null;
    if(!range || range.collapsed || !viewer?.pdfDocument)return false;
    const quote=win.getSelection().toString().trim();if(!quote)return false;
    const anchors=[];
    for(const page of frame.contentDocument.querySelectorAll('.pdfViewer .page[data-page-number]')){
      const anchor=capturePage(range,page);if(anchor)anchors.push(anchor);
      if(anchors.length>=40)break;
    }
    selection=anchors.length?{quote,anchors,rotation:viewer.pdfViewer?.pagesRotation||0}:null;
    return !!selection;
  }
  function openEditor(item){
    if(!item && !selection){status('PDF에서 먼저 문장을 선택하세요.');return;}
    editing=item||null;
    $('annotation-quote').textContent=item?.quote||selection.quote;
    $('annotation-color').value=item?.color||'yellow';$('annotation-note').value=item?.note||'';
    $('annotation-editor-status').textContent='';renderMarkdown($('annotation-preview'),$('annotation-note').value);
    $('annotation-dialog').showModal();$('annotation-note').focus();
  }
  $('annotation-preview').classList.add('markdown-body');
  $('annotation-note').addEventListener('input',()=>renderMarkdown($('annotation-preview'),$('annotation-note').value));
  $('annotation-cancel').onclick=()=>$('annotation-dialog').close();
  $('annotation-form').onsubmit=async event=>{
    event.preventDefault();if(saving || !documentId)return;
    const item=editing||selection;if(!item)return;
    const id=documentId,current=revision;
    saving=true;$('annotation-save').disabled=true;
    try{
      const saved=await api('/api/annotations/upsert',{documentId:id,item:{id:editing?.id,quote:item.quote,note:$('annotation-note').value,color:$('annotation-color').value,anchors:item.anchors,rotation:item.rotation||0}});
      if(current!==revision)return;
      const index=items.findIndex(value=>value.id===saved.id);if(index>=0)items[index]=saved;else items.push(saved);
      frame.contentWindow.getSelection()?.removeAllRanges();$('annotation-dialog').close();focusAnnotation(saved);status('주석을 저장했습니다. PDF의 표시나 주석 아이콘을 누르면 다시 볼 수 있습니다.');
    }catch(error){$('annotation-editor-status').textContent=error.message;}
    finally{saving=false;$('annotation-save').disabled=false;}
  };
  $('highlight').onclick=async()=>{
    $('context').hidden=true;if(!documentId || !selection)return;
    const id=documentId,current=revision,chosen=selection;
    try{const saved=await api('/api/annotations/upsert',{documentId:id,item:{...chosen,note:'',color:'yellow'}});if(current!==revision)return;items.push(saved);redraw();drawList();setPanel(true);status('형광펜을 저장했습니다.');}
    catch(error){fail(error);}
  };
  $('add-note').onclick=()=>{$('context').hidden=true;openEditor();};
  $('selection-note').onclick=()=>openEditor();
  $('selection-highlight').onclick=()=>$('highlight').click();
  return {
    capture,
    selectionSnapshot:()=>selection?structuredClone(selection):null,
    clearSelection(){selection=null;},
    open(id){const item=items.find(item=>item.id===id);if(!item)return false;focusAnnotation(item);jumpTo(item);return true;},
    async refresh(){
      if(!documentId)return true;
      if(saving)return false;
      const id=documentId,current=revision;
      const result=await api('/api/annotations?documentId='+encodeURIComponent(id));
      if(current!==revision || saving)return false;
      items=result;drawList();redraw();status(items.length+'개 저장됨 · PDF의 주석 아이콘을 눌러 답변을 확인하세요.');
      return true;
    },
    frameLoaded,
    redraw,
    reset(){revision++;documentId='';items=[];selection=null;editing=null;activeId='';$('annotation-search').value='';drawList();status('선택한 문장과 답변을 이곳에 모아두세요.');if($('annotation-dialog').open)$('annotation-dialog').close();},
    async ready(id){const current=++revision;documentId=id;items=[];drawList();try{const result=await api('/api/annotations?documentId='+encodeURIComponent(id));if(current!==revision)return;items=result;drawList();redraw();status(items.length+'개 저장됨 · PDF 문장을 우클릭하여 추가하세요.');}catch(error){if(current===revision)fail(error);}}
  };
}
