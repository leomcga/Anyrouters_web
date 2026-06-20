# Playground 代码解释器 / 文件回复 — 设计与实现计划

> 状态：**✅ 已上线并端到端验证（2026-06-20）**。分支 `feat/playground-code-interpreter`（commit bdf03e90，已部署，未推 GitHub/未合 main）。
> 生产：anyrouters.com 工作区 → 助手 python 回复 → 「Run code」→ 沙箱 → revenue.png 内联 + revenue.xlsx 下载（3s，Gemini 实测）。
> 主镜像 redesign20；sidecar=Cloud Run `sandbox-sidecar`(us-east1)；密钥在 Secret Manager。下方 RESUME HERE 仅作部署留档。

## ✅ 本会话已完成（2026-06-20）
- **E2B 账号**：e2b.dev，Google 登录 leomcga007@gmail.com，team「Leo's Default Team」（免费 20 并发）。API key + 内部密钥见密码库 AnyRouters.md「E2B」段。
- **端到端验证**：本机实测建沙箱→跑 matplotlib/pandas→收割 png/xlsx/csv，8s 跑通。
- **sidecar**（`sandbox-sidecar/`）：Express + @e2b/code-interpreter，`POST /execute`（内部密钥鉴权，建沙箱→跑码→收割 /home/user 全部产物 base64→返回 + rich png 去重）。本地 curl 全绿（鉴权 401、重库 8s、文件 base64 正确）。
- **Go 代理**（`controller/playground_execute.go` + `router/relay-router.go`）：`POST /pg/execute`（UserAuth 鉴权、无 Distribute），透传 sidecar，带 Cloud Run 身份令牌 + X-Internal-Secret 双鉴权。`go build` 通过。
- **前端**（`web/default/src/features/playground/`）：types 加 ExecuteResponse/ExecutionFile；api.ts `executeCode()`；constants `EXECUTE:/pg/execute`；`lib/code-extract.ts` 提取最后一个 python 代码块；`components/code-run-panel.tsx`（▶运行→沙箱→文件卡片：图片内联预览 + data-URL 下载 + stdout/错误）；接入 `playground-chat.tsx`（助手完成消息含 python 块→显示运行面板）。typecheck/eslint/版权 全过。
- **架构定稿**：不存文件（base64 经 Go 代理→前端 data-URL），无 GCS、无文件表。触发=显式「运行代码」按钮（成本安全，非自动跑）。

## 待创建的密钥/资源（re-auth 后）
- Secret Manager（earlier 因 auth 失败未建成）：`E2B_API_KEY` = `e2b_8e43f6c781a4d91470b26c09e9df72ac341e1c8d`；`SANDBOX_INTERNAL_SECRET` = `13ccf8df215dcf602ed7e5b39b8987dd590853a695647dc2`
- newapi 服务需加 env：`SANDBOX_SIDECAR_URL`（sidecar 部署后的 URL）+ `SANDBOX_INTERNAL_SECRET`（Secret 引用）

## 目标
工作区聊天 `/playground` 支持「代码解释器」：用户提需求 → AI 写代码 → 在 **E2B 沙箱**执行 → 产出文件（xlsx/png/pdf/csv）以**可下载卡片**呈现在聊天里。源于用户需求「聊天能回复完成的文件」。用户已认可此方案 + 增量成本（2026-06-19）。

## ⚠️ 关键设计点：Go 后端 ↔ E2B（先定这个）
E2B 官方 SDK 只有 **Python + JS/TS，没有 Go SDK**。new-api 后端是 Go。三种接法：
- **A. Go 直调 E2B REST API**（自己封装）— 省服务但要手写协议
- **B. Node/Python sidecar**（用官方 `@e2b/code-interpreter`），Go 内部调它 — **✅ 推荐**（SDK 成熟、文件/图片产物开箱即用）。sidecar 部署成 anyrouters-prod 上一个独立 Cloud Run 小服务，暴露内部 `/execute`
- **C. 前端直调 E2B** — ❌ 暴露 API key，否决

推荐 **B**。E2B_API_KEY 存 Secret Manager。

