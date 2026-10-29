# PM-19 — Ortak teslim kontrol listesi ve teslim özeti

28 Ekim 2026. Yerel teknik kapsam tamamlandı. Resmî sözleşme/fatura, imza sağlayıcısı ve tahsilat kuralı değişiklikleri bu kapsamda değildir.

## Ekran ve işleyiş

Satış kartındaki bağlantı `/handover/[settlementId]` sayfasını açar. Alıcı ve satıcı aynı kontrol listesini görür; admin salt okunur erişir, ilgisiz hesap erişemez. Örnek kullanıcı/ilanlar, askıya alınmış hesaplar ve oturumsuz erişim engellenir. Yerel test hesaplarıyla oluşturulmuş sentetik satış ayrı bir test kaydıdır.

- Kontrol listesi: birlikte inceleme, bilinen hasar/farkların kaydı, anlaşılmış anahtarların ve belgelerin alınması, aracın teslimi. Her madde başlangıçta **kontrol edilmedi/bilinmiyor**; cevap Evet veya Hayır olabilir. Hasar maddesinin Evet olması hasarsızlık iddiası değildir.
- Gerçek teslim tarihi, isteğe bağlı kilometre/anahtar sayısı, 2000 karaktere kadar açıklama. Bilinmeyen sayısal bilgiler boş kalır; sıfır gibi gösterilmez. Teyit için tarih satışın oluşturulduğu İsviçre takvim günü ile bugün arasında olmalı, her madde açıkça cevaplanmalı, bir Hayır varsa en az 10 karakter açıklama bulunmalıdır. İsviçre gün sınırı Europe/Zurich ile hesaplanır.
- Yalnızca e-posta ve telefonu doğrulanmış satış tarafları yazabilir. Satış AWAITING_CONFIRMATION olmalı ve OPEN/ACTION_REQUIRED itiraz bulunmamalıdır. Bu koruma her mutasyonda veritabanında tekrar kontrol edilir; eski açık ekranla aşılamaz.
- Kaydetme yeni sürüm oluşturur. Araç/bedel bilgisi sunucudan alınır; tam VIN yerine maskeli VIN saklanır. Kaydeden taraf, zaman ve içerik hash'i kaydedilir. Hash elektronik imza veya bağımsız güven damgası değildir.
- Her taraf yalnızca kendi teyidini verebilir. Teyitler aynı sürüm üzerinde, ayrı zamanlarla saklanır. İkinci aynı teyit yeni olay yaratmaz. İki teyit, tüm maddeler Evet olmasa da **bu kaydın iki tarafça teyit edildiğini** ifade eder; satışın tamamlandığını veya para ödendiğini göstermez.
- Düzeltme yeni sürüm oluşturur; önceki içerik ve teyitler geçmişte korunur, yeni sürümün teyitleri boş başlar. Eski sürümden kaydetme/teyit CONFLICT ile reddedilir. Arayüz yeni sürüm yüklendiğinde teyit kutusunu temizler. Otomatik kayıt yoktur; Yenile/kaydetmeden ayrılma kaydedilmemiş formu korumaz.
- Geçmiş 10 kayıtlık sayfalarda; en fazla 100 sürüm/satış, saatte 20 yeni sürüm. Limit sonrasında mevcut hazır sürüm teyit edilebilir; yeni sürüm yazılamaz. İçerik ve teyit silme/düzenleme API'si yoktur.

## Para ve çıktı sınırları

Teslim kaydı **tahsilat, rezervasyon serbest bırakma, satış tamamlama, temerrüt veya itiraz çözme başlatmaz**. Satıcının mevcut satış onayı ve mevcut itiraz blokajı korunur. Bu kaydı doldurmak mevcut satış onayının yeni bir ön şartı değildir; böyle bir ürün kuralı eklenmedi.

Ekran ve yazdırılabilir özet mevcut 30 CHF rezervasyon/ücret durumunu, sorgu zamanını ve yerel simülasyon işaretini açık gösterir. Ön provizyon, tahsil edilmiş ücret veya araç bedeli ödemesi diye sunulmaz. Durum alanı uygulamanın veritabanı kaydıdır; bu turda sağlayıcıdan doğrulanmadı.

