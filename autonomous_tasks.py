"""系统维护的情境迁移题与标准输入输出适配；不执行模型产生的源码。"""
from __future__ import annotations

import ast
import json
import re
from itertools import combinations
from textwrap import indent

from lab_contracts import LabDraft, TestCase
from shortest_path_assets import is_shortest_path_topic, shortest_distances
from spanning_tree_assets import is_spanning_tree_topic, NETWORK_BODY, network_examples
from queue_assets import is_linked_queue, SERVICE_BODY, service_examples
from floyd_assets import is_floyd, DEPOT_BODY, depot_examples


def is_two_sum(text: str) -> bool:
    # “两数加和算法”是用户常用别名；明确的 a+b 标量课不归入数组查找。
    if re.search(r"标量|两个整数相加|a\s*\+\s*b", text, re.I) and not re.search(r"数组|下标|target", text, re.I):
        return False
    return bool(re.search(r"两数之和|两数加和(?:算法)?|two[ -]?sum", text, re.I))


def task_profile(requirement: str) -> str | None:
    if is_shortest_path_topic(requirement): return 'delivery-deadline'
    if is_two_sum(requirement): return "budget-pair"
    if re.search(r"背包|knapsack", requirement, re.I): return "knapsack-minweight"
    if re.search(r"二叉树|binary tree|树.*遍历", requirement, re.I): return "tree-traversals"
    return None


def _stdio_draft(base: LabDraft, title: str, instructions: str, constraints: list[str],
                 samples: list[tuple[str, str]], body: str) -> LabDraft:
    cases = [TestCase(case_id=f"autonomous-{i}", inputs={"stdin": data}, expected=answer,
                      description=f"{'公开' if i < 4 else '保留'}用例 {i + 1}")
             for i, (data, answer) in enumerate(samples)]
    return base.model_copy(update={
        "title": title, "instructions": instructions, "difficulty": "Medium", "constraints": constraints,
        "scaffold_code": "class Solution:\n    def solve(self, stdin: str) -> str:\n        # TODO\n        raise NotImplementedError\n",
        "reference_solution": "class Solution:\n    def solve(self, stdin: str) -> str:\n" + indent(body, "        "),
        "public_test_cases": cases[:4], "hidden_test_cases": cases[4:],
    })


