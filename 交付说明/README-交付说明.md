# 基于OpenMAIC的离线AI算法课堂 · 项目源码包

本包对应技术报告中的“基于OpenMAIC的离线AI算法课堂-项目源码包.zip”，基于 OpenMAIC 1.2.0-rc.2（MIT）二次开发。

## 内容
- 二次开发源码（Next.js 应用、Python Agent、算法执行器 exam_simulator、Lab 与实验工作流）
- 模型运行配置：`scripts/prepare-dual-model.ps1`、`scripts/dual-model-gateway.mjs`、`openmaic.yml`（公开的固定模型路由）
- 测试：`tests/`、`scripts/dual-model-gateway.test.mjs`；离线自检：`离线自检.cmd`
- 部署与使用说明：`主开发版本说明.md`、`离线部署说明.md`
- `交付说明/`：前端直接依赖与 Python 安装依赖核对索引、第三方许可与声明、运行环境版本记录
- `演示视频/`：作品演示视频（含片头片尾，约 3 分 45 秒，断网环境录制）

上游 README 中的演示动图（assets/*.gif，约 80 MB）不影响运行，未随包提供，可在上游仓库查看。

## 不包含
- `.env`、`.env.local`、`database-runtime.json`、`local-database/`、`recovery/`、`logs/`（本机凭据与私有数据）
- `node_modules/`、`.venv/`、`.next/` 等可重新安装或生成的内容
- 模型权重：Gemma 4 E4B 与 Qwen2.5-Coder-7B 按各自许可由使用者通过 Ollama 从官方渠道获取，
  再由 `准备本地模型.cmd`（scripts/prepare-dual-model.ps1）创建 16K 运行别名；首次部署先运行 `准备运行环境.cmd`

## 第三方许可
各依赖的 LICENSE / NOTICE 收录于 `交付说明/第三方许可/`；字体按其实际许可（多为 OFL-1.1）保留声明；
Pyodide（MPL-2.0）与 mathml2omml（LGPL-3.0-or-later）的源码获取方式见同目录说明文件。

打包时间：20261029-032320
