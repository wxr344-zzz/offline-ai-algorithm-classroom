# EduPlus 真实 Agent API

已接通 Next.js → 已认证的 FastAPI 内部接口 → LangGraph → 本机 Ollama → PostgreSQL。原 Mock 已移除。主入口现为首页原生 `generation-runs`，自动将双页 Lab 嵌入讲解、模拟器、游戏与测验流程；`POST /api/generate` 和 `/eduplus` 保留为实验资产诊断接口与页面。项目实际版本为 Next.js 16.3.3。

## 启动

在项目根目录安装依赖：

```powershell
Set-Location 'D:\OPENMAIC项目\OpenMAIC\OpenMAIC-main'
.\.venv\Scripts\python.exe -m pip install -r requirements-api.txt
node scripts/prepare-eduplus-env.mjs
```

第一个 PowerShell 窗口启动 Python 服务：

```powershell
Set-Location 'D:\OPENMAIC项目\OpenMAIC\OpenMAIC-main'
powershell -ExecutionPolicy Bypass -File .\scripts\start-eduplus-agent.ps1
```

另一个窗口启动 Next.js：

```powershell
Set-Location 'D:\OPENMAIC项目\OpenMAIC\OpenMAIC-main'
pnpm dev --hostname 127.0.0.1
```

两边均应保持运行。不要在端口已被占用时重复启动。Ollama 必须已运行，当前工作流默认模型为 `qwen2.5-coder:7b`。

## 调用与数据

```powershell
$body = @{ prompt = 'Python 列表求和编程实验，空列表返回 0' } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/generate' -Method Post -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 660
```

成功响应为 `PublicCourse`，详见 [LAB_CONTRACT_V1.md](LAB_CONTRACT_V1.md)。实验课返回 `scenes` 中的引导实验与 OJ 练习；理论课返回空场景列表。旧的单页面四字段响应已替换，前端应读取 `response.scenes`，而非 `response.interactiveCode`。

参考实现、隐藏用例和 pytest 源码不会进入公开响应。Next.js 会再次使用 Python 生成的 Schema 校验响应，并拒绝额外字段或双页身份冲突。

错误统一返回：

```json
{"error":{"code":"OLLAMA_UNAVAILABLE","message":"无法连接本地 Ollama，请确认服务已启动。","requestId":"请求追踪 ID"}}
```

| HTTP 状态 | 含义 |
| --- | --- |
| 400 | JSON 无效、prompt 为空/类型错误/超过 12000 字符，或出现额外字段 |
| 429 | 模型繁忙；`Retry-After: 5` 提示稍后重试 |
| 499 | 客户端取消请求 |
| 500 | 服务配置或内部执行错误 |
| 502 | 模型生成校验失败、上游响应契约无效 |
| 503 | Python/Ollama 服务不可连接、模型未拉取 |
| 504 | 模型或整体生成请求超时 |

Next.js 与 Python 分别生成 `X-Request-ID`，Next.js 服务端错误日志记录二者关联。日志不打印完整 prompt、模型原始输出或上游内部错误信息。Python `/health` 仅检查服务进程存活，不代表模型已就绪。

## 配置与执行边界

| 变量 | 所属服务 | 默认值 |
| --- | --- | --- |
| `EDUPLUS_AGENT_BASE_URL` | Next.js 服务端 | `http://127.0.0.1:8001` |
| `EDUPLUS_AGENT_HTTP_TIMEOUT_MS` | Next.js 服务端 | `630000` |
| `EDUPLUS_AGENT_TIMEOUT_SECONDS` | Python | `600` |
| `EDUPLUS_AGENT_MAX_CONCURRENCY` | Python | `1` |

Next.js 配置可放 `.env.local`；Python 启动脚本现在通过 Next.js 环境加载器读取相同配置。直接运行 uvicorn 时仍需自行设置环境。配置只在服务端使用，不带 `NEXT_PUBLIC_` 前缀。更改配置后重启对应服务。自定义 HTTP 超时应比 Python 总超时略大。

Python 超时/客户端断开时取消工作流任务并关闭 provider 连接、释放并发名额；这不保证 Ollama 引擎立即停止底层计算。Next.js 请求失败不自动重试，避免重复消耗本地模型。

保持 Python 服务监听回环地址，当前不开放浏览器直连 CORS，也没有单独的 Python 公网认证。并发限制是单进程内的，启动脚本固定 `--workers 1`。`maxDuration=660` 是供部署平台读取的配置，平台自身限制仍可能更短；耗时生成优先在本地/自托管环境运行。

生成不执行模型代码；资源限制仍为契约声明，正式隔离判题尚未实现。课程与私有题目资产已一起持久化，支持公开课程重新读取与学生 Notebook 下载，详见 [EDUPLUS_PERSISTENCE_USAGE.md](EDUPLUS_PERSISTENCE_USAGE.md)。

原版应用的 PostgreSQL 启动检查与本 API 生成路径独立。2026-10-13 已修复本机应用账号认证，并验证 `openmaic` 用户能连接 `openmaic` 数据库，且具有 public schema 的 CREATE 权限。此验证不表示 EduPlus 课程保存已实现。

可重复运行以下只读检查（不会打印密码）：

```powershell
node scripts/check-openmaic-db.cjs
```

管理员 `postgres` 成功登录默认数据库 `postgres`，不等于应用账号 `openmaic` 已可连接。若以后再次出现 28P01，应检查项目实际使用的 DATABASE_URL，而不是仅验证管理员登录。`scripts/prepare-openmaic-db.cjs` 可按项目配置生成本机修复 SQL，输出在 Git 忽略的 logs 目录；修复后删除生成的 SQL 文件。

## 验证

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-api-test.txt
.\.venv\Scripts\python.exe -m pytest -q tests/test_agent_api.py tests/test_lab_contracts.py tests/test_agent_workflow.py tests/test_ollama_provider.py
pnpm exec vitest run tests/server/eduplus-agent-api.test.ts
.\.venv\Scripts\python.exe scripts/smoke_eduplus_api.py
```

最后一个命令会真实调用模型，分别检查实验课与理论课，并在 `logs/eduplus-api-smoke.json` 保存状态、ID 和耗时，不保存参考答案或用户代码。若配置了应用访问码，手动调用 Next.js 时需要已有的登录访问 Cookie。

课程持久化及学生公开资产导出已完成。下一步推进固定 Lab 编辑器、草稿、Worker 运行器及原生课堂场景融合，随后接入后台隔离判题。

实现参考：[FastAPI 测试](https://fastapi.tiangolo.com/tutorial/testing/)、项目随包的 Next.js Route Handlers 与 maxDuration 文档。
