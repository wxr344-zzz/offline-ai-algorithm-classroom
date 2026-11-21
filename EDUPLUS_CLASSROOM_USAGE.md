# EduPlus 原生课堂交付说明

更新：2026-10-15。主入口为原生首页和课堂播放器，当前范围为本机单用户；正式判题按用户要求暂不启用。

## 普通课程与项目式学习的边界

“讲解两数之和算法”“Python 编程练习”等普通需求走课堂内流程：概念讲解 → 模拟器/游戏 → Guided Lab → OJ Lab → 随堂检测 → 复盘导出。只有用户明确要求项目式学习、PBL 或完整项目开发时，才允许生成 PBL 场景；“实践案例”不等于项目式学习。大纲提示与服务端路由同时约束这一边界：普通请求中误生成的 PBL 会移除其项目配置，依据原始需求重新生成当前考点的实验，避免进入无关项目工作台。显式编程练习若未生成有效实验资产，会报告失败，不会静默改成理论课或 PBL。

明确“不需要实验、只讲理论”的请求不强制 Lab。已经保存的 PBL 课程不会因代码热更新自动改写；请从首页重新生成课程以使用新路由。旧课程和已保存作答保持原状。

## 2026-10-15 质量修复

中文设置现在同时控制课程生成语言，标题、角色介绍、对白、题面和测验使用同一语言；原始教学需求传给每一页。引导题运行前展示四项公开 Python 断言，独立题使用不同题目规格及不含类/函数骨架的编辑区，入口规范只以文字约定。

两数之和使用维护的原生 PPT 布局、逐步哈希查找模拟器和下标配对游戏；独立挑战改为统计目标和下标对数量，重复值的不同下标分别计数。公开测试与隐藏评测分别管理。用户故障课程 `stage-0w16rOjxhszq` 已原址修复，原浏览器刷新即可查看；旧课程完整内容保存在 `logs/stage-0w16rOjxhszq-before-quality-repair.json`，旧实验资产与草稿没有删除。不同题目的旧作答不会被当作新题答案或成绩。

## 启动与使用

保持 PostgreSQL、Ollama 运行，模型为 `qwen2.5-coder:7b`。在两个 PowerShell 窗口分别执行：

```powershell
Set-Location 'D:\OPENMAIC项目\OpenMAIC\OpenMAIC-main'
node scripts/run-eduplus-agent.mjs
```

```powershell
Set-Location 'D:\OPENMAIC项目\OpenMAIC\OpenMAIC-main'
pnpm dev --hostname 127.0.0.1
```

打开 `http://127.0.0.1:3000/`，填写 Python 编程课需求，直接使用原生“进入课堂”流程。Lab 会嵌在课程讲解、模拟器与游戏之后，不需要另建实验课。生成与教学补充均使用真实 Ollama 调用；繁忙、取消和失败均明确显示。`/eduplus` 现在是开发者实验资产接口诊断页，首页不提供该入口。

六阶表示教学职责，不限定六张页面。课程可有多张讲解、模拟器与游戏，也保留原有测验。理论课不强制编程。原生播放器另外包含结束页；本轮首页样例为 7 个内容页加结束页（8 页），用户升级课程为 8 个内容页加结束页（9 页）。

保留上游原生 JavaScript/Canvas 模拟器和游戏生成及隔离 iframe 渲染，不用数字示例柱状图代替这些环节。模型遗漏互动页时，编程课大纲补入原生 simulation/game 页面；模拟器与游戏排在 Lab 前。场景类型别名及缺失 widgetOutline 被规范化，避免互动页直接失败或降为讲解。原生教师对白、多智能体入口和随堂测验保留。自由问答使用项目原生模型配置，当前配置为本地 Ollama。

旧 Python HTML 编辑器不再直接加载 CodeMirror/Pyodide。尚未升级的旧课会显示“修复并嵌入当前课程”，经所有者与修订号检查后升级；保留原讲解、游戏、模拟器、测验和课程地址。截图中的 `stage-Vm7Z_fxadAmw` 已备份并完成原址升级，原浏览器刷新即可读取。

Lab 的“自定义输入调试”接受按函数参数名提供的 JSON，校验参数类型和安全整数范围，沿用同一 Worker 隔离、超时和取消规则。显示实际返回值或异常；不比较预期答案，不上传为公开测试或成绩。公开测试和自定义调试互相独立。

