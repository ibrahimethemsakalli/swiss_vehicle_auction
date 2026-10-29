# PM-12 — Red, düzeltme ve yeniden inceleme

Yerel kapsam, aşağıdaki güvenli yeniden yayın sınırıyla tamamlandı (28 Ekim 2026). Arayüz DE/FR/IT/EN destekler.

## Davranış

- Admin reddi ayrı `REJECTED` durumudur; satış iptaliyle karıştırılmaz. Red için 5–2000 karakter gerekçe ve en az bir düzeltme kategorisi gerekir: fotoğraflar, ruhsat, araç verileri, fiyat, açıklama.
- Satıcı `/drafts` ekranında gerekçeyi, düzeltme listesini ve son sürüm olaylarını görür. Serbest metin gerekçe adminin yazdığı dilde korunur; kategori/durum/eylem etiketleri seçilen dilde gösterilir.
- “İlanı düzelt” aynı ilana bağlı taslak açar. Gönderim mevcut doğrulama ve fotoğraf sahipliği kurallarıyla yeniden `PENDING_VERIFICATION` yapar. Otomatik onay/yayın yoktur.
- Gönderim, red, onay, düzenleme başlangıcı ve yeniden yayın başlangıcı `ListingRevision` tablosuna sürüm, zaman ve araç anlık görüntüsüyle kaydedilir. Eski satırları değiştiren uygulama uç noktası yoktur. Satıcıya yalnızca kendi kayıtlarının gerekçe/kategori/olay özeti sunulur; kullanıcı parolası veya başka kullanıcı verileri anlık görüntüye dahil edilmez. Geçmiş onaydan sonra da görünür.
- Ekran en son güncellenmiş 100 ilgili ilan ve ilan başına son 20 olayı gösterir; daha eski sürümler veritabanında korunur.
- Red bildiriminin bağlantısı doğrudan `/drafts` ekranına gider.

## Yeniden yayın sınırı

Yalnızca gerçekten süresi dolmuş `EXPIRED` ilan, **hiç teklif, ödeme rezervasyonu veya satış kaydı yoksa** yeniden incelemeye hazırlanabilir. Önce eski araç sürümü/tarihleri saklanır; taslak açılır; yeniden gönderimden sonra admin onayı gerekir. Yeni 7 günlük süre onay anında başlar.

Mevcut araç kimliği/VIN ve fotoğraf sahipliği korunur. Önceki teklifler veya satışlar yeni bir açık artırmaya taşınmaz: bu tür kayıtları bulunan ilanlarda işlem açıkça engellenir. Bunlar için yeni ilan kimliğiyle ayrı yeniden yayın tasarımı bu sürümde yoktur. `SOLD`, `CANCELLED`, aktif ilanlar ve henüz kapanmamış tarihler bu işlemden geçemez.

Eski `CANCELLED` kayıtları otomatik `REJECTED` yapılmadı; eski red ile gerçek satış iptalini varsayımla ayırmak doğru değildir. Migration `202610280004_listing_revisions` yeni red durumunu ve sürüm tablosunu ekler.

## Hedefli doğrulama

- `node scripts/ci-check.mjs unit listing-revisions.test.ts`: 2 yeni test geçti; gerekçe/kategori sınırları, yeni komutlar, dört dilde anahtarlar.
- `node --import tsx scripts/listing-revision-tests.mjs`: ayrı geçici PostgreSQL'de migration, admin/satıcı yetkileri, eski sürüm reddi, gerekçe gizliliği, red→düzelt→yeniden gönderim, değişmeyen eski anlık görüntü, şifre alanlarının dışlanması, süresi dolan ilanın yeniden incelemesi ve onayda yeni 7 gün, onay sonrası geçmiş görünürlüğü, teklif/rezervasyon kilidi geçti. Gerekli önceki durumlar sentetik fixture ile kuruldu; eski ihale/ödeme akışları yeniden çalıştırılmadı. Test DB silindi.
- Typecheck ve `git diff --check` geçti. `pnpm test:revisions` yeni birim ve DB kontrollerini çalıştırır; GitHub Actions adımı eklendi, push yapılmadı.
- Tarayıcıda sentetik ilan için adminin açıklama/kategori seçerek reddi, satıcının dört dilde gerekçe ve sürüm listesini görmesi, düzeltme düğmesinin doğru ilanla taslak açması doğrulandı. Fransızca/İtalyanca mevcut yaklaşık 498 px görünümde yatay taşma yoktu. Sentetik ilan, taslak, bildirim ve sürüm kayıtları temizlendi.

Gerçek ödeme/SMS/OCR API'si kullanılmadı. Tamamlanmış kullanıcı akışları ve production build tekrarlanmadı. Yerel geliştirme sunucusu yeni Prisma modeliyle yeniden başlatıldı; ayrı production sunucusuna dokunulmadı.
