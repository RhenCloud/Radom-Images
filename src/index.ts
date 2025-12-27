export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "");

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // Ensure the images table exists before handling requests
    await ensureTable(env);

    try {
      if (pathname === "/api/images" && request.method === "GET") {
        return await listImages(request, env);
      }

      // GET random image (supports ?category=... and ?raw)
      if ((pathname === "/api/images/random" || pathname === "/api/random") && request.method === "GET") {
        const qurl = new URL(request.url);
        const category = qurl.searchParams.get("category");
        const raw = qurl.searchParams.has("raw");
        let stmt = "SELECT id, category, url, created_at FROM images";
        let res;
        if (category) {
          stmt += " WHERE category = ? ORDER BY RANDOM() LIMIT 1";
          res = await env.DB.prepare(stmt).bind(category).all();
        } else {
          stmt += " ORDER BY RANDOM() LIMIT 1";
          res = await env.DB.prepare(stmt).all();
        }
        const item = res && res.results && res.results[0] ? res.results[0] : null;
        if (raw) {
          if (!item || !item.url) return new Response("Not found", { status: 404 });
          try {
            const proxied = await fetch(item.url);
            return proxied;
          } catch (e) {
            return new Response("Failed to fetch image", { status: 502 });
          }
        }
        return new Response(JSON.stringify(item), { status: 200, headers: jsonHeaders() });
      }

      if (pathname === "/api/images" && request.method === "POST") {
        return await addImage(request, env);
      }

      // DELETE /api/images/:id
      const delMatch = pathname.match(/^\/api\/images\/(\d+)$/);
      if (delMatch && request.method === "DELETE") {
        const id = Number(delMatch[1]);
        return await deleteImage(id, request, env);
      }

      // serve index.html for root
      if ((pathname === "" || pathname === "/") && request.method === "GET") {
        return await serveIndex(request);
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: jsonHeaders(),
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err?.message || String(err) }), {
        status: 500,
        headers: jsonHeaders(),
      });
    }
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  } as Record<string, string>;
}

function jsonHeaders() {
  return Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders());
}

async function listImages(request: Request, env: any) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  let stmt: string;
  if (category) {
    stmt = `SELECT id, category, url, created_at FROM images WHERE category = ? ORDER BY created_at DESC`;
    const res = await env.DB.prepare(stmt).bind(category).all();
    return new Response(JSON.stringify(res.results || []), { status: 200, headers: jsonHeaders() });
  }

  stmt = `SELECT id, category, url, created_at FROM images ORDER BY created_at DESC`;
  const res = await env.DB.prepare(stmt).all();
  return new Response(JSON.stringify(res.results || []), { status: 200, headers: jsonHeaders() });
}

async function addImage(request: Request, env: any) {
  // auth
  const ok = await checkAuth(request, env);
  if (!ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders() });
  }

  const body = await request.json();
  const category = (body.category || "default").trim();
  const url = (body.url || "").trim();
  if (!url) {
    return new Response(JSON.stringify({ error: "url required" }), { status: 400, headers: jsonHeaders() });
  }

  const created_at = new Date().toISOString();
  const stmt = `INSERT INTO images (category, url, created_at) VALUES (?, ?, ?)`;
  const r = await env.DB.prepare(stmt).bind(category, url, created_at).run();

  return new Response(JSON.stringify({ ok: true, meta: r }), { status: 201, headers: jsonHeaders() });
}

async function deleteImage(id: number, request: Request, env: any) {
  const ok = await checkAuth(request, env);
  if (!ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: jsonHeaders() });
  }

  const stmt = `DELETE FROM images WHERE id = ?`;
  const r = await env.DB.prepare(stmt).bind(id).run();
  return new Response(JSON.stringify({ ok: true, meta: r }), { status: 200, headers: jsonHeaders() });
}

async function checkAuth(request: Request, env: any) {
  // Accept: Authorization: Bearer <token>
  const auth = request.headers.get("Authorization") || "";
  let token: string | null = null;
  if (auth.startsWith("Bearer ")) token = auth.slice(7).trim();

  // or ?token= in URL
  if (!token) {
    const url = new URL(request.url);
    token = url.searchParams.get("token");
  }

  // or token in JSON body
  if (!token && request.method !== "GET") {
    try {
      const body = await request.clone().json();
      if (body && body.token) token = body.token;
    } catch (e) {
      // ignore
    }
  }

  // expected token from env.AUTH_TOKEN
  if (!env.AUTH_TOKEN) return false;
  return token === env.AUTH_TOKEN;
}