def contextual_task(base: LabDraft, requirement: str) -> LabDraft | None:
    """按知识点选取情境任务；期望答案由独立可信算法计算，不信任模型编造答案。"""
    from lcs_assets import lcs_transfer
    reviewed_lcs = lcs_transfer(base, requirement)
    if reviewed_lcs is not None: return reviewed_lcs
    if is_floyd(requirement):
        return _stdio_draft(base,'社区配送：带时限的中心选址',
            '社区有 n 个服务站，准备从其中选一个作为配送中心。道路为有向道路，耗时为非负整数，允许经过其他站点中转。'
            '每次从中心向每个服务站分别配送，要求中心能够到达所有站点，且到每个站点的最短耗时都不超过时限 T。'
            '在符合时限的候选中心中，选择到所有站点的最短耗时总和最小的一个；总和相同时选编号最小的站点。\n\n'
            '输入第一行 n T；随后 n 行为邻接矩阵，每行 n 个空格分隔整数。对角线为 0，-1 表示没有直接道路，零权道路有效，站点编号从 0 开始。'
            '输出一行“中心编号 总耗时 最远耗时”，三个整数以空格分隔；没有合法中心时输出 IMPOSSIBLE。总耗时包含到自身的 0，允许最远耗时恰好等于 T。'
            '例如三站双向链的相邻耗时为 2、3，T=3 时选中间站，输出 1 5 3；同一网络 T=2 时输出 IMPOSSIBLE。'
            '本题综合所有顶点对的最短路、候选筛选、求和、最大值和并列处理，需要独立编写标准输入输出程序。',
            ['1 <= n <= 50，0 <= T <= 1000000，边权为 -1 或 0 到 10000 的整数','邻接矩阵是合法方阵，-1 仅为无边标记'],depot_examples(),DEPOT_BODY)
    if is_linked_queue(requirement):
        return _stdio_draft(base,'社区诊所：限额候诊与重复挂号',
            '社区诊所只有 C 个候诊座位，按事件发生顺序管理当天挂号患者。患者编号为整数，初始无人候诊。'
            'ARRIVE id 表示到达：若该编号今天曾成功挂号（即使已看诊或被清空），输出 DUPLICATE；否则若候诊人数已等于 C，输出 FULL；否则加入队尾并输出 OK。'
            '拒绝的挂号不计入当天成功记录。SERVE 为队头患者看诊并输出编号，空队列输出 EMPTY。CLEAR 取消所有候诊，输出 CLEARED，但保留当天成功挂号记录。\n\n'
            '输入第一行 C N，随后 N 行各一条事件。输出 N 行，每行对应该事件的处理结果。N=0 时不输出任何内容。'
            '与引导题不同，本题需要综合队列、公平排队、容量判断及全天去重，独立编写标准输入输出程序。',
            ['0 <= C,N <= 100，患者编号为 1 到 10000 的整数','事件只有 ARRIVE id、SERVE、CLEAR；重复判断优先于容量判断'],
            service_examples(),SERVICE_BODY)
    if is_spanning_tree_topic(requirement):
        return _stdio_draft(base,'校园光纤升级：已有线路与施工预算',
            '学校要把 n 栋教学楼接入同一个校园网，楼编号为 0 到 n-1。已有 k 条双向光纤可以免费使用，另有 m 条候选线路，每条有施工报价。'
            '你需要先利用已有光纤，再选择新增线路，使全部教学楼连通，并尽量减少新增施工费用；最后判断总预算 B 是否足够。\n\n'
            '输入：第一行 n m k B；接下来 k 行 u v 表示已有免费线路；再接下来 m 行 u v w 表示候选双向线路及非负费用。'
            '每行用空格分隔整数，允许零费用、平行边、自环和已有线路成环。\n'
            '输出：若无论怎样施工都无法全部连通，输出 IMPOSSIBLE；否则输出 YES C（预算足够）或 NO C（预算不足），'
            'C 为最小追加费用。允许费用恰好等于预算。已有网络全部连通或只有一栋楼时，C 为 0。\n\n'
            '与引导题的区别：本题需要处理已有免费连接、最小追加费用和预算可行性，并独立完成标准输入输出程序。',
            ['1 <= n <= 100，0 <= m,k <= 1000，0 <= B,w <= 1000000','端点均在 0 到 n-1 范围内，线路为双向，允许不连通图'],
            network_examples(),NETWORK_BODY)
    if is_shortest_path_topic(requirement):
        examples = [
            (5, [(0,1,4),(1,2,2),(2,3,1),(3,4,1)], 0, 6),
            (3, [(0,1,2)], 0, 10), (1, [], 0, 0),
            (3, [(0,1,0),(1,2,3)], 0, 3),
            (4, [(0,1,8),(0,1,2),(1,2,2)], 0, 3),
            (3, [(0,1,1)], 2, 9), (3, [(0,1,3),(1,2,4)], 0, 2),
        ]
        samples = []
        for n, edges, start, limit in examples:
            rows = [str(i) for i in range(n)] + [f'{u} {v} {w}' for u,v,w in edges]
            distances = shortest_distances(rows, start)
            answer = sum(1 for node, distance in enumerate(distances) if node != start and 0 <= distance <= limit)
            samples.append((f'{n} {len(edges)} {start} {limit}\n' + ''.join(f'{u} {v} {w}\n' for u,v,w in edges), str(answer)))
        return _stdio_draft(base, '限时配送：统计时限内可服务的站点',
            '应用场景：配送中心位于编号 s 的站点。道路为单向道路，通行时间非负。每个站点各派一辆车，车辆从中心出发，'
            '沿最短路径行驶。统计能在 T 分钟内到达的其他站点数，不计配送中心自身。不是求一辆车访问所有站点的路线。'
            '不可达站点不计数，恰好 T 分钟可到达的站点计数。允许零耗时道路与重复道路。\n\n'
            '输入：第一行 n m s T，随后 m 行 u v w，表示 u 到 v 耗时 w。站点编号为 0 到 n-1。\n'
            '输出：一行整数，表示可服务站点数量。请从空白区编写完整 Python 程序读取输入并打印结果。\n'
            '示例输入：5 4 0 6\n0 1 4\n1 2 2\n2 3 1\n3 4 1\n示例输出：2\n'
            '解释：站点 1、2 的最短耗时为 4、6，可服务；站点 3、4 超时。',
            ['1 <= n <= 100，0 <= m <= 1000，0 <= s < n', '0 <= T、w <= 1000000', '有向道路；不计起点；每个目的地单独派车'], samples,
            "parts = list(map(int, stdin.split()))\nn, m, start, limit = parts[:4]\nadj = [[] for _ in range(n)]\nfor i in range(m):\n    u,v,w = parts[4+3*i:7+3*i]\n    adj[u].append((v,w))\nimport heapq\ndist = [float('inf')]*n\ndist[start] = 0\npending = [(0,start)]\nwhile pending:\n    d,u = heapq.heappop(pending)\n    if d != dist[u]:\n        continue\n    for v,w in adj[u]:\n        if d+w < dist[v]:\n            dist[v] = d+w\n            heapq.heappush(pending,(dist[v],v))\nreturn str(sum(1 for i,d in enumerate(dist) if i != start and d <= limit))\n")
    if is_two_sum(requirement):
        data = [([2, 7, 11, 15], 10), ([6, 6, 3], 12), ([9, 12], 5), ([], 10),
                ([4], 8), ([0, 0, 5], 5), ([8, 2, 4, 6], 11)]
        samples = []
        for prices, budget in data:
            # Oracle 枚举所有零/一/两件选择，和参考双指针算法相互独立。
            answer = max([0] + [sum(group) for size in (1, 2) for group in combinations(prices, size) if sum(group) <= budget])
            samples.append((f"{len(prices)} {budget}\n" + " ".join(map(str, prices)) + "\n", str(answer)))
        return _stdio_draft(base, "露营采购：预算内的最佳双物品组合",
            "班级准备露营，商店有 n 件价格非负的物品，每件只有一件。你最多购买两件不同位置的物品，"
            "总价不能超过预算 B；请输出能达到的最大总价。允许只买一件或不买，不买时为 0。"
            "相同价格的两件物品仍可分别购买。综合运用排序、循环、条件分支和双指针，注意不能复用同一件物品。\n\n"
            "输入格式：第一行 n B；第二行 n 个整数价格（n=0 时第二行可为空）。\n"
            "输出格式：一行一个整数，表示预算内可达到的最大总价。\n"
            "示例输入：4 10\n2 7 11 15\n示例输出：9\n解释：购买 2 元和 7 元物品。"
            "请从空白区编写完整 Python 程序，使用 input() 或 sys.stdin 读取，使用 print() 输出，不要求定义类。",
            ["0 <= n <= 10000", "0 <= B、物品价格 <= 10^9", "最多两件不同位置的物品；输入给定的价格数量恰好为 n"], samples,
            "parts = list(map(int, stdin.split()))\nn, budget = parts[:2]\nprices = sorted(parts[2:])\nanswer = max([0] + [p for p in prices if p <= budget])\nleft, right = 0, n - 1\nwhile left < right:\n    total = prices[left] + prices[right]\n    if total <= budget:\n        answer = max(answer, total)\n        left += 1\n    else:\n        right -= 1\nreturn str(answer)\n")
    if re.search(r"背包|knapsack", requirement, re.I):
        # A different optimization goal: meet a required value at minimum weight,
        # instead of maximizing value under a capacity. Keep the old wire profile
        # available so saved courses retain their original grading semantics.
        if re.search(r"最小重量|最低重量|minimum weight", base.instructions, re.I):
            return None
        data = [([(2,3),(3,4),(4,5)],7), ([(2,3)],4), ([],0), ([(1,2),(1,2)],4),
                ([(2,5),(3,6)],0), ([(3,4),(4,5),(2,3)],8), ([(2,3),(2,3)],7)]
        samples = []
        for items, required in data:
            weights = [sum(w for w, _ in group) for size in range(len(items)+1)
                       for group in combinations(items, size) if sum(v for _, v in group) >= required]
            samples.append((f"{len(items)} {required}\n" + "".join(f"{w} {v}\n" for w,v in items), str(min(weights, default=-1))))
        return _stdio_draft(base, "救援补给：达到保障指标的最轻装包方案",
            "应用场景：救援队需要携带保障价值至少达到 V 的物资，每件最多选择一次。每件物资有重量 w 和价值 v。"
            "请输出达到保障指标所需的最小总重量；无法达到时输出 -1。V=0 时可不选任何物资，输出 0。"
            "这次优化的是最小重量，而不是引导题中固定容量下的最大价值。综合处理选或不选、超额达标与不可达状态。\n\n"
            "输入格式：第一行 n V，随后 n 行，每行 w v。输出格式：一行最小总重量或 -1。\n"
            "示例输入：3 7\n2 3\n3 4\n4 5\n示例输出：5\n解释：选前两件，价值达 7、总重量最小为 5。"
            "请独立编写完整 Python 程序读取标准输入并打印结果，不提供代码骨架。",
            ["0 <= n <= 100，0 <= V <= 10000", "1 <= w <= 1000，0 <= v <= 100", "每件物资最多选择一次"], samples,
            "parts = list(map(int, stdin.split()))\nn, required = parts[:2]\ndp = [float('inf')] * (required + 1)\ndp[0] = 0\nfor i in range(n):\n    weight, value = parts[2+2*i:4+2*i]\n    previous = dp[: ]\n    for reached in range(required + 1):\n        target = min(required, reached + value)\n        dp[target] = min(dp[target], previous[reached] + weight)\nreturn str(-1 if dp[required] == float('inf') else dp[required])\n")
    if re.search(r"二叉树|binary tree|树.*遍历", requirement, re.I):
        # 层序完整槽位表示：数组 i 的左右孩子为 2i+1 / 2i+2，null 表示空节点。
        arrays = [["1","2","3","null","4"], ["7"], [], ["1","2","null","3"],
                  ["1","2","3"], ["-1","null","2"], ["5","5","5"]]
        samples = []
        for nodes in arrays:
            orders: list[list[str]] = [[], [], []]
            def visit(i: int) -> None:
                if i >= len(nodes) or nodes[i] == "null": return
                orders[0].append(nodes[i]); visit(2*i+1)
                orders[1].append(nodes[i]); visit(2*i+2); orders[2].append(nodes[i])
            visit(0)
            samples.append((str(len(nodes)) + "\n" + " ".join(nodes) + "\n", "\n".join(" ".join(row) for row in orders)))
        return _stdio_draft(base, "园区巡检：输出二叉树的三种巡检顺序",
            "园区路线按二叉树组织，节点记录区域编号。请分别输出先序、中序、后序三种巡检路线。"
            "综合处理空节点、只有单侧分支和重复编号，三种遍历的访问顺序必须正确。\n\n"
            "输入格式：第一行槽位数 n，第二行 n 个层序槽位，空位置用 null。槽位下标从 0 开始，"
            "i 的左、右孩子槽位为 2i+1、2i+2，null 的后代也为空。\n"
            "输出格式：三行，分别是先序、中序、后序编号，用单个空格分隔；空树输出三行空行。\n"
            "示例输入：5\n1 2 3 null 4\n示例输出：1 2 4 3\n2 4 1 3\n4 2 3 1\n"
            "请独立编写完整 Python 程序读取标准输入，并输出三行结果。",
            ["0 <= n <= 1000，非空编号为整数", "输入为合法完整槽位表示，空节点下不会出现非空后代"], samples,
            "parts = stdin.split()\nnodes = parts[1:]\norders = [[], [], []]\ndef visit(i):\n    if i >= len(nodes) or nodes[i] == 'null':\n        return\n    orders[0].append(nodes[i])\n    visit(2*i+1)\n    orders[1].append(nodes[i])\n    visit(2*i+2)\n    orders[2].append(nodes[i])\nvisit(0)\nreturn '\\n'.join(' '.join(row) for row in orders)\n")
    return None


