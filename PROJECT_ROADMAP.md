# AutoVeri — ürün incelemesi ve uygulama sırası

> PM-36 güncellemesi: güncel kapsam ve tek aktif kapanış listesi [LAUNCH_CLOSURE.md](LAUNCH_CLOSURE.md). Bu belgedeki önceki sıralama ve “sonraki öneri” notları tarihsel kayıttır; yeni görev yetkisi veya ikinci aktif kuyruk değildir.

İnceleme tarihi: 27 Ekim 2026. Başlangıç: `a19c90b`.

## Yönetici kararı

Mevcut ürün, yerelde kapsamlı şekilde çalıştırılmış bir MVP'dir. Canlı ödeme/SMS, operasyon ve veri koruma hazırlıkları tamamlanmış bir ticari hizmet olarak değerlendirilmemelidir. Ekran sayısından çok işlemin güvenle tamamlanması, kullanıcıların haberdar edilmesi ve satıcıların gerçek ilan vermesi önceliklidir.

Önerilen konumlandırma: İsviçre'deki özel satıcılara öncelik veren, kuralları açık, denetlenebilir araç açık artırması. Tüm rakip özelliklerini aynı anda kopyalamak yerine ilk gerçek satıcı ve alıcı grubunun başarılı satışlarını hedefleyelim. Yalnızca özel satıcı filtresi bir başlangıç tercihidir; mevcut üründe bayi hesapları da vardır. Pazarın arzını daraltan bu varsayılanın etkisi pilotta ölçülmeli.

## İncelemenin kapsamı ve sınırları

- Kod: Prisma modelleri; hesap, doğrulama, ilan, arama, yükleme, OCR, teklif, tahsilat, itiraz ve Socket.IO yolları; kullanıcı/admin ekranları; dört dil; proje dokümanları ve test düzeni.
- Önceki tarayıcı ve yerel ödeme testleri README'den kanıt olarak alındı; tekrar çalıştırılmadı. Tarihsel test başarısı yeni canlı entegrasyon testi sayılmaz.
- Rakiplerin kamuya açık resmî sayfaları incelendi. Üyelik arkasındaki akışlar, dönüşüm oranları, kullanıcı sayıları ve hizmet kalitesi bağımsız olarak doğrulanmadı. CARAUKTION ana sayfası kısmen JavaScript gerektirdi; yalnızca erişilen özellikler karşılaştırıldı.
- Bu inceleme penetrasyon testi, yük testi, hukuki görüş veya muhasebe onayı değildir. Bulgu ve öneri ayrımı aşağıdaki kayıtlarda korunmuştur.
- Mevcut `127.0.0.1:3000/admin` sekmesi veri yüklenemedi mesajı gösterdi. Kaynak kontrollerinin geçmesi bu çalışan ortamın sağlıklı olduğunu kanıtlamaz. Yetki/oturum, DB ve çalışan build eşleşmesi PM-06 kapsamında teşhis edilmeli; bu turda neden kesinleştirilmedi ve düzeltilmiş sayılmadı.

## Mevcut ve korunacak özellikler

| Alan | Mevcut durum / kanıt |
| --- | --- |
| Pazar yeri | Marka-model, fiyat/yıl/km, kanton, yakıt, şanzıman, tüketim, donanım ve diğer teknik filtreler; sunucuda filtreleme ve 24'lü sayfalama. `advanced-filters.tsx`, `market-query.ts`, `api/market/route.ts`. |
| İlan detayı | Çok fotoğraflı lisanslı örnekler, kaynak açıklamaları, büyük galeri, mobil kaydırma/yakınlaştırma, maskeli VIN ve durum etiketleri. Önceden test edildi. |
| Dil ve mobil | DE/FR/IT/EN, 360/390 px metin/hata kontrolleri, yerelleştirilmiş input/select/textarea hataları. Önceki kontroller korunacak. |
| Hesap / rol | Şifre hash'i, özel satıcı/bayi/admin rolleri, oturum sürümü, parola değişimi, tek kullanımlık kurtarma kodları, SMS adaptörü ve admin kimlik kontrolü. |
| Açık artırma | Kilitli teklif kabulü, tekrar isteğe karşı koruma, 7 gün, son 3 dakikada +2 dakika, kalıcı outbox ve yeniden bağlanma uzlaştırması. |
| Satış / itiraz | Kazanan seçimi, rezerv fiyat, satıcı onayı, admin temerrüt incelemesi, tahsilatı durduran itirazlar, iptal ve rezervasyon serbest bırakma. |
| Ödeme temeli | Stripe kart ön provizyonu adaptörü; tahsilat/serbest bırakma işleri, tekrar deneme, webhook ve yerel sahte ödeme modu. Gerçek sağlayıcı kabul testi eksik. |
| Sabit fiyat | Satın alma fiyatı ve satıcının kabul/red verebildiği teklifler. |
| İzlenebilirlik | Bazı admin kararları ve ödeme işlerinde denetim kayıtları var. Tam operasyon ekranı henüz yok. |

## Rakip karşılaştırması

