# PM-25A — Randevu hatırlatmaları ve takvim dosyası

28 Ekim 2026: yerel kapsam tamamlandı. Gerçek ödeme, SMS, e-posta veya takvim sağlayıcısı kullanılmadı. Yeni migration/bağımlılık yoktur.

## Davranış

- Kabul edilmiş ve henüz başlamamış randevular için son 24 saat içinde her iki tarafa birer kalıcı uygulama içi bildirim oluşturulur. Randevu bu aralıkta kabul edilirse sonraki taramada yakalanır.
- `notifications.appointments` worker'ı 60 saniyede bir, en fazla 100 randevuluk parti işler. Worker kapalıysa bildirim oluşmaz; sunucu tekrar çalıştığında halen gelecek olan randevular yakalanır. Başlangıç geçmişse eski bildirim üretilmez. İş yükü nedeniyle tam 24 saat öncesi teslim garantisi yoktur.
- Bekleyen/reddedilen/iptal edilmiş/geçmiş randevular, örnek veya askıya alınmış taraflar ve engellenmiş kullanıcı çiftleri atlanır. Bir partinin daha önce bildirim almış kayıtları sonraki kayıtları engellemez.
- Görüşme çiftinin mevcut işlem kilidi, güncel durumun yeniden okunması ve `(userId,eventKey)` benzersizliği eşzamanlı tekrarları önler. Takvim/hatırlatma satış veya ödeme durumunu değiştirmez.
- Bildirim, üretildiği zamandaki olay kaydıdır; sonradan iptal edilirse geçmişten silinmez. Metin kullanıcıyı mesajlardaki güncel durum/saat/yer bilgisine yönlendirir. Bildirimde özel buluşma adresi bulunmaz.
- Yeni mesajlar DE/FR/IT/EN olarak anlık seçilen dilde gösterilir.

## Takvime ekleme

Kabul edilmiş gelecek randevunun kartında `.ics` indirme bağlantısı vardır. `/api/appointments/calendar?id=...&lang=...` oturum ve taraf sahipliğini sunucuda doğrular. Admin rolü özel randevuya otomatik erişim sağlamaz. Örnek/askıya alınmış hesaplar reddedilir. İptal veya süre bitiminden sonra eski URL de dosya döndürmez.

Dosyada sabit UID, kesin UTC başlangıç zamanı, araç başlığı ve buluşma yeri vardır; süre uydurulmaz, davetli e-posta/telefonu eklenmez. Özel/no-store yanıt ve attachment başlığı kullanılır. RFC 5545 TEXT kaçışları, CRLF ve UTF-8 kod noktasını bölmeden 75 oktet satır katlama uygulanır. Kaynak: [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545).

Dosya kullanıcının kendi takvimine elle aktarılır; indirmek takvime otomatik kayıt yapmaz. İptal veya değişiklik dış takvimde otomatik eşitlenmez. Bu sınır dört dilde ekranda ve dosya açıklamasında belirtilir. Dış takvim uygulamalarına fiilî aktarım ve push teslimi bu kapsamda test edilmedi.

## Hedefli doğrulama

`pnpm test:appointments`: üç yeni unit testi (metin enjeksiyonu/UTF-8 katlama, İsviçre yaz-kış saati geçişlerinde kesin saat, dört dil) ve geçici PostgreSQL testleri. İki eşzamanlı tarama, tek bildirim, saat penceresi, durum/engel/askıya alma, iptal sonrası indirme engeli, sahiplik, dört dilde dosya, no-store ve 105 kayıtta parti ilerlemesi geçti. Test veritabanı temizlendi.

İlk testteki eksik fixture ilan türü düzeltildi. Testin yakaladığı PostgreSQL yerel saat farkı, sorguda uygulama tarafından bağlanan kesin tarih sınırlarıyla giderildi. Hedefli testler ardından geçti. pg sürücüsünün mevcut eşzamanlı sorgu deprecation uyarısı testleri başarısız kılmadı; bağımlılık değişikliği yapılmadı.

Tarayıcıda yeni bağlantıdan dosya indirildi ve içeriği doğrulandı; iptal edilen kartta bağlantı yoktu. Yeni açıklamalar ve bildirim DE/FR/IT/EN, 360/390 px'de taşmadan görüldü. Gerçek zamanlanmış worker yerel örneğin iki tarafına birer bildirim oluşturdu; worker durumu `ok`, hata sayısı 0. Yalnızca bu test için oluşturulan araç/görüşme/randevu/bildirim kayıtları temizlendi. Typecheck ve CI yapılandırma denetimi geçti; yeni DB testi Actions'a eklendi, uzak Actions bu adımda çalıştırılmadı. Eski kullanıcı/ihale/ödeme akışları ve production build tekrarlanmadı.

## Sonraki kapsam

PM-25B: PWA için kurulum ve güvenli çevrimdışı bilgilendirme; özel hesap/ödeme/mesaj verilerini önbelleğe almama. Push izinleri ve teslimatı ayrı; otomatik teklif ajanının gizli azami tutar, eşit teklif ve ücret kuralları ürün kararı olarak ayrıca netleştirilmeli. PM-25'in tamamı henüz bitmedi.
