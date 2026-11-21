# EduPlus 实验数据契约 v1

已完成设计方案中的第一项接入准备：统一 Python 模型、公开 JSON Schema 和 TypeScript 类型，并让真实 Agent 输出同一道题的两个实验页面。队友仓库仍独立保存在 `D:\OPENMAIC项目\OpenMAIC-Team`，尚未合并。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `lab_contracts.py` | 严格校验内部数据与学生公开数据；执行白名单投影 |
| `lab_assembly.py` | 分配课程、题目、页面 ID，解析函数签名，组装双页与 pytest |
| `agent_workflow.py` | Teacher → Lab/TA → Eval；Lab 使用真实 Ollama 生成 LabDraft |
| `contracts/eduplus-request.schema.json` | 请求 JSON Schema |
| `contracts/eduplus-public.schema.json` | 学生响应 JSON Schema |
| `lib/types/eduplus.generated.ts` | 从 Python 模型生成的 TypeScript 类型 |
| `scripts/export_lab_contracts.py` | 导出契约，或用 `--check` 检查产物是否同步 |

## 请求与公开响应

请求为 `{ "prompt": "Python 列表求和编程实验" }`，必须是非空字符串。

公开响应是 `PublicCourse`：`schemaVersion`、`courseId`、`topic`、`requiresLab`、`lessonPlan`、`commonMistakes`、`generationStatus`、`qualityStatus`、`scenes`。前端字段统一为 camelCase；内部工作流字段保留 snake_case。

需要实验时，`scenes` 按顺序包含：

1. `sceneType: "guided-lab"`，`template: "guided-lab-v1"`：有 TODO 的模板、分步教学提示。
2. `sceneType: "oj-lab"`，`template: "oj-lab-v1"`：同签名的空实现，不附分步提示。

2026-10-15 按用户最新要求调整：两页共享 `courseId`，新生成课程的 `sceneId` 和 `problem.problemId` 各自独立，题目版本分别管理。Guided 提供代码脚手架与至少四项可见公开断言；OJ 是同一考点下任务目标不同的独立迁移题，编辑区只提供作答提示，不预填类、函数或方法体。入口规范以题面文字说明。每页的 `scene.problem` 分别声明 `entryPoint`、`publicTestCases`、`executionPolicy`、难度与约束。旧共享题目课程仍可读取，不静默改写其草稿。理论课的 `scenes` 为空。

独立题参考实现、隐藏用例和完整 pytest 资产保存在私有 `oj_assessment` 中；公开投影不包含这些字段。两数之和使用“露营采购：预算内的最佳双物品组合”；二叉树使用园区巡检三种遍历；0/1 背包使用救援物资装包。系统按知识点选择维护的情境题，其公开期望值由可信算法计算；其他考点调用本地模型独立出题，再适配标准输入输出。

Guided 和旧课程采用 `Solution.solve` 入口，支持 `int`、`str`、`bool`、`list[int]`、`list[str]`、`list[bool]`。新自主题声明 `problem.executionMode="stdio"`，学生从空白编写完整程序，用 `input()`/`sys.stdin` 读输入，`print()` 输出，无类或函数骨架。公开用例使用 `inputs.stdin` 字符串和 `expected` 字符串；私有评测适配入口仍是 `Solution.solve(stdin: str) -> str`，该适配代码不下发学生。

可选 `standardIoProfile` 为 `budget-pair`、`tree-traversals`、`knapsack`。这些维护题在浏览器校验输入约束，并核对任意合法自定义输入的输出，错误答案及运行异常显示在输出框。未提供可信题型的模型题仅核对已知公开样例，其他自定义输入显示实际输出，不宣称答案正确。旧数据省略两个新字段时按函数模式兼容读取。

## 公私资产边界

服务端 `FinalOutput.problem` 保存双页、隐藏用例、参考答案和 pytest 源码；兼容字段 `FinalOutput.lab` 保留旧 Notebook 导出所需资产。两者都不可直接作为学生 API 响应。

```python
from agent_workflow import app, create_initial_state
from lab_contracts import to_public_course

async def generate_public_course(prompt: str) -> dict:
    result = await app.ainvoke(create_initial_state(prompt))
    return to_public_course(result["final_output"])
```

`to_public_course()` 只投影公开字段，禁止将内部字典直接展开到响应中。`build_student_notebook()` 与学生下载接口现已加入，只读取公开契约和公开用例。旧 `export_to_ipynb()` 会把完整 pytest 放进 Notebook，仅用于允许公开这些用例的练习/教师操作；单元格隐藏不是保密机制。

## 校验与当前边界

`generationStatus: "generated"` 表示生成链完成，`qualityStatus: "static-validated"` 仅表示结构、语法、签名和用例类型已校验。它不证明参考答案正确，也不证明隐藏用例足够充分。

`executionPolicy` 声明预期超时、输出上限和禁网策略；当前尚无隔离判题服务执行这些限制。生成阶段不执行模型输出的 Python 代码。后台判题、答案正确性验证和题目版本升级仍待实现；生成课程的不可变快照已接入 PostgreSQL。

ID 在一次组装中生成，重复投影和数据库读取不会改变。重新调用生成会产生新课程 ID；数据库保存与读取见 [EDUPLUS_PERSISTENCE_USAGE.md](EDUPLUS_PERSISTENCE_USAGE.md)。

## 本地检查

```powershell
Set-Location 'D:\OPENMAIC项目\OpenMAIC\OpenMAIC-main'
$env:PYTHONIOENCODING = 'utf-8'
.\.venv\Scripts\python.exe scripts/export_lab_contracts.py
.\.venv\Scripts\python.exe scripts/export_lab_contracts.py --check
.\.venv\Scripts\python.exe -m pytest -q tests/test_lab_contracts.py tests/test_agent_workflow.py tests/test_ollama_provider.py
.\.venv\Scripts\python.exe agent_workflow.py
```

真实模型验证包含列表求和编程课与无需实验的网络分层理论课。测试覆盖双页身份、公开/隐藏资产分离、契约 Schema、一致性和非法用例拒绝。

## 下一步

工作流现已封装成 Python FastAPI 服务，Next.js `app/api/generate/route.ts` 已替换 Mock 并调用真实工作流，按上述公开契约返回响应，处理超时与生成失败。启动与验证见 [EDUPLUS_API_USAGE.md](EDUPLUS_API_USAGE.md)。前端双页模板尚未接入。

随后适配队友导出按钮，使其消费真实课程资产，增加学生/教师导出区分，替换按关键词生成硬编码实验的路径，再逐步接入前端运行器与后台隔离判题。