Yazdır / PDF olarak kaydet düğmesi tarayıcının yazdırmasını açar. Yazdırma stilleri menüleri, düzenleme/teyit formlarını ve açılmış geçmişi gizler; güncel kayıt, teyit zamanları ve simülasyon açıklaması kalır. Üretilen metin özel teslim özetidir, resmî fatura/sözleşme veya elektronik imza değildir. İşletme bilgileri, faturalama politikası, imza/sözleşme niteliği, alıcının itiraz süresi ve tahsilat zamanı netleşmediği için bunlar uydurulmadı.

## Teknik korumalar

`202610280010_handover` migration'ı HandoverRevision tablosunu ve `(settlementId, version)` benzersiz indeksini oluşturur. Mutasyon kullanıcı ve mevcut satış işlemleriyle ortak araç kilidini alır. Yeni sürüm/teyit ile `handover.saved` / `handover.acknowledged` denetim olayı aynı transaction içinde yazılır. Eski sürümler üzerinden onay veya içerik değişikliği yapılamaz. Gösterim alıcı/satıcı rolüyle sınırlı tutulur; yazarın iç kullanıcı ID'si API gösterimine eklenmez. Admin tarafından başkası adına teyit yoktur.

Katı Zod şemaları, 12.000 bayt gerçek gövde sınırı, same-origin, güncel rol/askı kontrolü ve `private, no-store` kullanılır. Metinler React metni olarak gösterilir. Harici API, e-posta/SMS veya ödeme sağlayıcısı çağrısı eklenmedi.

## Sadece yeni alanlarda test kanıtı

- Dört yeni birim testi: bilinmeyen/değer sınırları, alan enjeksiyonu, eksik/olumsuz bulguyla teyit kuralları, İsviçre gece yarısı/yaz saati ve dört dil metinleri — geçti.
- İzole PostgreSQL: 21 migration, yetki sınırları, aynı sürüme eşzamanlı kayıttan yalnızca biri, bağımsız eşzamanlı teyitler, tekrar teyit idempotansı, sürüm değişince teyitlerin sıfırlanması ve geçmişin korunması, eski sürüm reddi, itiraz/kapalı satış blokajı, doğrulama/askı, kota ve geçmiş sayfalaması, HTTP origin/oturum/gövde sınırları — geçti. Test veritabanı kaldırıldı.
- Testte ödeme transaction sayısı sıfır kaldı, rezervasyon AUTHORIZED ve araç EXPIRED kaldı. Mevcut ihale/ödeme iş akışları çalıştırılmadan sentetik fixture kullanıldı. Migration/schema diff sıfır; typecheck geçti.
- Tarayıcı: admin salt okunur ekran; yerel satıcı yeni sürümü kaydetti ve teyit etti; ayrı yerel alıcı aynı sürümü teyit etti. Bilinmeyen kilometre, Hayır anahtar bulgusu ve açıklaması korundu. İki teyitten sonra satış AWAITING_CONFIRMATION ve rezervasyon AUTHORIZED olarak göründü.
- Form ve teyitli özet ayrı ayrı DE/FR/IT/EN × 360/390 px kontrol edildi; yatay taşma yok. Kanıtlar `.local/pm19-browser-checks.json`, `.local/pm19-handover-mobile.png`. Yazdırma CSS'i hazır; fiziksel yazıcı veya kaydedilmiş PDF'nin sayfa yerleşimi bu turda test edilmedi.
- Yerel deneme kaydı korundu: `/handover/23e88e3a-04d4-45db-a1d5-69a92aeee834`, araç “LOCAL TEST PM19 HANDOVER”. Veri gerçek teslim kanıtı değildir. Kaydın iki taraflı teyidi yalnızca sentetik senaryoya aittir.
- Eski galeri, giriş/kayıt, ihale, ödeme ve itiraz akışları baştan sona tekrarlanmadı; giriş yalnızca yeni ekranın rol testine hazırlık olarak kullanıldı. Production build, gerçek API ve uzak GitHub Actions çalıştırılmadı; push yapılmadı.

Hedefli komut: `pnpm test:handover`. CI'ya yalnızca yeni izole entegrasyon adımı eklendi. Sıradaki PM-20: ilan metadata/SEO ve özel/test sayfalarının indekslenmesini önleme; gerçek alan adı ve dil URL stratejisi ayrıca netleştirilecek.
