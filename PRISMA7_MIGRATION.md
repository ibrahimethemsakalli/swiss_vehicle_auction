# Prisma 7 geçişi — 27 Ekim 2026

Prisma CLI, istemci ve PostgreSQL adaptörü **7.10.1** olarak birlikte sabitlendi. `pg` ve tipleri **8.23.1**. Prisma 6 için geçici deepmerge-ts override kaldırıldı; yeni upstream zinciri effect 3.20.0 ve deepmerge-ts 8.0.2 içeriyor. Audit: **0 critical / high / moderate / low**. [Ham tarama](docs/dependency-audit-2026-10-27-prisma7.json).

## Uygulanan değişiklikler

- `prisma-client` generator artık ESM TypeScript istemcisini `src/generated/prisma` altında üretir; çıktı Git'e eklenmez. Sunucu tarafındaki Prisma tip/değer importları bu dizine taşındı.
- `prisma.config.ts` şema, migration dizini, açık dotenv yükleme ve CLI bağlantısını tanımlar. Generate/validate DB olmadan çalışabilir; migration için DATABASE_URL zorunludur. Mevcut 10 migration korunur, yeni SQL migration gerekmez.
- `src/lib/database-client.ts` bütün istemcileri `@prisma/adapter-pg` üzerinden kurar. Uygulama, CI, yerel restore yardımcısı ve operasyon testi aynı factory'yi kullanır.
- Paylaşılan istemci ilk DB erişiminde oluşur. DB olmadan build/demo modülleri yüklenebilir; gerçek bir DB erişimi URL yoksa açık hata verir. Geliştirmede havuz global olarak yeniden kullanılır.
- Varsayılan havuz: en fazla 10 bağlantı, bağlantı kurma/havuz bekleme için 5000 ms, boşta bağlantı için 10000 ms. İnteraktif transaction maxWait 2000 ms / timeout 5000 ms. `.env.example` içindeki DB_POOL_MAX, DB_CONNECT_TIMEOUT_MS, DB_IDLE_TIMEOUT_MS pozitif tam sayı ayarlarıdır.
- `schema=` adaptöre aktarılır. Eski Rust URL seçenekleri connection_limit/pool_timeout/connect_timeout/pgbouncer sessizce yok sayılmaz; açık hata verir. Havuz ayarları yeni env değişkenlerine taşınmalıdır. `pgbouncer=true` kullanılan bir canlı ortam ayrıca bağlantı sağlayıcısına göre değerlendirilmelidir.
- TLS sertifika doğrulaması kod tarafından kapatılmaz. Gerçek hosting sertifika/havuz davranışı yerel testsiz varsayılmaz.
- Paket ESM oldu. NextAuth v4 CommonJS default importları Node ESM ve Next bundler için normalize edildi; kimlik doğrulama kuralları değişmedi. Bu yalnızca modül yükleme testine alındı.
- GitHub Actions DB job'una hedefli `pnpm test:prisma` eklendi. Uzak Actions çalıştırılmadı.

## Çalıştırılan hedefli kontroller

`pnpm test:prisma` iki alt komutu birleştirir; bu turda alt komutlar ayrı çalıştırıldı:

1. Ağ erişimi engellenmiş tek ESM modül yükleme testi: yeni istemciyi kullanan modüller ve backup yardımcısı; hiçbir authorize/teklif/satış fonksiyonu çağrılmaz.
2. `node --import tsx scripts/prisma-security-tests.mjs`: yeni UUID adlı yerel PostgreSQL DB oluşturur, sonunda siler. Kaynak DATABASE_URL/TEST_DATABASE_URL yalnızca bağlantı bilgisi için kullanılır; gerçek uygulama DB'sine migration/veri yazılmaz.

İkinci kontrol geçti:

- Generate, validate, istemci sürümü ve gerçek Prisma config yükleme.
- Mevcut migration'ların uygulanması, tekrar deploy, migrate status ve Prisma 7 `--from-config-datasource --to-schema` diff ile sıfır drift.
- Bağlantı ayarı doğrulaması, DB'siz import, paylaşılan istemcinin bağlanması, `schema=` ile ayrı şema izolasyonu.
- CRUD, ilişkiler, enum varsayılanı, Decimal ve 30.00 CHF varsayılanı, P2002 unique ve P2003 FK hataları, JSONB.
- FOR UPDATE ve advisory lock; interactive commit/rollback ve array transaction.
- Tek bağlantılı havuz doluyken sınırlı bekleme; PostgreSQL konuşmayan yerel TCP bağlantısında handshake zaman aşımı; disconnect ve yeniden bağlantı.
- Test DB'si ve bağlantıların temizlenmesi.

