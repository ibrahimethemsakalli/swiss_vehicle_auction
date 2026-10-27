# PM-07 — CI ve bağımlılık incelemesi

**Güncel durum:** Prisma CLI/client/adapter-pg 7.10.1 geçişi tamamlandı; geçici deepmerge override kaldırıldı ve audit 0 bildirim. Generate/config, izole migration/drift, bağlantı havuzu ve DB işlemleri geçti. Ardından API/DB kapalı ayrı production build de TypeScript ve 31 statik sayfa üretimi dahil geçti. DB job'u `pnpm test:prisma` çalıştırır. Kanıt: PRISMA7_MIGRATION.md. Uzak Actions henüz çalıştırılmadı. Aşağıdaki PM-07/07A/07B/07C bulguları tarihsel kayıttır.

İnceleme: 27 Ekim 2026. Workflow dosyaları yerelde hazır; bu görevde GitHub'a push veya uzaktan Actions çalıştırması yapılmadı. GitHub üzerindeki ilk gerçek runner sonucu henüz doğrulanmadı. Önceki PM işleri çalışma ağacında korunuyor.

## Hazırlanan kontroller

`.github/workflows/ci.yml`: PR, main push ve elle workflow_dispatch olaylarında, Ubuntu 24.04 GitHub-hosted runner üzerinde çalışır. Node 24.19.0 (`.node-version`) ve pnpm 11.25.0 (`packageManager`) sabitlendi. Kurulum `--frozen-lockfile`; Actions tam commit SHA ile sabit; token yetkisi yalnızca contents:read; checkout kimlik bilgisi saklamaz. Aynı ref'in eski çalışması iptal edilir ve işler süre sınırlıdır. Deployment, otomatik merge, production ortamı veya uygulama secret'ı kullanılmaz. `pull_request_target` yoktur.

| Check adı | Ne yapar? | Gerçek API / veri gereksinimi |
| --- | --- | --- |
| `typecheck` | Next typegen + ayrı CI tsconfig ile TypeScript kontrolü | Yok |
| `unit` | `tests/*.test.ts` altındaki saf/stub birim testlerini ayrı Node süreçlerinde çalıştırır | Yok. fetch/HTTP/HTTPS bağlantıları engellenir; DB URL'si boşaltılır. Network gerektiren test bu gruba eklenmemeli. |
| `build` | Gerçek provider anahtarları ve DB URL'si boşaltılmış production build | Yok. `.local/next-ci-build` çıktısı ve ayrı tsconfig, mevcut `.next` önizlemesini etkilemez. Bu test çıktısı production deployment için kullanılmamalı. |
| `database-schema` | Ephemeral PostgreSQL 18.6 servisinde yalnızca migration deploy ve gerekli şema/trigger kontrolü | Yerel container servisi; uygulama kullanıcı akışları veya dış sağlayıcı yok. DB adı `_test`, parolası yalnızca geçici CI fixture'ıdır. |
| `dependency-audit` | `pnpm audit --audit-level high` | npm güvenlik servisine internet erişimi. Uygulama/ödeme/SMS API'si değildir. High/critical veya servis hatasında başarısız olur. |

`ci:lint` YAML, en düşük yetki, SHA pinleri, audit kapısı ve Dependabot konfigürasyonunu kontrol eder. `.github/dependabot.yml`, npm/pnpm paketlerini ve GitHub Actions sürümlerini haftalık PR'larla takip edecek şekilde hazırlandı; otomatik merge etkinleştirilmedi. Minor/patch güncellemeleri gruplanır, major geçişler ayrı değerlendirilir.

Prisma/esbuild'in gerekli kurulum script'leri allowlist ile korunur. Linux/macOS embedded-postgres installer script'leri CI için kapalıdır; DB job'u hizmet container'ı kullanır. Windows yerel PostgreSQL desteği korunur.

## Yerel komutlar ve yapılan hedefli doğrulama