def function_task_to_stdio(draft: LabDraft) -> LabDraft:
    """未知知识点仍由模型独立出题；使用明确的 JSON 文本 stdin/stdout 协议。"""
    tree = ast.parse(draft.reference_solution)
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "Solution": node.name = "_TaskSolution"
    private = ast.unparse(tree)
    source = private + "\n\nclass Solution:\n    def solve(self, stdin: str) -> str:\n        import json\n        return json.dumps(_TaskSolution().solve(**json.loads(stdin)), ensure_ascii=False)\n"
    cases = [case.model_copy(update={"inputs": {"stdin": json.dumps(case.inputs, ensure_ascii=False)},
                                   "expected": json.dumps(case.expected, ensure_ascii=False)})
             for case in draft.public_test_cases + draft.hidden_test_cases]
    instructions = re.sub(r"请[^。\n]*(?:Solution|solve)[^。\n]*[。]?", "", draft.instructions)
    instructions += "\n\n输入格式：一行 JSON 对象，字段为 " + ", ".join(draft.public_test_cases[0].inputs) + "。\n输出格式：一行 JSON 值，表示题目要求的结果。请编写完整 Python 程序，从标准输入读取并打印结果；不要求类或固定函数签名。"
    return draft.model_copy(update={"instructions": instructions, "reference_solution": source,
        "scaffold_code": "class Solution:\n    def solve(self, stdin: str) -> str:\n        # TODO\n        raise NotImplementedError\n",
        "public_test_cases": cases[:len(draft.public_test_cases)], "hidden_test_cases": cases[len(draft.public_test_cases):]})
