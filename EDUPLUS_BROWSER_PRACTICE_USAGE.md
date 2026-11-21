# EduPlus 浏览器编程练习：使用与验收

更新日期：2026-10-20。当前默认启用 Strict Judge Mode，详见 `STRICT_JUDGE_MODE_20261020.md`。下文 2026-10-14 的验收经过保留为历史记录；其中“不评分/只回显/判题暂缓”的说明已被严格测试集断言取代。当前仍使用本机浏览器隔离沙箱，未增加服务端隐藏用例容器。

## 已交付的操作流程

打开原生首页 `http://127.0.0.1:3000/` 创建 Python 编程课程，在课堂的讲解、模拟器和游戏之后进入 Guided Lab / OJ Lab。编辑代码后运行公开测试并保存草稿；重新打开恢复该页作答。自定义输入在独立调试面板填写，只显示实际返回值，不记测试成绩。`/eduplus` 仅是开发者资产接口诊断页。

- Monaco 使用本地资源；加载失败或操作需要时，可切换到文本编辑器。
- 引导页有分步任务；OJ 页保持独立空实现。两个页面共享题目版本，但草稿分别保存。
- 初始化与执行分开计时：初始化上限 90 秒，执行按照题目契约限制（当前为 3 秒）。停止、超时、切换页面或卸载都会销毁运行环境。迟到的旧事件不会更新新运行。
- 运行期间编辑器只读，防止将旧代码的结果误认为新代码的结果。修改代码、恢复模板或重新读取草稿会清除旧结果。
- “清空运行结果”只清除反馈；“恢复模板”修改编辑区，保留服务器草稿，直到用户再次主动保存。
- 未保存修改在刷新、离开实验页和切换课程时给出提醒。草稿保存冲突不会覆盖编辑区，可先复制备份后重新读取。
- “下载学生版 Notebook”包含原始模板；“下载已保存作答”包含服务器已保存的作答与公开测试，记录草稿修订号。未保存的编辑内容不会被误标记为已导出。

## 本地运行资源

```powershell
Set-Location 'D:\OPENMAIC项目\OpenMAIC\OpenMAIC-main'
node scripts/prepare-eduplus-assets.mjs
pnpm dev --hostname 127.0.0.1
```

`pnpm dev` 和 `pnpm build` 会自动准备资源。首次需要从 npm 官方 registry 下载固定版本的 Monaco 0.55.1 和 Pyodide 0.29.3，校验固定 SHA-512 完整性后复制到 `public/vendor/eduplus`。这不更改项目已有锁文件，也不在浏览器中访问 CDN。资源已准备好时无需再次联网。

资源目录不提交 Git；迁移机器或构建部署时运行准备脚本。Pyodide 使用该固定版本支持的 classic Worker 加载方式；升级版本时需重新检查 Worker API，不直接套用当前 stable 文档的模块加载方式。

## 运行边界

固定的开发者运行脚本位于 `public/eduplus-runtime/worker.js`，不让模型生成运行基础设施。Worker 位于无 `allow-same-origin` 权限的隐藏 sandbox iframe 内，通过私有 MessageChannel 与 React 通信，不直接访问页面 DOM。iframe 使用 nonce CSP，只允许加载本地运行资源，阻止访问应用 API 和外部网站；资源路径仅对公开资源开放无凭据 CORS。

每次运行创建新的 Worker 和 Python 命名空间，执行当前公开用例并限制标准输出与结果展示长度。运行结果不上传为成绩，也不读取参考答案或隐藏测试。错误由组件自行捕获，Lab Error Boundary 为渲染故障提供局部重试，保留其他课程内容和下载入口。

浏览器资源限制是尽力保护，不能提供容器级内存配额或权威判题保证；浏览器运行不证明模型生成的参考答案正确。当前课程质量标记仍为 `static-validated`。正式隔离执行质量关卡、隐藏用例判题和成绩存储均未启用。

浏览器的整数展示采用 JavaScript 安全整数范围；超出范围的返回结果会被拒绝，避免将精度损失后的值显示为正确结果。当前入口支持内置 Python 与标准库，不自动安装第三方包。

## 草稿接口与持久化

`eduplus_drafts` 通过迁移 v2 新增，原有 v1 课程迁移未改写。主键为 `(course_id, scene_id, problem_version)`，含代码、修订号和更新时间；权限通过所属课程的 owner JOIN 检查，匿名课程领取后草稿访问随课程迁移。

| 接口 | 行为 |
| --- | --- |
| `GET /api/eduplus/courses/{courseId}/drafts/{sceneId}` | 返回 `sceneId`, `problemVersion`, `code`, `revision`, `updatedAt`；首次返回原始模板与修订 0 |
| `PUT /api/eduplus/courses/{courseId}/drafts/{sceneId}` | 输入 `{ "problemVersion": 1, "code": "...", "revision": 0 }`；成功增加修订号 |
| `GET /api/eduplus/courses/{courseId}/notebook?sceneType=guided-lab&source=draft` | 导出引导页已保存作答；OJ 页使用 `sceneType=oj-lab` |

写入在事务中先执行身份写锁和退休身份检查，然后验证课程、页面与版本。代码上限为 UTF-8 100 KB，JSON 请求体有实际流读取上限。修订号比较失败返回 409；不同用户或不存在的页面均返回 404；不接受客户端 ownerId。浏览器跨站写请求被拒绝。

## 验收与复现

```powershell
pnpm exec vitest run tests/eduplus/practice-runner.test.ts tests/persistence/eduplus-drafts.test.ts tests/server/eduplus-draft-routes.test.ts tests/server/eduplus-course-routes.test.ts tests/persistence/owner-claims.test.ts
pnpm exec tsc --noEmit --incremental false
.\.venv\Scripts\python.exe scripts/smoke_eduplus_practice.py
```

真实 HTTP 验证已通过：生成、保存/重新读取、旧修订号拒绝、双页草稿独立、其他用户读写拒绝、学生草稿 Notebook 的 nbformat 校验。脚本不在宿主机执行学生代码，结果位于 `logs/eduplus-practice-smoke.json`。

真实浏览器验证已通过：本地 Monaco、公开用例 2/2 通过、死循环 3 秒终止、终止后正常运行、应用 API 网络访问被阻止，以及刷新后恢复草稿修订 1。后续截图与运行证据位于 `logs`。

## 下一阶段

原生 Stage/Scene 适配、六阶课堂、随堂检测和复盘现已接通，详见 `EDUPLUS_CLASSROOM_USAGE.md`。公开运行结果保存为浏览器自报学习记录，不计正式成绩。正式判题按用户决定暂缓。教师导出接口已实现，默认匿名身份拒绝；需配置经认证的教师角色后才能使用。多学生共享课程与独立作答授权仍需明确。

实现参考：[Pyodide 官方文档](https://pyodide.org/en/stable/usage/webworker.html)、[Monaco 官方 API](https://microsoft.github.io/monaco-editor/typedoc/)、[Next.js 本地开发来源限制](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins)。实际实现与加载 API 以固定资产版本及本项目验收为准。
