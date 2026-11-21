// Read-only generation acceptance snapshot. Never execute a course's Python here.
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
const require=createRequire(import.meta.url);
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const ids=process.argv.slice(2);
if(!ids.length||ids.some(id=>!/^run-[A-Za-z0-9_-]+$/.test(id)))throw new Error('Specify generation run ids');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
try {
  const {rows}=await pool.query(`SELECT r.id,r.state,r.stage_id,r.scenes_total,r.scenes_completed,
    r.error,c.course_id,c.public_data,c.private_data
    FROM generation_runs r
    LEFT JOIN generation_run_steps s ON s.run_id=r.id AND s.step_id='outline:lab-course'
    LEFT JOIN LATERAL (SELECT assets.* FROM eduplus_courses assets
      WHERE assets.owner_id=r.owner_id AND
        (assets.classroom_data->>'stageId'=r.stage_id OR assets.course_id=(s.output #>> '{}'))
      ORDER BY (assets.classroom_data->>'stageId'=r.stage_id) DESC NULLS LAST,assets.created_at DESC LIMIT 1) c ON true
    WHERE r.id=ANY($1::text[]) ORDER BY r.created_at`,[ids]);
  const report=[];
  for(const row of rows) {
    if(row.public_data)await writeFile(`logs/${row.id}-executable-assets.json`,JSON.stringify({publicCourse:row.public_data,privateOutput:row.private_data}));
    report.push({runId:row.id,state:row.state,stageId:row.stage_id,topic:row.public_data?.topic,
      courseId:row.course_id,completed:row.scenes_completed,total:row.scenes_total,error:row.error,
      exercises:row.public_data?.scenes.map(s=>({type:s.sceneType,title:s.problem.title,publicCases:s.problem.publicTestCases.length})),
      hiddenCases:row.private_data?.problem ? {
        guided:row.private_data.problem.hidden_test_cases.length,oj:row.private_data.problem.oj_assessment.hidden_test_cases.length}:undefined});
  }
  await writeFile('logs/executable-classroom-acceptance.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{await pool.end();}
