<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Main development workspace (2026-10-25)

This is the independent dual-model main development workspace. Make subsequent fixes here, not in the frozen single-model backup or the earlier dual-model test copy. No automatic synchronization back to those directories, and no remote pushes without the user asking.

Read `主开发版本说明.md` for entry points and scope. Main web: 3400; Agent: 8401; serial model gateway: 11436; private database: 55436. Use `启动平台-开发模式.cmd` for hot reload and `启动平台.cmd` for the production build.

All inference stays local. Preserve the task split between Gemma teaching and Qwen orchestration/Lab, and preserve deterministic executors, sandbox execution and honest grading. Ordinary topics retain native OpenMAIC behavior; algorithm-specific EduPlus behavior stays scoped to algorithm/programming courses.

Never commit or externally package `.env.local`, `local-database`, `database-runtime.json`, `recovery`, or logs. This handoff establishes the development baseline; it does not certify that the known content/layout/discussion issues have already been fixed.
