# bruol/short

A Cloudflare Workers URL shortener for `short.bruol.me`, backed by Workers KV.

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
