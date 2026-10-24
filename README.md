# AniCore API

**TR** | [EN below](#english)

Ücretsiz, açık kaynak, çok dilli anime & manga metadata API'si. API key yok, ücretli katman yok — **kendin host edersin, kural senin.**

## ⚡ Power Mode: tüm veri, saniyeler içinde, sıfır limit

```bash
curl -X POST localhost:4000/v1/sync/anime   # tüm AniList anime DB'sini (~21k) yerel SQLite'a aynala
```

Bir kez çalıştır, sonra her şey değişir:

- **Sıfır rate limit** — arama, top, sezon ve detay sorguları artık yerel aynadan servis edilir; `X-Served-By: mirror` başlığıyla. Milyonlarca istek atabilirsin, kimse durdurmaz.
- **Milisaniye hız** — FTS5 tam metin indeksli arama ~4 ms'de yanıt verir (Japonca/İbranice/Çince başlıklarda bile). `gzip` + ETag dahili.
- **Bulk**: `GET /v1/anime/bulk?ids=1,2,3...` tek istekte 500 kayıt.
- **Resumable senkron**: yarıda kesersen yeniden başlat, kaldığı sayfadan devam eder. `GET /v1/sync/status` ile ilerleme.

Jikan'dan farklı olarak AniCore hiçbir yerden veri kazımaz (scrape) ve hiçbir telifli içeriği depolamaz. [AniList](https://anilist.co) ve [Kitsu](https://kitsu.app) gibi açık topluluk API'lerini toplar, tek ve zengin bir şemada birleştirir.

## Neden Jikan'dan iyi?

| | Jikan | AniCore |
|---|---|---|
| Veri kaynağı | Sadece MAL (scrape) | AniList + Kitsu (resmi açık API'ler) |
| Çok dilli başlık | Sınırlı | romaji / english / native + dil tercihli `preferred` alanı |
| Kategorizasyon | Temel | genre + ağırlıklı tag'ler + studio + source + external links |
| Cross-provider ID | Yok | AniList ↔ MyAnimeList ↔ Kitsu tek yanıtta |
| Rate limit | Sıkı, bazen ödeme ister | Kendi sunucunda: provider başına akıllı kuyruk + backoff + önbellek |
| Fiyat | — | 0₺. `npm start` |

## Hızlı başlangıç

```bash
npm install
npm start
# http://localhost:3000/docs
```

## Endpoint'ler

```
POST /v1/sync/anime | /v1/sync/manga    # tüm veritabanını yerel aynaya indir (resumable)
GET  /v1/sync/status                    # ayna ilerlemesi

GET /v1/anime/search?q=frieren          # arama (mirror: FTS5, ms-hızında)
GET /v1/anime/:id                       # detay (mirror-first)
GET /v1/anime/bulk?ids=1,2,3            # tek istekte 500 kayıt
GET /v1/anime/top?by=score|popularity
GET /v1/anime/trending                  # trendler (canlı, daima güncel)
GET /v1/anime/season/2024/fall          # sezon (winter|spring|summer|fall)
GET /v1/anime/:id/characters            # kadro + roller
GET /v1/anime/:id/relations             # franchise grafiği (devam, spin-off)
GET /v1/anime/:id/recommendations       # "bunu beğendiyseniz"
GET /v1/manga/search?q=berserk
GET /v1/manga/top | /v1/manga/:id
GET /v1/character/:id
GET /v1/kitsu/anime/:id                 # doğrudan Kitsu id ile
GET /health                             # sağlık + önbellek + ayna istatistikleri
```

Örnek yanıt (kırpılmış):

```json
{
  "type": "ANIME",
  "id": { "anilist": 154587, "myanimelist": 52991, "kitsu": "46474" },
  "title": {
    "romaji": "Sousou no Frieren",
    "english": "Frieren: Beyond Journey's End",
    "native": "葬送のフリーレン",
    "userPreferred": "Sousou no Frieren"
  },
  "genres": ["Adventure", "Drama", "Fantasy"],
  "tags": [{ "name": "Elf", "rank": 86 }],
  "scores": { "average": 91, "popularity": 524000 },
  "studios": [{ "id": 112, "name": "Madhouse" }],
  "providers": ["anilist", "kitsu"]
}
```

Her yanıt `X-Data-Providers` ve `X-Attribution` başlıkları taşır — veri nereden geldiyse orada yazar.

## Telif konusunu nasıl aşıyoruz?

Kısaca: **AniCore hiçbir telifli içeriği depolamaz, üretmez ve dağıtmaz.** Ayrıntılar için [docs/COPYRIGHT-SAFE.md](docs/COPYRIGHT-SAFE.md) dosyasına bakın. Özet:

1. **Sıfır veritabanı** — veriler canlı olarak açık topluluk API'lerinden alınır; kalıcı depo yok.
2. **Yalnızca olgusal metadata önbelleklenir** (id, tarih, sayı, URL) ve kısa TTL ile tutulur.
3. **Görseller host edilmez** — sağlayıcının kendi CDN'ine işaret eder.
4. **Her yanıtta kaynak ataması** (`providers` alanı + `X-Attribution` başlığı).
5. Kod **MIT lisanslı**; veriler ilgili sağlayıcılara (AniList, Kitsu ve orijinal hak sahiplerine) aittir.

## Lisans

MIT — kod için. Veriler: AniList / Kitsu kullanım koşullarına ve orijinal içerik sahiplerine tabidir.

---

# English

Free, open-source, multilingual anime & manga metadata API. No API keys, no paid tier, no rate-limit anxiety — **you host it, you own it.**

Unlike Jikan, AniCore scrapes nothing and stores zero copyrighted content. It live-aggregates open community APIs ([AniList](https://anilist.co), [Kitsu](https://kitsu.app)) into one rich, normalized schema.

## Quick start

```bash
npm install
npm start        # http://localhost:3000/docs
```

Requires Node.js ≥ 18. Zero external services needed; only dependency is `express`.

## Why not just use Jikan?

Jikan proxies MyAnimeList by scraping, has tight shared rate limits, single-provider data and limited multilingual titles. AniCore aggregates two open APIs with per-provider rate-limit handling (semaphore + Retry-After backoff), cross-provider ID resolution (AniList ↔ MAL ↔ Kitsu), weighted tag/genre categorization and multilingual titles — all self-hosted, all free.

## Architecture

```
src/
  config.js            env + provider settings
  server.js            express app, CORS, docs, error handling
  index.js             entrypoint
  lib/
    cache.js           LRU + TTL in-memory cache (factual metadata only)
    rate-limit.js      semaphore + fetch retry/backoff honoring Retry-After
  providers/
    anilist.js         AniList GraphQL (primary: rich categorization, MAL ids)
    kitsu.js           Kitsu JSON:API (enrichment: multilingual titles, ids)
  core/
    normalize.js       unified provider-agnostic schema
    aggregate.js       cross-provider matching + merge
  routes/index.js      all v1 endpoints
```

## Rate limiting (yours, not ours)

- Per-provider concurrency semaphores (`ANILIST_CONCURRENCY`, `KITSU_CONCURRENCY`)
- Automatic retry with exponential backoff, honoring upstream `Retry-After`
- TTL-cached responses so repeated traffic never re-hits providers

## Copyright safety

AniCore stores, generates and distributes no copyrighted content. It caches only short-lived factual metadata, hotlinks images from the providers' own CDNs, and attributes every response via the `providers` field and `X-Attribution` header. Code is MIT. See [docs/COPYRIGHT-SAFE.md](docs/COPYRIGHT-SAFE.md).

## License

MIT for the code. Data belongs to AniList, Kitsu and the original rights holders.