| Rakip | Resmî sayfada doğrulanan yaklaşım | Bizim için sonuç |
| --- | --- | --- |
| AutoScout24 / Direct | İlan ile satıcıya satış seçeneklerini ayırıyor; Direct değer tahmini, teknik veri doldurma ve bayi teklifleri sunuyor. Sayfada ilan için CHF 59/14 günden başlayan, Direct için başarılı satışta CHF 149 fiyatı gösteriliyor. Bu fiyatlar farklı hizmetlerin fiyatlarıdır. | Bizim alıcıdan alınan CHF 30 tutarını bunlarla bire bir ucuzluk karşılaştırmasına sokmayalım. Satış türü, ödeyen kişi, hizmet kapsamı ve değer önerisi açık olmalı. Veri kaynağı olmadan fiyat tahmini üretmeyelim. |
| AutoScout24 Optimizer | Benzer ilanlar, piyasa konumlandırması; üst pakette fiyat analizi, geçmiş ve satış süresi gibi göstergeler. | Önce gerçek veriye dayalı basit görüntülenme/favori/teklif istatistikleri; lisanslı fiyat verisi sonradan. |
| CARAUKTION | Classic ve Direct modellerini ayırıyor; rezerv fiyat yaklaşımı farklı, Direct tarafında teklif ajanı tanıtılıyor. | Bizde kuralların açıklanması ve güvenilir kapanış öncelikli. Otomatik teklif ajanı sonraki aşama; gizli azami tutar ve eşitlik kuralları ayrıca tasarlanmalı. |
| Ricardo | Satıcı doğrulaması, satıcı değerlendirmeleri ve soru-cevap yaklaşımı; ücret ve koruma koşullarını ayrı açıklıyor. | Satıcı profili, gerçekleşmiş işlem değerlendirmesi ve güvenli soru-cevap eksik. Ricardo korumasının otomatik olarak araç alımına uygulanacağı varsayılmamalı; erişilen Käuferschutz+ sayfası paket teslimatı ve fiyat sınırı gibi koşullar koyuyor. |
| tutti.ch | Genel ilan keşfi ve mesajlar ana navigasyonda. | Alıcı ile satıcının görüşme ve teslim organizasyonu için platform içi bir iletişim yolu gerekli. İncelenen sayfa araç kategorisinde ücretsizliğin kapsamını doğrulamaya yetmediği için fiyat karşılaştırmasına katılmadı. |

## Tek öncelikli iş listesi

Durumlar: **Tamamlandı**, **Sıradaki**, **Bekliyor**, **Hazır / yayın bekliyor**, **Harici bağımlı**. P0 canlıya çıkış öncesi, P1 çekirdek ürün, P2 büyüme/ölçek. Sıra ürün değerine ve bağımlılıklara göre seçildi; tüm P0 işleri bitmeden gerçek para ile açılış önerilmiyor.

