// Rectangles use the visible PDF content box, excluding PDF.js's page border.
// Text anchors let older border-box annotations recover their exact position.
export function rotateRect(rect,delta){
  const [x,y,w,h]=rect;
  if(delta===90)return [1-y-h,x,h,w];
  if(delta===180)return [1-x-w,1-y-h,w,h];
  if(delta===270)return [y,1-x-w,h,w];
  return rect;
}

export const compactText=text=>text.replace(/\s/g,'');
export const validAnchor=anchor=>anchor && Number.isInteger(anchor.page) && anchor.page>=1 && anchor.page<=100000
  && (anchor.space===undefined || anchor.space==='page')
  && (anchor.kind===undefined || anchor.kind==='page-note')
  && (anchor.textQuote===undefined || typeof anchor.textQuote==='string' && anchor.textQuote.length<=10000)
  && (anchor.textStart===undefined || Number.isInteger(anchor.textStart) && anchor.textStart>=0 && anchor.textStart<=10000000)
  && Array.isArray(anchor.rects) && anchor.rects.length>0 && anchor.rects.length<=250
  && anchor.rects.every(r=>Array.isArray(r)&&r.length===4&&r.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&r[2]>0&&r[3]>0&&r[0]+r[2]<=1.001&&r[1]+r[3]<=1.001);

export function normalizeRect(part,box){
  const left=Math.max(part.left,box.left),top=Math.max(part.top,box.top);
  const right=Math.min(part.right,box.right),bottom=Math.min(part.bottom,box.bottom);
  if(right<=left || bottom<=top || !box.width || !box.height)return null;
  return [(left-box.left)/box.width,(top-box.top)/box.height,(right-left)/box.width,(bottom-top)/box.height];
}

export function contentBox(page){
  // The overlay's containing block is this same border-free box, at every zoom.
  const box=page.getBoundingClientRect(),style=page.ownerDocument.defaultView.getComputedStyle(page);
  const left=box.left+parseFloat(style.borderLeftWidth),top=box.top+parseFloat(style.borderTopWidth);
  const right=box.right-parseFloat(style.borderRightWidth),bottom=box.bottom-parseFloat(style.borderBottomWidth);
  return {left,top,right,bottom,width:right-left,height:bottom-top};
}

export function legacyRect(rect,pageBox,box){
  const [x,y,w,h]=rect;
  return normalizeRect({left:pageBox.left+x*pageBox.width,top:pageBox.top+y*pageBox.height,
    right:pageBox.left+(x+w)*pageBox.width,bottom:pageBox.top+(y+h)*pageBox.height},box);
}

function textIndex(layer){
  const walker=layer.ownerDocument.createTreeWalker(layer,4),runs=[];
  let node,text='';
  while((node=walker.nextNode())){
    const positions=[];
    for(let i=0;i<node.length;i++)if(!/\s/.test(node.data[i]))positions.push(i);
    if(!positions.length)continue;
    const start=text.length;
    text+=positions.map(i=>node.data[i]).join('');
    runs.push({node,start,end:text.length,positions});
  }
  return {text,runs};
}

function measureRuns(runs,box){
  const rects=[];
  for(const {node,start,end} of runs){
    if(end<=start)continue;
    const range=node.ownerDocument.createRange();range.setStart(node,start);range.setEnd(node,end);
    // Range boxes include font leading and can extend into the next line. Clip
    // to the actual PDF.js text span, and ignore marked-content wrapper boxes.
    const span=node.parentElement.getBoundingClientRect();
    for(const part of range.getClientRects()){
      const rect=normalizeRect({left:Math.max(part.left,span.left),top:Math.max(part.top,span.top),
        right:Math.min(part.right,span.right),bottom:Math.min(part.bottom,span.bottom)},box);
      if(rect)rects.push(rect);
    }
  }
  // Adjacent fragments of a single line must not darken each other by overlap.
  const merged=[];
  for(const rect of rects){
    const previous=merged.at(-1);
    if(previous && Math.abs(previous[1]-rect[1])*box.height<.5 && Math.abs(previous[3]-rect[3])*box.height<.5
      && rect[0]>=previous[0] && (rect[0]-previous[0]-previous[2])*box.width<Math.max(1,rect[3]*box.height*.6)){
      previous[2]=Math.max(previous[0]+previous[2],rect[0]+rect[2])-previous[0];
    }else merged.push([...rect]);
  }
  return merged.slice(0,250);
}

