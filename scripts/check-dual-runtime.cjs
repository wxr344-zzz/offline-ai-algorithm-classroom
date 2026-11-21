const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const settings=Object.fromEntries(fs.readFileSync(path.join(root,'.env.local'),'utf8').split(/\r?\n/).filter(s=>/^[A-Z][A-Z0-9_]*=/.test(s)).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
let failed=0;const ok=s=>console.log('[OK] '+s),warn=s=>console.log('[INFO] '+s),bad=s=>{failed++;console.error('[FAIL] '+s)};
(async()=>{
  console.log('OPENMAIC DUAL MODEL MAIN | local/offline readiness');
  for(const relative of ['node_modules/next/package.json','.venv/Scripts/python.exe','public/vendor/eduplus/pyodide/python_stdlib.zip','public/vendor/eduplus/pyodide/pyodide.asm.wasm','public/vendor/eduplus/monaco/vs/loader.js','public/vendor/eduplus/katex/katex.min.js']){if(fs.existsSync(path.join(root,relative)))ok(relative);else bad('Missing '+relative);}
  if(fs.existsSync(path.join(root,'.next/BUILD_ID')))ok('Production build exists');else warn('Main launcher will build before production start.');
  for(const key of ['DATABASE_URL','EDUPLUS_AGENT_SERVICE_TOKEN','OPENMAIC_SECRET_KEY']){if(settings[key])ok(key+' configured (value hidden)');else bad('Missing '+key);}
  const yaml=require('js-yaml');const cfg=yaml.load(fs.readFileSync(path.join(root,'openmaic.yml'),'utf8'));
  if(cfg.slots?.llm==='local:qwen2.5-coder:7b'&&cfg.slots?.['course.content.slide']?.model==='local:openmaic-gemma4-e4b:dual-16k'&&cfg.providers?.local?.baseUrl==='http://127.0.0.1:11436/v1'&&cfg.lock==='all'&&cfg.allowUserKeys===false)ok('Both local models locked; main queue 11436');else bad('Unexpected model routing');
  const runtime=JSON.parse(fs.readFileSync(path.join(root,'database-runtime.json'),'utf8'));
  const url=new URL(settings.DATABASE_URL);
  if(url.port===String(runtime.port)&&url.pathname==='/openmaic_dual_main')ok('Independent main database configuration');else bad('Database points outside main workspace');
  const {Client}=require('pg');const db=new Client({connectionString:settings.DATABASE_URL,connectionTimeoutMillis:3000});
  try{await db.connect();await db.query('select 1');ok('Main PostgreSQL reachable');}catch(e){if(e.code==='ECONNREFUSED'&&fs.existsSync(path.join(root,'local-database/PG_VERSION')))warn('Database stopped; launcher starts it automatically');else bad('Database: '+(e.code||e.message));}finally{await db.end().catch(()=>{});}
  try{const tags=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(4000)}).then(r=>r.json());for(const model of ['qwen2.5-coder:7b','openmaic-gemma4-e4b:dual-16k']){if(tags.models.some(m=>m.name===model))ok('Installed: '+model);else bad('Missing '+model);}}catch{warn('Ollama is stopped/unreachable; launcher attempts to start it.');}
  console.log(failed?'Readiness checks failed: '+failed:'Readiness checks passed; content accuracy is evaluated separately.');process.exitCode=failed?1:0;
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
