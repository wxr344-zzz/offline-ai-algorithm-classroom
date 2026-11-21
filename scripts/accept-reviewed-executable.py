"""Validate a reviewed repair through the same independent WASM/compiler gates.

This is a local repair tool, not a catalog entry or runtime fallback. It never
executes the supplied Python in the host interpreter.
"""
import asyncio,hashlib,json,sys
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import executable_lessons as compiler
from exam_simulator.generated import GeneratedAlgorithm
from lab_contracts import FinalOutput,to_public_course

payload=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
program=GeneratedAlgorithm.model_validate(payload['program'])
oracle=payload['oracle']
proof={'kind':'independent-execution','program':program.model_dump(mode='json'),'oracle':oracle,
       'sourceHash':hashlib.sha256((program.source+'\n'+oracle).encode()).hexdigest()}
async def reviewed_labels(*args):
    return compiler.ApplicationLabels(location='数据分析实验室',actor='分析员',record='点集聚类任务',summary='frequencies')
compiler.application_labels=reviewed_labels
state={'current_topic':program.title,'course_kind':'algorithm','teaching_requirement':sys.argv[3],
       'execution_proof':proof,'final_output':{'course_id':str(uuid4()),'topic':program.title,
       'requires_lab':True,'status':'ready','lesson_plan':{'title':program.title,
       'objectives':['理解聚类目标与Lloyd迭代','能手算距离、标签和坐标均值','能处理空簇、平局与终止条件'],
       'knowledge_points':['以距离平方选择最近的聚类中心','逐维计算簇内数据点的均值','固定初始化、平局规则与空簇处理','中心不变或达到迭代上限时终止']},
       'common_mistakes':[],'lab':None,'problem':None}}
result=asyncio.run(compiler.build_executable_labs(state))
private=FinalOutput.model_validate(result['final_output']).model_dump(mode='json',by_alias=True)
Path(sys.argv[2]).write_text(json.dumps({'publicCourse':to_public_course(private),'privateOutput':private},ensure_ascii=False),encoding='utf-8')