export function capturePage(range,page){
  const layer=page.querySelector('.textLayer');if(!layer || !range.intersectsNode(layer))return null;
  const index=textIndex(layer),runs=[];let textQuote='',textStart;
  for(const entry of index.runs){
    const {node}=entry;if(!range.intersectsNode(node))continue;
    const start=range.startContainer===node?range.startOffset:0,end=range.endContainer===node?range.endOffset:node.length;
    const quote=compactText(node.data.slice(start,end));if(!quote)continue;
    textStart??=entry.start+entry.positions.filter(i=>i<start).length;
    textQuote+=quote;runs.push({node,start,end});
  }
  const rects=measureRuns(runs,contentBox(page));
  return rects.length?{page:Number(page.dataset.pageNumber),space:'page',rects,textQuote,textStart}:null;
}

export function quoteMatches(text,quote,{partial=false,start}={}){
  quote=compactText(quote);if(!quote)return [];
  if(Number.isInteger(start) && text.slice(start,start+quote.length)===quote)return [{start,end:start+quote.length}];
  const matches=[];
  for(let at=text.indexOf(quote);at>=0&&matches.length<100;at=text.indexOf(quote,at+1))matches.push({start:at,end:at+quote.length});
  if(matches.length || !partial)return matches;
  // A legacy selection may continue across page boundaries. Only accept exact
  // overlaps touching an edge of both the quote and this page's text stream.
  const length=Math.min(text.length,quote.length);
  if(quote.includes(text) && text.length>=22)return [{start:0,end:text.length}];
  for(let size=length;size>=16;size--){
    if(text.endsWith(quote.slice(0,size)))return [{start:text.length-size,end:text.length}];
    if(text.startsWith(quote.slice(-size)))return [{start:0,end:size}];
  }
  return [];
}

export function resolveRects(anchor,item,page,rotation){
  const delta=((rotation-(item.rotation||0))%360+360)%360,box=contentBox(page);
  const rotated=anchor.rects.map(rect=>rotateRect(rect,delta));
  const fallback=anchor.space==='page'?rotated:rotated.map(rect=>legacyRect(rect,page.getBoundingClientRect(),box)).filter(Boolean);
  if(anchor.kind==='page-note')return fallback;
  const layer=page.querySelector('.textLayer');if(!layer)return fallback;
  const index=textIndex(layer),matches=quoteMatches(index.text,anchor.textQuote??item.quote,{partial:item.anchors.length>1,start:anchor.textStart});
  let best=null,distance=Infinity;
  for(const match of matches){
    const runs=index.runs.filter(run=>run.end>match.start&&run.start<match.end).map(run=>({node:run.node,
      start:run.positions[Math.max(0,match.start-run.start)],end:run.positions[Math.min(run.end,match.end)-run.start-1]+1}));
    const rects=measureRuns(runs,box);if(!rects.length)continue;
    const expected=rotated[0],actual=rects[0];
    const score=(expected[0]-actual[0])**2+(expected[1]-actual[1])**2;
    if(score<distance){distance=score;best=rects;}
  }
  return best||fallback;
}
// Group first-line anchors in page coordinates so zoom cannot change membership.
export function groupNoteMarkers(entries){
  const groups=[];
  for(const entry of [...entries].sort((a,b)=>a.page-b.page||a.y-b.y||a.x-b.x)){
    let group=groups.find(group=>group.page===entry.page&&Math.abs(group.y-entry.y)<=Math.min(group.height,entry.height)*.55);
    if(!group){group={page:entry.page,y:entry.y,height:entry.height,entries:[]};groups.push(group);}
    if(!group.entries.some(other=>other.item.id===entry.item.id))group.entries.push(entry);
  }
  return groups;
}

// Keep note icons within the visible viewer rail; stack nearby notes without overlap.
export function noteMarkerTop(preferred,occupied,height){
  const minimum=11,maximum=Math.max(minimum,height-11),base=Math.max(minimum,Math.min(maximum,preferred));
  let position=base;
  for(let step=0;step<=occupied.length+1;step++){
    const candidates=step?[base+step*22,base-step*22]:[base];
    const available=candidates.find(value=>value>=minimum&&value<=maximum&&occupied.every(other=>Math.abs(other-value)>=16));
    if(available!==undefined){position=available;break;}
  }
  occupied.push(position);return position;
}
