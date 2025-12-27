# Hitokoto (一言) Vercel API

这是一个可直接部署到 Vercel 的简单一言（hitokoto）API，函数路径为 `api/hitokoto.js`。

使用方法：

- 部署到 Vercel：将仓库推到 GitHub 后在 Vercel 控制台选择导入仓库，或本地使用 `vercel` CLI 部署。
- 本地调试（需安装 Vercel CLI）：

```powershell
npm install -g vercel
vercel dev
```

- 请求示例：

```bash
curl https://<your-deployment>.vercel.app/api/hitokoto
curl https://<your-deployment>.vercel.app/api/hitokoto?format=text
```

返回格式：

- JSON: `{ "id": 1, "hitokoto": "...", "from": "..." }`
- 纯文本（?format=text）: 只返回一言文本

Cloudflare Workers + D1 图片管理 (新增)

此仓库还包含一个基于 Cloudflare Workers + D1 的图片管理服务：

- Worker 入口: `src/index.js`
- D1 迁移 SQL: `migrations/001_create_images.sql`
- 本地管理页面: 根路径 `/`（内置在 Worker 中）

功能摘要：

- 使用 D1 存储图片 `category` 与 `url`。
- 支持通过 token 认证（`Authorization: Bearer <token>` 或 `?token=` 或 POST body `token`）。
- 认证后可通过管理页面在线添加/删除图片。

快速部署说明（Cloudflare）：

1. 安装 Wrangler：

```powershell
npm install -g wrangler
```

2. 在 Cloudflare 创建 D1 数据库，并在 `wrangler.toml` 中填写 `d1_databases` 的 `database_name`，或在 Cloudflare 控制台完成绑定后将 `DB` 作为 binding 名称使用。

3. 设置管理 token（在本地用 env 或在 Cloudflare Dashboard 的 Worker 环境变量/secret）：

```powershell
wrangler secret put AUTH_TOKEN
# 然后按提示输入你想要的 token
```

4. 运行迁移（在本地使用 wrangler dev 时，D1 可以通过 Dashboard 或 wrangler CLI 管理迁移；请参照 Cloudflare D1 文档将 SQL 导入到 D1 数据库）。

5. 本地调试与发布：

```powershell
wrangler dev
wrangler publish
```

管理页面访问：本地 `http://localhost:8787/`（`wrangler dev` 启动后），或部署后访问你的 Worker 域名根路径。
