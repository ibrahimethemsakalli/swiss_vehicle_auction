# PM-33 — Taslağı koruyan mesaj geçmişi

Destek ayrıntısında geçmiş ayrı bir modal pencerede açılır. Otuz mesajlık önceki/sonraki sayfalar, en eski mesajlara ve son 30 mesaja geçiş, taslağa dönüş DE/FR/IT/EN olarak sunulur. Ayrıntıdaki mevcut mesaj sayfalama düğmeleri de bu pencereyi açar; editör yeniden oluşturulmaz ve URL değiştirilmez. Kuyruk sayfalaması değişmedi.

Geçmiş yalnızca mevcut yetkili `/api/support` GET çağrısını kullanır. Yanıt, atama gerekçesi, durum/sorumlu seçimleri, editörün sürümü ve çakışma onayı değiştirilmez. Görüntüleme mesajları okunmuş işaretlemez ve otomatik gönderim yapmaz. Geçmiş okuması yeni ticket sürümünü editöre taşımadığından mevcut sürüm denetimi korunur. Editör taslağı yalnızca sayfa belleğindedir; kalıcı taslak saklama eklenmedi.

Yükleme sırasında eski sayfa içeriği kaldırılır; hata halinde yeniden deneme veya taslağa dönüş mümkündür. Pencere kapanınca/sayfa değişince önceki istek iptal edilir; gecikmiş yanıtlar görüntülenmez. Son sayfada ileri kapalıdır. Son 30 mesaj görünümünden en eski mesajlara geçilerek tüm geçmiş gezilebilir. Migration ve backend değişikliği yok.

## Hedefli testler

- Üç yeni birim testi geçti: GET/sayfalama/abort/no-store ve editör verilerinin ayrılması; hata/yetki/bozuk yanıt ve iptal; dört dilde metinler ve sayfa numarası interpolasyonu.
- Typecheck geçti.
- Yerel tarayıcıda `LOCAL E2E TEST PM33 long history` için 65 örnek mesaj oluşturuldu. 1–30, 31–60, 61–65 sayfaları, son sayfa engeli, geri gezinme ve son 30 mesaj (36–65) doğrulandı. Dönüşte yanıt, atama gerekçesi ve RESOLVED seçimi aynı kaldı. Yeni kontroller dört dilde incelendi.
- Kanıt: `.local/pm33-support-history.png`. Gerçek sağlayıcı API’si, eski iş akışı testleri, mesaj gönderimi, veri silme kullanılmadı.

## Sonraki öneri

PM-34: destek geçmişine konuşma içi metin araması ve tarih aralığı eklemek; sonuçlardan mesajın bağlamına taslağı koruyarak dönmek. Dört dilde, gerçek API olmadan yalnızca yeni arama ve bağlam davranışını test etmek.
