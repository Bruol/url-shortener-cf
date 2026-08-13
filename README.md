# bruol/short

A Cloudflare Workers URL shortener for `short.bruol.me`, backed by Workers KV.

Short URLs are reverse proxied: the destination response is streamed through the
Worker while the short URL remains in the browser's address bar. KV continues to
store the destination URL, including presigned R2 URLs; no R2 binding is required.

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
  -d '{"url":"https://example.com","slug":"example"}'
```

## Deploy

```sh
npm run deploy
```
