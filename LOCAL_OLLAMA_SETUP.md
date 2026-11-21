# 本地 Ollama 开发环境

实际工程目录：`D:\OPENMAIC项目\OpenMAIC\OpenMAIC-main`。
这是 ZIP 解压的 Next.js/TypeScript 项目，不是 Python/FastAPI 项目；当前目录没有 `.git`。
不需要重新 clone，也不要在已有源码目录执行 `git clone ... .`。

## Python 通信层

已建立 `.venv`，依赖见 `requirements-ollama.txt`。
使用 PowerShell：

```powershell
Set-Location 'D:\OPENMAIC项目\OpenMAIC\OpenMAIC-main'
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
$env:PYTHONIOENCODING = 'utf-8'
python ollama_provider.py
python -m unittest discover -s tests -p test_ollama_provider.py
```

也可以不激活，直接运行 `.\.venv\Scripts\python.exe ollama_provider.py`。
如需重建依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-ollama.txt
```

`generate()` 默认发送 `format="json"`，返回经过 JSON 检查的字符串。
`generate_json(prompt, YourPydanticModel)` 发送 JSON Schema 并返回严格验证的 Pydantic 对象。
`generate_stream()` 返回异步文本片段；JSON 流只有正常结束后才完成验证。
消费者应暂存 JSON 片段，迭代失败时丢弃，避免将未完整验证的数据交给 Agent。
连接失败、超时、临时 HTTP 错误会随机指数退避，默认最多 3 次尝试。
404 和无效输出不重试。流式输出交付首个片段后不再自动重试。
底层异常保存在 `__cause__` 中，模块日志不打印 prompt 或模型内容。
`timeout` 是网络读写等待时间；若需要总调用时限，在调用方使用 `asyncio.timeout()`。
FastAPI 使用时，在 lifespan 中建立实例并在退出时 `aclose()`，路由内 `await` 调用。

## 网页项目的原生接入

`openmaic.yml` 使用现有 `ollama` provider，连接 `http://localhost:11434/v1`；
模型为本机已安装的 `qwen2.5-coder:7b`，无需 OpenAI 密钥。
全部模型槽锁定，禁止用户添加云端服务。语音、图片、视频、联网检索、远程文档解析槽禁用。
Ollama `/api/show` 实测该已安装模型声明 `tools` 能力，Agent 使用 `openai-completions`。
这只验证了模型能力声明；尚不代表整套 Agent 工具流程已通过集成测试。
OpenAI 兼容接口是 Ollama 的本地接口协议，保留对应 SDK 不等于调用云端 OpenAI。
Python 模块是独立扩展，并未被 Next.js 自动调用；主项目通过已有 TypeScript provider 调用 Ollama。
配置禁用了云端模型服务，但不保证整个产品所有网络请求离线（例如外部内容或字体）。

本版本启动需要 Node.js >=22.19、项目指定的 pnpm 10.28.0 和 PostgreSQL 16。
`.env.local` 已写入仓库文档中的本地开发数据库连接串。
安装 Docker Desktop 并启动后，可运行：

```powershell
Set-Location 'D:\OPENMAIC项目\OpenMAIC\OpenMAIC-main'
npm --registry=https://registry.npmjs.org exec --yes --package=pnpm@10.28.0 -- pnpm install --no-frozen-lockfile --store-dir .pnpm-store --registry https://registry.npmjs.org
pnpm db:up
pnpm dev
```

如果已有 PostgreSQL，改 `.env.local` 的 `DATABASE_URL` 指向自己的数据库，再运行 `pnpm dev`。
原 ZIP 的 `pnpm-lock.yaml` 与子包 `packages/@openmaic/dsl/package.json` 不一致；
首次安装需要用项目指定版本更新锁文件，不能直接使用 `--frozen-lockfile`。
本次网页依赖安装因持续缓慢已停止，保留 `.pnpm-store` 和部分 `node_modules` 下载缓存；
尚未完成 `pnpm install`、项目构建或 TypeScript 配置解析测试。原 ZIP 的锁文件保留。
Python 虚拟环境不依赖这些 Node 依赖，可以独立运行。
数据库当前尚未配置或验证；不要将“Python 模型调用成功”视为网页已启动。
如果 Ollama 未运行，在另一窗口运行 `ollama serve`；已有服务运行时无需重复启动。
模型缺失时运行 `ollama pull qwen2.5-coder:7b`。

## 已完成的验证

- Python 依赖安装成功，`pip check` 无依赖冲突；精确版本见 `requirements-ollama.lock.txt`。
- 14 项离线测试通过（连接恢复/耗尽、超时、404、503、无效 JSON/Schema、日期 Schema、流式中断和长度截断）。
- 本机原生 `/api/generate` 的 Schema 非流式、Schema 流式、文本流式调用成功。
- 本机 `/v1/chat/completions` 的 JSON 模式调用成功。
- 本机 5432 端口未运行数据库，未检测到 PostgreSQL 服务、psql 或 Docker 命令；网页尚未启动。
