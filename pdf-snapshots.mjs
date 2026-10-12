import {createHash} from 'node:crypto';
import {UserError} from './auth.mjs';
import {createQueryIndex} from './pdf-query.mjs';
export const PDF_LIMITS={bytes:64*1024*1024,pages:1000,text:12_000_000,snapshots:3,totalBytes:192*1024*1024};
export function renderRegion(region=[0,0,1,1]){
  if(!Array.isArray(region)||region.length!==4||!region.every(Number.isFinite)||region[0]<0||region[1]<0||region[2]<.02||region[3]<.02||region[0]+region[2]>1.000001||region[1]+region[3]>1.000001)throw new UserError('영역은 [x,y,width,height] 0~1 좌표이며 폭·높이는 0.02 이상이어야 합니다.');
  return region;
}
export function createPdfSnapshots({renderer,now=Date.now}={}){
  const records=new Map();let closed=false,registration=Promise.resolve();
  function remove(record){records.delete(record.snapshotId);record.index?.close();renderer?.release(record.snapshotId);}
  function prune(){for(const record of records.values())if(!record.refs.size && now()-record.touched>300000)remove(record);}
  function get(id){prune();const record=records.get(id);if(!record || closed)throw new UserError('PDF 고정본이 만료되었습니다. 다시 공유하세요.',410);record.touched=now();return record;}
  const info=record=>({snapshotId:record.snapshotId,pageCount:record.pages?.length||0,bytes:record.bytes,emptyPages:record.pages?.flatMap((text,i)=>text.trim()?[]:[i+1])||[],state:record.state});
  return {
    available:!!renderer,
    register(bytes,documentId,fileName){const job=registration.then(async()=>{
      if(closed || !renderer)throw new UserError('AI 문맥 검색은 Electron 앱에서 지원합니다.',409);
      if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>PDF_LIMITS.bytes||!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new UserError('PDF 파일은 최대 64 MiB입니다. 원본 PDF 형식을 확인하세요.',413);
      if(typeof documentId!=='string'||!/^[a-f\d-]{1,200}$/i.test(documentId)||typeof fileName!=='string'||!fileName.trim()||fileName.length>500)throw new UserError('PDF 이름과 문서 ID를 확인하세요.');
      prune();const snapshotId=createHash('sha256').update(bytes).digest('hex');
      const existing=records.get(snapshotId);if(existing){if(existing.documentId!==documentId)throw new UserError('같은 PDF의 문서 ID가 일치하지 않습니다.');existing.touched=now();return info(existing);}
      for(const record of [...records.values()])if(records.size>=PDF_LIMITS.snapshots && !record.refs.size)remove(record);
      if(records.size>=PDF_LIMITS.snapshots || [...records.values()].reduce((n,r)=>n+r.bytes,0)+bytes.length>PDF_LIMITS.totalBytes)throw new UserError('PDF 공유 한도(3개/192 MiB)에 도달했습니다. 노트 연결을 해제한 뒤 다시 공유하세요.',409);
      const record={snapshotId,documentId,bytes:bytes.length,state:'indexing',touched:now(),refs:new Set()};records.set(snapshotId,record);
      try{
        const result=await renderer.load(snapshotId,bytes,PDF_LIMITS);
        if(closed || records.get(snapshotId)!==record)throw new UserError('PDF 등록이 취소되었습니다.',410);
        if(!Array.isArray(result.pages)||!result.pages.length||result.pages.length>PDF_LIMITS.pages||result.pages.some(p=>typeof p!=='string')||result.pages.reduce((n,p)=>n+p.length,0)>PDF_LIMITS.text)throw new UserError('페이지/본문 추출 한도를 초과했습니다.');
        if(result.documentId!==documentId)throw new UserError('원본 PDF와 뷰어 문서가 일치하지 않습니다. 다시 열어주세요.');
        record.pages=result.pages;record.index=createQueryIndex(record.pages);await record.index.ready();
        if(closed || records.get(snapshotId)!==record)throw new UserError('PDF 등록이 취소되었습니다.',410);
        record.state='ready';return info(record);
      }catch(error){remove(record);throw error;}
    });registration=job.catch(()=>{});return job;},
    pin(id,documentId,selectionId){const record=get(id);if(record.documentId!==documentId||record.state!=='ready')throw new UserError('질문과 PDF 고정본이 일치하지 않습니다.');record.refs.add(selectionId);},
    unpin(id,selectionId){const record=records.get(id);if(!record)return;record.refs.delete(selectionId);if(!record.refs.size)remove(record);},
    inspect(id){const record=get(id);return {...info(record),schema:{pages:'pages(page_no INTEGER PRIMARY KEY, raw_text TEXT)',page_fts:'page_fts(page_no UNINDEXED, text) USING FTS5 · NFKC normalized'},limits:{queryRows:20,queryCharacters:12000,queryMilliseconds:1500,readPages:3},example:{sql:"SELECT CAST(page_no AS INTEGER) AS page_no, snippet(page_fts,1,'[',']','…',35) AS excerpt FROM page_fts WHERE page_fts MATCH ? ORDER BY bm25(page_fts) LIMIT 10",params:['"Theorem 2"']},pageNumbers:'1-based PDF viewer pages; not printed page numbers',searchAdvice:'Search in the original language. Zero matches do not prove absence. Read raw_text for exact evidence; request images for plots/formulas.'};},
    async query(id,sql,params){const record=get(id),value=await record.index.query(sql,params);if(get(id)!==record)throw new UserError('PDF 공유가 종료되었습니다.',410);return value;},
    read(id,pages){const record=get(id);if(!Array.isArray(pages)||pages.length<1||pages.length>3||pages.some(p=>!Number.isInteger(p)||p<1||p>record.pages.length))throw new UserError('유효한 PDF 페이지를 한 번에 최대 3개 지정하세요.');return {pages:[...new Set(pages)].map(page=>({page,text:record.pages[page-1].slice(0,18000),truncated:record.pages[page-1].length>18000})),emptyTextAdvice:'텍스트가 없는 스캔 페이지는 render_pdf_page로 확인하세요.'};},
    async render(id,page,region){const record=get(id);if(!Number.isInteger(page)||page<1||page>record.pages.length)throw new UserError('PDF 페이지 범위를 확인하세요.');region=renderRegion(region);const value=await renderer.render(id,page,region);if(get(id)!==record)throw new UserError('PDF 공유가 종료되었습니다.',410);return value;},
    reset(){for(const record of [...records.values()])remove(record);},
    close(){closed=true;this.reset();renderer?.close();}
  };
}
