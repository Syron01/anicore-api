# Copyright Safety Architecture

Bu proje telif sorununu mimari düzeyde çözer. / This project solves copyright
issues at the architectural level. (TR + EN)

---

## Türkçe

### 1. Sıfır veritabanı prensibi
AniCore, hiçbir yerde telifli içerik (özet metinleri, görseller, videolar)
**kalıcı olarak depolamaz**. Tüm veriler istek anında AniList ve Kitsu gibi
kendileri de yasal olarak metadata dağıtan açık topluluk API'lerinden alınır
ve yalnızca kısa süreli önbellekte tutulur.

### 2. Yalnızca olgusal metadata
Önbelleğe alınan veriler yasal olarak telif kapsamına girmeyen **olgular**dır:
ID'ler, tarihler, bölüm/kapak sayıları, puanlar, URL'ler ve etiket adları.
Kreatif içerik (özet metni gibi) her yanıtta canlı sağlayıcıdan akar ve bizim
tarafımızda sahiplenilmez.

### 3. Görsel ve video host edilmez
Poster, banner ve fragman bağlantıları sağlayıcının kendi CDN'ine (AniList CDN,
Kitsu CDN, YouTube) işaret eder. AniCore hiçbir görseli sunucunda barındırmaz,
öylece doğrudan hak sahibi kanallarından sunulur.

### 4. Zorunlu atama (attribution)
Her API yanıtında:
- `providers` alanı: hangi kaynaklar katkıda bulundu
- `X-Data-Providers` ve `X-Attribution` HTTP başlıkları

Bu, AniList'in ve Kitsu'nun atama gereksinimlerini uygulama düzeyinde garanti
eder; ihmal edilemez.

### 5. Kod lisansı
Kod MIT lisanslıdır. Telifli veri içermediği için projenin kendisi (kod +
dokümantasyon) kısıtlama olmadan dağıtılabilir: fork'lanabilir, satılabilir,
değiştirilebilir — çünkü dağıtılan şey bizim kalemimizden çıkan koddur,
başkasının eseri değildir.

### 6. "Ya sonra değişirse?" — kalkan katmanı
Herhangi bir sağlayıcı erişimi kapatırsa, AniCore'un provider-mimarisi sayesinde
yeni bir açık kaynak (ör. TMDB, Anime-Planet benzeri açık API'ler) eklemek tek
dosyalık bir provider yazmaktır; sistem tasarım gereği sağlayıcı-bağımsızdır.
Tek bir kaynağa bağımlılık = tek başarım noktası olmadığı için proje,
kaynak tarafındaki değişikliklerden yapısal olarak etkilenmez.

---

## English

### 1. Zero-database principle
AniCore never persistently stores copyrighted content (synopsis texts, images,
videos). All data is fetched live at request time from open community APIs —
AniList and Kitsu — which themselves lawfully redistribute metadata, and kept
only in a short-TTL cache.

### 2. Facts only
Cached data consists of **facts** (ids, dates, counts, scores, urls, tag
names), which are not copyrightable subject matter in most jurisdictions.
Creative text (e.g. synopses) streams through live from the provider on every
response and is never owned by this project.

### 3. No image or video hosting
Cover, banner and trailer links point to the provider's own CDN (AniList CDN,
Kitsu CDN, YouTube). AniCore hosts zero media, so content is served directly
through the rights holders' own channels.

### 4. Mandatory attribution
Every API response carries:
- a `providers` field listing contributing sources
- `X-Data-Providers` and `X-Attribution` HTTP headers

This enforces AniList's and Kitsu's attribution requirements at the protocol
level — it cannot be accidentally omitted.

### 5. Code license
The code is MIT-licensed. Because it contains no copyrighted data, the project
itself (code + docs) can be forked, modified and redistributed without
restriction: what is distributed is our own original code, not someone else's
work.

### 6. Provider-swappable future-proofing
If any provider closes access, adding a new open source is a single provider
file — the system is provider-agnostic by design. No single point of failure
means changes on the data-source side cannot structurally break the project.
