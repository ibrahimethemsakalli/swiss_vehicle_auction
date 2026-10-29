# PM-14 — Paylaşılabilir filtreler ve kayıtlı aramalar

28 Ekim 2026: yerel kapsam tamamlandı. DE/FR/IT/EN desteklenir.

## Kullanım ve sınırlar

- Ana sayfanın filtreleri, sıralaması, sayfası ve favori görünümü URL'ye yazılır. Yenileme ve tarayıcının geri/ileri düğmeleri bu durumu yükler. Bozuk veya aşırı uzun filtre parametreleri güvenli varsayılanlara döner.
- Arama bölümündeki “Saved searches & sharing” paneli mevcut bağlantıyı seçip kopyalamak için gösterir. Bağlantı arama metnini ve filtreleri açıkça içerir. Favori görünümü paylaşılırsa alıcının kendi favorileri gösterilir; başka hesabın favori kimlikleri aktarılmaz.
- Hesaba en fazla 20 isimli arama kaydedilebilir. İsim 1–60 karakterdir; aynı hesapta aynı isim tekrar kullanılamaz. Kaydetme mevcut filtreleri alır; favori kapsamı ve sayfa numarası kaydedilmez. Uygulama tüm ilanlarda ilk sayfayı açar. Silme yalnızca oturum sahibinin kaydını etkiler.
- Bu ilk sürümde kayıtlı aramayı değiştirmek için silip yeni ayarlarla tekrar kaydetmek gerekir. Liste sayfa açılışında ve başarılı yazmalarda güncellenir; farklı sekmelerde anlık liste eşitlemesi yoktur.

## Uygulama içi eşleşme bildirimi

Kaydederken isteğe bağlı bildirim seçilir. `notifications.searches` worker'ı 60 saniyelik aralıkla, bir turda en fazla 100 arama ve arama başına 100 eşleşme işler. Devam konumu veritabanındadır; hata olursa ilgili işlem geri alınır. Her arama/araç çifti için benzersiz olay anahtarı tekrar bildirimi engeller. Bildirim kutusundan ilan detayına gidilir.

Arama kaydedildikten sonra oluşturulan veya güncellenen, kontrol anında filtreye uyan aktif ilanlar değerlendirilir. Eski, değişmemiş ilanlar başlangıç bildirimi üretmez. Güncellenmiş eski bir ilan da yeni eşleşme olabilir; bu bir fiyat düşüşü takibi değildir. Örnek ilanlar, kendi ilanları ve süresi geçmiş ihaleler bildirilmez. Askıya alınmış/örnek hesapların aramaları taranmaz. Silinen aramanın önceki bildirimleri kutuda kalır.

Bu, periyodik mevcut durum taramasıdır: iki tarama arasında eşleşip tekrar eşleşmez hale gelen ilan için olay geçmişi garantisi vermez. Çok uzun süren eşzamanlı ilan işlemlerinin zaman damgası sınırı ayrıca üretim yük testinde değerlendirilmelidir. E-posta, SMS ve push gönderilmez.

## Veri ve kontroller

`202610280006_saved_searches` migration'ı yerelde uygulandı (17 migration). Yeni model kullanıcıya bağlıdır; isim benzersizliği veritabanında da korunur. Kota kontrolleri kullanıcı satır kilidiyle seri hale gelir. `GET/POST /api/saved-searches`: oturum, aktif kullanıcı, aynı origin, katı komut şeması, 24.000 bayt gövde sınırı ve private/no-store yanıtları.

`pnpm test:searches` yalnızca yeni testleri çalıştırır:

- Üç yeni birim testi geçti: gelişmiş filtre URL dönüşümü/varsayılanlar, geçersiz bağlantı ve sahiplik enjeksiyonu, dört dil anahtar/değişken eşliği.
- Geçici yerel PostgreSQL testi geçti: migration, yeniden bağlantıda kalıcılık, hesap ayrımı, isim/kota sınırı, silme yetkisi, eşleşme/örnek/kapalı ilan süzme, tekrar bildirim engeli ve HTTP sınırları. Test veritabanı kaldırıldı; ödeme kaydı oluşturulmadı.
- Typecheck geçti. İlk kontrolde yalnızca yeni testteki birleşim tipi daraltması düzeltildi.
- Tarayıcı: Audi/BMW arasında geri/ileri dönüş, paylaşım bağlantısı, boş isim hatası, hesapta kaydetme, yenileme sonrası kalıcılık, başka filtreden kayıtlı filtreye uygulama ve silme geçti. Yeni panel DE/FR/IT/EN × 360/390 px'de yatay taşma olmadan görüntülendi. Kanıt: `.local/pm14-saved-searches.png` (Git dışında).
- Tarayıcıda oluşturulan `PM14 browser Audi` test kaydı kaldırıldı. Eşleşme bildirim üretimi izole DB testinde doğrulandı; eski bildirim okuma ve ihale/ödeme akışları yeniden çalıştırılmadı.

Yerel geliştirme sunucusu yeni model/worker ile yeniden başlatıldı; gerçek sağlayıcı anahtarları süreçte kapalıdır. CI'ye yeni izole DB adımı eklendi. Tam production build, uzak CI ve gerçek API testleri bu kapsamda çalıştırılmadı; GitHub'a push yapılmadı.
