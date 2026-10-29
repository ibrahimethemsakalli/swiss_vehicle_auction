# PM-16 — Şehir, posta kodu ve konum filtreleri

28 Ekim 2026: istenen yerel kapsam tamamlandı. DE/FR/IT/EN desteklenir.

## Eklenenler

- İlanda isteğe bağlı `city` ve `postalCode`; taslak kaydetme/geri yükleme, özel önizleme, gönderme ve onay öncesi düzenleme desteği. Alanların temizlenmesi DB'de null olarak korunur.
- Şehir: Unicode/NFC normalizasyonu, baş/son ve yinelenen boşlukların temizliği, en çok 80 karakter. Harfler ve yer adlarında kullanılan noktalama kabul edilir; sayı, e-posta, satır sonu veya HTML içeren adres benzeri girişler reddedilir. `Biel/Bienne`, `St. Gallen`, `L’Isle` gibi adlar desteklenir.
- Posta kodu: boş veya 1–9 ile başlayan dört rakam. Bu biçim kontrolüdür; kodun varlığı, şehir/kantonla ilişkisi veya ülke aidiyeti doğrulanmaz.
- Şehir filtresi tam adla, büyük/küçük harf farkını yok sayarak eşleşir. Posta kodu filtresi 1–4 rakamlık başlangıçla eşleşir. Aktif konum filtresinde eksik bilgi eşleşme sayılmaz. PostgreSQL araması ve favorilerin yerel filtresi aynı kuralları kullanır.
- Yeni filtreler mevcut URL/kayıtlı arama şemasına dahildir; kayıtlı arama bildirimleri ortak sorguyu kullanır. Şehir ve posta kodu kartta, detayda ve karşılaştırmada gösterilir. Karşılaştırmada bu iki alan metindir; posta kodu tarih/sayı olarak biçimlendirilmez.

## Gizlilik ve harici işler

Yeni konum modeli tam adres, sokak, bina numarası, enlem veya boylam toplamaz. Herkese açık DTO yalnızca şehir/posta kodu ekler; özel randevu verilerini okumaz. Giriş yanında tam adres yazılmaması ve kesin buluşma yerinin özel olarak kararlaştırılması açıklanır.

Bu, mevcut açıklama metinleri veya fotoğraflara kullanıcı tarafından yazılmış adresleri otomatik sansürleyen bir sistem değildir. Eski ilanlara tahmini şehir/posta kodu eklenmedi. Konumlar satıcı beyanı olarak belirtilir; doğrulanmış adres etiketi verilmez.

Harita, tarayıcı konum izni, koordinat üretimi, yaklaşık mesafe ve yarıçap araması eklenmedi. Mesafe hesaplaması doğrulanmış koordinatlar varsa yerelde yapılabilir; bunun için güvenilir/lisansı uygun posta kodu–yerleşim–koordinat veri seti veya coğrafi kodlama sağlayıcısı ayrıca seçilmelidir. Bu görevde böyle bir veri seti indirilmedi ve gerçek sağlayıcı çağrısı yapılmadı.

## Migration ve test

`202610280007_vehicle_location` migration'ı yerel DB'ye uygulandı (18 migration); nullable alanlar ve status/şehir, status/posta kodu indeksleri eklendi. Prisma istemcisi üretildi; yerel geliştirme sunucusu yeni modelle yeniden başlatıldı. Gerçek sağlayıcılar süreçte kapalı kaldı.

`pnpm test:location` sadece yeni konum kontrollerini çalıştırır:

- Üç yeni birim testi geçti: normalizasyon/boş değerler/biçim ve özel adres alanı reddi; şehir ve posta kodu eşleştirme/URL; karşılaştırma metin türü/bilinmeyenler/dört dil anahtarları.
- İzole yerel PostgreSQL testi geçti: yeni alanların taslakta kalıcılığı, gönderimde normalizasyonu, düzenlemede null'a temizlenmesi, public DTO, revision kaydı ve SQL/favori filtre eşliği. İlan onayı, teklif veya ödeme akışı çalıştırılmadı. Geçici DB kaldırıldı; ödeme kaydı oluşturulmadı.
- Typecheck geçti. GitHub Actions'a izole konum testi eklendi; uzak CI çalıştırılmadı.
- Tarayıcıda şehir/posta kodu URL değerleri, filtre temizleme ve konumu eksik mevcut ilanların dışlanması doğrulandı. Yeni form alanları ile özel önizlemedeki değerler kontrol edildi. Kısa posta kodunun HTML pattern kontrolünde geçersiz olduğu görüldü; hatalı sunucu girdileri birim testinde doğrulandı.
- Yeni form alanları/gizlilik açıklaması ve açık mobil konum filtreleri DE/FR/IT/EN × 360/390 px'de ölçüldü: sayfa/panel yatay taşması yok. Kanıt: `.local/pm16-location-mobile.png` (Git dışında). Fiziksel telefon testi yapılmadı.

Tarayıcıda test edilen yer adı ve posta kodu yalnızca kaydedilmeyen formda kullanıldı; örnek ilanların konumu değiştirilmedi. Harici API, eski ihale/ödeme/galeri akışları, tam build ve push bu görevin kapsamında çalıştırılmadı.
