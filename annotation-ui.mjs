const $=id=>document.getElementById(id);
const shades={yellow:'#ffe35c',green:'#8fe4a5',pink:'#ff9cc7',blue:'#8ecbff'};

function inline(parent,text){
  const pattern=/`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let start=0,match;
  while((match=pattern.exec(text))){
    if(match.index>start)parent.append(document.createTextNode(text.slice(start,match.index)));
    if(match[1]){const code=document.createElement('code');code.textContent=match[1];parent.append(code);}
    else if(match[2]){const link=document.createElement('a');link.textContent=match[2];link.href=match[3];link.target='_blank';link.rel='noopener noreferrer';parent.append(link);}
    else {const emphasis=document.createElement(match[4]?'strong':'em');inline(emphasis,match[4]||match[5]);parent.append(emphasis);}
    start=pattern.lastIndex;
  }
  if(start<text.length)parent.append(document.createTextNode(text.slice(start)));
}

export function renderMarkdown(target,source){
  target.replaceChildren();let list=null,code=null;
  for(const line of source.split(/\r?\n/)){
    if(/^\s*```/.test(line)){if(code)code=null;else{const pre=document.createElement('pre');code=document.createElement('code');pre.append(code);target.append(pre);}list=null;continue;}
    if(code){code.textContent+=(code.textContent?'\n':'')+line;continue;}
    if(!line.trim()){list=null;continue;}
    const heading=line.match(/^(#{1,4})\s+(.+)/),item=line.match(/^\s*[-*+]\s+(.+)/),numbered=line.match(/^\s*\d+\.\s+(.+)/),quote=line.match(/^>\s?(.*)/);
    let node;
    if(heading){list=null;node=document.createElement('h'+heading[1].length);inline(node,heading[2]);target.append(node);continue;}
    if(item||numbered){const tag=numbered?'ol':'ul';if(!list || list.tagName.toLowerCase()!==tag){list=document.createElement(tag);target.append(list);}node=document.createElement('li');inline(node,(item||numbered)[1]);list.append(node);continue;}
    list=null;node=document.createElement(quote?'blockquote':'p');inline(node,quote?quote[1]:line);target.append(node);
  }
}

function rotateRect(rect,delta){
  const [x,y,w,h]=rect;
  if(delta===90)return [1-y-h,x,h,w];
  if(delta===180)return [1-x-w,1-y-h,w,h];
  if(delta===270)return [y,1-x-w,h,w];
  return rect;
}

export function createAnnotationUI({frame,api,getViewer}){
  let documentId='',items=[],selection=null,editing=null,revision=0,saving=false;
  const status=message=>{$('annotation-status').textContent=message;};
  const fail=error=>status(error.message || String(error));
  function setPanel(open){$('annotation-panel').hidden=!open;document.querySelector('main').classList.toggle('has-annotations',open);$('annotations-toggle').setAttribute('aria-expanded',String(open));}
  $('annotations-toggle').onclick=()=>setPanel($('annotation-panel').hidden);
  $('annotations-close').onclick=()=>setPanel(false);
  function frameLoaded(){
    const doc=frame.contentDocument;if(!doc || doc.getElementById('reader-highlight-style'))return;
    const style=doc.createElement('style');style.id='reader-highlight-style';style.textContent='.reader-highlights{position:absolute;inset:0;pointer-events:none;z-index:2;mix-blend-mode:multiply}.reader-highlight{position:absolute;border-radius:2px;opacity:.5;pointer-events:none}';doc.head.append(style);
  }
  function redraw(){
    const doc=frame.contentDocument,viewer=getViewer();if(!doc || !viewer?.pdfDocument)return;
    for(const page of doc.querySelectorAll('.pdfViewer .page[data-page-number]')){
      let layer=page.querySelector(':scope > .reader-highlights');
      if(!layer){layer=doc.createElement('div');layer.className='reader-highlights';page.append(layer);}
      layer.replaceChildren();
      const number=Number(page.dataset.pageNumber);
      for(const item of items)for(const anchor of item.anchors)if(anchor.page===number){
        const delta=((viewer.pagesRotation-(item.rotation||0))%360+360)%360;
        for(const original of anchor.rects){
          const [x,y,w,h]=rotateRect(original,delta),mark=doc.createElement('span');
          mark.className='reader-highlight';mark.style.backgroundColor=shades[item.color]||shades.yellow;
          mark.style.left=x*100+'%';mark.style.top=y*100+'%';mark.style.width=w*100+'%';mark.style.height=h*100+'%';
          layer.append(mark);
        }
      }
    }
  }
  function drawList(){
    $('annotation-count').textContent=String(items.length);const list=$('annotation-list');list.replaceChildren();
    for(const item of items){
      const row=document.createElement('article');row.className='annotation-item';
      const jump=document.createElement('button');jump.type='button';jump.className='annotation-jump';jump.textContent='p. '+item.anchors.map(a=>a.page).join(', ')+' · '+item.quote.slice(0,140);
      jump.style.borderLeftColor=shades[item.color]||shades.yellow;
      jump.onclick=()=>{getViewer().page=item.anchors[0].page;frame.focus();};row.append(jump);
      if(item.note){const preview=document.createElement('div');preview.className='annotation-item-note';renderMarkdown(preview,item.note);row.append(preview);}
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
      const layer=page.querySelector('.textLayer');if(!layer || !layer.contains(range.commonAncestorContainer) && !page.contains(range.startContainer) && !page.contains(range.endContainer) && !range.intersectsNode(layer))continue;
      const box=page.getBoundingClientRect(),textBox=layer.getBoundingClientRect(),rects=[];
      for(const part of range.getClientRects()){
        const left=Math.max(part.left,textBox.left),top=Math.max(part.top,textBox.top),right=Math.min(part.right,textBox.right),bottom=Math.min(part.bottom,textBox.bottom);
        if(right-left<2 || bottom-top<2)continue;
        const x=Math.max(0,(left-box.left)/box.width),y=Math.max(0,(top-box.top)/box.height);
        const w=Math.min(1-x,(right-left)/box.width),h=Math.min(1-y,(bottom-top)/box.height);
        if(w>0 && h>0 && rects.length<250)rects.push([x,y,w,h]);
      }
      if(rects.length)anchors.push({page:Number(page.dataset.pageNumber),rects});
      if(anchors.length>=40)break;
    }
    selection=anchors.length?{quote,anchors,rotation:viewer.pagesRotation||0}:null;
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
      redraw();drawList();$('annotation-dialog').close();setPanel(true);status('주석을 저장했습니다.');
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
  return {
    capture,
    frameLoaded,
    redraw,
    reset(){revision++;documentId='';items=[];selection=null;editing=null;drawList();status('PDF 문장을 선택하고 우클릭하여 추가하세요.');if($('annotation-dialog').open)$('annotation-dialog').close();},
    async ready(id){const current=++revision;documentId=id;items=[];drawList();try{const result=await api('/api/annotations?documentId='+encodeURIComponent(id));if(current!==revision)return;items=result;drawList();redraw();status(items.length+'개 저장됨 · PDF 문장을 우클릭하여 추가하세요.');}catch(error){if(current===revision)fail(error);}}
  };
}
