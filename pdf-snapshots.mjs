import {createHash} from 'node:crypto';
import {UserError} from './auth.mjs';
import {createQueryIndex} from './pdf-query.mjs';
import {createPassageReader,CONTEXT_LIMITS} from './pdf-passages.mjs';
import {textQuality} from './pdf-text-quality.mjs';
export const PDF_LIMITS={bytes:64*1024*1024,pages:1000,text:12_000_000,snapshots:3,totalBytes:192*1024*1024};
export function renderRegion(region=[0,0,1,1]){
  if(!Array.isArray(region)||region.length!==4||!region.every(Number.isFinite)||region[0]<0||region[1]<0||region[2]<.02||region[3]<.02||region[0]+region[2]>1.000001||region[1]+region[3]>1.000001)throw new UserError('영역은 [x,y,width,height] 0~1 좌표이며 폭·높이는 0.02 이상이어야 합니다.');
  const [x,y,w,h]=region.map(n=>Math.round(n*10000)/10000);
  return [x,y,Math.min(w,1-x),Math.min(h,1-y)];
}
export function createPdfSnapshots({renderer,now=Date.now,queryOptions}={}){
  const records=new Map();let closed=false,registration=Promise.resolve();
  function remove(record){records.delete(record.snapshotId);record.index?.close();renderer?.release(record.snapshotId);}
  function prune(){for(const record of records.values())if(!record.refs.size && now()-record.touched>300000)remove(record);}
  function get(id){prune();const record=records.get(id);if(!record || closed)throw new UserError('PDF 고정본이 만료되었습니다. 다시 공유하세요.',410);record.touched=now();return record;}
  const info=record=>({snapshotId:record.snapshotId,pageCount:record.pages?.length||0,bytes:record.bytes,emptyPages:record.pages?.flatMap((text,i)=>text.trim()?[]:[i+1])||[],textQuality:record.quality,state:record.state});
  return {
    available:!!renderer,
    resources:()=>({snapshots:records.size,searchWorkers:[...records.values()].filter(r=>r.index?.resident).length,renderers:renderer?.residentCount??null}),
    register(bytes,documentId,fileName){const job=registration.then(async()=>{
      if(closed || !renderer)throw new UserError('AI 문맥 검색은 Electron 앱에서 지원합니다.',409);
      if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>PDF_LIMITS.bytes||!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new UserError('PDF 파일은 최대 64 MiB입니다. 원본 PDF 형식을 확인하세요.',413);
      if(typeof documentId!=='string'||!/^[a-f\d-]{1,200}$/i.test(documentId)||typeof fileName!=='string'||!fileName.trim()||fileName.length>500)throw new UserError('PDF 이름과 문서 ID를 확인하세요.');
      prune();const snapshotId=createHash('sha256').update(bytes).digest('hex');
      const existing=records.get(snapshotId);if(existing){if(existing.documentId!==documentId)throw new UserError('같은 PDF의 문서 ID가 일치하지 않습니다.');existing.touched=now();existing.source=bytes;return info(existing);}
      for(const record of [...records.values()])if(records.size>=PDF_LIMITS.snapshots && !record.refs.size)remove(record);
      if(records.size>=PDF_LIMITS.snapshots || [...records.values()].reduce((n,r)=>n+r.bytes,0)+bytes.length>PDF_LIMITS.totalBytes)throw new UserError('PDF 공유 한도(3개/192 MiB)에 도달했습니다. 노트 연결을 해제한 뒤 다시 공유하세요.',409);
      const record={snapshotId,documentId,bytes:bytes.length,source:bytes,state:'indexing',touched:now(),refs:new Set()};records.set(snapshotId,record);
      try{
        const result=await renderer.load(snapshotId,bytes,PDF_LIMITS);
        if(closed || records.get(snapshotId)!==record)throw new UserError('PDF 등록이 취소되었습니다.',410);
        if(!Array.isArray(result.pages)||!result.pages.length||result.pages.length>PDF_LIMITS.pages||result.pages.some(p=>typeof p!=='string')||result.pages.reduce((n,p)=>n+p.length,0)>PDF_LIMITS.text)throw new UserError('페이지/본문 추출 한도를 초과했습니다.');
        if(result.documentId!==documentId)throw new UserError('원본 PDF와 뷰어 문서가 일치하지 않습니다. 다시 열어주세요.');
        record.pages=result.pages;record.quality=textQuality(record.pages);record.reader=createPassageReader(snapshotId,record.pages,result.paragraphBreaks);record.index=createQueryIndex(record.pages,{...queryOptions,passages:record.reader.passages});await record.index.ready();
        if(closed || records.get(snapshotId)!==record)throw new UserError('PDF 등록이 취소되었습니다.',410);
        record.state='ready';return info(record);
      }catch(error){remove(record);throw error;}
    });registration=job.catch(()=>{});return job;},
    source(id){return get(id).source;},
    discardSource(id){get(id).source=null;},
    pin(id,documentId,selectionId){const record=get(id);if(record.documentId!==documentId||record.state!=='ready')throw new UserError('질문과 PDF 고정본이 일치하지 않습니다.');record.refs.add(selectionId);},
    unpin(id,selectionId){const record=records.get(id);if(!record)return;record.refs.delete(selectionId);if(!record.refs.size)remove(record);},
    inspect(id){const record=get(id);return {...info(record),paragraphCount:record.reader.passages.length,schema:{pages:'pages(page_no,raw_text)',page_fts:'page_fts(page_no,text)',paragraphs:'paragraphs(passage_id,page_no,start,end,raw_text)',paragraph_fts:'paragraph_fts(passage_id,page_no,text) FTS5'},limits:CONTEXT_LIMITS,example:{tool:'search_pdf',query:'"Theorem 2"'},pageNumbers:'1-based PDF viewer pages; not printed page numbers',searchAdvice:'Prefer search_pdf -> read_pdf(passageId). Expand only missing nearby evidence via before/after cursor and a reason; search again for distant definitions or assumptions. Zero lexical results do not prove absence. read_pdf(pages) returns only the first paragraph of each page. No tool removes older ChatGPT context.'};},
    async query(id,sql,params){const record=get(id),value=await record.index.query(sql,params);if(get(id)!==record)throw new UserError('PDF 공유가 종료되었습니다.',410);return value;},
    async search(id,args){
      const record=get(id),limit=args.limit??CONTEXT_LIMITS.searchHits;
      if(typeof args.query!=='string'||!args.query.trim()||args.query.length>500||!Number.isInteger(limit)||limit<1||limit>5)throw new UserError('검색어는 1~500자, 결과 수는 1~5개입니다.');
      if(args.pages!==undefined&&(!Array.isArray(args.pages)||!args.pages.length||args.pages.length>20||args.pages.some(p=>!Number.isInteger(p)||p<1||p>record.pages.length)))throw new UserError('검색할 PDF 페이지를 확인하세요.');
      const filter=args.pages?' AND CAST(page_no AS INTEGER) IN ('+args.pages.map(()=>'?').join(',')+')':'';
      const sql="SELECT passage_id, CAST(page_no AS INTEGER) AS page_no, snippet(paragraph_fts,2,'[',']','…',24) AS excerpt FROM paragraph_fts WHERE paragraph_fts MATCH ?"+filter+' ORDER BY bm25(paragraph_fts) LIMIT ?';
      const result=await record.index.query(sql,[args.query,...(args.pages||[]),limit+1]);
      if(get(id)!==record)throw new UserError('PDF 공유가 종료되었습니다.',410);
      const quality=args.pages?textQuality(record.pages,args.pages):record.quality;
      return {matches:result.rows.slice(0,limit).map(row=>({passageId:row.passage_id,page:row.page_no,excerpt:row.excerpt.slice(0,CONTEXT_LIMITS.searchExcerptCharacters)})),moreMatches:result.rows.length>limit||result.truncated,textQuality:quality,limits:{hits:limit,excerptCharacters:CONTEXT_LIMITS.searchExcerptCharacters},advice:'Search excerpts are discovery only. Read the passageId for exact text. Short or empty results: source-language synonyms, broader keywords, or SQL metadata lookup. If textQuality is partial/limited, inspect relevant low-text/damaged pages with render_pdf_page, then crop only needed detail. Never conclude absence from zero lexical hits. Expand nearby text only after reading; do not equate a snippet with complete evidence.'};
    },
    read(id,pagesOrArgs){const record=get(id);return record.reader.read(Array.isArray(pagesOrArgs)?{pages:pagesOrArgs}:pagesOrArgs);},
    expand(id,args){return get(id).reader.expand(args);},
    async render(id,page,region){const record=get(id);if(!Number.isInteger(page)||page<1||page>record.pages.length)throw new UserError('PDF 페이지 범위를 확인하세요.');region=renderRegion(region);const value=await renderer.render(id,page,region);if(get(id)!==record)throw new UserError('PDF 공유가 종료되었습니다.',410);return value;},
    reset(){for(const record of [...records.values()])remove(record);},
    close(){closed=true;this.reset();renderer?.close();}
  };
}