## 两种实现路线
- **路线 1（推荐 MVP，前端编排）**：模型回复含可执行代码块/工具调用 → 前端调新后端端点 `POST /pg/execute`（code→E2B→文件）→ 前端渲染文件卡片。**relay 不动**，增量可控，先做这个。
- **路线 2（完整 code-interpreter，后端 tool-use 循环）**：定义 `execute_python` function tool，relay 拦截 tool_call → E2B 执行 → 结果回喂模型多轮。更原生但要改 relay 流式 + 多轮编排，复杂。MVP 验证体验后再考虑。

## 现有架构勘察（关键文件，已确认）
前端在 `web/default/src/features/playground/`，后端 Go 在仓库根。

| 层 | 组件 | 文件 | 关键行 |
|---|---|---|---|
| 路由 | playground 页 | `web/default/src/routes/_authenticated/playground/index.tsx` | 24-31 |
| 容器 | 状态/hooks | `web/default/src/features/playground/index.tsx` | 31-256（`handleSendMessage` 134-143）|
| 聊天显示 | 消息渲染 | `web/default/src/features/playground/components/playground-chat.tsx` | 71-291（Response 在 259，**artifacts 渲染插 264 后**）|
| 输入框 | PromptInput | `web/default/src/features/playground/components/playground-input.tsx` | 78-239（附件按钮 104-108 现为 "Feature in development" 桩）|
| 类型 | Message/请求 | `web/default/src/features/playground/types.ts` | 29-143 |
| API 流 | SSE 处理 | `web/default/src/features/playground/hooks/use-stream-request.ts` | 28-154（delta 解析 60-85）|
| 渲染器 | Streamdown 包装 | `web/default/src/components/ai-elements/response.tsx` | 27-60 |
| **复用 UI** | **artifact 套件（未接入）** | `web/default/src/components/ai-elements/artifact.tsx` | 35-169 |
| **复用 UI** | **tool 套件（未接入）** | `web/default/src/components/ai-elements/tool.tsx` | 50-191 |
| 后端路由 | playground 端点 | `router/relay-router.go` | `playgroundRouter.POST("/chat/completions", controller.Playground)` |
| 后端处理 | playground 控制器 | `controller/playground.go` | 15-56 |
| 响应 DTO | 流式 delta | `dto/openai_response.go` | delta 88-94（已含 `ToolCalls`）|

**关键发现**：
- `artifact.tsx` + `tool.tsx` 两套 UI 已存在但**未接入** playground —— 直接复用，省一半前端活。
- tool-call DTO 后端已支持；消息类型已支持 `image_url` 输入（UI 未启用）。
- 聊天流：input → `handleSendMessage` → `useChatHandler` → SSE `POST /pg/chat/completions` → `controller/playground.go` → `Relay`。流式 delta 字段 content / reasoning_content / tool_calls。

## 实现计划（分阶段）
### 后端（Go）
- [ ] E2B sidecar（Node + `@e2b/code-interpreter`）：暴露 `POST /execute {code,language}` → 返回 stdout/stderr + 产物文件（base64/或直传 GCS）。部署 anyrouters-prod Cloud Run，E2B_API_KEY 走 Secret Manager
- [ ] `service/file_storage.go`：存产物（**GCS bucket** 推荐，带 TTL ~7天），返回 fileID + URL
- [ ] `controller/playground_execute.go`：`POST /pg/execute`（鉴权同 playground=JWT；收 code → 调 sidecar → 存文件 → 返回 artifacts 元数据）
- [ ] `controller/playground_files.go`：`GET /pg/files/:id`（校验归属防枚举 + 正确 Content-Type 流式返回）
- [ ] `router/relay-router.go` 注册上述路由
### 前端（`web/default/src/features/playground/`）
- [ ] `types.ts`：`Message` 加 `artifacts?: {id,type,fileName,url,mimeType,size}[]` + `executionResult?: {code,output,status,error}`
- [ ] `components/artifact-file.tsx`：复用 `ai-elements/artifact.tsx`，文件卡片 + 下载按钮 + 图片预览
- [ ] `components/execution-result-panel.tsx`：复用 `ai-elements/tool.tsx`，代码 + 输出 + 状态徽章
- [ ] `playground-chat.tsx`：Response 后（~264 行）渲染 artifacts / executionResult
- [ ] 触发：输入框加「代码执行」开关，或检测模型回复含代码自动触发 → 调 `/pg/execute`
- [ ] `downloadFile(url, name)` 工具
### 前置 / 外部
- [ ] **E2B 账号 + API key**（e2b.dev；免费额度，之后按沙箱用量计费）→ 用户提供，或授权我用默认 SaaS 信息（Bymii AI Global Limited + Airwallex 8084）注册
- [ ] 文件存储：建 GCS bucket（anyrouters-prod，us-east1，带生命周期 TTL）

