import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
try {
  const {rows}=await pool.query("SELECT id, data->>'name' AS title FROM document_stages WHERE data->>'name' ILIKE $1 ORDER BY data->>'updatedAt' DESC LIMIT 3",['%斐波%']);
  for(const row of rows){
    const scenes=await pool.query('SELECT data FROM document_scenes WHERE stage_id=$1 ORDER BY scene_order',[row.id]);
    console.log(JSON.stringify({...row,scenes:scenes.rows.map(({data})=>({type:data.type,title:data.title,widget:data.content.widgetType,lab:data.content.eduplus?.phase}))}));
  }
}finally{await pool.end();}
