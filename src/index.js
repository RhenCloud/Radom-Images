export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '');

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    // Ensure the images table exists before handling requests
    await ensureTable(env);

    try {
      if (pathname === '/api/images' && request.method === 'GET') {
        return await listImages(request, env);
      }

      if (pathname === '/api/images' && request.method === 'POST') {
        return await addImage(request, env);
      }

      // DELETE /api/images/:id
      const delMatch = pathname.match(/^\/api\/images\/(\d+)$/);
      if (delMatch && request.method === 'DELETE') {
        const id = Number(delMatch[1]);
        return await deleteImage(id, request, env);
      }

      // serve index.html for root
      if ((pathname === '' || pathname === '/') && request.method === 'GET') {
        return await serveIndex(request);
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: jsonHeaders()
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: jsonHeaders()
      });
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
  };
}

function jsonHeaders() {
  return Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, corsHeaders());
}

// Ensure the `images` table exists. If missing, create it.
async function ensureTable(env) {
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
    // (errors will surface later when DB is used)
  }
}

async function listImages(request, env) {
  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  let stmt;
  if (category) {
    stmt = `SELECT id, category, url, created_at FROM images WHERE category = ? ORDER BY created_at DESC`;
    const res = await env.DB.prepare(stmt).bind(category).all();
    return new Response(JSON.stringify(res.results || []), { status: 200, headers: jsonHeaders() });
  }

  stmt = `SELECT id, category, url, created_at FROM images ORDER BY created_at DESC`;
  const res = await env.DB.prepare(stmt).all();
  return new Response(JSON.stringify(res.results || []), { status: 200, headers: jsonHeaders() });
}

async function addImage(request, env) {
  // auth
  const ok = await checkAuth(request, env);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders() });
  }

  const body = await request.json();
  const category = (body.category || 'default').trim();
  const url = (body.url || '').trim();
  if (!url) {
    return new Response(JSON.stringify({ error: 'url required' }), { status: 400, headers: jsonHeaders() });
  }

  const created_at = new Date().toISOString();
  const stmt = `INSERT INTO images (category, url, created_at) VALUES (?, ?, ?)`;
  const r = await env.DB.prepare(stmt).bind(category, url, created_at).run();

  return new Response(JSON.stringify({ ok: true, meta: r }), { status: 201, headers: jsonHeaders() });
}

async function deleteImage(id, request, env) {
  const ok = await checkAuth(request, env);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders() });
  }

  const stmt = `DELETE FROM images WHERE id = ?`;
  const r = await env.DB.prepare(stmt).bind(id).run();
  return new Response(JSON.stringify({ ok: true, meta: r }), { status: 200, headers: jsonHeaders() });
}

async function checkAuth(request, env) {
  // Accept: Authorization: Bearer <token>
  const auth = request.headers.get('Authorization') || '';
  let token = null;
  if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();

  // or ?token= in URL
  if (!token) {
    const url = new URL(request.url);
    token = url.searchParams.get('token');
  }

  // or token in JSON body
  if (!token && request.method !== 'GET') {
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

async function serveIndex(request) {
  const html = await getIndexHtml();
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function getIndexHtml() {
  // Minimal single-file admin UI
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Random Images Admin</title>
  <style>body{font-family:Arial;padding:20px}input,button{padding:6px;margin:4px}</style>
</head>
<body>
  <h2>Random Images 管理</h2>
  <div>
    <label>Token: <input id="token" placeholder="输入 token"></label>
    <button onclick="load()">登录并加载</button>
  </div>

  <h3>添加图片</h3>
  <div>
    <input id="category" placeholder="分类">
    <input id="url" placeholder="图片 URL" style="width:60%">
    <button onclick="add()">添加</button>
  </div>

  <h3>图片列表</h3>
  <div id="list"></div>

  <script>
    async function fetchJson(path, opts) {
      const t = document.getElementById('token').value.trim();
      opts = opts || {};
      opts.headers = opts.headers || {};
      if (t) opts.headers['Authorization'] = 'Bearer ' + t;
      const r = await fetch(path, opts);
      return r.json();
    }

    async function load() {
      const data = await fetchJson('/api/images');
      const el = document.getElementById('list');
      el.innerHTML = '';
      if (Array.isArray(data)) {
        data.forEach(item => {
          const div = document.createElement('div');
          div.innerHTML = '<b>[' + item.id + '] ' + item.category + '</b> <a href="' + item.url + '" target="_blank">查看</a> <button data-id="' + item.id + '">删除</button>';
          div.querySelector('button').onclick = async (e) => {
            const id = e.target.getAttribute('data-id');
            await fetchJson('/api/images/' + id, { method: 'DELETE' });
            load();
          };
          el.appendChild(div);
        });
      } else {
        el.textContent = JSON.stringify(data);
      }
    }

    async function add() {
      const category = document.getElementById('category').value;
      const url = document.getElementById('url').value;
      await fetchJson('/api/images', { method: 'POST', body: JSON.stringify({ category, url }), headers: { 'Content-Type': 'application/json' } });
      document.getElementById('url').value = '';
      load();
    }
  </script>
</body>
</html>`;
}
