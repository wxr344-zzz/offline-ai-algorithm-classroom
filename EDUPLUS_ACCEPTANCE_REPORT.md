# EduPlus 本机演示验收记录

日期：2026-10-15。范围：原生课程里的本机单用户实验室，正式判题按用户要求关闭。

## 2026-10-15 课程质量验收

本轮修复中文设置未传入生成请求、后续页面缺少原始需求、Two Sum 主题偏移、模型互动脚本的 DOM/状态错误、引导页不展示公开断言，以及独立页复用同题并预填骨架的问题。用户最新要求优先于旧版双页共享题目的约定，新生成的 OJ 使用不同题目身份与独立私有评测；旧资产保持可读。

真实首页样例 `stage-fZ0VmAnNAGJQ` 完成生成并在浏览器验证：中文讲解与对白；模拟器逐步找到 [0,1]；游戏配对成功、得分增加；Guided 四项公开测试 4/4；不同返回目标的 OJ 四项公开测试 4/4；OJ 初始编辑区无类/函数骨架；三道随堂概念题为中文。截图见 `logs/quality-original-classroom-fixed.png`、`logs/quality-simulation-passed.png`、`logs/quality-game-passed.png`、`logs/quality-guided-four-passed.png`、`logs/quality-oj-no-scaffold.png`、`logs/quality-oj-four-passed.png`、`logs/quality-chinese-quiz.png`。

两数之和讲解、互动及迁移题使用维护的已审核教学模板和边界用例，其他考点仍使用本地模型生成并验证；此处运行成功不能等同于所有模型生成的互动代码已经通过浏览器质量关卡。未在宿主机执行模型/学生代码。用户故障课程 `stage-0w16rOjxhszq` 已原址修复，课程地址与所有者不变，原文档完整备份及旧实验资产、草稿保留。旧题作答不自动移植到新题。

本轮最终验证：25 个文件、184 项 TypeScript 测试通过；70 项 Python 测试通过；完整类型检查、相关 ESLint、契约产物同步及生产构建通过。日志分别为 `logs/quality-complete-tests-final.log`、`logs/quality-complete-python.log`、`logs/quality-complete-lint.log`、`logs/quality-production-build.log`。以下保留历史验收与上游扩大回归限制，不代表全项目所有测试均通过。

## 对上一轮完成判断的修正

上一轮独立实验页和另建 Stage 的验证未覆盖首页实际生成链路，因此不能作为用户所要求原生融合的完成证据。本轮直接修改原生 generation-runs 的规划、生成与事务绑定；保留原生讲解、模拟器、游戏与测验，并移除首页独立实验课按钮。开发诊断页仍可直接访问，但不是日常课程入口。

用户旧课程 `stage-Vm7Z_fxadAmw` 已原址升级为 8 个内容页，原讲解与测验 ID 保留，备份在 `logs/stage-Vm7Z_fxadAmw-before-integration.json`。浏览器验证模拟器 12+15=27、游戏 2+3=5 且计分更新，无原 baseSetup/publishState 运行故障。首页新生成课程验证内嵌编辑器、公开测试 3/3、草稿修订 1、自定义调试返回 27，并验证调试后公开测试仍为 3/3。新课堂按设计排序，截图位于 `logs/native-embedded-lab-passed.png`、`logs/native-embedded-code.png`、`logs/native-repaired-simulation.png`。

最终相关回归为 21 个测试文件、159 项 TypeScript 测试通过，Python 69 项通过；类型检查、相关 ESLint、契约一致性与本轮 `pnpm build` 均通过。生产构建日志为 `logs/eduplus-production-build.log`。下面保留上一轮验收记录及未通过的扩大回归，不能把它们与主入口融合验证混淆。

## 验收结果

- 相关 TypeScript 回归：17 个测试文件、101 项测试通过，包含课堂原子创建、版本化草稿、公开事件、服务端测验复算、教师角色拒绝、所有者隔离及对白只读归档。
- Python 回归：68 项通过，覆盖真实节点的 Mock 接口验证、公开/私有契约、API 错误处理、教学结构和 Notebook。自动测试不在宿主机执行模型或学生代码。
- TypeScript 全量类型检查、相关 ESLint、契约生成一致性检查通过。
- `pnpm build` 成功：Next.js 16.3.3 编译、生产类型检查与 56 个静态页面生成完成。上游仍有 middleware 约定弃用及动态文件追踪范围过大的警告；部署前需要另行收敛文件追踪范围并检查产物。
- 真实 Next → Python → Ollama → PostgreSQL 实验课与理论课链路通过：课堂首次创建、重复复用、公开投影、未提交复盘、Markdown 导出、标准 Notebook、默认教师拒绝和跨用户拒绝。证据：`logs/eduplus-classroom-smoke.json`。
- 真实浏览器：六阶原生课堂切换、草稿修订 1 恢复、未保存编辑跨场景保留、公开用例 2/2、随堂测验 3/3、复盘显示实际记录，以及公开数值输入 Canvas。截图：`logs/eduplus-native-review.png`、`logs/eduplus-native-demo.png`。
- 此前浏览器验证：死循环按 3 秒终止、终止后重新运行、运行器无法访问应用 API、刷新恢复草稿。公开测试为练习反馈，不构成正式成绩。

## 未通过的扩大回归

扩大到原框架 `tests/runtime/chat-storage.test.ts` 时，该文件 37 项失败（包含超时），其余同批 5 个文件通过。首个“structured-clone Map/BigInt”断言期望记录数 2、实际为 3；以未修改的 Git HEAD 聊天存储模块再次执行同一测试，出现相同失败。因此不能将全项目回归标注为全绿，也不能将其余失败全部推断为同一根因。

本轮对该模块仅新增 `readPersistedChatSessions` 只读投影；新增独立测试验证读取不创建、不追加、不删除记录且隔离学生分区。原框架写入回归仍需单独排查。

## 交付限制

2026-10-15 原课程访问修复：发现本机演示仍使用匿名身份，导致公开课堂能读、私有实验/复盘接口 404。现启用内置单用户模式，并对用户指定课堂及其当前实验完成备份后归属修复。原课程 classroom、Guided/OJ 草稿和 review 接口真实 HTTP 均为 200；浏览器显示引导代码与四项断言，自主题用非公开输入 `5 13 / 2 4 6 8 10` 得到 `12` 并核对正确。验证未保存参考答案，也未写入学生练习成绩。单用户与课堂/草稿/复盘相关 56 项测试通过，类型检查和改动文件 ESLint 通过（`logs/local-demo-tests.log`）。

- 课程仍标记 `static-validated`；结构、语法和选项检查不保证模型题意或参考答案正确，课程内容需要教学审核。
- 教师私有 Notebook 接口要求认证适配器提供 verified 的教师/admin 角色及课程所有权，当前默认关闭。
- 多学生共享课程授权和分别作答尚未配置；不要把当前按课程所有者保存的草稿直接开放给多人。
- 正式容器判题、生成执行质量关卡、资源配额、容量压测和异步任务队列不在本机演示验收通过范围内。

启动及操作见 `EDUPLUS_CLASSROOM_USAGE.md`。当前没有提交、推送或发布远程仓库。
