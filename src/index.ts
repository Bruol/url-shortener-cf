const SLUG_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
const RESERVED = new Set(["api", "favicon.ico", "robots.txt"]);

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="A tiny URL shortener for short.bruol.me">
  <title>bruol / short</title>
  <style>
    :root{color-scheme:dark;--bg:#0b0d10;--card:#15191f;--line:#2a313b;--text:#f4f7fb;--muted:#96a0ad;--accent:#bcff5e;--danger:#ff7b72}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:radial-gradient(circle at 20% 10%,#1b2638 0,transparent 38%),var(--bg);font:16px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text)}main{width:min(680px,calc(100% - 32px));padding:clamp(28px,6vw,56px);border:1px solid var(--line);border-radius:24px;background:color-mix(in srgb,var(--card) 92%,transparent);box-shadow:0 24px 80px #0008}h1{margin:0 0 8px;font-size:clamp(2rem,8vw,4.2rem);letter-spacing:-.08em;line-height:1}.slash{color:var(--accent)}p{color:var(--muted);margin:0 0 32px}form{display:grid;gap:14px}label{display:grid;gap:7px;font-size:.82rem;color:var(--muted)}input,button{font:inherit;border-radius:10px;border:1px solid var(--line);padding:13px 15px}input{width:100%;background:#0e1116;color:var(--text);outline:none}input:focus{border-color:var(--accent);box-shadow:0 0 0 3px #bcff5e22}.row{display:grid;grid-template-columns:1fr auto;gap:10px}button{cursor:pointer;background:var(--accent);border-color:var(--accent);color:#111;font-weight:800}button:disabled{opacity:.55;cursor:wait}#result{min-height:24px;margin-top:20px;color:var(--muted);overflow-wrap:anywhere}#result a{color:var(--accent)}#result.error{color:var(--danger)}small{display:block;margin-top:30px;color:#66717f}@media(max-width:520px){.row{grid-template-columns:1fr}}
  </style>
</head>
<body><main>
  <h1>bruol<span class="slash">/</span>short</h1>
  <p>Turn long links into small ones.</p>
  <form id="form">
    <label>Destination URL<input id="url" name="url" type="url" inputmode="url" placeholder="https://example.com/a/very/long/link" required maxlength="2048"></label>
    <label>Custom alias (optional)<div class="row"><input id="slug" name="slug" pattern="[A-Za-z0-9_-]{3,32}" placeholder="my-link" maxlength="32"><button type="submit">Shorten →</button></div></label>
  </form>
  <div id="result" role="status" aria-live="polite"></div>
  <small>Aliases use 3–32 letters, numbers, underscores, or hyphens.</small>
</main><script>
const form=document.querySelector('#form'),result=document.querySelector('#result'),button=form.querySelector('button');
form.addEventListener('submit',async(event)=>{event.preventDefault();button.disabled=true;result.className='';result.textContent='Creating…';try{const response=await fetch('/api/links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:form.url.value,slug:form.slug.value||undefined})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not create link');result.innerHTML='Ready: <a href="'+data.shortUrl+'" target="_blank" rel="noopener">'+data.shortUrl+'</a> <button type="button" id="copy">Copy</button>';document.querySelector('#copy').onclick=async()=>{await navigator.clipboard.writeText(data.shortUrl);document.querySelector('#copy').textContent='Copied!'}}catch(error){result.className='error';result.textContent=error instanceof Error?error.message:'Something went wrong'}finally{button.disabled=false}});
</script></body></html>`;

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function randomSlug(): string {
  const alphabet = "23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function normalizeDestination(value: unknown, requestUrl: URL): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const target = new URL(value);
    if (target.protocol !== "http:" && target.protocol !== "https:") return null;
    if (target.hostname === requestUrl.hostname) return null;
    return target.toString();
  } catch {
    return null;
  }
}

async function createLink(request: Request, env: Env): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4096) return json({ error: "Request is too large." }, 413);

  let body: { url?: unknown; slug?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a valid JSON body." }, 400);
  }

  const requestUrl = new URL(request.url);
  const destination = normalizeDestination(body.url, requestUrl);
  if (!destination) return json({ error: "Enter a valid http(s) URL on another domain." }, 400);

  const requestedSlug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (requestedSlug && (!SLUG_PATTERN.test(requestedSlug) || RESERVED.has(requestedSlug.toLowerCase()))) {
    return json({ error: "Alias must be 3–32 letters, numbers, underscores, or hyphens." }, 400);
  }

  let slug = requestedSlug;
  if (slug) {
    if (await env.LINKS.get(slug)) return json({ error: "That alias is already taken." }, 409);
  } else {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = randomSlug();
      if (!(await env.LINKS.get(candidate))) {
        slug = candidate;
        break;
      }
    }
    if (!slug) return json({ error: "Could not allocate an alias. Try again." }, 503);
  }

  await env.LINKS.put(slug, destination, { metadata: { createdAt: new Date().toISOString() } });
  return json({ slug, shortUrl: `${requestUrl.origin}/${slug}`, url: destination }, 201);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(page, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (request.method === "POST" && url.pathname === "/api/links") return createLink(request, env);
    if (request.method === "GET" && url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
    }
    if (request.method === "GET") {
      const slug = decodeURIComponent(url.pathname.slice(1));
      if (!SLUG_PATTERN.test(slug)) return new Response("Not found", { status: 404 });
      const destination = await env.LINKS.get(slug);
      if (!destination) return new Response("Not found", { status: 404 });
      return Response.redirect(destination, 302);
    }
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, POST" } });
  },
} satisfies ExportedHandler<Env>;
