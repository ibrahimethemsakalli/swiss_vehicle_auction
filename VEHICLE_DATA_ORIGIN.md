# PM-23 — Araç verisinin kaynağı ve manuel düzeltmeler

28 Ekim 2026. API gerektirmeyen kapsam tamamlandı. Lisanslı araç veri kaynağı veya değerleme servisi bağlanmadı.

## Kullanıcıya gösterilenler

İlan detayındaki dört dilli **Veri kaynağı ve doğrulama** kartı üç kaynağı ayırır:

- **Satıcı beyanı:** yeni gönderimlerde sunucunun aldığı beyanın tarihi. Belge düzenleme tarihi, üretici verisinin tarihi veya teknik doğrulama tarihi değildir.
- **Kaynak kaydedilmemiş:** geçmiş ilanlarda beyan geçmişi bulunmadığında. Oluşturulma/güncellenme tarihi kullanılarak geçmiş kaynak uydurulmaz.
- **Kurgu örnek / fotoğraf referansı:** örnek ilanlar. Fotoğraf ve dosya adı gerçek sunulan aracın donanımını, durumunu veya kimliğini kanıtlamaz; mevcut fotoğraf kaynak bağlantıları korunur.

Bağımsız doğrulama her durumda **yapılmamış** olarak gösterilir. Satıcı kimlik kontrolü, admin ilan onayı ve OCR birbirinden ayrıdır; hiçbiri otomatik teknik doğrulama etiketi üretmez. Model-yıl/standart donanım kataloğu ve piyasa değerlemesinin bulunmadığı açıklanır. Başlangıç fiyatı, teklif ve istenen fiyat değerleme değildir. Eksik model yılı, donanım ve diğer değerler boş kalır; fotoğraf, model adı veya ilk tescil yılından yeni bilgi türetilmez.

İlan veri girişine OCR dahil bilgilerin elle kontrol edilmesi gerektiği eklendi. Önceden mevcut taslak/düzeltme akışına bağlantı verilir; yeni bir aktif ilan düzenleme yolu açılmaz. Uygun taslak/bekleyen/reddedilmiş ilan düzenlenip yeniden gönderilebilir; aktif ilandaki yanlış bilgi mevcut raporlama özelliğiyle bildirilir.

## Kayıt ve denetim

- `Vehicle.dataDeclaredAt` yalnızca sunucu tarafından yeni doğrudan ilan yaratma veya taslak gönderme sırasında yazılır. İstemci bu alanı gönderemez. Doğrudan yaratma yoluna da mevcut `ListingRevision` sistemiyle SUBMITTED snapshot'ı eklendi.
- Admin mevcut inceleme ekranında make/model/kimlik/ilk tescil/MFK alanlarından birini gerçekten değiştirirse `dataCorrectedAt` ve `dataCorrectedFields` son düzeltmenin tarihini ve alan adlarını kaydeder. Salt onay/ret tarihi bu alanlara yazılmaz. Herkese açık kartta yalnızca alanların çevrilmiş etiketleri gösterilir; özel admin notu, eski değer, tam VIN veya aktör kimliği eklenmez.
- Satıcı yeniden gönderdiğinde yeni beyan tarihi oluşur ve önceki düzeltme işareti güncel karttan temizlenir. Eski değerler özel, değiştirilmeyen revizyon/outbox geçmişinde kalır. Son admin düzeltmesinin yeni değerleri ve kaynak bilgisi aynı transaction'da outbox denetim kaydına girer.
- Bu genel beyan kaydıdır; alan başına lisanslı belge delili veya OCR güven skoru sistemi değildir. OCR metni/fotoğrafı için doğrulanmış kaynağa sahipmiş izlenimi verilmez.
- Migration `202610280013_vehicle_data_origin` yerel autoveri DB'ye uygulandı. Eski ilanlara tarih veya doğrulanmış kaynak atanmadı.

## Yeni kontroller

- 3 birim testi: kaynak ayrımı, doğrulama iddiasının oluşmaması, gerçek değişikliklerde tarih/alan listesi, veri sızdırmama, şema sınırları ve 17 yeni DE/FR/IT/EN çeviri anahtarı/değişken eşleşmesi.
- İzole PostgreSQL: iki gönderim yolunda sunucu tarihi, tarihi bilinmeyen eski kayıt, gerçek admin alan düzeltmesi, salt onayın doğrulama olmaması, düzeltilmiş yeniden gönderim, eski snapshot'ın korunması, kaynak tarihi taklidinin reddi ve şema uyumu. Yalnızca yeni kaynak alanlarına ilişkin gönderim/düzeltme kontrolleri yapıldı; ödeme/ihale/satış akışları çalıştırılmadı.
- Tarayıcı: yeni beyan/manuel düzeltme, eski kayıt ve örnek ilan kaynak kartları; açılır açıklama ve düzeltme bağlantısı. Yeni kart ve form açıklaması DE/FR/IT/EN × 360/390 px'de taşmasız. Form gönderilmedi; galeri, filtre ve önceki kullanıcı akışları tekrar edilmedi.
- Typecheck ve CI yapılandırma kontrolü. `pnpm test:vehicle-data-origin` ve GitHub Actions hedefli DB adımı eklendi. Bu görevde push/uzak CI yapılmadı.
- Geçici test DB'leri ve tarayıcı ilanı kaldırıldı. Kanıtlar `.local/pm23-browser-checks.json`, `.local/pm23-wizard-checks.json`, `.local/pm23-origin-mobile.png` (Git dışında).

## Gerçek veri/API bekleyenler

Lisanslı marka-model-model yılı ve standart donanım kapsamı; kaynak sağlayıcı/sürüm/tarih ve alan delili; otomatik değerleme ve belirsizlik aralığı. Ticari veri lisansı, API seçimi ve kapsam netleşmeden bunlar gerçek özellik gibi sunulmayacak. Sıradaki PM-24'ün yerel kısmı bayi profili ve CSV stok içe aktarma/önizleme/hata raporudur; gerçek sicil doğrulaması ve ücretli plan ayrı karar gerektirir.