引导页和独立练习使用同一公开题目版本，但分别保存作答。切换原生场景时，未保存编辑内容保留在当前页面会话内存；刷新前仍应保存草稿。修订冲突不会覆盖其他页面已保存的作答。

## 复盘与导出

公开测试运行结果可保存为浏览器自报的学习记录，不计正式成绩。复盘展示最近 100 次记录、各页已保存草稿修订号、实际提交的概念测验及错题。服务端重新计算概念测验分数；题目被原生编辑器修改或课堂删除后，不按旧快照自动重新评分。

复盘 Markdown 可下载目标、知识点、练习记录、草稿信息及最近 200 条已保存可见对白。对白只包含学生和 Agent 的可见文本，不包含系统提示、思考过程或工具调用；没有对白时不会编造记录。

学生 Notebook 可下载模板或已保存作答，始终只含公开测试。教师 Notebook 构建器和受保护接口已实现，包含参考实现及完整评测材料；默认匿名身份返回 403，无公开下载入口。启用时必须由项目认证适配器提供 `assurance=verified`，并授予 `eduplus:teacher` 或 `admin` 角色，同时通过课程所有权检查。客户端提交角色、请求参数或修改页面不能获得教师权限。

## 接口与存储

本机单用户演示已启用框架内置配置 `OWNER_SINGLE_USER=true`、`OWNER_SINGLE_USER_ID=local`（保存在 `.env.local`）。浏览器和不同本机域名统一使用演示所有者，不再依赖匿名 Cookie 碰巧一致。开发命令绑定 `127.0.0.1`。多用户部署仍须另行配置身份认证与授权。

2026-10-15 针对 `stage-taPz9RxSms4W` 将课堂及当前绑定实验迁入同一演示所有者，场景、题目和草稿 ID 保留。备份位于 `logs/stage-taPz9RxSms4W-before-local-demo.json`。没有批量改写其他课堂。移除已有可运行自主编程后多余的同名静态“综合练习”页，之后直接进入总结、检测和复盘。

| 接口 | 行为 |
| --- | --- |
| `POST /api/eduplus/courses/{courseId}/classroom` | 原子创建原生 Stage/Scene 和映射；已有课堂重复调用返回同一地址，不重新调用模型；已删除课堂返回 409 |
| `GET /api/eduplus/courses/{courseId}/classroom` | 返回所有者的公开课程、讲解和测验数据 |
| `POST /api/eduplus/courses/{courseId}/practice` | 保存有版本的浏览器练习事件；事件 UUID 幂等，验证场景、用例数量和草稿修订 |
| `GET /api/eduplus/courses/{courseId}/review` | 返回真实学习事实；`?format=markdown` 下载复盘 |
| `GET /api/eduplus/courses/{courseId}/teacher-notebook` | 经认证教师且拥有课程时才可导出私有材料 |

迁移 v3 新增 `eduplus_courses.classroom_data` 与 `eduplus_practice_events`，未改写已应用迁移。课堂映射和原生文档在同一数据库事务提交，避免创建一半；跨站写请求和其他课程所有者访问均拒绝。原生场景使用固定 React 实验组件；公开 HTML 为兼容回退文本，不承载模型生成的运行器。`eduplus` 是应用层互动内容扩展，第三方严格 DSL 导入器需支持该扩展或使用回退 HTML。

## 已验证与保留范围

真实 HTTP 已验证实验与理论课程生成、课堂创建、重复创建复用、空复盘、Markdown 下载、标准 Notebook、教师默认拒绝和不同所有者拒绝。真实浏览器已验证六阶切换、草稿恢复、切场景保留编辑、公开测试 2/2、原生测验 3/3、复盘显示实际结果；截图和 HTTP 证据位于 `logs`。

```powershell
.\.venv\Scripts\python.exe scripts/smoke_eduplus_classroom.py
pnpm exec vitest run tests/eduplus tests/server/eduplus-classroom-routes.test.ts tests/server/eduplus-review.test.ts tests/server/eduplus-teacher-export.test.ts
```

当前质量状态仍为 `static-validated`。LLM 测验通过结构与选项校验，不等于题意已通过教学审查；使用前应审核歧义题。多学生共享课程需要明确教师身份、课程访问授权及每个学生独立草稿模型，目前未开放。执行质量关卡、隐藏用例权威判题、容器资源配额、异步任务队列与容量压测仍属于后续范围。
