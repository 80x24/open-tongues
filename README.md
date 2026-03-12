# tongues

Zero-config website translation server. Add one script tag, get automatic translation to any language — powered by Claude AI.

## How it works

1. Add the script tag to your site
2. tongues scans your page for translatable text
3. Translations are cached in SQLite for instant subsequent loads
4. New content is automatically detected via MutationObserver

```
Request → Memory Cache → SQLite → Claude API → Cache & Return
```

## Quick Start

```bash
# Clone and install
git clone https://github.com/80x24/open-tongues.git
cd open-tongues
bun install

# Configure
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Run
bun dev
```

Add to your website:

```html
<script src="http://localhost:3000/t.js" defer></script>
```

## API

### `POST /api/translate`

Translate text strings.

```json
{
  "texts": ["Hello", "Welcome to our site"],
  "to": "ko",
  "domain": "example.com"
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

### `GET /api/seo/render?url=...&lang=...`

Server-side rendered translation for SEO crawlers.

### `POST /api/purge/:domain/:lang`

Clear cached translations for a domain and language.

### `GET /health`

Health check with cache statistics.

## Client Options

```html
<!-- Auto-translate on load (default) -->
<script src="https://YOUR_HOST/t.js" defer></script>

<!-- Manual mode — call window.t.setLocale("ko") to translate -->
<script src="https://YOUR_HOST/t.js" data-manual defer></script>

<!-- Custom context for better translations -->
<script src="https://YOUR_HOST/t.js" data-preprompt="This is a food menu" defer></script>
```

### Client API (`window.t`)

- `t.setLocale("ko")` — translate to a language
- `t.restore()` — revert to original text
- `t.translateEl(".my-class")` — translate specific elements
- `t.locale` — current locale (read-only)

### Exclude from translation

```html
<span translate="no">Brand Name</span>
<span class="notranslate">Keep Original</span>
```

## Docker

```bash
docker build -t tongues .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... tongues
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key |
| `PORT` | No | `3000` | Server port |
| `DB_PATH` | No | `./tongues.db` | SQLite database path |

## License

MIT
