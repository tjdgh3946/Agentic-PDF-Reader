// A heuristic for extraction coverage, not an OCR/accuracy score. A sparse
// cover, blank page or figure-only page may legitimately have little text.
export function textQuality(pages,scope){
  const numbers=scope||pages.map((_,index)=>index+1),low=[],damaged=[];
  for(const page of numbers){
    const text=pages[page-1]||'',letter=/[\p{L}\p{N}]/gu;let letters=0,position=-1,damage=0;
    while(letters<40&&letter.exec(text))letters++;
    if(letters<40)low.push(page);
    const threshold=Math.max(3,text.length*.02);
    while((position=text.indexOf('\uFFFD',position+1))!==-1)if(++damage>threshold){damaged.push(page);break;}
  }
  const limited=new Set([...low,...damaged]);
  return {status:!limited.size?'searchable':limited.size===numbers.length?'limited':'partial',checkedPages:numbers.length,lowTextPageCount:low.length,lowTextPages:low.slice(0,20),damagedTextPageCount:damaged.length,damagedTextPages:damaged.slice(0,20),pageListTruncated:low.length>20||damaged.length>20,advice:limited.size?'일부 페이지의 추출 텍스트가 적거나 손상되었습니다. 스캔·그림·빈 페이지일 수 있습니다. 검색 0건을 내용 부재로 판단하지 말고, 관련 페이지를 render_pdf_page로 읽은 뒤 필요한 영역을 확대하세요. OCR은 수행하지 않습니다.':'텍스트 검색 가능 여부의 휴리스틱입니다. 수식·도표의 정확성은 페이지 이미지로 확인하세요.'};
}
