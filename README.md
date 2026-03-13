# open-tongues

Zero-config website translation. One script tag, any language — powered by Claude AI.

## How it works

```
Request → Memory Cache (L1) → SQLite (L2) → Claude API (L3) → Cache & Return
```

1. Add a script tag to your site
2. tongues scans the page for translatable text
3. Translations are cached at three levels for instant subsequent loads
4. New content is automatically detected via MutationObserver

## Install

### As an npm package

```bash
npm install open-tongues
```

```ts
import { Hono } from 'hono'
import { createHandler } from 'open-tongues'

const app = new Hono()
app.route('/tongues', createHandler({
  apiKey: process.env.ANTHROPIC_API_KEY!,
}))

export default app
```

Then add the client script to your HTML:

```html
<script src="/tongues/t.js" defer></script>
```

### As a standalone server

```bash
git clone https://github.com/80x24/open-tongues.git
cd open-tongues
bun install

cp .env.example .env
# Edit .env — add your ANTHROPIC_API_KEY

bun dev
```

```html
<script src="http://localhost:3000/t.js" defer></script>
```

## API

### `createHandler(config)`

Factory that returns a Hono app you can mount as a sub-router.

```ts
import { createHandler } from 'open-tongues'

app.route('/tongues', createHandler({
  apiKey: 'sk-ant-...',       // required
  dbPath: './tongues.db',      // default: ./tongues.db
  model: 'claude-haiku-4-5-20251001', // default
  cacheSize: 10_000,           // L1 max entries (default: 10000)
  cacheTTL: 86_400_000,        // L1 TTL in ms (default: 24h)
  rateLimit: 100,              // per domain per minute (default: 100, 0 = disabled)
  corsOrigin: '*',             // CORS origin (default: *)
}))
```

### `createTranslator(config)`

Standalone translation engine — use without Hono if you only need the translation logic.

```ts
import { createTranslator } from 'open-tongues'

const translator = createTranslator({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const result = await translator.translateTexts(
  ['Hello', 'Welcome'],
  'ko',
  'example.com'
)
// { "Hello": "안녕하세요", "Welcome": "환영합니다" }
```

### REST Endpoints

When mounted via `createHandler()`, the following endpoints are available:

#### `POST /api/translate`

```json
{
  "texts": ["Hello", "Welcome to our site"],
  "to": "ko",
  "domain": "example.com",
  "pageTitle": "My Site",
  "preprompt": "This is a food menu"
}
```

Response:

```json
{
  "translations": {
    "Hello": "안녕하세요",
    "Welcome to our site": "저희 사이트에 오신 것을 환영합니다"
  }
}
```

#### `GET /api/seo/render?url=...&lang=...`

Server-side rendered translation for SEO crawlers.

#### `POST /api/purge/:domain/:lang`

Clear cached translations for a domain and language.

#### `GET /health`

Health check with cache statistics.

## Client

### Script tag options

```html
<!-- Auto-translate on load (default) -->
<script src="https://YOUR_HOST/t.js" defer></script>

<!-- Manual mode — call window.t.setLocale("ko") to start -->
<script src="https://YOUR_HOST/t.js" data-manual defer></script>

<!-- Custom context for better translations -->
<script src="https://YOUR_HOST/t.js" data-preprompt="This is a food menu" defer></script>
```

### Client API (`window.t`)

- `t.setLocale("ko")` — translate to a language
- `t.restore()` — revert to original text
- `t.translateEl(".selector")` — translate specific elements
- `t.locale` — current locale (read-only)

### Exclude from translation

```html
<span translate="no">Brand Name</span>
<span class="notranslate">Keep Original</span>
```

### Importing the client bundle

If you're bundling the client yourself:

```js
import 'open-tongues/client'
```

## Docker

```bash
docker build -t tongues .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... tongues
```

## Environment Variables (standalone mode)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key |
| `PORT` | No | `3000` | Server port |
| `DB_PATH` | No | `./tongues.db` | SQLite database path |

## License

MIT
