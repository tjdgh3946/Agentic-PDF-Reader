import {DatabaseSync,constants as C} from 'node:sqlite';

// Separate OS process: a synchronous SQLite query can be terminated at the deadline.
// No files, identity, settings, or network endpoints are passed to this process.
let db;
const tables=new Set(['pages','page_fts','page_fts_data','page_fts_idx','page_fts_content','page_fts_docsize','page_fts_config']);
const functions=new Set(['match','bm25','snippet','highlight','substr','substring','length','lower','upper','trim','ltrim','rtrim','replace','instr','coalesce','ifnull','nullif','abs','round','min','max','count','sum','avg','total','like','glob']);
function authorize(action,a,b,database){
  if(action===C.SQLITE_SELECT || action===C.SQLITE_RECURSIVE)return C.SQLITE_OK;
  if(action===C.SQLITE_READ && (database==='main' || (database===null && b==='')) && tables.has(a))return C.SQLITE_OK;
  if(action===C.SQLITE_FUNCTION && functions.has(String(b).toLowerCase()))return C.SQLITE_OK;
  // FTS5 checks its private in-memory connection's change counter at execution.
  // User PRAGMA statements are rejected by the SQL validator before this point.
  if(action===C.SQLITE_PRAGMA && a==='data_version' && b===null && database==='main')return C.SQLITE_OK;
  return C.SQLITE_DENY;
}
process.on('message',({id,sql,params,pages})=>{
  try{
    if(pages){
      db=new DatabaseSync(':memory:',{allowExtension:false});
      if(typeof db.setAuthorizer!=='function')throw new Error('PDF 검색에는 SQLite authorizer와 FTS5가 필요합니다. Electron 앱 또는 Node 24.10 이상으로 실행하세요.');
      db.exec('CREATE TABLE pages(page_no INTEGER PRIMARY KEY, raw_text TEXT); CREATE VIRTUAL TABLE page_fts USING fts5(page_no UNINDEXED, text);');
      const raw=db.prepare('INSERT INTO pages VALUES (?,?)'),fts=db.prepare('INSERT INTO page_fts VALUES (?,?)');
      db.exec('BEGIN');
      pages.forEach((text,index)=>{
        raw.run(index+1,text);
        // TeX PDFs may extract a word's diaeresis as a separate glyph, e.g.
        // Gr¨ onwall. Repair only this inline Latin-word pattern in the index;
        // pages.raw_text remains untouched for checking the actual source.
        const searchable=text.replace(/([A-Za-z])\s*¨\s*([A-Za-z])/g,(_match,left,right)=>left+right+'\u0308').normalize('NFKC').replaceAll('\u00ad','');
        fts.run(index+1,searchable);
      });
      db.exec('COMMIT; PRAGMA query_only=ON;');
      db.prepare("SELECT page_no FROM page_fts WHERE page_fts MATCH 'initialization'").all();
      db.setAuthorizer(authorize);
      process.send({ready:true});return;
    }
    const statement=db.prepare(sql);statement.setReadBigInts(true);
    const bindings=Array.isArray(params)?params:[params||{}];
    const rows=[];let chars=0,truncated=false;
    for(const value of statement.iterate(...bindings)){
      const row=Object.fromEntries(Object.entries(value).map(([key,v])=>{
        if(typeof v==='bigint')return [key,v<=BigInt(Number.MAX_SAFE_INTEGER)&&v>=BigInt(Number.MIN_SAFE_INTEGER)?Number(v):String(v)];
        if(typeof v==='string' && v.length>12000)return [key,v.slice(0,12000)];
        return [key,v];
      }));
      const size=JSON.stringify(row).length;
      if(rows.length>=20 || chars+size>12000){truncated=true;break;}
      if(Object.values(value).some(v=>typeof v==='string' && v.length>12000))truncated=true;
      rows.push(row);chars+=size;
    }
    process.send({id,value:{rows,truncated}});
  }catch(error){
    const matchHelp=/\bMATCH\b/i.test(sql||'') && /fts5|no such column/i.test(error.message)
      ? ' MATCH 매개변수는 FTS5 문법입니다. 하이픈·구두점이 있는 검색어는 큰따옴표로 감싸세요(예: "non-polynomial"). SQL 매개변수 바인딩만으로 FTS 문법이 이스케이프되지는 않습니다.' : '';
    process.send({id,error:'SQL 실행 실패: '+error.message+matchHelp});
  }
});