## 资源 / 约束
- 仓库 `~/Dev@github/Anyrouters_web`；**dev 分支做原型，勿直接动 main/prod**
- prod 后端 newapi（us-east1），部署 `gcloud run deploy newapi --image us-east1-docker.pkg.dev/anyrouters-prod/anyrouters/new-api:redesignN`
- 架构/凭据见 auto-memory `project-anyrouters.md`；gcloud 已认证 ryan@shushilab.com
- AGPL：改动须开源、保留署名（见仓库 `COMPLIANCE-AGPL.md`）

## RESUME HERE（下次接续点 = 仅部署，代码已就绪）
前置：**gcloud 需以 ryan 重新登录**（令牌过期）。让用户在会话里跑 `! gcloud auth login`（选 ryan@shushilab.com）。然后：

```bash
GC=/opt/homebrew/bin/gcloud; P=anyrouters-prod
# 1) 建 Secret Manager 密钥（earlier 因 auth 失败未成）
printf '%s' 'e2b_8e43f6c781a4d91470b26c09e9df72ac341e1c8d' | $GC secrets create E2B_API_KEY --data-file=- --replication-policy=automatic --project=$P
printf '%s' '13ccf8df215dcf602ed7e5b39b8987dd590853a695647dc2' | $GC secrets create SANDBOX_INTERNAL_SECRET --data-file=- --replication-policy=automatic --project=$P
# 2) 部署 sidecar（--source 走 Cloud Build；内部专用）
cd sandbox-sidecar && $GC run deploy sandbox-sidecar --source . --region us-east1 --project=$P \
  --no-allow-unauthenticated \
  --set-secrets E2B_API_KEY=E2B_API_KEY:latest,INTERNAL_SECRET=SANDBOX_INTERNAL_SECRET:latest
# 3) 授权 newapi 的 SA 调用 sidecar（取 newapi SA；默认 263789180083-compute@developer.gserviceaccount.com）
SA=$($GC run services describe newapi --region us-east1 --project=$P --format='value(spec.template.spec.serviceAccountName)')
[ -z "$SA" ] && SA=263789180083-compute@developer.gserviceaccount.com
$GC run services add-iam-policy-binding sandbox-sidecar --region us-east1 --project=$P --member="serviceAccount:$SA" --role=roles/run.invoker
# 4) 给 newapi 注入 env（⚠️ --update-env-vars 只增量；--set-secrets 要把现有 SQL_DSN/SESSION_SECRET/CRYPTO_SECRET 一并列上，否则会被替换掉！先 describe 现有 secrets 再合并）
SIDE=$($GC run services describe sandbox-sidecar --region us-east1 --project=$P --format='value(status.url)')
$GC run services update newapi --region us-east1 --project=$P \
  --update-env-vars SANDBOX_SIDECAR_URL=$SIDE \
  --update-secrets SANDBOX_INTERNAL_SECRET=SANDBOX_INTERNAL_SECRET:latest   # 用 --update-secrets 增量，别用 --set-secrets
```
5. **重建主镜像**（含 Go + 前端改动）→ 部署 newapi：
   - 前端 `cd web/default && bun install && bun run build`（产物嵌入 Go 二进制）
   - 走项目既有 Cloud Build：`gcloud builds submit`/Dockerfile 出 `redesignN`（N 递增）推 `us-east1-docker.pkg.dev/anyrouters-prod/anyrouters/new-api:redesignN`
   - `gcloud run deploy newapi --image …:redesignN --region us-east1 --project anyrouters-prod`（复用现有 env/secret 引用）
6. **端到端验证**：登录 anyrouters.com 工作区 → 让模型写「生成柱状图并保存 png + 导出 xlsx」的 python → 点「运行代码」→ 应出现文件卡片（图片预览 + 下载）。
7. 通知用户验收。

> 注：`--no-allow-unauthenticated` + 身份令牌是正路；若调试期想简化，可临时 `--allow-unauthenticated`（仍有 INTERNAL_SECRET 兜底），验证通过再收紧。
