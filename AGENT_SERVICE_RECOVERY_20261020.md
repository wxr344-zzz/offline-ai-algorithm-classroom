# 本地 Agent 连接恢复

## 根因与现象

截图任务 `run-zhr0idJdnUJhwPZQ` 请求为“请为我讲解堆排序算法”。Next 网页正常，但 8001 端口没有监听进程；上次临时命令窗口启动的 Agent 曾返回健康，随后进程退出。这次错误发生在连接服务阶段，与题目校验或学生代码判题无关。

## 修复

- 本地开发模式下，对固定地址 `http://127.0.0.1:8001` 自动做健康检查；服务缺失时由长期运行的 Next 进程启动项目自带 Python Agent，并等待就绪再发送生成、教学或导出请求。
- 重试入口也在重新排队前检查依赖，兼容开发服务器热更新前已经存在的生成后台。
- 同一进程的并发请求共享一次启动。启动失败不永久缓存，后续可重试；启动等待限制为 30 秒。
- 已健康的服务直接复用，不重启。8001 被其他服务占用时不抢占或结束进程。
- 自动启动仅默认适用于开发环境的固定本机地址。生产部署需要显式 `EDUPLUS_AGENT_AUTO_START=1`，可用 `EDUPLUS_AGENT_AUTO_START=0` 禁用。远程地址及其他端口始终按原配置连接，不创建本地进程。
- 日志保存在 `logs/agent-managed.stdout.log` 与 `logs/agent-managed.stderr.log`；不增加 Windows 自启动项、计划任务或开放端口。

## 验证

- 本地服务实际自动启动，`/health` 返回 `eduplus-agent` 正常。
- 原堆排序任务已收到 `/internal/v1/generate` 和 `/internal/v1/teaching` 的 HTTP 200，最终状态为 `completed`，9/9 个生成页面完成，课堂为 `stage-vTFuwLPORS0D`（界面另有课程完成页）。
- 24 项启动生命周期与 Agent API 回归测试通过；TypeScript、ESLint 检查通过。
- 原课程、数据库、已保存草稿保留。

课堂入口：http://127.0.0.1:3000/classroom/stage-vTFuwLPORS0D

网页截图：`logs/agent-recovered-heapsort-20261020.png`。