| Sıra / ID | Öncelik, durum | Bulgu ve kanıt | Uygulama / kabul ölçütü | Harici ihtiyaç |
| --- | --- | --- | --- | --- |
| 1 / PM-01 | P0, Tamamlandı | Ücret/rezervasyon açıklamaları farklı ekranlara dağılmış; mekanik kontrol ile hesap doğrulaması kolay karışıyor. | `/help`: dört dilde 7 konu, 30 CHF ile araç bedelinin ayrımı, kart/sağlayıcı sınırları, yenileme, itiraz/gerçek iade ayrımı; menü/altbilgi/ana sayfadan erişim. Yalnızca yeni sayfa ve bağlantıları kontrol et. | Yok; hukuki metin yerine geçmez. |
| 2 / PM-02 | P0, Tamamlandı | Önceki yükleyicide sahiplik/kota/EXIF arındırma modeli yoktu ve ilan API'si HTTPS URL kabul ediyordu. | MediaAsset sahipliği, atomik ilan bağlantısı, kilitli kotalar, decode/re-encode, EXIF/GPS temizliği, özel bekleyen dosyalar ve yeniden denenebilir sahipsiz dosya temizliği eklendi. Hedefli testler geçti; ayrıntılar uygulama günlüğünde. | Canlı kalıcı depolama sağlayıcısı ayrı hazırlık olarak duruyor. |
| 3 / PM-03 | P0, Hazır / yayın bekliyor | Dört dilli taslaklar, iletişim alanları ve immutable sürüm/onay kayıtları hazır. | `/privacy`, `/terms`, `/contact`, `/legal/accept`; yeni işlemlerde sürüm kontrolü, geçmiş metin/hash/dil/zaman kaydı. 5 birim, 7 hedefli DB/HTTP grubu ve yeni ekran kontrolleri geçti. Ayrıntılar LEGAL_READINESS.md içinde. | İşletme/sağlayıcılar belirsiz; destek/iade/saklama politikaları sonra belirlenecek. Gerçek yayın yapılmadı. |
| 4 / PM-04 | P0, Yerel uygulama tamamlandı; gerçek gönderim bekliyor | E-posta doğrulama/kurtarma, admin parola + tek kullanımlık e-posta kodu ve +423 biçim desteği eklendi. | Süreli ve tek kullanımlık hashli kodlar, istek/deneme sınırları, authVersion iptali; yalnızca loopback development mesaj kutusu. 9 hedefli güvenlik grubu, typecheck ve dört dil mobil yeni alan kontrolleri geçti. ACCOUNT_SECURITY.md kullanım ve kapsamı açıklar. | Gerçek e-posta sağlayıcısı/alan adı doğrulaması, +423 SMS teslimi ve üretim admin faktörünün operasyonel kabulü. TOTP/passkey kapsamda değil. |
| 5 / PM-05 | P0, Yerel sınırlar tamamlandı; gerçek kabul bekliyor | Yerel/gerçek sağlayıcı izolasyonu, kesin ret için FAILED durumu, Twilio hata/yanıt doğrulaması ve imza sınırları güçlendirildi. | 9 yeni birim/sınır testi + 1 izole DB grubu; yalnızca değişen adaptörler kontrol edildi. PROVIDER_READINESS.md tamamlanan/harici/bekleyen işleri ayırır. Eski ihale ve satış akışları tekrar çalıştırılmadı. | Stripe/Twilio test ve canlı kabulü, işletme/muhasebe/iade politikası. Stripe TWINT manuel capture desteklemediğinden mevcut ön provizyon modeliyle kullanılamaz; alternatif karar gerekiyor. |
| 6 / PM-06 | P0, Yerel işletim hazır; harici operasyon bekliyor | Liveness/readiness, atomik worker durumu/hata sayacı ve admin kuyruk ölçümleri; yerel pg_dump+medya manifesti ve güvenli boş hedef restore komutları eklendi. | 4 yeni birim + 4 izole DB/restore grubu ve typecheck geçti. Sıra korunarak worker turu takibi, takılma/kapanış, sentetik restore ve checksum/overwrite koruması doğrulandı. OPERATIONS.md komutları ve sınırları açıklar. Eski iş akışları tekrarlanmadı. | Dış alarm/log toplama, zamanlama/retention, offsite şifreli yedek, RPO/RTO ve hosting kararları. Tek instance desteklenir; Redis/lease/merkezi izleme yok. |
| 7 / PM-07 | P0, yerel kontroller geçti; GitHub Actions doğrulaması izleniyor | Next/React, Zod ve Prisma 7.10.1 geçişi tamamlandı; audit 0 bildirim. Development ve ayrı salt okunur production açılışı geçti. | Hedefli kanıtlar NEXT16_MIGRATION.md, ZOD4_MIGRATION.md ve PRISMA7_MIGRATION.md. Uzak CI sonucu ilgili GitHub commit kontrollerinden izlenir. | Gerçek API/hosting kabulü ayrı. PM-08 uygulama içi kapsam tamamlandı; PM-09 yerel kapsam tamamlandı; PM-10 yerel kapsam tamamlandı; PM-11 yerel kapsam tamamlandı; PM-12 yerel kapsam tamamlandı (teklifsiz yeniden yayın); PM-13 yerel kapsam tamamlandı; PM-14 yerel kapsam tamamlandı; PM-15 yerel kapsam tamamlandı; PM-16 yerel şehir/posta kodu kapsamı tamamlandı; PM-17 yerel moderasyon/değerlendirme kapsamı tamamlandı; PM-18 yerel admin kuyrukları tamamlandı; PM-19 yerel teslim kaydı hazır (hukuki belge/ücret makbuzu ayrı); PM-20 yerel SEO hazırlığı tamamlandı; PM-21 yerel arama performansı tamamlandı; PM-22 yerel satıcı istatistikleri tamamlandı; PM-23 yerel kaynak/düzeltme kapsamı tamamlandı; PM-24 yerel bayi/CSV kapsamı tamamlandı; PM-25A yerel randevu/takvim kapsamı tamamlandı; PM-25B yerel PWA hazırlığı tamamlandı; PM-25C yerel otomatik teklif simülasyonu tamamlandı; PM-25D izole yerel motor tamamlandı; PM-25E yerel hesap/HTTP/ekran bağlantısı tamamlandı; PM-25F kapanış yaşam döngüsü tamamlandı; gerçek entegrasyon/push kapsamı bekliyor; bütün PM serisi tamamlanmış değildir. |
| 7A / PM-07A | P0, Kaynak yükseltmesi tamamlandı | Next 14.2.35 → 16.4.3 aktif LTS; React 19.3.1. Promised params/searchParams, React ref/JSX ve Webpack/typegen uyumu sağlandı. | 3 yeni unit + 3 dar HTTP/socket grubu, React hydration/form smoke, build, typecheck/frozen install geçti. DB ve business worker kapalıydı; eski akışlar tekrarlanmadı. | Audit 28→3; critical 3→0. Mevcut çalışan kullanıcı sunucusu yeniden başlatılmalı; production deployment yapılmadı. |
| 8 / PM-08 | P1, Uygulama içi kapsam tamamlandı | Kalıcı kutu, zil/sayaç, okunmamış filtresi, sayfalama, okunma zamanı ve DE/FR/IT/EN; olaylarla atomik ve tekrarsız kayıt. | 2 yeni unit, izole bildirim DB/API testleri, typecheck ve yeni kutunun tarayıcı kontrolü geçti. Ayrıntılar NOTIFICATIONS.md. Eski kullanıcı akışları tekrarlanmadı. | E-posta/SMS/push ayrı sağlayıcı kapsamı; saklama politikası bekliyor. PM-09 yerel kapsam tamamlandı; PM-10 yerel kapsam tamamlandı; PM-11 yerel kapsam tamamlandı; PM-12 yerel kapsam tamamlandı (teklifsiz yeniden yayın); PM-13 yerel kapsam tamamlandı; PM-14 yerel kapsam tamamlandı; PM-15 yerel kapsam tamamlandı; PM-16 yerel şehir/posta kodu kapsamı tamamlandı; PM-17 yerel kapsam tamamlandı; PM-18 yerel kapsam tamamlandı; PM-19 yerel teslim kaydı hazır; PM-20 yerel SEO hazırlığı tamamlandı; PM-21 yerel arama performansı tamamlandı; PM-22 yerel satıcı istatistikleri tamamlandı; PM-23 yerel kaynak/düzeltme kapsamı tamamlandı; PM-24 yerel bayi/CSV kapsamı tamamlandı; PM-25A yerel randevu/takvim kapsamı tamamlandı; PM-25B yerel PWA hazırlığı tamamlandı; PM-25C yerel otomatik teklif simülasyonu tamamlandı; PM-25D izole yerel motor tamamlandı; PM-25E yerel hesap/HTTP/ekran bağlantısı tamamlandı; PM-25F kapanış yaşam döngüsü tamamlandı; gerçek entegrasyon/push kapsamı bekliyor. |
| 9 / PM-09 | P1, Yerel kapsam tamamlandı | İlan bazlı özel mesajlaşma, satış sonrası taraf erişimi, randevu öner/kabul/ret/iptal, çift yönlü engel ve admin rapor inceleme; DE/FR/IT/EN. | Yeni birim ve izole DB/API testleri, typecheck ve yalnızca yeni ekran kontrolleri. Kapsam/sınırlar MESSAGING.md. Eski satış/ihale akışları tekrarlanmadı. | Moderasyon operasyonu ve veri saklama politikası; harici takvim/e-posta ayrı. |
| 10 / PM-10 | P1, Yerel kapsam tamamlandı | Hesaba özel manuel taslak kaydı, devam, özel önizleme ve onay öncesi geri çek/düzenle/yeniden gönder; DE/FR/IT/EN. Aktif/teklifli ilanlar kilitli, fotoğraf sahipliği ve revizyon kontrolü korunur. | 2 yeni unit, izole DB/API, kota/eşzamanlılık, typecheck ve yeni ekranların tarayıcı kontrolleri geçti. Ayrıntılar LISTING_DRAFTS.md. Eski akışlar tekrarlanmadı. | Otomatik taslak saklama süresi işletme politikası olarak bekliyor; harici API gerekmiyor. |
| 11 / PM-11 | P1, Yerel kapsam tamamlandı | MFK bilinmiyor/henüz yok, ayrı model yılı, hasar açıklaması ve EV/plug-in pil sağlığı; DE/FR/IT/EN. Eksik değerler MFK/model yılı/SoH filtrelerini karşılamaz. | 4 yeni unit, izole migration/DB/filtre testleri, typecheck ve yalnızca yeni alanların dört dilde tarayıcı kontrolü geçti. VEHICLE_DISCLOSURES.md. | Resmî araç kataloğu ve bağımsız beyan doğrulaması lisanslı kaynak/operasyon gerektirir. |
| 12 / PM-12 | P1, Yerel kapsam tamamlandı; yeniden yayın teklifsiz ilanlarla sınırlı | Ayrı REJECTED durumu, gerekçe/kategori listesi, düzeltip yeniden gönderme ve özel sürüm kayıtları; DE/FR/IT/EN. Süresi dolan, teklif/rezervasyon/satış kaydı olmayan ilan yeni onayla açılır. | 2 yeni unit, izole DB/yetki/sürüm/yeniden inceleme testleri, typecheck ve yeni tarayıcı ekranları geçti. LISTING_REVISIONS.md. | Geçmiş işlemli ilanı yeni ilan kimliğiyle tekrar yayınlama ayrı tasarım; mevcut geçmiş değiştirilmez. Eski CANCELLED kayıtları varsayımla dönüştürülmez. |
| 13 / PM-13 | P1, Yerel kapsam tamamlandı | Hesaba bağlı DB favorileri, açık misafir birleştirmesi, 200 kayıt kotası ve DE/FR/IT/EN; kapalı ilan gösterimi korundu. | 2 yeni unit, izole DB/API ve typecheck geçti; tarayıcıda hesap kaydı/yenileme/kaldırma ve dört dil kontrol edildi. ACCOUNT_FAVORITES.md. | Toplu aktarım DB testinde doğrulandı; tarayıcıdaki önceki misafir verileri korundu. İkinci fiziksel cihaz testi yapılmadı. |
| 14 / PM-14 | P1, Yerel kapsam tamamlandı | Paylaşılabilir filtre URL, geri/ileri koruma, hesaba bağlı 20 isimli arama ve isteğe bağlı uygulama içi eşleşme bildirimi; DE/FR/IT/EN. | 3 yeni unit, izole DB/API ve typecheck geçti. Tarayıcıda kaydetme/yenileme/uygulama/silme ve dört dil × 360/390 px geçti. SAVED_SEARCHES.md. | Periyodik mevcut durum taraması; e-posta/SMS/push yok. Üretim yük testi ayrı. |
| 15 / PM-15 | P1, Yerel kapsam tamamlandı | En fazla 3 araç, tarayıcıda korunan seçim ve dört dilde /compare; 42 bilgi satırı, açık bilinmeyen değerler, mobil yatay tablo. | 4 yeni unit ve typecheck geçti. Tarayıcı seçim/yenileme/detaydan kaldırma/temizleme; dört dil × 360/390 px kontrol edildi. VEHICLE_COMPARISON.md. | Hesaplar/cihazlar arası seçim eşitlemesi yok; 15 saniyelik veri yenileme. Fiziksel telefon testi yapılmadı. |
| 16 / PM-16 | P1, Yerel şehir/posta kodu kapsamı tamamlandı | Şehir/posta kodu giriş, taslak/önizleme/düzenleme, public DTO ve dört dilde konum filtreleri. Tam adres alanı eklenmez. | 3 yeni unit, izole DB alan/veri temizleme/SQL-favori eşlik testi ve typecheck geçti. Yeni alanlar ve filtreler dört dil × 360/390 px kontrol edildi. VEHICLE_LOCATION.md. | Harita/koordinat/mesafe/yarıçap ayrı: doğrulanmış ve lisansı uygun veri seti veya coğrafi kodlama sağlayıcısı gerekir. Konum satıcı beyanıdır. |
| 17 / PM-17 | P1, Yerel kapsam tamamlandı | İlan şikâyeti, tamamlanmış satış değerlendirmesi, tek cevap/itiraz, admin karar kaydı ve ilan içinde satıcı puanı; dört dil. | 3 yeni unit, izole DB/API testleri, typecheck, yeni formlarda DE/FR/IT/EN × 360/390 px geçti. Ayrıntılar TRUST_AND_MODERATION.md. | Otomatik yaptırım/para hareketi yok; tam profil sayfası ayrı. Operatör politikası bekliyor. |
| 18 / PM-18 | P1, Yerel admin kapsamı tamamlandı | Altı yönetim kuyruğunda 20 kayıtlık sayfalar, arama/durum/UTC tarih filtreleri, kayıt yaşı, üstlenme/bırakma ve operatör geçmişi dört dilde hazır. | 4 yeni unit, altı kuyruk × 105 kayıtlı izole DB/API testi, typecheck, tarayıcı filtre/atama/detay/sayfa ve DE/FR/IT/EN × 360/390 px geçti. ADMIN_QUEUES.md. | Kayıt yaşı oluşturulmadan ölçülür; durum bazlı SLA değildir. Atama karar/para yetkisi vermez. Kullanıcı garajının genel liste ölçeklemesi ayrı kapsam. |
| 19 / PM-19 | P1, Yerel teslim kaydı hazır; hukuki/ücret belgesi bekliyor | Ortak kontrol listesi, sürümlü alıcı/satıcı teyidi, geçmiş ve yazdırılabilir özel özet dört dilde hazır. Bilinmeyenler açık; teyit tahsilat yapmaz. | 4 yeni unit, izole DB/API, typecheck; tarayıcıda iki tarafın aynı sürümü teyidi ve DE/FR/IT/EN × 360/390 px geçti. HANDOVER.md. Fiziksel/PDF çıktı sayfa yerleşimi ayrıca doğrulanacak. | Resmî işletme bilgileri, fatura/sözleşme/imza politikası, alıcı itiraz süresi ve tahsilat koşulları bekliyor. Mevcut ödeme kuralı değiştirilmedi. |
| 20 / PM-20 | P1, Yerel teknik kapsam tamamlandı | Dört dil URL/metadata, sunucu ilan içeriği, canonical/hreflang, OG, bölünmüş sitemap ve noindex sınırları hazır. | 4 unit, 1.001 ilanlı izole DB/sitemap, dört dil HTTP, mobil dil geçişi ve typecheck. Ayrıntılar SEO_READINESS.md. | Canlı alan adı ve yayın onayı bekliyor; indeksleme kapalı. Gerçek bot/sosyal önizleme kabulü ayrı. |
| 21 / PM-21 | P2, Yerel kapsam tamamlandı | Parametreli SQL sıralama/sayfalama; sayfa/count/detay için tutarlı snapshot; mevcut filtre anlamı korunur. | 378 eşdeğerlik karşılaştırması, 2 unit, izole HTTP/eşzamanlılık ve 20.000 kayıtla plan/ölçüm; typecheck geçti. MARKET_SEARCH.md. | Üretim hedef hacmi/eşzamanlı trafik ve çoklu worker/Socket.IO ayrı; derin OFFSET ve count maliyeti sürüyor. |
| 22 / PM-22 | P2, Yerel kapsam tamamlandı | Dört dilli özel satıcı istatistikleri: günlük tekilleştirilmiş yerel görüntülenme, mevcut favori ve yeni iletişim toplamları. | 2 unit, izole DB/HTTP/gizlilik/kota/temizlik; 360/390 px dört dil ve yeni görüntülenme→satıcı ekranı kontrolü. LISTING_STATISTICS.md. | Canlı analitik/saklama kararı bekliyor; production görüntülenme toplama kapalı. Global huni/kohort dönüşüm oranı ayrı. |
| 23 / PM-23 | P2, Yerel kaynak/düzeltme kapsamı tamamlandı | Dört dilli kaynak/tarih/doğrulama kartı; satıcı beyanı ve adminin gerçek alan düzeltmesi ayrımı; bilinmeyen geçmiş korunur. | 3 unit, izole DB/kaynak snapshot testleri, typecheck; yeni kart ve form açıklaması 360/390 px dört dil. VEHICLE_DATA_ORIGIN.md. | Değerleme, model-yıl ve standart donanım doğrulaması lisanslı API bekliyor. |
| 24 / PM-24 | P2, Yerel bayi/CSV kapsamı tamamlandı | Açık yayın seçimiyle bayi profili, aktif stok vitrini; CSV önizleme/hata raporu ve özel taslak aktarımı, rol/kota/tekrar koruması, dört dil. | 3 unit, izole DB/API/migration, typecheck ve yeni ekranlarda 360/390 px dört dil tarayıcı kontrolleri geçti. DEALER_INVENTORY.md. | Gerçek sicil doğrulaması, abonelik ve harici stok/fotoğraf entegrasyonu ayrı; şirket doğrulanmış gibi gösterilmez. |
| 25 / PM-25 | P2, PM-25A/B/C/D/E/F/G/H/I/J yerel kapsam tamamlandı | Kabul edilmiş randevulara tek uygulama içi hatırlatma, özel ICS indirme ve dört dil hazır. PWA kurulum/çevrimdışı ekran hazır; gerçek cihaz/HTTPS kabulü, push ve teklif ajanı ayrı. | PM-25A: 3 unit, izole DB/API, typecheck, yeni alanlarda 360/390 px dört dil, tarayıcıdan indirme ve worker bildirimi geçti. APPOINTMENT_REMINDERS.md. PM-25B: dört unit, yerel HTTP, gerçek ağ kesintisi ve 360/390 px dört dil geçti; PWA_READINESS.md. PM-25C: saf simülatör, 5 test ve 360/390 px dört dil geçti; PROXY_BIDDING_PROPOSAL.md. PM-25D: ayrı limit/hold/komut/olay modeli, atomik motor, eşzamanlılık ve rollback testleri geçti; LOCAL_PROXY_ENGINE.md. PM-25E: hesap eşlemesi, HTTP yetkilendirme ve dört dilde limit/rezervasyon ekranı geçti; LOCAL_PROXY_WORKSPACE.md. PM-25F kapanış/iptal/release ve worker tamamlandı; LOCAL_PROXY_LIFECYCLE.md. PM-25G yerel yenileme, satış teyidi ve tek sahte tahsilat tamamlandı; LOCAL_PROXY_SALE.md. PM-25H gerekçeli talep, admin kararı ve tek sahte iade tamamlandı; LOCAL_PROXY_REFUND.md. PM-25I admin ödeme defteri, toplamlar ve tutarlılık denetimi tamamlandı; 4 unit, izole DB/HTTP, typecheck ve yeni raporda dört dil 360/390 px geçti; LOCAL_PROXY_LEDGER.md. PM-25J UTC tarih/sorun filtreleri, filtreli toplamlar ve güvenli dört dil CSV tamamlandı; 4 yeni unit, typecheck, tarayıcıdan indirme ve 360/390 px kontrolleri geçti; LOCAL_PROXY_LEDGER_EXPORT.md. PM-26 karar matrisi hazır; açık yayın koşulları GO_LIVE_MATRIX.md içinde izlenir. | Harici takvim eşitleme/push teslimi yok. Otomatik teklifin kuralları ürün kararı bekliyor. |
| 26 / PM-26 | P0, Karar matrisi tamamlandı; canlı yayın hazır değil | Tek açık yayın listesi: işletme/politika, kart sağlayıcı kabulü, gerçek e-posta/iade boşlukları, operasyon ve ertelenen otomatik teklif kuralları. | GO_LIVE_MATRIX.md. Kullanıcı kararı: ilk canlı sürüm kart + manuel teklif; otomatik teklif/TWINT kapalı. Yalnızca belge/kaynak incelemesi; eski testler ve gerçek API çalıştırılmadı. PM-26A destek/iade/sınırlı saklama kararları kaydedildi; PM-26B dört dil yayımlanmamış taslak ve koruma planı hazır (RETENTION_PROTECTION_PLAN.md). PM-26C dört dil yerel admin saklama envanteri hazır (RETENTION_INVENTORY.md); 3 yeni unit, izole DB/handler, typecheck ve yeni mobil ekran kontrolü geçti. PM-26D onaylı son etkinlik/koruma kuralları ve salt okunur mesaj aday önizlemesi tamamlandı (RETENTION_MESSAGE_PREVIEW.md); PM-26E gerekçeli manuel koruma ve inceleme kuyruğu tamamlandı (RETENTION_MANUAL_PROTECTION.md); PM-26F üç karar onaylandı; PM-26G yerel kanıtlı iki admin koruma kaldırma tamamlandı (RETENTION_REVIEW.md); PM-26H admin kuyruğu/uygulama içi bildirim tamamlandı (RETENTION_ROUTING.md); işletme/sağlayıcı ve işlem/uyuşmazlık süreleri açık. | İşletme verileri, sağlayıcı seçimi, test ortamı ve ayrıca yetkilendirilecek canlı kabul hâlâ bekliyor. |

