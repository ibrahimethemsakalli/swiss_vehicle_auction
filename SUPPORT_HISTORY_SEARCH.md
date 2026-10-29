# PM-34 — Konuşma içi arama ve bağlam

Geçmiş penceresine DE/FR/IT/EN mesaj metni araması ve başlangıç/bitiş tarihi eklendi. Metin en fazla 160 karakterdir; büyük/küçük harf duyarsız eşleşir, SQL LIKE joker karakterleri düz metin olarak kaçırılır. Tarihler UTC tam günleri kapsar; bitiş gününden sonraki gece hariç üst sınırdır. Geçersiz günler ve ters aralıklar reddedilir.

Arama mevcut konuşma yetkisi denetlendikten sonra yapılır; başka taleplerin mesajları aranmaz. Sonuçlar 30 kayıtlık sayfalardadır. Bağlama geçiş seçilen mesajın aynı konuşmaya ait olduğunu doğrular, tarih/id sırasındaki yerinden filtresiz sayfasını hesaplar ve mesajı yeşil vurgular. Sonuçlara dönüş uygulanan arama ve sonuç sayfasını geri getirir. Bağlam içinde önceki/sonraki sayfalar da gezilebilir. Geçmiş penceresi editördeki mesaj, atama gerekçesi, sürüm ve çakışma onayını değiştirmez; otomatik gönderim veya okundu kaydı yoktur.

Arama alanları kalıcı depolamaya veya sayfa URL’sine yazılmaz; yerel GET isteğinde taşınır. Yetkili yanıt yalnızca mesaj kimliği, gövde, personel işareti ve tarihi içerir. Migration ve harici sağlayıcı eklenmedi.

## Yeni kontroller

- Dört yeni test: gerçek takvim günü ve aralık doğrulama; konuşma kapsamı, joker kaçırma, UTC sınırları ve sayfalama; bağlam sırası ve başka konuşma mesajının reddi; sahiplik ve dört dil metinleri.
- Yerel tarayıcı: mevcut 65 mesajlı PM-33 verisinde `message 35` araması; ikinci sayfadaki komşu mesajlarla bağlam; sonuçlara dönüş; ters tarih uyarısı; dışarıda kalan günün boş sonucu; aynı günün eşleşmesi; dönüşte iki taslağın korunması.
- Tarih girdisinin input olayıyla güncellenmesi düzeltildi ve tarayıcıda tekrar doğrulandı. Typecheck geçti.
- Kanıt `.local/pm34-history-search.png`. Gerçek API kullanılmadı, veri yazılmadı, önceki iş akışları tekrar test edilmedi.

## Sonraki öneri

PM-35: destek geçmişindeki arama sonucunu belirli bir mesaja açan yetki kontrollü bağlantı; bağlantıdan açılışta mesaj vurgusu ve erişim yoksa güvenli hata. Taslakla açık sayfadan bu bağlantıya geçişte mevcut ayrılma koruması korunmalı.
