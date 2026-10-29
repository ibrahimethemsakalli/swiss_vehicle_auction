# PM-32 — Taslağı koruyarak sürüm çakışması inceleme

Yanıt veya atama kaydında `CONFLICT` alınırsa kaydetme durur. Mesaj, konu, atama gerekçesi, seçili sorumlu ve seçili durum korunur. DE/FR/IT/EN uyarısı önceki sürümü ve yüklenen sürümü gösterir. Güncel talebi yüklemek otomatik gönderim yapmaz; ayrıca “güncel talebi inceledim” onayı gerekir. Yeniden gönderim normal düğmeyle yapılır ve sunucunun sürüm kontrolü yine uygulanır. Bu arada yeni bir değişiklik olursa tekrar çakışma gösterilir.

Güncel yükleme mevcut yetkili GET üzerinden `newest=true` ile son 30 mesajı getirir; görüntüleme sırası eskiden yeniye doğrudur. Güncel durum, sorumlu ve mevcut atama geçmişi gösterilir. Bu sınırlı inceleme görünümünde normal sayfalama kapalıdır; normal yenileme olağan mesaj sayfasını geri getirir. Mesaj komut payload’ları yanıttan çıkarılmaya devam eder. Admin/kullanıcı sahiplik kontrolleri değişmedi; migration yok.

Yükleme hatası inceleme onayını açmaz. Yükleme sırasında ve çakışma çözülene kadar kayıt kapalıdır. Talep kapanmışsa atama gerekçesi görünür kalır fakat kaydedilemez; kullanıcı mesaj taslağı da görünür kalır fakat kapalı talebe gönderilemez. Adminlerin mevcut kapalı talebe yanıt yetkisi değişmedi. Yanıtın kaydedilmesi ayrı atama gerekçesini temizlemez. Taslaklar yalnızca sayfa belleğindedir; URL, localStorage veya sunucuya otomatik kaydedilmez.

## Hedefli doğrulama

- Üç yeni birim testi geçti: inceleme sürümü/yükleme kilidi; son 30 mesajın sınırı, sırası, özel alanların çıkarılması ve admin yetkisi; dört dilde gerçek i18next sürüm interpolasyonu.
- Typecheck geçti.
- Yerel tarayıcıda iki admin değişikliğiyle yanıt ve atama çakışmaları üretildi. Mesaj, gerekçe ve seçimlerin korunduğu; yükleme sonrasında gönderimin kapalı kaldığı; inceleme onayı ve açık gönderimle kaydın tamamlandığı doğrulandı. Dört dilde sürüm numaraları kontrol edildi. İlk kontrolde görülen yer tutucu biçimi düzeltildi ve tekrar doğrulandı.
- Kanıt: `.local/pm32-conflict-review.png`. Yalnızca `LOCAL E2E TEST PM32 conflict review` adlı yerel test talebi oluşturulup değiştirildi. Gerçek sağlayıcı API’si, önceki iş akışı testleri veya veri silme kullanılmadı.

## Sonraki öneri

PM-33: destek mesajlarında sayfa değiştirirken taslağı koruyan geçmiş inceleme görünümü; uzun konuşmalarda eski mesajları inceleyip taslağa geri dönüş. Dört dilde, gerçek API kullanmadan yalnızca yeni geçmiş/taslak davranışı test edilmeli.
