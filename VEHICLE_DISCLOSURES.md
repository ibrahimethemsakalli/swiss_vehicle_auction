# PM-11 — Araç bilgileri ve bilinmeyen değerler

Yerel kapsam tamamlandı (28 Ekim 2026). Yeni alanlar DE/FR/IT/EN olarak araç formunda, taslak/özel önizlemede, detaylarda ve admin incelemesinde yer alır.

- MFK: tarihi biliniyor / henüz yapılmadı / bilinmiyor. Yalnızca bilinen tarihte tarih alanı zorunludur. Diğer durumlarda tarih NULL tutulur; yeşil MFK rozeti ve güncel MFK filtresi uygulanmaz. Eski tarihli kayıtlar DATED olarak korunur; örnek ilanlara doğrulanmış MFK rozeti verilmez.
- Model yılı ayrı isteğe bağlı alandır; ilk tescilden otomatik türetilmez. Yıl filtresi açıkça model yılıdır ve artık ilk tescil yılına geri dönmez. Model yılı bilinmeyen araç model yılı filtresini karşılamaz. Model yılı 1900 ile güncel yıl + 1 arasındadır; ilk tescilden farklı olabilir.
- Hasar geçmişi “bilinmiyor” seçeneğini içerir. Hasarlı/onarılmış seçiminde en fazla 2000 karakterlik açıklama zorunludur. Açıklama satıcının beyanı olarak gösterilir.
- Pil sağlığı (SoH) 0–100 arası isteğe bağlı yüzde değeridir. Yalnızca ELECTRIC/PLUGIN_HYBRID ile kabul edilir. Ölçüm raporuna dayalı satıcı beyanı istenir; bağımsız doğrulama yapılmış sayılmaz. Boş değer sıfıra çevrilmez ve pil sağlığı filtresini karşılamaz.
- Admin MFK durumunu/tarihini birlikte inceleyebilir; yeni model yılı, hasar açıklaması ve pil beyanını görebilir. Bekleyen ilan bu alanlarla yeniden gönderildiğinde mevcut PM-10 sürüm kontrolü devam eder.

Migration `202610280003_vehicle_disclosures`, MFK tarihini nullable yapar; durum, hasar açıklaması ve pil sağlığı kolonlarını ekler. Veritabanı MFK durum/tarih tutarlılığını ve pil yüzdesini CHECK kısıtlarıyla korur. Gerçek API veya lisanslı katalog kullanılmaz. Resmî katalog ve bağımsız beyan doğrulaması ayrı kapsamdır.

## Yalnızca değişen kapsamın testleri

- `node scripts/ci-check.mjs unit vehicle-disclosures.test.ts`: 4 test geçti. Durum/tarih tutarlılığı, geçmiş/future tarih sınırları, model yılı ayrımı, hasar açıklaması, pil sınırları, alan hata eşlemesi, istemci filtreleri ve dört dilde anahtarlar.
- `node --import tsx scripts/vehicle-disclosure-tests.mjs`: yeni geçici yerel PostgreSQL veritabanında migration, yeni alanların taslaktan gönderime taşınması, düzenlemede temizlenmesi, public DTO, SQL filtrelerinin olumlu/olumsuz sonuçları ve DB kısıtları geçti. Test DB kaldırıldı. İhale, admin onayı veya ödeme akışı çalıştırılmadı; gerekli durumlar sentetik fixture olarak kuruldu.
- Typecheck geçti. `pnpm test:disclosures` iki hedefli test grubunu çalıştırır. CI adımı eklendi; push/uzak Actions çalıştırılması bu talebin parçası değildir.
- Değişen model yılı semantiği nedeniyle katalog testinin fixture'ına açık model yılı eklendi; yalnızca etkilenen `technical filters combine` testi ayrıca çalıştırıldı ve geçti.
- Tarayıcıda yalnızca yeni alanlar: DE/FR/IT/EN etiketleri, bilinen MFK'de zorunlu tarih / diğerlerinde tarih alanının kapanması, hasar seçiminin açıklamayı zorunlu yapması, pil giriş sınırları ve çevrilmiş özel önizleme kontrol edildi. Mevcut yaklaşık 498 px görünümde yatay taşma görülmedi; 360/390 px kontrolü yapıldığı iddia edilmez. Formdaki sentetik deneme verisi kaydedilmedi.

Gerçek servisler kapalı tutuldu. Tamamlanmış satış, ödeme, mesajlaşma, galeri veya diğer kullanıcı akışları tekrar test edilmedi. Production build bu kapsamda çalıştırılmadı.