İlk geçiş turunda yeni tipler ve `prisma.config.ts` ile typecheck geçti; frozen-lockfile kurulumu geçti. Gerçek Stripe/SMS/OCR API çağrısı ve tamamlanan kullanıcı/tarayıcı iş akışları tekrarlanmadı. Production build daha sonraki ayrı kontrolde doğrulandı (aşağıda). Paket/advisory indirmeleri internet kullandı.

## Çalıştırma

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm test:prisma
```

Test loopback PostgreSQL ve CREATE DATABASE yetkisi ister. Prisma 7 `migrate dev` sonrasında istemci üretimini otomatik yapmaz; şema değişince `pnpm db:generate` ayrıca çalıştırılmalıdır. İlk geçiş turunda sunucu yeniden başlatılmamıştı. Sonraki açılış kontrolünde 127.0.0.1:3000 üzerinde Prisma 7.10.1 ve yerel sağlayıcılarla başlatıldı; ana sayfa, canlılık/hazırlık uçları ve DB kaynaklı ilan okuması 200 döndü. GitHub'a push yapılmadı.

## Ayrı production build kontrolü — 27 Ekim 2026

`node scripts/ci-check.mjs build` başarıyla tamamlandı (exit 0): Next.js 16.4.3 webpack derlemesi, TypeScript kontrolü, sayfa verisi toplama, 31/31 statik sayfa üretimi ve build trace aşamaları geçti. Kod düzeltmesi gerekmedi. İlk sandbox denemesinde çıktı dizinine yazma EPERM hatası verdi; gerekli dosya erişimiyle yeniden çalıştırıldı ve geçti.

Çıktı `.local/next-ci-build`, build kimliği `0z_c85-liiWAOnC1uks1s`. Çalışan geliştirme sunucusunun `.next` çıktısı kullanılmadı; build'in geçici `next-env.d.ts` referansları kontrol sonunda önceki geliştirme referanslarına döndürüldü. `ciEnvironment` ile DATABASE_URL boş, gerçek sağlayıcı anahtarları boş, ödeme/SMS yerel simülasyonları ve OCR kapalıydı. Gerçek API, migration, veri işlemi ve tamamlanan kullanıcı akışları yeniden çalıştırılmadı. Bu ilk kontrol derleme kanıtıydı; production açılışı aşağıdaki ayrı kontrolde yapıldı. Deployment yapılmadı.

## Ayrı production açılışı — 27 Ekim 2026

Aynı build `NODE_ENV=production`, `CI_BUILD=true` ile **http://127.0.0.1:3144** üzerinde gerçek `server.ts` girişinden başlatıldı. Prisma 7.10.1 yerel autoveri veritabanına bağlandı. Bağlantı URL'sindeki PostgreSQL `default_transaction_read_only=on` ayarı doğrulandı; gerçek sağlayıcı anahtarları, OCR ve yerel ödeme/SMS simülasyonları bu süreçte kapalıdır.

İkinci sunucunun aynı veritabanında işleri tekrar çalıştırmaması için `BACKGROUND_WORKERS_ENABLED=false` desteği eklendi. Ayar normal sunucuda verilmezse önceki davranış sürer. Bu süreçte medya temizliği, ihale kapanışı, teklif süresi, ödeme ve outbox dahil bütün worker'ların `disabled`, `lastStartedAt=null`, hata sayısının sıfır olduğu doğrulandı. Sağlık heartbeat'i ayrı `.local/prisma7-production-operations` dizininde tutulur.

Yalnızca açılış kontrolleri yapıldı: ana sayfa, derlenmiş JavaScript ve CSS, `/api/health/live`, `/api/health/ready` ve `/api/market` **200** döndü. Hazırlık yanıtı `ready`; market sonucu demo fallback değil, veritabanından 3 ilan içeriyor. Login/teklif/satış gibi tamamlanan kullanıcı akışları tekrarlanmadı, migration veya veri yazma testi yapılmadı.

3000 portundaki geliştirme süreci kontrol öncesi ve sonrasında aynı PID **19848** ile çalışıyordu; durdurulmadı veya yeniden başlatılmadı. Production kontrol süreci PID **20536** ayrı portta açık bırakıldı. Yerel kanıt `.local/prisma7-production-check.json`; bu adres salt okunur önizlemedir ve tam iş akışı testi değildir.

Kaynak: [Prisma 7 resmî geçiş rehberi](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7). PM-07C raporu önceki sürümün tarihsel kanıtıdır; güncel sürüm bu rapordur.
