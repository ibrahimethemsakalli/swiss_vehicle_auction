# PM-07C — Prisma güvenlik zinciri

**Güncelleme:** Prisma 7 geçişi tamamlandı. Bu dosya PM-07C tarihsel kaydıdır; güncel sürüm, kaldırılan override ve bağlantı testleri [PRISMA7_MIGRATION.md](PRISMA7_MIGRATION.md) içinde.

27 Ekim 2026. Prisma CLI ve istemci 6.19.0 → **6.19.3**, config zincirindeki effect → **3.21.0**. CLI/istemci sürümleri birlikte sabitlenmiştir.

Prisma 6.19.3 hâlâ deepmerge-ts 7.1.5 istediğinden `pnpm-workspace.yaml` yalnızca `@prisma/config@6.19.3>deepmerge-ts` için **8.0.2** sabitlemesi içerir. Genel bir major override veya audit istisnası yoktur. Prisma'nın kullandığı plain `deepmerge` / c12 yolu incelendi; config yükleme ve döngüsel nesne birleştirme test edildi. Map birleştirme ve deepmergeInto davranış değişiklikleri uygulamanın bu yapılandırma yolunda kullanılmıyor. Upstream güvenli sürümü doğrudan benimsediğinde bu geçici override kaldırılmalıdır.

## Hedefli kanıt

`pnpm test:prisma` yeni UUID adlı, yalnızca loopback PostgreSQL veritabanı oluşturur ve sonunda siler. Yerel bağlantı bilgisi `.env` içinden veya `TEST_DATABASE_URL` ile alınır; mevcut uygulama veritabanına migration uygulamaz. Test kullanıcısının CREATE DATABASE yetkisi gerekir.

- Generate / validate ve üretilen istemci sürümü.
- Gerçekte çözümlenen effect/deepmerge-ts sürümleri, iç içe ve döngüsel merge, gerçek Prisma config yükleme ve config ile CLI validate.
- Mevcut 10 migration'ın boş DB'ye uygulanması, ikinci deploy, migrate status ve migrate diff ile sıfır drift.
- Sentetik CRUD, ilişkiler, Decimal 1234.56 ve varsayılan 30.00 CHF, enum varsayılanı, P2002 unique ve P2003 FK hataları.
- JSONB, FOR UPDATE, advisory lock, interactive commit/rollback ve sıralı transaction ile silme.
- Geçici test DB'sinin temizlenmesi.

Hepsi geçti. Yeni istemciyle `ci:typecheck` ve `install --frozen-lockfile` geçti. Audit: **0 critical / 0 high / 0 moderate / 0 low**; [ham kayıt](docs/dependency-audit-2026-10-27-prisma.json). Bu, tarama anında bildirilen bağımlılık açıklarıdır; genel güvenlik garantisi değildir.

Drift kontrolü önceki şema tanımlarında dört FK varsayılan farkı buldu: AccountChallenge için `onUpdate: NoAction`, Vehicle/Bid/PaymentHold hukuki onay ilişkilerinde `onDelete: Restrict` açıkça belirtildi. Bu tanımlar mevcut SQL migration kurallarını korur. Eski migration'lar değiştirilmedi, yeni migration gerekmedi; gerçek DB'ye şema yazılmadı.

Tamamlanan kullanıcı, ödeme, ilan, galeri ve tarayıcı akışları tekrarlanmadı. Stripe/SMS/OCR API çağrısı yapılmadı. Paket indirme ve advisory taraması internet kullandı. Uzak GitHub Actions, push ve çalışan uygulama sunucusunun yeniden başlatılması bu kapsamda yapılmadı.

## Sonraki bakım sınırı

Prisma 6 güvenlik desteği **19 Kasım 2026** tarihinde bitiyor. Bu yama güncel açıkları giderir; uzun vadeli sürüm geçişinin yerine geçmez. Prisma 7 sürücü adaptörü, bağlantı havuzu ve config değişiklikleri ayrı bir bakım işi olarak planlanmalıdır.

Kaynaklar: [Prisma sürüm desteği](https://www.prisma.io/docs/orm/release-status), [upstream deepmerge takibi](https://github.com/prisma/orm/issues/30052), [deepmerge güvenlik bildirimi](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx), [effect güvenlik bildirimi](https://github.com/advisories/GHSA-38f7-945m-qr2g).
