"""Explicit repair of the two audited test assets, using developer-owned math.

Not a runtime topic router. Original immutable assets and drafts are retained by
the calling maintenance command. Generated implementations run only in WASM.
"""
import json
from pathlib import Path
import sys
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lab_contracts import FinalOutput, LabDraft, PrivateAssessment, to_public_course
from lab_assembly import assemble_lab, normalize_generated_draft, build_pytest_source
from autonomous_tasks import contextual_task
from shortest_path_assets import review_shortest_path_draft
from problem_statements import ProblemStatement, render_statement
from importlib.util import spec_from_file_location, module_from_spec

spec = spec_from_file_location('trusted_oracles', Path(__file__).with_name('check-cross-algorithm-answers.py'))
oracle = module_from_spec(spec)
spec.loader.exec_module(oracle)


def repair(value: dict, mode: str) -> dict:
    if mode == 'bst':
        from importlib import import_module
        return import_module('repair-bst-reviewed').repair_bst(value)
    if mode == 'search-lesson':
        from capped_match_assets import repair_search_lesson
        return repair_search_lesson(value)
    if mode == 'capped-matches':
        from capped_match_assets import repair as repair_capped_matches
        return repair_capped_matches(value)
    if mode in ('regenerated', 'avl', 'executable', 'executable-programming'):
        import asyncio
        from agent_workflow import LabAgent_Node, create_initial_state
        output=FinalOutput.model_validate(value)
        old=output.problem
        scene=old.guided_scene
        draft=LabDraft(title=scene.problem.title,instructions=scene.problem.instructions,
            scaffold_code=scene.interactive_code,reference_solution=old.reference_solution,
            difficulty=scene.problem.difficulty,constraints=scene.problem.constraints,
            teaching_steps=scene.teaching_steps,public_test_cases=scene.problem.public_test_cases,
            hidden_test_cases=old.hidden_test_cases)
        if mode == 'avl':
            from avl_assets import avl_guide
            draft = avl_guide(output.topic)
            if draft is None:
                raise ValueError('AVL repair requires an AVL course')
        compiled=mode in ('executable','executable-programming')
        state=create_initial_state(output.topic,executable_labs=compiled)
        if compiled:
            prefix='# executable-contract-verification: '
            proofs=[line[len(prefix):] for line in old.pytest_source.splitlines() if line.startswith(prefix)]
            if proofs:state['execution_proof']=json.loads(proofs[-1])
            if len(sys.argv)>5 and sys.argv[5]:
                state['execution_proof']=json.loads(Path(sys.argv[5]).read_text(encoding='utf-8'))
        if compiled and len(sys.argv)>4 and Path(sys.argv[4]).exists():
            state['teaching_requirement']=Path(sys.argv[4]).read_text(encoding='utf-8').strip() or output.topic
        state.update(current_topic=output.topic,requires_lab=True,
            course_kind='programming' if mode=='executable-programming' else 'algorithm',
            final_output={**output.model_dump(mode='json'), 'course_id':str(uuid4()),'lab':None,'problem':None})
        result=asyncio.run(LabAgent_Node(state,accepted_guided=None if compiled else draft))['final_output']
        if compiled and len(sys.argv)>6 and state.get('execution_proof',{}).get('kind')=='independent-execution':
            from exam_simulator.generated import remember_verified_contract
            requirement=state['teaching_requirement'].split('。当前课程：',1)[0].removeprefix('原始教学需求：')
            asyncio.run(remember_verified_contract(requirement,sys.argv[6],state['execution_proof'],
                purpose='programming-task' if mode=='executable-programming' else 'algorithm',teaching_context=requirement))
        final=FinalOutput.model_validate(result).model_dump(mode='json',by_alias=True)
        return {'publicCourse':to_public_course(final),'privateOutput':final}
    if mode == 'lcs':
        from lcs_assets import repair_lcs
        return repair_lcs(value)
    if mode == 'floyd':
        from floyd_assets import repair_floyd
        return repair_floyd(value)
    if mode == 'kruskal':
        from importlib import import_module
        return import_module('kruskal-reviewed-assets').repair_kruskal(value)
    output = FinalOutput.model_validate(value).model_copy(deep=True)
    old = output.problem
    guided = old.guided_scene
    draft = LabDraft(title=guided.problem.title, instructions=guided.problem.instructions,
        scaffold_code=guided.interactive_code, reference_solution=old.reference_solution,
        difficulty=guided.problem.difficulty, constraints=guided.problem.constraints,
        teaching_steps=guided.teaching_steps, public_test_cases=guided.problem.public_test_cases,
        hidden_test_cases=old.hidden_test_cases)
    parameters = [p.name for p in guided.problem.entry_point.parameters]
    if mode == 'knapsack':
        if parameters != ['weights', 'values', 'capacity'] or guided.problem.entry_point.return_type != 'int':
            raise ValueError('Unexpected knapsack contract; manual review required')
        for case in draft.public_test_cases + draft.hidden_test_cases:
            data = case.inputs
            if len(data['weights']) > 20 or len(data['weights']) != len(data['values']):
                raise ValueError('Unreviewed fixture size')
            case.expected = oracle.backpack(**data)
            case.description = f'0/1 选择：容量 {data["capacity"]}，最大总价值为 {case.expected}。'
        draft.reference_solution = '''class Solution:
    def solve(self, weights: list[int], values: list[int], capacity: int) -> int:
        dp = [0] * (capacity + 1)
        for weight, value in zip(weights, values):
            for room in range(capacity, weight - 1, -1):
                dp[room] = max(dp[room], dp[room - weight] + value)
        return dp[capacity]
'''
        statement = ProblemStatement(title='0/1 背包：容量内的最大总价值',
            context='在有限承重的背包中选择物品，每件物品最多选一次。',
            task='返回总重量不超过 capacity 时的最大总价值。允许不选物品。',
            input_explanation='weights 和 values 按相同位置对应重量和价值，capacity 为非负整数容量。',
            output_explanation='一个整数，表示最大总价值；不能重复选择同一件物品。',
            constraints=['两列表长度相同，重量为正整数，价值和容量为非负整数'])
    elif mode == 'dijkstra-adjacency':
        if parameters != ['graph', 'start'] or guided.problem.entry_point.return_type != 'list[int]':
            raise ValueError('Unexpected adjacency-list contract; manual review required')
        draft = review_shortest_path_draft(draft, 'Dijkstra')
        statement = ProblemStatement(title='有向图：从起点到各节点的最短距离',
            context='沿有向道路从一个站点到达其他站点，计算各自的最短耗时。',
            task=draft.instructions,
            input_explanation='graph 是邻接行字符串列表。每行 u v1 w1 v2 w2 ... 表示从 u 出发的有向边及非负边权；孤立点只写 u。start 为起点编号。',
            output_explanation='按节点编号返回整数列表。起点距离为 0，不可达节点距离为 -1。',
            constraints=draft.constraints)
    elif mode == 'dijkstra':
        if parameters != ['graph', 'source'] or guided.problem.entry_point.return_type != 'int':
            raise ValueError('Unexpected Dijkstra contract; manual review required')
        for case in draft.public_test_cases + draft.hidden_test_cases:
            distances = oracle.shortest_paths(json.loads(case.inputs['graph']), case.inputs['source'])
            case.expected = sum(distances) if all(d >= 0 for d in distances) else -1
            case.description = f'逐节点最短距离为 {distances}；按题意返回 {case.expected}。'
        draft.reference_solution = '''class Solution:
    def solve(self, graph: str, source: int) -> int:
        import json
        import heapq
        matrix = json.loads(graph)
        dist = [float('inf')] * len(matrix)
        dist[source] = 0
        queue = [(0, source)]
        while queue:
            distance, node = heapq.heappop(queue)
            if distance != dist[node]:
                continue
            for target, weight in enumerate(matrix[node]):
                if weight > 0 and distance + weight < dist[target]:
                    dist[target] = distance + weight
                    heapq.heappush(queue, (dist[target], target))
        return -1 if any(d == float('inf') for d in dist) else sum(dist)
'''
        statement = ProblemStatement(title='Dijkstra：到各节点的最短距离总和',
            context='从一个配送中心出发，计算到所有站点的最短距离。',
            task='返回 source 到所有节点的最短距离总和（包含到自身的 0）；任意节点不可达时返回 -1。',
            input_explanation='graph 是 JSON 字符串编码的方阵。正数为有向边权重，0 表示无边；source 为起点下标。',
            output_explanation='一个整数，表示最短距离总和或 -1；没有直接边也可能通过其他节点到达。',
            constraints=['非空合法方阵，边权非负，0 表示无边', '0 <= source < 节点数'])
        for step in draft.teaching_steps:
            if '不可达' in step.title or '不可达' in step.instruction:
                step.instruction = '只要存在一个不可达节点就返回 -1；全部节点可达时返回最短距离之和，源点到自身的距离为 0。'
                step.hint = '逐个检查无穷距离，不能直接使用距离数值的布尔真值。'
    else:
        raise ValueError('Explicit audited repair mode required')
    draft = normalize_generated_draft(draft)
    output.course_id = str(uuid4())
    lab, rebuilt = assemble_lab(draft, output.course_id)
    rebuilt.guided_scene.problem.title = statement.title
    rebuilt.guided_scene.problem.instructions = render_statement(statement, rebuilt.guided_scene)
    rebuilt.guided_scene.problem.constraints = statement.constraints
    rebuilt.guided_scene.markdown_content = '# ' + statement.title + '\n\n' + rebuilt.guided_scene.problem.instructions
    lab.title, lab.instructions = statement.title, rebuilt.guided_scene.problem.instructions
    if mode in ('knapsack', 'dijkstra-adjacency'):
        transfer = contextual_task(draft, '0/1 背包算法' if mode == 'knapsack' else 'Dijkstra')
        _, independent = assemble_lab(transfer, output.course_id)
        rebuilt.oj_scene = independent.oj_scene
        rebuilt.oj_scene.problem = rebuilt.oj_scene.problem.model_copy(update={
            'execution_mode': 'stdio', 'standard_io_profile': 'knapsack-minweight' if mode == 'knapsack' else 'delivery-deadline'})
        rebuilt.oj_scene.interactive_code = '# 请独立编写完整程序，从标准输入读取，并将结果打印到标准输出。\n'
        rebuilt.oj_assessment = PrivateAssessment(hidden_test_cases=independent.hidden_test_cases,
            reference_solution=independent.reference_solution, pytest_source=independent.pytest_source)
    else:
        # Keep the distinct reachability goal, but replace its broken all(dist)
        # reference and independently recompute normal and invalid-input cases.
        rebuilt.oj_scene = old.oj_scene.model_copy(deep=True)
        rebuilt.oj_scene.course_id = output.course_id
        rebuilt.oj_scene.scene_id = str(uuid4())
        rebuilt.oj_scene.problem.problem_id = str(uuid4())
        rebuilt.oj_assessment = old.oj_assessment.model_copy(deep=True)
        for case in [*rebuilt.oj_scene.problem.public_test_cases, *rebuilt.oj_assessment.hidden_test_cases]:
            data = json.loads(case.inputs['stdin'])
            matrix = json.loads(data['graph'])
            source = data['source']
            expected = bool(matrix) and 0 <= source < len(matrix) and all(
                d >= 0 for d in oracle.shortest_paths(matrix, source))
            case.expected = json.dumps(expected)
            case.description = f'根据有向路径判断全部站点可达性，输出 {case.expected}。'
        rebuilt.oj_assessment.reference_solution = '''class Solution:
    def solve(self, stdin: str) -> str:
        import json
        data = json.loads(stdin)
        matrix = json.loads(data['graph'])
        source = data['source']
        if not matrix or not 0 <= source < len(matrix):
            return 'false'
        visited = {source}
        pending = [source]
        while pending:
            node = pending.pop()
            for target, weight in enumerate(matrix[node]):
                if weight > 0 and target not in visited:
                    visited.add(target)
                    pending.append(target)
        return json.dumps(len(visited) == len(matrix))
'''
        rebuilt.oj_assessment.pytest_source = build_pytest_source(
            [*rebuilt.oj_scene.problem.public_test_cases, *rebuilt.oj_assessment.hidden_test_cases])
        oj_statement = ProblemStatement(title='配送网络：判断全部站点是否可达',
            context='配送中心需要确认能否沿单向道路到达每一个站点。',
            task='判断从 source 能否到达全部节点（包括自身）。空图或起点越界时返回 false。',
            input_explanation='标准输入为一行 JSON 对象，字段 graph 是 JSON 字符串编码的邻接方阵，source 是起点下标。正数表示边权，0 表示无边。',
            output_explanation='输出一行 JSON 布尔值 true 或 false，必须小写。',
            constraints=['非空图为合法方阵且边权非负，0 表示无边', '空图或起点越界时输出 false'])
        rebuilt.oj_scene.problem.title = oj_statement.title
        rebuilt.oj_scene.problem.instructions = render_statement(oj_statement, rebuilt.oj_scene)
        rebuilt.oj_scene.problem.constraints = oj_statement.constraints
        rebuilt.oj_scene.markdown_content = '# ' + oj_statement.title + '\n\n' + rebuilt.oj_scene.problem.instructions
    output.lab, output.problem = lab, rebuilt
    validated = FinalOutput.model_validate(output.model_dump()).model_dump(mode='json', by_alias=True)
    return {'publicCourse': to_public_course(validated), 'privateOutput': validated}


if __name__ == '__main__':
    result = repair(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')), sys.argv[3])
    Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