- `pnpm ci:lint` — YAML/policy doğrulaması geçti. Ayrıca resmî actionlint 1.7.12 ile workflow ifadesi/şeması kontrol edildi; sonuç başarılı.
- `pnpm ci:typecheck` — geçti.
- `pnpm ci:test ci.test.ts dependency-patches.test.ts socket-auth.test.ts` — 7 kontrol geçti. Yeni CI çevre temizliği, ağ engeli, tehlikeli workflow değişikliklerinin reddi, NextAuth malformed Bearer düzeltmesi, PostCSS sourcemap düzeltmesi ve değişen auth bağımlılığının cookie/origin uyumu kontrol edildi. Giriş/teklif/satış iş akışı çalıştırılmadı.
- `pnpm ci:build` — geçti; 31 statik sayfa oluşturuldu. Yalnızca yeni CI build yolu kontrol edildi; site worker'ları başlatılmadı.
- `pnpm ci:db` — yeni boş/geçici yerel `_test` DB'sinde 10 migration ve gerekli nesneler kontrol edildi. DB temizlendi. Geçersiz/eksik hedef URL'siyle komutun başarısız olduğu da doğrulandı. Mevcut `autoveri` DB'sine yazılmadı.
- Frozen lockfile kurulumu doğrulandı. Tarama, düzeltmelerden önce ve sonra alındı.

CI'daki `unit` job'u gelecekte bütün saf birim testlerini çalıştıracak şekilde tanımlı. Kullanıcının kapsam talebi doğrultusunda bu turda eski birim testlerinin tamamı ve bütün eski DB/HTTP/browser senaryoları yerelde yeniden çalıştırılmadı. Bu nedenle yerel 7 kontrol sonucu bütün test dosyalarının veya uzak Linux runner'ın yeşil olduğu iddiası değildir.

DB kontrolünü yerelde kullanmak için yalnızca yeni/ayrı loopback `_test` URL'sini `TEST_DATABASE_URL` olarak sağlayın. Komut geliştiricinin `.env` dosyasındaki gerçek DATABASE_URL'ye otomatik yönelmez. Build wrapper anahtarları boş değerlerle gölgeler; Next logundaki “Environments: .env” satırı gerçek provider anahtarlarının kullanıldığı anlamına gelmez.

## Bağımlılık sonucu

| Ölçüm | Önce | Sonra |
| --- | ---: | ---: |
| Critical | 4 | 3 |
| High | 15 | 12 |
| Moderate | 16 | 11 |
| Low | 2 | 2 |
| Toplam bildirim | 37 | 28 |

Bu sayılar audit advisory eşleşmeleridir; 28 farklı paketin veya uygulamada doğrulanmış 28 istismar yolunun bulunduğu anlamına gelmez. Tarihli, lockfile SHA-256 içeren kalan bildirim dökümü: [docs/dependency-audit-2026-10-27.json](docs/dependency-audit-2026-10-27.json).

Uygulanan, dar kapsamlı düzeltmeler:

- `next-auth` 4.24.13 → **4.24.15**. Aynı ana sürümde güvenlik düzeltmesi; malformed Bearer ve mevcut cookie/origin kontrolleri hedefli doğrulandı. OAuth veya gerçek e-posta akışı kullanılmadı.
- `postcss` 8.5.6 → **8.5.23**. Next/Tailwind altındaki daha eski PostCSS 8 kopyaları da workspace override ile aynı düzeltmeye taşındı. Güvensiz mutlak sourcemap yüklemesinin reddi ve build doğrulandı.
- `postcss-selector-parser` 6.x alt bağımlılığı **6.1.5** düzeltmesine sabitlendi. CSS/build kontrolü geçti.
- YAML politikası için **yaml 2.9.1** dev bağımlılığı eklendi. Node/pnpm sürümleri ve kurulum script izinleri CI ile uyumlu hale getirildi. Geliştirici PostgreSQL paketi üretim hizmeti olarak değerlendirilmedi.

## Kalan güvenlik işleri — gerçek API gerektirmiyor