async function serveIndex(request: Request) {
  const html = await getIndexHtml();
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function getIndexHtml() {
  // Vue 3 via CDN single-file admin UI (no build step) — improved visuals
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Random Images Admin</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root{
      --bg:#f6f9fb; --card:#ffffff; --muted:#6b7280; --accent1:#06b6d4; --accent2:#3b82f6; --glass:rgba(2,6,23,0.06)
    }
    *{box-sizing:border-box}
    body{font-family:Inter,system-ui,Segoe UI,Arial;margin:0;padding:28px;background:linear-gradient(180deg,var(--bg),#eef6fb);color:#0b1220}
    .container{max-width:1100px;margin:0 auto}
    header{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px}
    h1{margin:0;font-size:20px;font-weight:600}
    .controls{display:flex;gap:10px;align-items:center}
    input[type=text]{padding:8px 12px;border-radius:10px;border:1px solid var(--glass);background:#fbfeff;color:inherit;min-width:160px}
    button{padding:8px 12px;border-radius:10px;border:0;cursor:pointer}
    .btn-primary{background:linear-gradient(90deg,var(--accent1),var(--accent2));color:white;font-weight:600}
    .btn-ghost{background:transparent;border:1px solid var(--glass);color:var(--muted)}
    .layout{display:grid;grid-template-columns:1fr 320px;gap:18px}
    .card{background:var(--card);padding:16px;border-radius:12px;box-shadow:0 6px 18px rgba(15,23,42,0.06)}
    .add-row{display:flex;gap:10px;align-items:center}
    .grid-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
    .img-card{background:#fbfeff;padding:10px;border-radius:10px;display:flex;flex-direction:column;gap:8px;border:1px solid rgba(2,6,23,0.04)}
    .img-card img{width:100%;height:140px;object-fit:cover;border-radius:8px}
    .meta{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--muted)}
    .small{font-size:13px;color:var(--accent2);text-decoration:none}
    footer.note{margin-top:18px;color:#475569;font-size:13px}
    /* modal */
    .modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(11,18,32,0.6);z-index:60}
    .modal-inner{max-width:90%;max-height:90%;border-radius:12px;overflow:hidden}
    .modal-inner img{width:100%;height:100%;object-fit:contain;background:var(--card)}
    @media (max-width:880px){.layout{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div id="app" class="container">
    <header>
      <h1>Random Images 管理</h1>
      <div class="controls">
        <input v-model="filterCategory" placeholder="按分类过滤" />
        <input v-model="token" placeholder="管理 token" />
        <button class="btn-primary" @click="load">加载</button>
      </div>
    </header>

    <div class="layout">
      <main>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <strong>添加新图片</strong>
            <div style="color:var(--muted);font-size:13px">已存 <strong>{{images.length}}</strong></div>
          </div>
          <div class="add-row">
            <input v-model="category" placeholder="分类" />
            <input v-model="url" placeholder="图片 URL" style="flex:1" />
            <button class="btn-primary" @click="add">添加</button>
          </div>
        </div>

        <div class="card" style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <strong>图片库</strong>
            <div style="display:flex;gap:8px">
              <button class="btn-ghost" @click="load">刷新</button>
            </div>
          </div>

          <div v-if="loading">加载中…</div>
          <div v-else>
            <div v-if="images.length===0" style="color:var(--muted)">暂无图片</div>
            <div class="grid-list" v-else>
              <div v-for="img in images" :key="img.id" class="img-card">
                <img :src="img.url" @click="openPreview(img.url)" alt="thumb" />
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div>
                    <div style="font-weight:600">{{img.category}}</div>
                    <a :href="img.url" target="_blank" class="small">查看链接</a>
                  </div>
                  <div style="text-align:right">
                    <div class="meta">#{{img.id}}</div>
                    <button style="margin-top:8px" @click="remove(img.id)">删除</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer class="note">点击缩略图可预览；使用 token 管理权限。</footer>
      </main>

      <aside>
        <div class="card">
          <strong>调试 / 信息</strong>
          <div style="margin-top:8px;color:var(--muted)">
            <div>Images: <strong>{{images.length}}</strong></div>
            <div v-if="error" style="color:#ffb4b4;margin-top:8px">{{error}}</div>
          </div>
        </div>
      </aside>
    </div>

    <div v-if="showPreview" class="modal" @click.self="closePreview">
      <div class="modal-inner">
        <img :src="previewUrl" alt="preview" />
      </div>
    </div>
  </div>

  <script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
  <script>
    const { createApp } = Vue;
    createApp({
      data() { return { token: '', category: 'default', url: '', images: [], loading: false, error: null, filterCategory: '', showPreview: false, previewUrl: '' } },
      methods: {
        async fetchJson(path, opts) {
          opts = opts || {};
          opts.headers = opts.headers || {};
          if (this.token) opts.headers['Authorization'] = 'Bearer ' + this.token;
          const r = await fetch(path, opts);
          if (!r.ok) {
            let j = null; try { j = await r.json() } catch(e){}
            throw new Error((j && j.error) ? j.error : r.statusText);
          }
          return r.json();
        },
        async load() {
          this.loading = true; this.error = null;
          try {
            const q = this.filterCategory ? '?category=' + encodeURIComponent(this.filterCategory) : '';
            const data = await this.fetchJson('/api/images' + q);
            this.images = Array.isArray(data) ? data : [];
          } catch (e) { this.error = e.message }
          this.loading = false;
        },
        async add() {
          try {
            await this.fetchJson('/api/images', { method: 'POST', body: JSON.stringify({ category: this.category, url: this.url }), headers: { 'Content-Type': 'application/json' } });
            this.url = ''; this.load();
          } catch (e) { this.error = e.message }
        },
        async remove(id) {
          try { await this.fetchJson('/api/images/' + id, { method: 'DELETE' }); this.load(); } catch (e) { this.error = e.message }
        },
        openPreview(url) { this.previewUrl = url; this.showPreview = true },
        closePreview() { this.showPreview = false; this.previewUrl = '' }
      },
      mounted() { this.load() }
    }).mount('#app')
  </script>
</body>
</html>`;
}

// Ensure the `images` table exists. If missing, create it.
async function ensureTable(env: any) {
  if (!env || !env.DB) return;
  try {
    const check = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='images'").all();
    if (!check || !check.results || check.results.length === 0) {
      const stmt = `CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL DEFAULT 'default',
        url TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`;
      await env.DB.prepare(stmt).run();
    }
  } catch (e) {
    // ignore — failure to check/create shouldn't crash the worker at startup
  }
}
