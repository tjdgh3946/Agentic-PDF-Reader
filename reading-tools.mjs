import {WINDOW_OPTIONS} from './context.mjs';

export function questionContext({selection='',startPage,endPage,currentPage=1,total=1,window='near1'}){
  const clamp=value=>Math.max(1,Math.min(total,Number(value)||1));
  const start=clamp(selection?startPage:currentPage),end=clamp(selection?endPage||start:currentPage);
  const kind=WINDOW_OPTIONS.includes(window)?window:'near1';
  return {startPage:Math.min(start,end),endPage:Math.max(start,end),window:!selection&&kind==='selection'?'page':kind};
}

export function readingQuestion(kind,selected){
  const target=selected?'선택한 문장과 수식':'현재 페이지의 내용';
  return {
    explain:`${target}을 한국어로 쉽게 설명해 주세요. 핵심 개념, 필요한 가정, 논문에서의 역할을 구분하고 근거 페이지를 표시해 주세요.`,
    translate:`${target}을 문맥에 맞게 한국어로 번역해 주세요. 수식과 기호는 유지하고 핵심 용어는 영문을 함께 적어 주세요.`,
    math:`${target}에 등장하는 수식을 설명해 주세요. 기호의 뜻과 차원, 성립 가정, 계산 단계를 나누고 직관적인 예시를 들어 주세요. 추출된 수식이 불완전하면 추측하지 말고 해당 부분을 짚어 주세요.`
  }[kind]||'';
}

export function pageNote(page,rotation=0){
  return {quote:`p. ${page} · 페이지 질문`,rotation,anchors:[{page,space:'page',kind:'page-note',rects:[[.92,.04,.03,.025]]}]};
}

export function findNotes(items,query=''){
  const words=query.trim().normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item=>{const text=[item.quote,item.note,...item.anchors.map(a=>'p. '+a.page)].join(' ').normalize('NFKC').toLocaleLowerCase();return words.every(word=>text.includes(word));})
    .sort((a,b)=>a.anchors[0].page-b.anchors[0].page || a.anchors[0].rects[0][1]-b.anchors[0].rects[0][1] || a.createdAt.localeCompare(b.createdAt));
}

export function notesMarkdown(fileName,items){
  const title=String(fileName||'PDF').replace(/[\r\n]/g,' ');
  return [`# ${title} · 논문 노트`,`원문: ${title}\n\n저장된 주석 ${items.length}개`,...findNotes(items).map(item=>[
    `## p. ${item.anchors.map(a=>a.page).join(', ')}`,
    item.quote.split(/\r?\n/).map(line=>'> '+line).join('\n'),
    item.note||'_형광펜 표시_',
    ...(item.evidence?.pages?.length?['AI가 읽은 페이지: '+item.evidence.pages.map(p=>'p. '+p.page+' ('+(p.text&&p.image?'본문·이미지':p.image?'이미지':'본문')+')').join(', ')+(item.evidence.truncated?' · 일부 기록':'')]:[]),
    '---'
  ].join('\n\n'))].join('\n\n')+'\n';
}

export function notesFileName(fileName){
  return (String(fileName||'paper').replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'paper')+'-notes.md';
}
