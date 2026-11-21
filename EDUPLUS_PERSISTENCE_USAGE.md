# EduPlus 课程保存与学生版导出

## 已交付

生成链为：浏览器 → Next.js 身份解析 → 已认证的 Python 内部接口 → LangGraph / Ollama → Next.js PostgreSQL 事务保存 → 学生公开响应。

`eduplus_courses` 保存不可变的课程快照：课程 ID、所属用户、公开数据、私有资产和创建时间。公开数据和私有数据在同一事务写入；数据库未配置、初始化失败或保存失败时，接口不返回生成成功。重新读取沿用原有课程、场景和题目 ID，不重新调用模型，不覆盖题目版本。

课程身份由项目现有 `withRequestOwner()` 解析，不接受前端提交 ownerId。匿名浏览器的身份 Cookie 在成功和失败响应中均保留。用户领取匿名课程时，EduPlus 表参加原有身份迁移事务；保存使用原有身份锁与退休身份检查。

当前 EduPlus 课程使用独立存储表和 `/eduplus` 页面，尚未映射为原生 Stage/Scene 的六阶课堂；不会把其当作已经完成原生课堂融合。

## 启动与入口

首次配置内部服务密钥（不打印值）：

```powershell
Set-Location 'D:\OPENMAIC项目\OpenMAIC\OpenMAIC-main'
node scripts/prepare-eduplus-env.mjs
node scripts/check-openmaic-db.cjs
powershell -ExecutionPolicy Bypass -File .\scripts\start-eduplus-agent.ps1
```

另一个终端运行 `pnpm dev --hostname 127.0.0.1`，打开 `http://127.0.0.1:3000/eduplus`。首页右上角提供“EduPlus 实验课”入口。

Python 启动脚本通过 Next.js 的环境加载器读取与 Next.js 相同的环境文件及优先级。`EDUPLUS_AGENT_SERVICE_TOKEN` 是服务端凭据，仅用于内部 HTTP 请求，不能添加 `NEXT_PUBLIC_` 前缀、返回浏览器或提交到 Git。未配置或凭据不匹配时，内部生成和下载接口拒绝访问。

## HTTP 接口

| 接口 | 行为 |
| --- | --- |
| `POST /api/generate` | 输入 `{ "prompt": "..." }`，生成并保存后返回 PublicCourse |
| `GET /api/eduplus/courses` | 返回当前用户最近 50 门课程，响应为 `{ "courses": [...] }` |
| `GET /api/eduplus/courses/{courseId}` | 返回当前用户的公开课程；不存在或无权访问均返回 404 |
| `GET /api/eduplus/courses/{courseId}/notebook?sceneType=guided-lab` | 下载引导实验的学生版 Notebook |
| `GET /api/eduplus/courses/{courseId}/notebook?sceneType=oj-lab` | 下载独立练习的学生版 Notebook |

读取与下载 SQL 只选择 `public_data`，不选择 `private_data`。私有传输 Schema 为 `contracts/eduplus-internal.schema.json`，类型位于 `lib/server/eduplus-internal.generated.ts`；前端只使用原公开类型。

Python `/v1/generate` 保留为本机独立公开投影调试接口，它不负责保存；产品前端应使用 Next.js `/api/generate`。`/internal/v1/generate` 返回完整资产，只接受内部服务凭据。内部接口不出现在公开 Swagger 中；隐藏文档本身不作为认证措施。

## 学生 Notebook

实验 Notebook 包含三个单元格：教学说明、学生模板、公开 pytest 测试。测试使用当前 Notebook 内核中的 `Solution`，不依赖 Bash。引导页保留 TODO，独立练习保留空实现；课程 ID、场景 ID、题目 ID 和版本记录在 Notebook 元数据中。

理论课导出一个教学说明 Markdown 单元格。导出不执行模型代码。文件不含参考答案或隐藏测试，公开用例不伪装成保密评测；通过这些用例不能当作权威判题成绩。

页面现已提供本地 Monaco 编辑器、按用户和页面隔离的服务器草稿、Pyodide Worker 公开测试，以及已保存作答导出。详见 `EDUPLUS_BROWSER_PRACTICE_USAGE.md`。原 `export_to_ipynb()` 保留用于可信的后端/教师操作，完整测试资产不得通过学生接口直接导出；教师下载接口需有明确角色权限后再开放。

## 队友代码接入范围

参考队友 `OpenMAIC-Team` 的导出按钮交互，将新入口适配为读取真实课程资产，而不是调用按关键词生成示例代码的函数。学生导出按钮位于 `components/eduplus/notebook-export.tsx`。未整体合并其基于旧上游版本的分支，原生课堂导出菜单的适配随 Stage/Scene 融合推进。

## 验证

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests/test_agent_api.py tests/test_student_notebook.py tests/test_lab_contracts.py tests/test_agent_workflow.py tests/test_ollama_provider.py
pnpm exec vitest run tests/server/eduplus-agent-api.test.ts tests/server/eduplus-course-routes.test.ts tests/persistence/eduplus-courses.test.ts tests/persistence/schema-boot-check.test.ts
.\.venv\Scripts\python.exe scripts/smoke_eduplus_api.py
```

实测脚本检查实验课/理论课真实生成、数据库重新读取、课程列表、引导页/OJ 页 Notebook 下载和 nbformat 校验。结果写入 Git 忽略的 `logs/eduplus-api-smoke.json`。

下一阶段：原生课堂场景适配、随堂检测和复盘。用户已选择正式判题暂不启用；隔离判题及执行质量关卡待容器环境就绪后接入。

## 页面构建问题修复

联调发现，旧模型设置导入只需要服务商目录，却引入了完整媒体执行模块和 SDK；旧浏览器存储通过总入口又引入了 PostgreSQL 后端，导致页面构建包含 `fs`/`node:crypto` 等 Node 模块。

已将 LLM、图像、视频的静态目录拆成纯元数据模块，保留原执行模块的兼容导出和模型元数据初始化；新增 `@openmaic/storage/browser` 专用入口，并迁移相应浏览器调用方。无需切换构建器，默认 Turbopack 页面已恢复 200。浏览器中已验证真实生成、双页切换、保存课程列表和学生版下载。

存储包增加了新的浏览器子路径。源码修改后使用 `pnpm --filter @openmaic/storage build` 更新 dist；当前工作区已编译完成。独立发布存储包前，还需按上游版本发布流程处理版本号和发布检查。
