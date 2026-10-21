import {createWindowDrafts} from './draft-session.mjs';
import {renderMarkdown} from './markdown.bundle.mjs';
import {hasNote,findNotes,notesMarkdown,notesFileName} from './reading-tools.mjs';
import {capturePage,contentBox,resolveRects} from './annotation-geometry.mjs';
import {evidenceLabel} from './pdf-evidence.mjs';
const $=id=>document.getElementById(id);
const shades={yellow:'#ffe35c',green:'#8fe4a5',pink:'#ff9cc7',blue:'#8ecbff'};

export function createAnnotationUI({frame,api,getViewer,getFileName}){
  let documentId='',items=[],selection=null,editing=null,revision=0,saving=false,activeId='';
  const drafts=createWindowDrafts('paper-reader-note-drafts',value=>value&&typeof value.documentId==='string'&&value.item&&typeof value.item.note==='string'&&typeof value.item.color==='string'&&Array.isArray(value.item.anchors)&&value.baseline&&typeof value.baseline.note==='string');let editorContext=null;
  function drawDrafts(){const count=[...drafts.values()].filter(draft=>draft.documentId===documentId).length;$('annotation-restore-draft').hidden=!count;$('annotation-restore-draft').textContent=`작성 중인 노트 복원 (${count})`;}
  function rememberDraft(){
    if(!editorContext)return;
    const note=$('annotation-note').value,color=$('annotation-color').value;
    if(note===editorContext.baseline.note&&color===editorContext.baseline.color)drafts.delete(editorContext.key);
    else drafts.set(editorContext.key,{...editorContext,item:{...editorContext.item,note,color}});
    drawDrafts();
  }
  const status=message=>{$('annotation-status').textContent=message;};
  const fail=error=>status(error.message || String(error));
  function setPanel(open){$('annotation-panel').hidden=!open;document.querySelector('main').classList.toggle('has-annotations',open);$('annotations-toggle').setAttribute('aria-expanded',String(open));}
  $('annotations-toggle').onclick=()=>setPanel($('annotation-panel').hidden);
  $('annotations-close').onclick=()=>setPanel(false);
  $('annotation-search').oninput=drawList;
  $('annotations-export').onclick=()=>{
    if(!items.some(hasNote))return;
    const url=URL.createObjectURL(new Blob([notesMarkdown(getFileName(),items)],{type:'text/markdown;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=notesFileName(getFileName());link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);status('이 논문의 전체 노트를 Markdown 파일로 내보냈습니다.');
  };
  function jumpTo(item){
    activeId=item.id;getViewer().page=item.anchors[0].page;redraw();
    const mark=[...frame.contentDocument.querySelectorAll('.reader-highlight,.reader-note-marker')].find(mark=>mark.dataset.annotationId===item.id);
    mark?.scrollIntoView({block:'center',inline:'nearest'});
  }
  function focusAnnotation(item){
    if(!hasNote(item)){activeId=item.id;redraw();drawList();status('하이라이트를 저장했습니다. 노트 내용을 적으면 논문 노트에 표시됩니다.');return;}
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
      const item=[...items].reverse().find(item=>item.anchors.some(anchor=>anchor.page===Number(page.dataset.pageNumber) && resolveRects(anchor,item,page,viewer.pdfViewer?.pagesRotation||0).some(rect=>{
        const [left,top,width,height]=rect;
        return x>=left && x<=left+width && y>=top && y<=top+height;
      })));
      if(item){if(hasNote(item))focusAnnotation(item);else openEditor(item);}
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
        for(const rect of anchor.kind==='page-note'?[]:rects){
          const [x,y,w,h]=rect,mark=doc.createElement('span');
          mark.dataset.annotationId=item.id;
          mark.className='reader-highlight'+(item.id===activeId?' is-active':'');mark.style.backgroundColor=shades[item.color]||shades.yellow;
          mark.style.left=x*100+'%';mark.style.top=y*100+'%';mark.style.width=w*100+'%';mark.style.height=h*100+'%';
          layer.append(mark);
        }
        if(hasNote(item) && rects.length){
          const [x,y,w,h]=rects[rects.length-1],marker=doc.createElement('button');
          marker.type='button';marker.className='reader-note-marker'+(item.id===activeId?' is-active':'');marker.textContent='✎';
          marker.dataset.annotationId=item.id;
          marker.title=item.note;marker.setAttribute('aria-label','주석 보기: '+item.quote.slice(0,100));
          marker.style.left=`calc(${Math.min(x+w,1)*100}% - ${x+w>.95?24:-4}px)`;marker.style.top=(y+h/2)*100+'%';
          marker.onclick=event=>{event.stopPropagation();focusAnnotation(item);};markers.append(marker);
        }
      }
    }
  }
  function drawList(){
    drawDrafts();
    const notes=items.filter(hasNote);
    $('annotation-count').textContent=String(notes.length);const list=$('annotation-list');list.replaceChildren();
    $('annotation-panel-count').textContent=String(notes.length);
    $('annotation-document').textContent=documentId?getFileName():'PDF를 열면 이 문서의 노트가 표시됩니다.';
    $('annotation-document').title=documentId?getFileName():'';
    $('annotations-export').disabled=!notes.length;
    const visible=findNotes(items,$('annotation-search').value);
    if(!visible.length){const empty=document.createElement('div');empty.className='notes-empty';const title=document.createElement('strong'),hint=document.createElement('p');title.textContent=notes.length?'일치하는 노트가 없습니다':'읽으며 남기는 기록';hint.textContent=notes.length?'원문이나 답변의 다른 단어로 검색해 보세요.':'PDF에서 문장을 선택해 노트를 추가하세요. 내용이 있는 노트와 ChatGPT에서 저장한 답변만 모입니다.';empty.append(title,hint);list.append(empty);}
    for(const item of visible){
      const row=document.createElement('article');row.className='annotation-item'+(item.id===activeId?' is-active':'');row.dataset.annotationId=item.id;row.tabIndex=-1;
      const pageNote=item.anchors[0].kind==='page-note';
      row.style.setProperty('--annotation-color',shades[item.color]||shades.yellow);
      const jump=document.createElement('button');jump.type='button';jump.className='annotation-jump';
      const meta=document.createElement('span');meta.className='annotation-source-meta';
      const page=document.createElement('span');page.className='annotation-page';page.textContent='p. '+[...new Set(item.anchors.map(a=>a.page))].join(', ');
      const kind=document.createElement('span');kind.className='annotation-kind';kind.textContent=pageNote?'페이지 질문':item.note?'원문 노트':'하이라이트';
      const arrow=document.createElement('span');arrow.className='annotation-source-arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');meta.append(page,kind,arrow);jump.append(meta);
      if(!pageNote){const quote=document.createElement('span');quote.className='annotation-source-quote';quote.textContent=item.quote;quote.title=item.quote;jump.append(quote);}
      jump.title=pageNote?'질문한 PDF 페이지로 이동':'PDF의 원문 위치로 이동';jump.onclick=()=>{jumpTo(item);drawList();};row.append(jump);
      if(item.note){const preview=document.createElement('div');preview.className='annotation-item-note markdown-body';renderMarkdown(preview,item.note);row.append(preview);}
      if(item.evidence?.pages?.length){
        const evidence=document.createElement('div');evidence.className='annotation-evidence';
        const label=document.createElement('span');label.textContent='AI가 읽은 페이지'+(item.evidence.truncated?' · 일부 기록':'');evidence.append(label);
        for(const source of item.evidence.pages){const button=document.createElement('button');button.type='button';button.textContent=evidenceLabel(source);button.title='읽은 근거 페이지로 이동 · 각 주장과의 일치는 원문으로 확인하세요.';button.onclick=()=>{getViewer().page=source.page;status(evidenceLabel(source)+'로 이동했습니다.');};evidence.append(button);}
        row.append(evidence);
      }
      const actions=document.createElement('div');actions.className='annotation-actions';
      const edit=document.createElement('button');edit.type='button';edit.textContent='수정';edit.onclick=()=>openEditor(item);
      const remove=document.createElement('button');remove.type='button';remove.className='annotation-delete';remove.textContent='삭제';remove.onclick=async()=>{
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
    if(saving)return;
    if(!item && !selection){status('PDF에서 먼저 문장을 선택하세요.');return;}
    if($('annotation-dialog').open)rememberDraft();
    editing=item||null;
    const original=structuredClone(item||selection),key=JSON.stringify([documentId,original.id||[original.quote,original.anchors]]),draft=drafts.get(key);
    editorContext={key,documentId,item:original,creationId:draft?.creationId||crypto.randomUUID(),baseline:draft?.baseline||{note:original.note||'',color:original.color||'yellow'}};
    $('annotation-title').textContent=item&&!hasNote(item)?'하이라이트 · 노트':'논문 노트';
    $('annotation-delete').hidden=!item;
    $('annotation-delete').textContent=item&&hasNote(item)?'주석 삭제':'하이라이트 삭제';
    $('annotation-quote').textContent=item?.quote||selection.quote;
    document.querySelector('label[for="annotation-color"]').textContent=(item||selection).anchors[0].kind==='page-note'?'노트 표시 색상':'하이라이트 색상';
    $('annotation-color').value=draft?.item.color||item?.color||'yellow';$('annotation-note').value=draft?.item.note??item?.note??'';
    $('annotation-editor-status').textContent=draft?'이 창에서 보관한 초안을 복원했습니다. 저장하거나 복사할 수 있습니다.':'';renderMarkdown($('annotation-preview'),$('annotation-note').value);
    $('annotation-dialog').showModal();$('annotation-note').focus();
  }
  $('annotation-preview').classList.add('markdown-body');
  $('annotation-note').addEventListener('input',()=>{rememberDraft();renderMarkdown($('annotation-preview'),$('annotation-note').value);});
  $('annotation-color').addEventListener('change',rememberDraft);
  $('annotation-dialog').addEventListener('close',rememberDraft);
  $('annotation-dialog').addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  $('annotation-restore-draft').onclick=()=>{const draft=[...drafts.values()].filter(value=>value.documentId===documentId).at(-1);if(draft)openEditor(items.find(item=>item.id&&item.id===draft.item.id)||draft.item);};
  $('annotation-copy').onclick=async()=>{try{const text=$('annotation-note').value;if(window.paperDesktop?.writeClipboard)await window.paperDesktop.writeClipboard(text);else await navigator.clipboard.writeText(text);$('annotation-editor-status').textContent='노트 초안을 복사했습니다.';}catch{$('annotation-note').focus();$('annotation-note').select();$('annotation-editor-status').textContent='내용을 선택했습니다. Ctrl+C로 복사하세요.';}};
  $('annotation-cancel').onclick=()=>$('annotation-dialog').close();
  $('annotation-delete').onclick=async()=>{
    if(!editing||saving||!confirm('이 하이라이트와 노트를 삭제할까요?'))return;
    const id=documentId,current=revision,item=editing;saving=true;
    try{await api('/api/annotations/delete',{documentId:id,id:item.id});if(current!==revision)return;items=items.filter(value=>value.id!==item.id);$('annotation-dialog').close();redraw();drawList();status('주석을 삭제했습니다.');}
    catch(error){$('annotation-editor-status').textContent=error.message;}finally{saving=false;}
  };
  $('annotation-form').onsubmit=async event=>{
    event.preventDefault();if(saving || !documentId)return;
    const item=editing||selection;if(!item)return;
    const id=documentId,current=revision;
    saving=true;rememberDraft();for(const control of ['annotation-save','annotation-note','annotation-color','annotation-cancel','annotation-delete'])$(control).disabled=true;
    try{
      const saved=await api('/api/annotations/upsert',{documentId:id,item:{id:editing?.id,...(!editing?.id?{creationId:editorContext.creationId}:{}),quote:item.quote,note:$('annotation-note').value,color:$('annotation-color').value,anchors:item.anchors,rotation:item.rotation||0}});
      drafts.delete(editorContext.key);editorContext.baseline={note:saved.note,color:saved.color};drawDrafts();
      if(current!==revision)return;
      const index=items.findIndex(value=>value.id===saved.id);if(index>=0)items[index]=saved;else items.push(saved);
      frame.contentWindow.getSelection()?.removeAllRanges();$('annotation-dialog').close();focusAnnotation(saved);status(hasNote(saved)?'노트를 이 PC에 저장했습니다. 원본 PDF 파일은 수정하지 않습니다.':'하이라이트를 저장했습니다. 노트 내용이 있는 항목만 논문 노트에 표시됩니다.');
    }catch(error){rememberDraft();$('annotation-editor-status').textContent='저장 실패 · 초안은 이 창에 보관됩니다. 다시 저장하거나 노트를 복사하세요. '+error.message;}
    finally{saving=false;for(const control of ['annotation-save','annotation-note','annotation-color','annotation-cancel','annotation-delete'])$(control).disabled=false;}
  };
  $('highlight').onclick=async()=>{
    $('context').hidden=true;if(!documentId || !selection || saving)return;
    const id=documentId,current=revision,chosen=selection;
    saving=true;
    try{const saved=await api('/api/annotations/upsert',{documentId:id,item:{...chosen,note:'',color:'yellow'}});if(current!==revision)return;items.push(saved);redraw();drawList();status('하이라이트를 저장했습니다. 노트 내용이 있는 항목만 논문 노트에 표시됩니다.');}
    catch(error){fail(error);}finally{saving=false;}
  };
  $('add-note').onclick=()=>{$('context').hidden=true;openEditor();};
  $('selection-note').onclick=()=>openEditor();
  $('selection-highlight').onclick=()=>$('highlight').click();
  return {
    close:()=>setPanel(false),
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
      items=result;drawList();redraw();status(items.filter(hasNote).length+'개 노트 · PDF의 주석 아이콘을 눌러 답변을 확인하세요.');
      return true;
    },
    frameLoaded,
    redraw,
    reset(){if($('annotation-dialog').open)rememberDraft();revision++;documentId='';items=[];selection=null;editing=null;activeId='';$('annotation-search').value='';drawList();status('선택한 문장과 답변을 이곳에 모아두세요.');if($('annotation-dialog').open)$('annotation-dialog').close();},
    async ready(id){const current=++revision;documentId=id;items=[];drawList();try{const result=await api('/api/annotations?documentId='+encodeURIComponent(id));if(current!==revision)return;items=result;drawList();redraw();status(items.filter(hasNote).length+'개 노트 · 하이라이트를 클릭해 노트를 추가·수정할 수 있습니다.');}catch(error){if(current===revision)fail(error);}}
  };
}
