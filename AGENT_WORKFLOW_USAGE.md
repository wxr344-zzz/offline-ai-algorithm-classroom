# 真实 Ollama 多智能体工作流

TeacherAgent_Node 和 LabAgent_Node 已改为 async 节点，TA、Eval 保持同步。
图拓扑保留 Teacher → Lab/TA → Eval → END。

```powershell
Set-Location 'D:\OPENMAIC项目\OpenMAIC\OpenMAIC-main'
$env:PYTHONIOENCODING = 'utf-8'
.\.venv\Scripts\python.exe agent_workflow.py
.\.venv\Scripts\python.exe -m pytest -q tests/test_agent_workflow.py tests/test_ollama_provider.py
```

`agent_workflow.py` 示例会真实调用本机 Ollama；离线测试通过 monkeypatch 替换通信方法。
异步调用入口：

```python
from agent_workflow import app, create_initial_state, WorkflowGenerationError
from lab_contracts import to_public_course

async def generate_lesson(question: str) -> dict:
    result = await app.ainvoke(create_initial_state(question))
    return to_public_course(result["final_output"])
```

原先的 `app.invoke()` / `app.stream()` 不适用于包含这些 async 节点的图。
使用 `app.ainvoke()` / `app.astream()`；命令行用 `asyncio.run()` 启动事件循环。

现有 OllamaProvider.generate 没有 format 参数；传 `json_mode=True` 会在 HTTP 请求中
发送 `format="json"`。本工作流还通过 Pydantic 严格验证字段、嵌套 LessonPlan 和布尔类型。
每个节点使用 `async with OllamaProvider(...)`，退出时关闭连接。
HTTP 连接/超时重试由 provider 负责；Lab 的输出校验失败额外反馈修复一次。
最终失败会记录不含完整模型输出的日志，并抛出 WorkflowGenerationError；原因通过 __cause__ 保留。

Lab 生成 `LabDraft`：学生模板、参考实现、教学步骤、至少一个公开用例和三个隐藏用例。
后端从结构化用例组装 pytest，固定评测命令，并检查语法、占位符、签名和用例类型。
这些是静态检查，不证明参考答案正确、覆盖充分或源码可安全执行。
节点不执行生成代码；实际判题应在另行实现的隔离环境中运行，并限制资源及执行时间。

final_output 是教师/后端完整数据；学生接口必须使用 `to_public_course()` 白名单投影。
它返回 v1 双页契约，不包含隐藏用例、pytest 源码或参考实现。
详细字段、生成命令与接入边界见 [LAB_CONTRACT_V1.md](LAB_CONTRACT_V1.md)。
Python 服务 `agent_api.py` 已封装此工作流，`app/api/generate/route.ts` 已连接真实服务。
启动与错误契约见 [EDUPLUS_API_USAGE.md](EDUPLUS_API_USAGE.md)。最小双页展示、课程读取和学生下载已接入；编辑器、草稿与 Worker 运行尚待实现。