| Sıra | Bulgu | Gerekli ayrı uygulama / kabul kapsamı |
| --- | --- | --- |
| PM-07A / P0 (tarihsel bulgu; tamamlandı) | **Next.js 14.2.35 destek dışı; 25 advisory eşleşmesi, 3 critical içeriyor.** | Desteklenen sürüme geçiş. İncelenen resmî güncellemede 15.5.28 ve 16.4.1 düzeltmeleri var; uygulanacağı gün yeniden doğrulanmalı. 16 aktif LTS; 15 bakım LTS. Async route params, server/cookie API'leri, custom server/Socket.IO, React/NextAuth ve cache davranışı hedefli migration testleri ister. Bu turdaki sınırlı CI değişikliğine major framework geçişi dahil edilmedi. |
| PM-07B / P0 (tarihsel bulgu; tamamlandı) | Zod 3.25.76 için koleksiyon doğrulama/bellek tüketimi bildirimi; audit düzeltmesi ≥4.6.6 | Zod 4 şema/API uyumluluğu; request doğrulama ve hata biçimleri için planlı geçiş. Sadece override ile major sürüm zorlanmadı. |
| PM-07C / P1 (tamamlandı) | Prisma 6.19.0 config zincirinde `effect` (<3.20.0) ve `deepmerge-ts` (<8) high bildirimleri | Prisma 6.19.3 + sınırlı deepmerge-ts 8.0.2 override; config/generate/migration/drift/transaction testleri geçti. Ayrıntı PRISMA_SECURITY.md. |
| Bakım | React 18, Tailwind 3, eski Node 22 tipleri ve beta embedded-postgres sürümü | Framework geçişi sırasında destek/uyumluluk planı; sırf en yeni sürüme çıkmak için toplu yükseltme yapılmadı. Bu satır kendi başına yeni bir güvenlik açığı iddiası değildir. |

**PM-07A sonrasında da mevcut lockfile ile `dependency-audit`, kalan iki high nedeniyle başarısız olacaktır.** High/critical bildirimler ignore listesine eklenmedi; devam-et/başarılı-say ayarı yok. CI altyapısının hazır olması bağımlılık güvenliğinin veya üretime hazır olmanın tamamlandığı anlamına gelmez. İmaj optimizasyonu bildirimlerinin bazılarına karşı mevcut sharp 0.35.5 sürümü bir azaltım olabilir; Next 14 desteği veya tüm açıklar için yeterlilik iddiası yapılmadı.

## GitHub ve gerçek API gerektiren kalanlar

| İş | Durum |
| --- | --- |
| GitHub üzerinde ilk Actions çalışması ve branch protection | Dosyalar push edilince workflow çalışabilir. Repo Actions politikası, runner erişimi/bütçesi ve required checks ayarları uzaktan doğrulanmadı/değiştirilmedi. Dependabot da dosya default branch'e geldikten sonra devreye girer. Bu görev push yetkisi isteği olarak yorumlanmadı. |
| npm/Node/Actions/Prisma binary ve container indirmeleri | CI kurulumu için internet gerekir. Bunlar uygulamanın gerçek Stripe/Twilio kabul testi değildir. Registry kesintisi audit'i başarılı göstermez. |
| Stripe 3DS, gerçek capture/release/refund, webhook teslimi, TWINT kararı | PM-05'te ayrılan hesap/işletme gereksinimleri sürüyor. CI'a gerçek sağlayıcı secret'ı eklenmedi. |
| +41/+423 gerçek SMS, gerçek e-posta teslimi ve production admin ikinci faktörü | Gerçek sağlayıcı, ülke izinleri, domain ve test alıcısı kabulü bekliyor. Saf/stub testleri teslim kanıtı değildir. |
| Deployment ve dış izleme | PM-06 işletim/harici servis kararları sürüyor. CI deployment yapmaz ve eski çalışan sunucuyu yeniden başlatmaz. Bağımlılık düzeltmelerini çalışan sitede kullanmak için kontrollü restart gerekir. |

Resmî kaynaklar: [Next destek politikası](https://nextjs.org/support-policy), [14 Ekim 2026 Next güvenlik güncellemesi](https://nextjs.org/blog/nextjs-security-update-october-14-2026), [NextAuth Bearer düzeltmesi](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-xmf8-cvqr-rfgj), [PostCSS 8.5.23 düzeltmesi](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp), [GitHub güvenli workflow kullanımı](https://docs.github.com/en/actions/reference/security/secure-use), [Dependabot ekosistemleri](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories).