## Önerilen uygulama yöntemi

1. Her turda tek ID: kapsam, veri etkisi, kabul ölçütü, ilgili testler ve sonuç kaydedilir.
2. Durum değişmedikçe bitmiş galeri/mobil/ihale senaryoları tekrarlanmaz. Ortak bileşen ya da para/rol mantığı değişirse ilgili regresyon grubu gerekçesiyle seçilir.
3. API gerektirmeyen altyapı ve ekranlar yerelde tamamlanır. Dış servisin başarılı çalıştığı sahte sonuçla ilan edilmez.
4. Yeni ücret/ceza, hukuki metin, harici iletişim ve canlı para hareketi otomatik varsayılmaz. Gerçek işletme/sağlayıcı bilgileri gereken aşamada istenir.
5. Kaynak kodu için önce yerelde değişiklik ve hedefli test; ardından yetkili push ve ilgili commit'in GitHub Actions sonuçları. Yerel başarı uzak CI başarısı sayılmaz.

## Pilot başarı ölçümleri

Başlangıçta gerçek veri toplanacak; bugün ölçülmüş dönüşüm/gelir sayıları yoktur.

- İlanı başlatan → incelemeye gönderen → onaylanan oranı; her aşamada kayıp nedeni.
- Onay bekleme süresi, teklif alan ilan oranı, rezervi geçen ihale oranı.
- Kazanan → teslim edilen → ücret tahsil edilen satış oranı; aşama süreleri.
- İtiraz/temerrüt oranı, rezervasyon yenileme ve serbest bırakma başarısızlığı, bekleyen iş yaşı.
- Özel satıcı arzı, nitelikli alıcı ve araç başına teklif; varsayılan özel satıcı filtresinin sonucu daraltması.
- Başarıyla tamamlanan satış başına gerçek net katkı: tahsilat eksi sağlayıcı, SMS, destek, iade ve pazarlama maliyetleri. CHF 30'un yeterli olduğu henüz doğrulanmış değil.

