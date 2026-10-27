# PM-07A — Next.js 16 güvenlik yükseltmesi

**Sonraki PM-07B güncellemesi:** Zod 4.6.7 geçişi tamamlandı; güncel audit 0 critical / 2 high. Aşağıdaki 28→3 tablosu PM-07A anının kanıtıdır. ZOD4_MIGRATION.md güncel doğrulama kapsamını açıklar.

27 Ekim 2026. Kaynak ve lockfile **Next.js 16.4.3**, **React/ReactDOM 19.3.1**, React tipleri 19.3.0 ile güncellendi. Next 16 aktif LTS serisidir. Sürümler resmî npm kayıtları ve Next destek/güvenlik belgeleri üzerinden doğrulandı. Gerçek ödeme/SMS/e-posta API'si kullanılmadı.

## Değişiklikler

- Araç detay sayfası, public market detail API'si ve upload okuma API'si `params` Promise'ini await eder.
- Privacy/terms sayfaları `searchParams` Promise'ini await eder; eski sürüm/dil query değerleri aktarılmaya devam eder.
- React 19 tiplerine uyum için OfferForm ref'inin başlangıç değeri açıkça `undefined` yapıldı. Teklif, ödeme veya onay iş kuralları değiştirilmedi.
- TypeScript JSX modu `react-jsx`. CI typecheck önce `next typegen`, sonra `tsc` çalıştırır. CI tarafından üretilen next-env referansları işlem bitiminde önceki dosya içeriğine döndürülür; CI dist yolu geliştirme dosyasına zorla bırakılmaz.
- Normal/CI build ve custom server Webpack'i açıkça seçer. Bu geçişte Turbopack, yeni cache modeli, Server Actions, React Compiler veya proxy/middleware eklenmedi. `next start` yerine Socket.IO'yu bağlayan mevcut `server.ts` kullanılmaya devam eder.
- CI build job'una, yalnızca framework HTTP/Socket.IO sınırlarını test eden smoke adımı eklendi. Bu sunucuda DB ve tüm business worker'lar devre dışıdır.

## Güvenlik sonucu

| Ölçüm | PM-07 sonrası | PM-07A sonrası |
| --- | ---: | ---: |
| Critical | 3 | **0** |
| High | 12 | **3** |
| Moderate | 11 | **0** |
| Low | 2 | **0** |
| Toplam advisory eşleşmesi | 28 | **3** |

Tarama artık Next.js veya React için advisory döndürmüyor. Önceki üç kritik Next bildirimi (Windows sunucu RCE, AVIF ve SVG imaj optimizasyonu) kullanılan dependency sürümünden kaldırıldı. Bu sonuç tarihteki audit envanteridir; uygulama penetrasyon testi veya gelecekte sıfır açık garantisi değildir.

Kalanlar **effect**, **deepmerge-ts** (Prisma/config zinciri; PM-07C) ve **Zod** (PM-07B) için üç high bildirimidir. `dependency-audit` high kapısı bu nedenle hâlâ başarısız olur. Güvenlik kapısı gevşetilmedi. Güncel sürümler, lockfile hash'i ve kalan URL'ler [docs/dependency-audit-2026-10-27-next16.json](docs/dependency-audit-2026-10-27-next16.json) içinde kayıtlı; eski 28'lik rapor tarihsel kanıt olarak korundu.

## Yalnızca etkilenen bölümlerdeki kanıt

| Kontrol | Sonuç / kapsam |
| --- | --- |
| 3 yeni ağsız birim kontrolü | Promised page/query props, promised API params + private missing-file 404, desteklenen/patched framework-renderer aileleri. |
| Production Webpack build | Next 16.4.3 ile başarılı; 30 statik sayfa. Gerçek API anahtarları/DB URL'si boşaltıldı; ayrı `.local/next-ci-build` kullanıldı. |
| Route/query HTTP grubu | Gerçek `server.ts` production host'u; public detail SSR, dinamik ID API, privacy/terms query aktarımı ve invalid upload 404/cache gizliliği. |
| Auth bağlamı HTTP grubu | Async cookies/headers altında CSRF cookie, boş session, `/sell` login redirect ve oturumsuz korumalı API reddi. Kullanıcıyla giriş/kayıt/parola değişikliği veya MFA akışı tekrar çalıştırılmadı. DB kapalı olduğu için account GET'in mevcut açıkça kurgusal demo yanıtı auth guard testi olarak kullanılmadı. |
| Socket.IO grubu | Polling ve doğrudan WebSocket handshake'i Next custom host ile çalıştı. Teklif veya auction subscribe olayı gönderilmedi. Bütün business worker'ların disabled/hiç başlamamış olduğu runtime kaydından doğrulandı. |
| React 19 tarayıcı açılışı | Oturum çerezlerinden ayrı, DB'siz 127.0.0.2:3142 önizlemede hydration, dil değişimi ve boş form doğrulama olayı çalıştı. Konsolda error/warn yok. Galeri, mobil matrisi veya satış senaryoları tekrarlanmadı. Görsel: artifacts/pm-07a-react19.png. |
| Typegen/typecheck, frozen install, CI policy | Geçti. Yeni HTTP adımı CI build job'una eklendi; uzak GitHub Actions çalıştırması/push yapılmadı. |

Komutlar:

- `pnpm ci:typecheck`
- `pnpm ci:test framework-migration.test.ts`
- `pnpm ci:build`
- `pnpm test:framework:http` — önce CI build gerekir; yalnızca geçici DB'siz HTTP/socket test sunucusu açar ve kapatır.
- `pnpm test:framework` — bu yeni kontrollerin birleşik komutu. Eski integration/settlement/media/mobile testlerini çağırmaz.

Yedek/restore, ilan oluşturma, admin onayı, teklif, ihale kapanışı, satış/itiraz, galeri ve filtre iş akışları yeniden çalıştırılmadı. Mevcut `autoveri` veritabanına yazılmadı. DB migration gerekmedi.

## Çalışan sunucu ve dağıtım sınırı

Paket yükseltmesi daha önce başlamış Node süreçlerinin bellekteki Next/React sürümünü değiştirmez. Eski uygulama sunucusu, yeni sürümü kullanmak için kontrollü biçimde durdurulup aynı çalışma moduyla yeniden başlatılmalıdır. Bu görev mevcut DB'li kullanıcı sunucusunu durdurmadı veya yeniden başlatmadı. Ayrı 127.0.0.2:3142 önizleme yalnızca kurgusal veri gösterir; ilan/ödeme testi için kullanılamaz. Uzak GitHub veya production deployment yapılmadı.

Sonraki dar kapsamlı işler PM-07B (Zod) ve PM-07C (Prisma config bağımlılıkları) olarak kalır. Gerçek Stripe/SMS/e-posta kabulü ve PM-06 harici işletim işleri bu yükseltme tarafından tamamlanmış sayılmaz.

Resmî kaynaklar: [Next destek politikası](https://nextjs.org/support-policy), [Next 16 geçiş rehberi](https://nextjs.org/docs/app/guides/upgrading/version-16), [14 Ekim 2026 güvenlik güncellemesi](https://nextjs.org/blog/nextjs-security-update-october-14-2026). npm sürüm/peer kayıtları da kurulum öncesi doğrulandı.
