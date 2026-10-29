# PM-10 — İlan taslakları

Yerel kapsam tamamlandı (28 Ekim 2026). DE/FR/IT/EN arayüz, `/drafts` ve `/sell?draft=<id>` üzerinden kullanılır.

## Davranış

- Eksik alanlarla hesaba özel taslak kaydı; kaydedilen adımdan, fotoğraflardan ve araç bilgilerinden devam etme.
- Kayıt **manuel**: “Taslağı kaydet” düğmesi kullanılır. Otomatik kayıt yoktur. Seçilen ruhsat/OCR belgesinin kendisi taslağa yazılmaz.
- Özel önizleme eksik alanları açıkça gösterir; ilan yayınlamaz, teklif veya ödeme başlatmaz.
- En fazla 20 açık taslak. Mevcut fotoğraf sahipliği, dosya boyutu ve kullanıcı kotaları uygulanır. Taslağa bağlı fotoğraflar sahipsiz dosya temizliğine dahil edilmez.
- Yeni taslak silinebilir. Onaydan geri çekilerek düzenlenen mevcut ilan korunur ve yeniden gönderilir; bu kayıtta taslak silme seçeneği yoktur.
- Onay bekleyen ilan düzenlemeye açıldığında inceleme kuyruğundan çekilir (`DRAFT`). Yeniden gönderme aynı araç kimliğini korur ve durumu `PENDING_VERIFICATION` yapar. İhale süresi onayda başlar.
- Aktif, satılmış, iptal edilmiş, süresi dolmuş veya teklif/rezervasyon/satış kaydı bulunan ilan düzenlenemez. Geçmiş fiyat ve teklif kayıtları değişmez.
- Sabit fiyatlı ilan türü de taslakta korunur. Opsiyonel alanları temizlemek yeniden gönderimde veritabanında da temizler.

## Güvenlik ve veri

`ListingDraft` tablosu sahip, JSON anlık görüntü, adım, revizyon ve varsa araç bağlantısı tutar. `MediaAsset.draftId` fotoğraf sahipliğini taslakla bağlar. Migration: `202610280002_listing_drafts`.

Sunucu kullanıcı/sahiplik kontrolü, askıya alınmış hesap engeli, aynı origin kontrolü, 48 KB istek sınırı ve katı alan doğrulaması uygular. Gönderimde tam araç doğrulaması, kimlik/telefon/e-posta ve güncel hukuki kabul kontrolleri devam eder. Önizleme yalnızca giriş yapan sahibin verisidir; yanıtlar `private, no-store` döner.

Kullanıcı satırı kilidi kota ve fotoğraf değişikliklerini seri hale getirir. Revizyon kontrolü iki sekmenin birbirinin değişikliklerini ezmesini önler. Aynı gönderimin tekrarında ikinci araç oluşturulmaz. Admin inceleme isteği artık araç `version` değerini taşır; eski inceleme ekranından karar verilemez.

## Yalnızca yeni kapsamın doğrulanması

- `node scripts/ci-check.mjs unit listing-drafts.test.ts`: 2 test geçti; komut/payload sınırları, eski admin sürümü, dört dilde yeni anahtar ve değişken uyumu.
- `node --import tsx scripts/listing-draft-tests.mjs`: ayrı geçici yerel PostgreSQL veritabanında kalıcılık, devam adımı, sahiplik, eşzamanlı kayıt, eksik gönderim reddi, fotoğraf gizliliği/temizleme koruması, yeniden gönderim, alan temizleme, 20 taslak kotası, düzenleme kilitleri, HTTP sınırları ve silme geçti. Geçici veritabanı kaldırıldı.
- `node scripts/ci-check.mjs typecheck`: geçti.
- Tarayıcı: eksik bilgili taslak kaydetme/listeleme/devam etme, dört dilde özel önizleme, iki fotoğraflı bekleyen ilanı geri çekip düzenleme ve aynı araçla yeniden gönderme geçti. Kalıcı sonuç ayrıca veritabanında doğrulandı; yalnızca bu kontrole ait sentetik kayıtlar/fotoğraflar temizlendi.
- `pnpm test:drafts` yeni birim ve izole DB kontrollerini bir arada çalıştırır. GitHub Actions'a adımı eklendi; bu değişiklikler henüz push edilmedi.

Gerçek ödeme/SMS/OCR API'si kullanılmadı. Tamamlanmış kullanıcı, ödeme, ihale ve galeri akışları tekrarlanmadı. Production build bu kapsamda tekrar çalıştırılmadı. Taslakların otomatik yaşlandırılması/saklama süresi ayrıca işletme politikası olarak belirlenmelidir; mevcut sürüm kaydedilmiş taslağı zaman aşımıyla silmez.
