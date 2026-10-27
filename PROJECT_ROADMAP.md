# AutoVeri — ürün incelemesi ve uygulama sırası

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
| 7 / PM-07 | P0, yerel kontroller geçti; GitHub Actions doğrulaması izleniyor | Next/React, Zod ve Prisma 7.10.1 geçişi tamamlandı; audit 0 bildirim. Development ve ayrı salt okunur production açılışı geçti. | Hedefli kanıtlar NEXT16_MIGRATION.md, ZOD4_MIGRATION.md ve PRISMA7_MIGRATION.md. Uzak CI sonucu ilgili GitHub commit kontrollerinden izlenir. | Gerçek API/hosting kabulü ayrı. PM-08–PM-25 bekliyor; bütün PM serisi tamamlanmış değildir. |
| 7A / PM-07A | P0, Kaynak yükseltmesi tamamlandı | Next 14.2.35 → 16.4.3 aktif LTS; React 19.3.1. Promised params/searchParams, React ref/JSX ve Webpack/typegen uyumu sağlandı. | 3 yeni unit + 3 dar HTTP/socket grubu, React hydration/form smoke, build, typecheck/frozen install geçti. DB ve business worker kapalıydı; eski akışlar tekrarlanmadı. | Audit 28→3; critical 3→0. Mevcut çalışan kullanıcı sunucusu yeniden başlatılmalı; production deployment yapılmadı. |
| 8 / PM-08 | P1, Bekliyor | Kullanıcı bildirim modeli/ekranı yok; outbox yalnızca açık artırma güncellemesi yayıyor. | Önce kalıcı uygulama içi kutu: geçilme, kazanma, ilan onay/red, kapanış, rezervasyon yenileme ve itiraz kararı. Tekrarsız olay, okunma durumu, yetki. Sonra tercihe bağlı e-posta. | İlk bölüm yok; e-posta için sağlayıcı. |
| 9 / PM-09 | P1, Bekliyor | Alıcı-satıcı mesajlaşması ve randevu modeli yok. Satış sonrası iletişim de eksik. | İlan bazlı soru-cevap ve özel konuşma; satış taraflarına teslim görüşmesi; raporla/engelle, hız sınırı ve kişisel bilgi koruması. Telefonları herkese açmadan organizasyon yapılabilmeli. | Yerelde yapılabilir; moderasyon operasyonu gerekli. |
| 10 / PM-10 | P1, Bekliyor | Wizard yalnızca React state'inde. `DRAFT` enum'u var, taslak oluşturma/düzenleme API'si yok. | Hesaba ait taslak kaydı, devam etme, önizleme, onay öncesi düzenleme; aktif ve teklif almış ilanda kurallı değişiklik. Teklif/fiyat geçmişini geriye dönük değiştirmemeli. | Yok. |
| 11 / PM-11 | P1, Bekliyor | MFK tarihi ve bazı alanlar zorunlu; yeni/hiç MFK görmemiş aracın dürüstçe belirtilmesi eksik. Ruhsat tarihi ile model yılı ayrımı satış formunda tam değil. | Bilinmiyor/henüz MFK yok durumları, açıklamalı alanlar, açık hasar ve EV pil sağlığı bilgisi; model yılı/ilk tescil ayrımı. Eksik veri filtrede doğrulanmış veri sayılmamalı. | Resmî araç kataloğu otomasyonu ayrıca lisanslı kaynak gerektirir. |
| 12 / PM-12 | P1, Bekliyor | İlan reddi `DRAFT` durumuna gidiyor; kullanıcı tarafında düzenleyip tekrar gönderme akışı eksik. | Red gerekçesi ve değişiklik kontrol listesi, tekrar gönderme ve sürüm kaydı; süresi biten ilanın yeni inceleme ile tekrar yayını. Geçmiş teklif/satış değişmez. | Yok. |
| 13 / PM-13 | P1, Bekliyor | Favoriler yalnızca `localStorage` üzerinde; cihazlar arasında yok. | Giriş yapan kullanıcıya DB favorileri; misafir favorilerinin açık kurallı birleştirilmesi; kapalı ilan durumları korunmalı. Önceden tamamlanan canlı etiket testleri yalnızca değişirse yeniden çalışır. | Yok. |
| 14 / PM-14 | P1, Bekliyor | Filtreler URL'ye yazılmıyor; kayıtlı arama modeli yok. | Paylaşılabilir URL, geri/ileri gezinmede filtre koruma, isimli kayıtlı aramalar; yeni eşleşme bildirimi PM-08 sonrası. | Uygulama içi için yok. |
| 15 / PM-15 | P1, Bekliyor | Araçları yan yana karşılaştırma yok. | En fazla 3 araç; fiyat, yıl/tescil, km, teknik veri, donanım, MFK ve ilan durumu; bilinmeyeni açık gösteren mobil karşılaştırma. | Yok. |
| 16 / PM-16 | P1, Bekliyor | Yer/satıcı kantonu var; şehir, yaklaşık mesafe ve ziyaret konumu yok. | Şehir/posta kodu, isteğe bağlı yakınlık ve yarıçap. Tam ev adresini herkese göstermeyen görüşme planı. | Posta kodu veri seti; harita/coğrafi kodlama sonraki aşama. |
| 17 / PM-17 | P1, Bekliyor | Kullanıcı profili/değerlendirme ve satış öncesi ilan raporlama modeli yok. | Sadece gerçek kapanmış işlemden tek değerlendirme; cevap/itiraz ve moderasyon; sahte yorum engeli. İlanı şikâyet etme, inceleme ve yaptırım kaydı. | Operatör politikası. |
| 18 / PM-18 | P1, Bekliyor | Admin kuyruk/ödeme sorgularında `take:100`; sonraki sayfa yok. Diğer listeler sınırsız büyüyebilir. | Sayfalama, arama/durum/tarih filtreleri; kuyruk yaşı ve sorumlu; incelenmesi gereken tüm kayıtlar erişilebilir. Operatör denetim geçmişi. | Yok. |
| 19 / PM-19 | P1, Bekliyor | Satışta alıcıdan ayrı teslim teyidi, teslim belgesi ve sözleşme çıktısı yok. | Ortak teslim kontrol listesi, imzalı/onaylı teslim özeti ve ücret makbuzu. Alıcının itiraz süresi ve satıcı onayıyla tahsilat kuralı tasarlanmalı; mevcut akışa sessizce yeni ceza eklenmez. | Sözleşme şablonu ve iş/hukuk kararı. |
| 20 / PM-20 | P1, Bekliyor | Genel layout metadata'sı sabit; detay route'u istemci bileşeni; sitemap/robots/hreflang/ilan sosyal önizlemesi yok. | Sunucu kaynaklı herkese açık ilan özeti/metadata, canonical, uygun dil URL stratejisi, sitemap, gerçek durumla uyumlu yapılandırılmış veri. Özel panel ve test yolları indekslenmemeli. | Alan adı; schema türünün açık artırma anlamı ayrıca doğrulanacak. |
| 21 / PM-21 | P2, Bekliyor | Arama sıralaması tüm eşleşen fiyat satırlarını belleğe alıyor. | SQL'de sıralama/sayfalama, gerçekçi veri setinde sorgu planı ve ölçüm; aynı filtre anlamını koru. Çoklu Socket.IO/worker PM-06 ile birlikte. | Yük ortamı ve hedef hacim. |
| 22 / PM-22 | P2, Bekliyor | Görüntülenme/favori/iletişim dönüşümü ölçülmüyor. | Botlardan ayrıştırılmış temel olaylar, kullanıcı gizliliğine uygun satıcı istatistiği ve ürün hunisi. Veri yokken örnek sayaçları gerçek gibi göstermeme. | Analitik ve veri saklama kararı. |
| 23 / PM-23 | P2, Bekliyor | Değerleme, model-yıl uyumu, standart donanım kataloğu yok. Mevcut liste marka-model sözlüğü. | Lisanslı veri kaynağı ve kapsama kontrolü; kaynak/tarih/güven bilgisi; manuel düzeltme. Fotoğraf veya model adından doğrulanmamış donanım/fiyat uydurma. | Ticari veri lisansı/API. |
| 24 / PM-24 | P2, Bekliyor | Bayi profili ve stok içe aktarma yok. | Doğrulanmış şirket vitrini, CSV içe aktarma/önizleme/hatalı satır raporu, rol ve kota; abonelik ancak ekonomik model netleşince. | Sicil doğrulama ve ticari plan. |
| 25 / PM-25 | P2, Bekliyor | Teklif ajanı/proxy bidding, PWA/push, takvim hatırlatmaları yok. | Önce bildirim/şeffaf kurallar; sonra gizli azami tutarlı otomatik teklif tasarımı ve kontrollü test. Push izinleri isteğe bağlı. | Push sağlayıcısı/servis worker; ürün kararı. |

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
