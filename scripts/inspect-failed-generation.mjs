// SELECT-only diagnostics; never retries or changes a run.
import {createRequire} from 'node:module';
import pg from 'pg';
const require=createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
try {
 const rows=await pool.query('SELECT id,state,step,input,error,stage_id FROM generation_runs WHERE id LIKE $1 ORDER BY updated_at DESC LIMIT 4',['%'+process.argv[2]+'%']);
 for(const row of rows.rows) console.log(JSON.stringify(row));
} finally {await pool.end();}
