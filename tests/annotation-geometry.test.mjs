import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRect,rotateRect,legacyRect,quoteMatches,validAnchor,capturePage,resolveRects} from '../annotation-geometry.mjs';

const near=(actual,expected)=>actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-10,`${actual} != ${expected}`));
test('content coordinates stay on the same text through zoom, scrolling and panel resize',()=>{
  for(const scale of [.5,.75,1,1.25,2,4]){
    const box={left:137,top:-430,right:137+600*scale,bottom:-430+800*scale,width:600*scale,height:800*scale};
    const rect=normalizeRect({left:box.left+60*scale,top:box.top+160*scale,right:box.left+360*scale,bottom:box.top+176*scale},box);
    near(rect,[.1,.2,.5,.02]);
  }
});

test('old border-box rectangles remove PDF.js border on both axes',()=>{
  const page={left:10,top:100,width:618,height:818};
  const content={left:19,top:109,right:619,bottom:909,width:600,height:800};
  near(legacyRect([69/618,169/818,300/618,16/818],page,content),[.1,.2,.5,.02]);
  assert.equal(normalizeRect({left:0,top:0,right:10,bottom:10},content),null);
});

test('rotation and inverse rotation preserve the selected rectangle',()=>{
  const rect=[.1,.2,.3,.04];
  near(rotateRect(rect,90),[.76,.1,.04,.3]);
  near(rotateRect(rect,180),[.6,.76,.3,.04]);
  near(rotateRect(rect,270),[.2,.6,.04,.3]);
  for(const angle of [0,90,180,270])near(rotateRect(rotateRect(rect,angle),(360-angle)%360),rect);
});

test('legacy quote lookup handles partial words, wrapped lines and repeated passages',()=>{
  const text='EuropeexcludingFrance(+9%)continued.ElsewhereEuropeexcludingFrance(+9%)continued.';
  const quote='urope excluding France (+9%)\ncontinued.';
  const matches=quoteMatches(text,quote);
  assert.equal(matches.length,2);assert.equal(matches[0].start,1);
  assert.deepEqual(quoteMatches(text,quote,{start:matches[1].start}),[matches[1]]);
  assert.deepEqual(quoteMatches(text,'different text'),[]);
});

test('legacy selections across pages only match exact page-edge overlap',()=>{
  const first='Firstpageselectedpassage.',second='Secondpageselectedpassage.';
  assert.deepEqual(quoteMatches('Introduction.'+first,first+second,{partial:true}),[{start:13,end:13+first.length}]);
  assert.deepEqual(quoteMatches(second+'Conclusion.',first+second,{partial:true}),[{start:0,end:second.length}]);
  assert.deepEqual(quoteMatches('othertext',first+second,{partial:true}),[]);
});

test('both legacy and text-anchored geometry are validated',()=>{
  const anchor={page:2,rects:[[.1,.2,.3,.04]]};
  assert.ok(validAnchor(anchor));
  assert.ok(validAnchor({...anchor,space:'page',textQuote:'Selectedtext',textStart:23}));
  for(const extra of [{space:'screen'},{textStart:-1},{textStart:1.5},{textQuote:'a'.repeat(10001)},{rects:[[.9,.2,.3,.04]]}])assert.ok(!validAnchor({...anchor,...extra}));
  assert.ok(!validAnchor(null));
});

test('capture and legacy repair use text spans, excluding borders, wrappers and font leading',()=>{
  // A 600 x 800 page with a 9px border, scrolled above the viewport. The
  // browser's selection box is taller than the rendered 16px PDF text span.
  const span={left:79,top:69,right:239,bottom:85,width:160,height:16};
  const doc={defaultView:{getComputedStyle:()=>({borderLeftWidth:'9px',borderTopWidth:'9px',borderRightWidth:'9px',borderBottomWidth:'9px'})},
    createTreeWalker:()=>{let visited=false;return {nextNode:()=>visited?null:(visited=true,node)};},
    createRange:()=>{let start,end;return {setStart:(_,offset)=>{start=offset;},setEnd:(_,offset)=>{end=offset;},
      getClientRects:()=>[{left:span.left+start*10,right:span.left+end*10,top:span.top-3,bottom:span.bottom+6}]};}};
  const node={data:'Selected passage',length:16,ownerDocument:doc,parentElement:{getBoundingClientRect:()=>span}};
  const layer={ownerDocument:doc},page={ownerDocument:doc,dataset:{pageNumber:'2'},querySelector:()=>layer,
    getBoundingClientRect:()=>({left:10,top:-100,right:628,bottom:718,width:618,height:818})};
  const range={intersectsNode:()=>true,startContainer:node,startOffset:0,endContainer:node,endOffset:16};
  const anchor=capturePage(range,page);
  assert.equal(anchor.space,'page');assert.equal(anchor.textStart,0);assert.equal(anchor.textQuote,'Selectedpassage');
  near(anchor.rects[0],[.1,.2,160/600,.02]);
  const legacy={page:2,rects:[[69/618,166/818,160/618,25/818]]};
  const item={quote:'Selected passage',rotation:0,anchors:[legacy]};
  near(resolveRects(legacy,item,page,0)[0],anchor.rects[0]);
});