## Kaynaklar

27 Ekim 2026'da erişilen resmî kaynaklar. Özellik/fiyatlar değişebilir; tahmin ve rakip pazarlama iddiaları bağımsız ölçüm değildir.

- [AutoScout24 Direct: satış modeli ve gösterilen fiyatlar](https://www.autoscout24.ch/de/direct)
- [AutoScout24 Optimizer: ürün kapsamı](https://help.autoscout24.ch/hc/de/articles/34454285509778-Was-ist-der-Optimizer)
- [CARAUKTION: Classic / Direct ve teklif ajanı](https://www.carauktion.ch/)
- [Ricardo: satıcı olma ve doğrulama](https://help.ricardo.ch/hc/de/articles/115003832545-Wie-werde-ich-zum-Ricardo-Verk%C3%A4ufer)
- [Ricardo: satıcı değerlendirmeleri ve sorular](https://help.ricardo.ch/hc/en-ch/articles/115002928645-Wie-sehe-ich-ob-ein-e-Verk%C3%A4ufer-in-vertrauensw%C3%BCrdig-ist)
- [Ricardo: ücret kapsamı](https://help.ricardo.ch/hc/de/articles/115002854885-Was-kostet-das-Verkaufen-auf-Ricardo)
- [Ricardo: Käuferschutz+ koşulları](https://help.ricardo.ch/hc/de/articles/11706288346780-Was-sind-die-Bedingungen-f%C3%BCr-K%C3%A4uferschutz)
- [tutti.ch: ilan keşfi ve mesajlar](https://www.tutti.ch/de)
- [İsviçre FDPIC: internet gizlilik açıklamalarında açıklık, dil ve erişim](https://www.edoeb.admin.ch/en/privacy-statements-on-the-internet)

## Uygulama günlüğü

### PM-01 — 27 Ekim 2026

- Dört dilli `/help` eklendi. Üst/alt navigasyon ve ana sayfadaki süreç alanından erişiliyor.
- Gerçek araç bedeli, CHF 30 ön provizyon, yenileme, serbest bırakma, satıcı onayı, itiraz, gerçek iade ve telafi ödemesi ayrı açıklandı.
- Telefon/kimlik kontrolünün mekanik ekspertiz veya mülkiyet kanıtı olmadığı, örnek ve yerel testlerin canlı hizmet kanıtı olmadığı belirtildi.
- Kabul kontrolü geçti: typecheck; dört dil anahtar/değişken eşleşmesi; yeni sayfada DE/FR/IT/EN × 360/390 px. Her kombinasyonda 7 konu, sıfır eksik bağlantı hedefi, sıfır kesilen metin ve sıfır yatay taşma. Konu bağlantısı ve mobil menüden dönüş doğrulandı.
- Görsel kontrol, mevcut 3000 sunucusuna dokunmadan `127.0.0.1:3101` üzerinde izole Next geliştirme önizlemesinde yapıldı. Kanıtlar: `artifacts/pm-01-help-checks.json`, `artifacts/pm-01-help-mobile.png` (yerel, Git dışında).
- Tamamlanmış ihale/ödeme/galeri senaryoları tekrarlanmadı. Canlı sağlayıcı işlemi yapılmadı. Sıradaki geliştirme PM-02; mevcut ortam hatası PM-06 altında açık kayıt olarak duruyor.

### PM-02 — 27 Ekim 2026

- `MediaAsset` migration'ı yerel `autoveri` veritabanına uygulandı. Yükleyenin sahipliği ve dosyanın bağlandığı ilan ayrı tutuluyor. İlan yaratılırken kullanıcı satırı kilitleniyor; yalnızca kendisine ait, READY, süresi geçmemiş ve başka ilana bağlanmamış dosyalar atomik olarak bağlanıyor. Dış URL, tekrarlı fotoğraf ve başka kullanıcının dosyası reddediliyor.
- Kaynak sınırı: tek dosya 5 MB; multipart gövde 5.1 MB (başlığa güvenmeden akış sınırı); JPEG/PNG gerçek decode; 40 megapiksel ve kenar başına 12.000 piksel. Sharp işlemi 10 saniye ile sınırlı; süreç başına en fazla iki eşzamanlı işleme.
- EXIF yönü piksellere uygulanıyor; EXIF/GPS/XMP/IPTC/ICC korunmadan sRGB JPEG yeniden kodlanıyor. En uzun kenar en fazla 4096 piksel; küçük fotoğraf büyütülmüyor; şeffaf PNG beyaz zemine işleniyor. Orijinal dosya saklanmıyor. Bu garanti yeni yüklemeler içindir; eski bağlı fotoğraflar bu turda yeniden işlenmedi.
- Kullanıcı kotası: en fazla 24 bağlanmamış dosya / 60 MB; toplam 120 dosya / 300 MB. İşlem sürerken 5 MB rezervasyon sayılıyor. Sayı ve bayt kotaları eşzamanlı isteklerde aynı DB kilidiyle korunuyor. İlan başına 12 fotoğraf korunuyor.
- Bekleyen fotoğrafı sahibi okuyabilir; admin, bağlı inceleme ilanının fotoğrafını görebilir. Anonim ve ilgisiz kullanıcı 404 alır. Yayınlanmış/kapanmış ilan fotoğrafları herkese açık; özel yanıtlar `no-store`, herkese açık yanıtlar yeniden doğrulamalı.
- READY ama bağlanmamış dosya 24 saatten sonra, STAGING dosya 1 saatten sonra temizliğe uygun. DELETING durumunda disk hataları tekrar deneniyor. Saatlik iş her seferinde en fazla 100 kayıt ve 100 kayıtsız dosyayı işler. Yalnızca upload dizininin kökündeki UUID adlı JPG/PNG normal dosyalar değerlendirilir; klasörler/sembolik bağlantılar/diğer dosyalar taranıp silinmez. Bir ilanda referansı bulunan eski kayıtsız dosya da korunur.
- Manuel komut `pnpm media:cleanup` yalnızca dry-run; `pnpm media:cleanup -- --apply` dosyaları siler. Geçmiş ilanlardan dosya sahipliği tahmin edilmez. Eski kayıtsız fotoğraf yeni ilana sahiplik kanıtı olmadan taşınamaz.
- Ön yüz başarısız kota/yoğunluk nedenini dört dilde gösterir; süresi dolan bekleyen yüklemeyi yeniden gönderir. Daha önce tamamlanan akışlar yeniden oynatılmadı.
- Testler: 6 fotoğraf/multipart birim testi; izole `_test` PostgreSQL ve geçici dizinde 9 medya entegrasyon grubu (HTTP upload/read/origin/session dahil); typecheck; dört dil anahtar/değişken eşleşmesi. Test verisi ve geçici dosyalar kaldırıldı. Mevcut genel entegrasyon fixture'ları yeni sahiplik sözleşmesine uyarlandı, bu eski senaryolar tekrar çalıştırılmadı.

### PM-03 — 27 Ekim 2026

- Teknik hazırlık ve yalnızca yeni alanların kontrolleri tamamlandı. Dört dilde belgeler işletme bilgileri netleşmediği için TASLAK kaldı; gerçek hukuki yayın/kabul oluşturulmadı.
- Kullanıcı kararı: 18+, İsviçre/Lihtenştayn; kazanan alıcıdan 30 CHF; onaylanmış temerrütte 30 CHF satıcıya aktarılmadan işletmede hizmet bedeli olarak kalır.
- Yayın/kabul modeli, ayrı gizlilik bilgilendirmesi, eski sürüm/hash/dil/zaman kaydı ve yeni işlemlerde tekrar kabul koruması eklendi. Gerçek işletme ve sağlayıcılar, destek/iade ve saklama politikaları sonradan tamamlanacak.
- Ayrıntılı veri ve yayın kontrol listesi: [LEGAL_READINESS.md](LEGAL_READINESS.md).

PM-26H: [yerel inceleme kuyruğu ve bildirimler](RETENTION_ROUTING.md) tamamlandı. İki admin kuralı korunur; silme kapalıdır. Sonraki öneri PM-27: dört dilde uygulama içi destek talebi ve yanıt takibi; gerçek API olmadan.

PM-27 tamamlandı: dört dilde [destek talepleri, admin yanıtı ve durum geçmişi](SUPPORT_REQUESTS.md). Saklama süresi belirsiz, silme ve gerçek API yok. Sonraki öneri PM-28: sorumlu admin, okunmamış yanıt ve uygulama içi bildirim bağlantıları.

PM-28 tamamlandı: [destek ataması, kullanıcıya özel okunmamış yanıtlar ve dört dilde bildirimler](SUPPORT_ROUTING.md). Belirsiz süreler korunur; silme/gerçek API yok. Sonraki öneri PM-29: atanmış/atanmamış/okunmamış filtreleri ve destek araması.

PM-29 tamamlandı: [destek kuyruğu arama ve filtreleri](SUPPORT_SEARCH.md). Gerçek API veya yeni süre yok. Sonraki öneri PM-30: filtreleri URL ile koruma ve geri/ileri gezinme.

PM-30 tamamlandı: [URL ile destek filtreleri ve gezinme](SUPPORT_NAVIGATION.md). Yeni süre, silme veya gerçek API yok. Sonraki öneri PM-31: gönderilmemiş destek yanıtı/atama gerekçesi için ayrılma uyarısı.

## PM-31 — Destek taslağı koruması

Dört dilde ayrılma uyarısı, bağlantı/çıkış ve destek gezinmesi koruması eklendi. Yerel hedefli kontroller ve tarayıcı sınırları: [SUPPORT_DRAFT_GUARD.md](SUPPORT_DRAFT_GUARD.md). Sonraki öneri PM-32: sürüm çakışmasında taslağı koruyarak güncel talebi inceleme.

## PM-32 — Destek çakışması inceleme

Dört dilde taslağı koruyarak güncel talebi yükleme ve açık inceleme onayı eklendi. Kapsam ve hedefli test sonuçları: [SUPPORT_CONFLICT_REVIEW.md](SUPPORT_CONFLICT_REVIEW.md). Sonraki öneri PM-33: uzun konuşmalarda taslağı koruyarak geçmiş inceleme.

## PM-33 — Taslağı koruyan destek geçmişi

Dört dilde ayrı geçmiş inceleme penceresi, 30 mesajlık sayfalama ve taslağa dönüş eklendi. Kapsam ve hedefli test sonuçları: [SUPPORT_HISTORY.md](SUPPORT_HISTORY.md). Sonraki öneri PM-34: konuşma içi arama ve tarih filtresi.

## PM-34 — Destek mesajlarında arama

Dört dilde konuşma içi metin/tarih filtresi, bağlama geçiş ve sonuçlara dönüş eklendi. Kapsam ve testler: [SUPPORT_HISTORY_SEARCH.md](SUPPORT_HISTORY_SEARCH.md). Sonraki öneri PM-35: yetki kontrollü doğrudan mesaj bağlantısı.

## PM-35 — Yetki kontrollü mesaj bağlantıları

Dört dilde doğrudan mesaj bağlantısı ve hedef vurgusu tamamlandı. Kapsam ve hedefli testler: [SUPPORT_MESSAGE_LINKS.md](SUPPORT_MESSAGE_LINKS.md). PM-35 dahil 35 ana başlık vardır; harfli alt maddeler ayrıca sayılır, önceden sabitlenmiş bir son PM sayısı yoktur. Sonraki öneri PM-36: yeni küçük özellikler yerine kapsamı sabitleme ve zorunlu canlıya çıkış kapanış listesini oluşturma.

## PM-36 — Kapsam sabitleme

Tamamlandı (belge kapsamı): 19 zorunlu açık iş grubu tek [kapanış listesinde](LAUNCH_CLOSURE.md) toplandı. İsteğe bağlı geliştirmeler için ayrı liste açılmadı. Gerçek yayın hazır değildir; uygulama/test veya API çalıştırılmadı.
