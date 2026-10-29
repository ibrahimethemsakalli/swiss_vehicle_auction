# PM-35 — Yetki kontrollü mesaj bağlantıları

Destek geçmişindeki her mesaj için DE/FR/IT/EN bağlantı oluşturma ve açma eklendi. Bağlantı yalnızca talep kimliği, mesaj kimliği ve dili taşır; içerik veya erişim anahtarı içermez. Kullanıcı ve admin yolları ayrıdır. Oturum, rol, hesap uygunluğu, talep sahipliği ve mesajın aynı talebe ait olması sunucuda denetlenir; bağlantıya sahip olmak erişim sağlamaz.

Doğrudan açılış geçmiş penceresini doğru sayfada açar, hedefe kaydırır ve yeşil vurgu ile metinsel etiket gösterir. Geçmişi kapatma URL'deki hedefi silmez; yenileme hedef mesajı tekrar açar. Bağlantı normal bir bağlantıdır ve mevcut taslak ayrılma korumasından geçer. Bağlantı alanı seçilip elle kopyalanabilir; otomatik paylaşım yoktur. Geçersiz/tekrarlı mesaj parametreleri yok sayılır. Yüklenemeyen veya erişilemeyen hedef için genel hata gösterilir. Okundu kaydı, veri silme, migration veya gerçek sağlayıcı çağrısı eklenmedi.

## Yalnızca yeni kontroller

- Dört hedefli birim testi geçti: dört dilde URL oluşturma/okuma; sahiplik ve admin rolü; mesaj-talep eşleşmesi; çeviri anahtarları.
- Typecheck geçti.
- Yerel tarayıcıda mevcut PM-33 verisindeki 35. mesaj için bağlantı üretildi ve açıldı; ikinci sayfa, doğru mesaj ve yeşil/metinsel vurgu doğrulandı. Yeni veri yazılmadı.
- Kanıt: .local/pm35-message-link.png. Önceki iş akışları tekrar çalıştırılmadı.

## Kapsam ve sonraki öneri

PM-35 dahil 35 ana PM başlığına ulaşıldı; harfli alt maddeler ayrıca bulunur. Bu numaralar sabit bir toplamı göstermez: sonraki öneriler kullanıcı onayıyla kapsama eklenmiştir. PM-36 önerisi yeni küçük özellikler eklemek yerine kapsamı sabitlemek ve canlıya çıkış için kalan zorunlu işleri, işletme/sağlayıcı kararlarını ve ertelenecek isteğe bağlı işleri tek sonlandırılabilir listede toplamaktır. Gerçek servis doğrulamaları karar ve entegrasyon sağlanmadan tamamlanmış sayılmaz.
