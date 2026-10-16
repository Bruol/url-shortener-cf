# bruol/short

A Cloudflare Workers URL shortener for `short.bruol.me`, backed by Workers KV.

Short URLs are reverse proxied: the destination response is streamed through the
Worker while the short URL remains in the browser's address bar. Presigned URLs
for the `html-plans` bucket are converted to object keys when the link is created,
then served through the Worker's private R2 binding. The short link therefore does
not stop working when the original presigned URL expires.

## Development

```sh
npm install
npm run types
npm run dev
```

Create a short link through the web UI or API:

```sh
curl -X POST https://short.bruol.me/api/links \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","slug":"example","expiresIn":86400}'
```

`expiresIn` is the lifetime in whole seconds and must be at least 60. It defaults
to 604800 seconds (7 days). Set it to `null` for a link that never expires:

```sh
curl -X POST https://short.bruol.me/api/links \
  -H 'content-type: application/json' \
  -d '{"url":"https://public.example.com/artifact.html","expiresIn":null}'
```

The lifetime controls the short-link record. For objects in the bound `html-plans`
R2 bucket, a permanent short link remains valid without a permanent public object
URL. Other destinations can still expire independently.

## Deploy

Requests are limited per client IP using Cloudflare Workers rate-limit bindings:
120 requests per 60 seconds across all routes, and 10 `POST /api/links` attempts
per 60 seconds. Invalid creation attempts also count. Excess requests receive a
JSON error with status `429`, `Retry-After: 60`, and `Cache-Control: no-store`.
The web UI displays the error automatically.

Adjust the limits in `wrangler.jsonc`. Cloudflare enforces these approximate
limits per location, rather than as a strict global quota. Requests without
`CF-Connecting-IP` (such as local development) share an `unknown` bucket.

```sh
npm run deploy
```
