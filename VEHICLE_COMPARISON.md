# PM-15 — Araç karşılaştırma

28 Ekim 2026: yerel kapsam tamamlandı. DE/FR/IT/EN desteklenir.

## Kullanım

İlan kartından veya araç detayından en fazla üç araç seçilir. Ortak seçim çubuğu `/compare` sayfasını açar. Araç çıkarma ve seçimi tamamen temizleme desteklenir. Dördüncü araç ekleme düğmesi devre dışıdır; mevcut seçimler kaldırılabilir. Filtre/sayfa değişikliği seçimleri silmez.

Seçim bu tarayıcıdaki `autoveri-compare` anahtarında yalnızca ilan kimlikleri olarak tutulur; hesap favorilerinden bağımsızdır. Bozuk kayıtlar ayıklanır, tekrarlar kaldırılır ve yüklemede üç kayıt sınırı uygulanır. Sekmeler storage olayıyla eşitlenir. Tarayıcı depolaması kapalıysa mevcut oturumda seçim yapılabilir, kalıcılık uyarısı gösterilir. Cihazlar arasında hesap eşitlemesi bu kapsamda yoktur.

## Gösterim

- Üç araç sütunu; fiyat ve fiyat türü, ilan durumu, kanton, model yılı, ilk tescil, kilometre, güç, motor hacmi, MFK, teknik özellikler ve donanım dahil 42 bilgi satırı.
- Model yılı ilk tescilden türetilmez. Eksik/sayısal olmayan değerler açıkça bilinmiyor olarak gösterilir; gerçek sıfır değeri kaybolmaz.
- Donanımda yalnızca kaydedilen seçenekler “belirtilmiş” sayılır. Diğerleri “belirtilmemiş” gösterilir; donanımın bulunmadığı varsayılmaz.
- MFK: hiç yapılmamış, tarihli, bilinmeyen ve örnek ilanda doğrulanmamış ayrıdır. Örnek ilan işaretleri korunur.
- Telefonlarda tablo kendi alanında yatay kayar; özellik başlığı sütunu sabittir. Kaydırma alanı klavyeyle de odaklanabilir. Sayfa genişliği taşmaz.
- Karşılaştırma ekranında teklif veya rezervasyon işlemi bulunmaz. Detay bağlantıları mevcut ilan sayfalarını açar.

Mevcut herkese açık `/api/market/[id]` uç noktası okunur; özel veriye erişim eklenmez. Veri açılışta, pencereye dönüşte, elle yenilemede ve 15 saniyede bir yenilenir. Süresi geçmiş ama sunucuda henüz kapanmamış ihale “durum kontrol ediliyor” gösterilir; satılmış varsayılmaz. 404 olan ilan sütununda erişilemez mesajı ve kaldırma kalır; diğer istek hatalarında yenileme önerilir. Başarısız yenilemede eski veri güncelmiş gibi sunulmaz. Bu ekran WebSocket ile anlık fiyat garantisi vermez.

## Hedefli kontroller

`pnpm test:comparison` yalnızca dört yeni birim testini çalıştırır:

1. Geçerli kimlik, sıra, tekrar ayıklama, üç kayıt sınırı, çıkarma ve yerine başka araç ekleme.
2. Bilinmeyen sayısal/teknik veriler, sıfır değer, yıl/tescil ayrımı ve belirtilmemiş donanım.
3. MFK durumları, örnek ilan, kapanış kontrolü ve satılmış/iptal edilmiş/süresi dolmuş durumları.
4. Dört dilde yeni metin ve alan anahtarları/değişkenleri.

Dört test ve typecheck geçti. GitHub Actions mevcut birim test keşfi yeni dosyayı da kapsar; uzak CI çalıştırılmadı.

Tarayıcıda Audi, Renault ve Subaru seçildi; 3/3 sayaç ve limit mesajı, yenilemede kalıcılık, detaydan çıkarıp tekrar ekleme, karşılaştırma tablosu ve tüm seçimi temizledikten sonraki boş durum doğrulandı. Model yılındaki binlik ayırıcı bu kontrolde kaldırıldı. Dördüncü eklemenin reddi birim testinde doğrulandı; mevcut aktif gridde yalnızca üç araç olduğundan ayrı dördüncü kart tarayıcı testi yapılmadı.

Yeni karşılaştırma sayfası DE/FR/IT/EN × 360/390 px'de kontrol edildi: sekiz kombinasyonda sayfa taşması yok, dört tablo sütunu (özellik + üç araç), 42 bilgi satırı ve tablo içinde yatay kaydırma var. Klavye ile yatay kaydırma gözlendi; fiziksel telefonda dokunma testi yapılmadı. Görsel kanıtlar `.local/pm15-comparison.png` ve `.local/pm15-comparison-mobile.png` (Git dışında). Test seçimi temizlendi; favori, ilan, teklif ve ödeme kayıtları değiştirilmedi.

Yeni DB migration'ı veya harici sağlayıcı gerekmez. Gerçek API, tamamlanan ihale/ödeme/galeri akışları ve tam production build çalıştırılmadı; GitHub'a push yapılmadı.
