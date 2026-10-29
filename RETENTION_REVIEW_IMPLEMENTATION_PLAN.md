# PM-26G — Koruma yeniden inceleme uygulama planı

> Güncel durum: PM-26G yerel uygulaması tamamlandı: kanıt doğrulama, iki adminli kararlar, sürümlü geçmiş ve veri silmeden manuel koruma kaldırma. Uygulama/kanıt ve sınırlar: [RETENTION_REVIEW.md](RETENTION_REVIEW.md). Sonraki öneri PM-26H mevcut admin kuyruğu ve uygulama içi bildirim entegrasyonu; yeni süre, e-posta/SMS veya silme eklemeden. Aşağıdaki plan ve önceki aşama notları tarihsel karar/uygulama kapsamını korur.

Durum: **plan hazır; kodlama ve etkinleştirme yapılmadı**. Dayanak: kullanıcının PM-26F kapsamındaki üç öneriyi kabul etmesi; [onaylanan kararlar](RETENTION_REVIEW_DECISIONS.md), [karar matrisi](GO_LIVE_MATRIX.md). Aşağıdaki model ve uç adları teknik tasarımdır; yeni ürün kararı veya uygulanmış özellik değildir.

## 1. Kapsam ve değişmeyen sınırlar

Yerel modda konuşmaya ait manuel korumanın tekrar incelenmesi ve şartları sağlanırsa iki adminle kaldırılması planlanır. Yeni kanıt, yanlış konuşma, gerekçe veya dosya değişikliği inceleme başlatabilir. Kanıt/dosya referansı ve açıklama zorunludur; yetersiz kanıt korumayı sürdürür. Kapanmış dosya tek başına kaldırma gerekçesi değildir.

Teklif, rezervasyon, satış, açık/kapalı ilan veya mesaj raporu ve bekleyen/kabul edilmiş randevu gibi mevcut otomatik koruma sebepleri kaldırılamaz veya geçersiz kılınamaz. Bunlardan biri varsa manuel kaldırma da engellenir. Eksik/geçersiz/gelecek tarih, tanınmayan durum, erişilemeyen kanıt veya tamamlanamayan ilişki kontrolü belirsizlik sayılır; kaldırma yapılmaz.

Altı ayın henüz dolmamış olması tek başına belirsizlik değildir: diğer şartlar uygunsa manuel koruma kaldırılabilir, fakat mesajlar normal süre kuralı nedeniyle aday olmaz. Manuel korumanın varlığını kendi kaldırma işlemine engel sayan döngü kurulmamalıdır; bağımsız koruma sebepleri ayrıca değerlendirilir.

Silme/anonimleştirme, otomatik süre sonu, periyodik inceleme işi, harici sağlayıcı, gerçek API ve hukuki yayın kapsam dışıdır. İşlem/onay, açık/kapalı uyuşmazlık, koruma ve karar geçmişi saklama süreleri belirsiz kalır. Bilinmeyen süreye varsayılan değer veya süresiz onay atanmaz.

## 2. Veri modeli ve geçiş

| Öğe | Planlanan içerik ve kısıt |
| --- | --- |
| Koruma dönemi | Conversation ilişkisi, ACTIVE/RELEASED durumu, sürüm, oluşturma gerekçesi/aktörü/zamanı, kaldırmaya dayanak karar kimliği. Konuşma başına en fazla bir aktif dönem; kaldırılmış dönemler geçmişte kalır. Sonradan yeni gerekçeyle yeni dönem açılabilir. |
| İnceleme talebi | Koruma dönemi, talep eden admin, neden kodu, gerekçe, kanıt referansları, dayanak koruma sürümü, durum ve sunucu zamanları. Dönem başına en fazla bir açık talep. |
| Karar/olay geçmişi | Talep açma, ek bilgi, kanıt ekleme, sürdürme, geri çekme, değişiklik nedeniyle yeniden inceleme ve kaldırma kararları eklenerek saklanır. Aktör, zaman, önceki sürüm ve ilgili kanıt sürümü bulunur; geçmiş üstüne yazılmaz. |
| Kanıt referansı | İzin verilen iç kayıt türü + kimliği + gözlenen sürüm/zaman. Serbest URL veya dış dosya indirme yok. Referansın varlığı, erişimi ve ilgili konuşma/dosyayla ilişkisi sunucuda doğrulanır. Tam mesaj içeriği gereksiz yere çoğaltılmaz. |

PM-26E kayıtlarının kimlikleri, oluşturma gerekçeleri ve inceleme notları korunarak bütün mevcut korumalar ACTIVE taşınır. Eski “incelendi” durumu kaldırma onayı olarak yorumlanmaz. Eski notlar tarihsel kayıt olarak aktarılır; eksik eski kanıt referansı uydurulmaz, yeni kaldırma talebinde kanıt tamamlanır. Kullanıcı/konuşma ilişkilerinde mevcut RESTRICT davranışı korunur. Migration tekrar uygulanabilir veri aktarımı ve kayıt sayısı eşlemesiyle tasarlanır; mevcut mesajlar değiştirilmez.

Kanıt türleri uygulamada mevcut iç kayıtlarla sınırlı bir izin listesine bağlanır. Hiçbir uygun referansla desteklenemeyen talep serbest metinle onaylanmaz; ek bilgi bekler. Bir raporu kanıt göstermek o raporun otomatik korumasını ortadan kaldırmaz.

## 3. Durum geçişleri ve yetkiler

| İşlem | Yetki ve sonuç |
| --- | --- |
| Yeniden inceleme talebi | Güncel, askıya alınmamış admin; konuşmanın tarafı olamaz. Gerekçe ve iç kanıt referansı zorunlu. Koruma ACTIVE kalır. |
| Ek bilgi / korumayı sürdür | Talep sahibinden farklı uygun admin gerekçeli karar kaydeder. Ek bilgi durumunda talep açık kalır; sürdürmede o talep kapanır. Koruma ACTIVE kalır. |
| Ek kanıt / yeniden gönderim | Talep sahibi açık talebe sürümlü ek kayıt ekler; önceki delil ve not değişmez. Yeni sürüm yeniden incelenir. |
| Geri çekme | Talep sahibi talebi kapatır; koruma devam eder. |
| Kaldırmayı onayla | Talep sahibinden farklı, konuşmanın tarafı olmayan güncel admin. Korumayı ilk oluşturan kişi talep açabilir fakat kendi talebini onaylayamaz. Aynı işlem içinde yeniden kontrol ve manuel dönemi RELEASED yapma gerçekleşir. |
| Yeni kanıt veya sürüm değişikliği | Eski duruma dayanarak onay verilmez; yeniden inceleme gerekir. Koruma aktif kalır. |

İkinci uygun admin yoksa işlem bekler. Tek-admin geçişi veya acil durum arka kapısı eklenmez. Mevcut ikinci faktör doğrulaması talep/karar uçlarında kullanılır; rol, askıya alınma, taraf olma ve talep sahibinin güncel uygunluğu son karar anında da kontrol edilir. Yerel test hesapları kullanılabilir; mevcut örnek hesap engeli korunur.

## 4. Atomik işlem ve eşzamanlılık

Onay ve kaldırma tek transaction içinde yapılır; sonradan körlemesine çalıştırılan ayrı bir kaldırma işi oluşturulmaz. Yetki, açık talep, koruma/kanıt sürümleri ve bütün bağımsız koruma sebepleri tekrar okunur. Aynı anda iki onay yalnızca bir durum geçişi ve karar üretir; tekrar gönderimler komut kimliği ve sürüm ile güvenli karşılanır.

Uygulama öncesinde Bid, PaymentHold, Settlement, MessageReport, ListingReport ve Appointment yazma yolları incelenerek onayla aynı kilit sırasına bağlanır veya eşdeğer serializable/çatışma denetimi uygulanır. Yalnızca koruma satırını kilitlemek yeni ilişkilerin oluşmasını engellemeye yetmez. Kuralı etkileyen yeni mesaj/tarih değişiklikleri de sürüm denetimine dahil edilir. Onaydan önce oluşan engelleyici delil kaldırmayı durdurmalı; onaydan sonra eklenen bağlantı ise otomatik korumayı derhal sağlamalıdır. Bu yarışın hedefli testi geçmeden kaldırma yolu tamamlanmış sayılmaz.

Hata durumunda durum değişikliği ve karar kaydı birlikte geri alınır. Manuel kaldırma, otomatik koruma satırlarını veya kaynak kayıtlarını değiştirmez. Salt okunur envanter yalnızca aktif manuel dönemleri dikkate alır; karar/koruma geçmişi saklama süresi belirsiz delil olarak korunur. “RELEASED” yalnızca ilgili manuel dönemin sona erdiğini anlatır, “veri silinebilir/silindi” anlamına gelmez.

## 5. HTTP ve dört dilde arayüz

- Mevcut yerel/sağlayıcısız ortam kapısı, admin oturumu, aynı-origin kontrolü, gövde sınırı ve private/no-store yanıtları korunur. Kısıtlar sunucuda uygulanır; düğmeyi gizlemek yetki kontrolü yerine geçmez.
- Ayrı komutlar: talep aç, ek kanıt sun, ek bilgi iste, korumayı sürdür, geri çek, kaldırmayı onayla. Genel durum PATCH veya DELETE ucu yoktur. PM-26E'nin tek inceleme yolu yeni kontrolleri aşacak alternatif bırakmamalıdır.
- Kuyrukta açık/ek bilgi bekleyen/kapanmış talepler; kayıtta koruma dönemi, neden, kanıt referansları, engeller, sürüm ve değişmeyen geçmiş gösterilir. Sayfalama korunur; karar sonrası eski önizleme geçersiz kılınır.
- DE/FR/IT/EN: bütün durumlar, yetki/kanıt/çatışma hataları ve “manuel koruma kaldırıldı; veri silinmedi” açıklaması çevrilir. Kanıt ve gerekçeler yalnızca yetkili adminlere gösterilir; halka açık sayfalara veya genel loglara taşınmaz.
- Kaldırma eylemi konuşma/dönem ve kapsamını açıkça gösterir; istemci bekleme/yeniden gönderme durumunda ikinci işlem oluşturmaz. Mobilde uzun gerekçeler ve doğrulama mesajları sarılır.

## 6. Uygulama sırası ve yalnızca değişen alanların kabulü

1. Mevcut kayıtları koruyan model/migration ve sürümlü geçmiş. İzole yerel DB'de PM-26E kayıtlarının aktif taşındığı ve mesajların değişmediği doğrulanır.
2. Saf karar kuralları, kanıt çözümleme ve yetki kontrolleri. Yalnızca yeni testler: eksik/ilgisiz kanıt, kendi talebini onaylama, taraf admin, yetki kaybı, ikinci admin yokluğu, kapalı rapor ve belirsizlik engelleri.
3. Atomik komutlar ve etkilenen ilişki yazma yolları. Hedefli testler: eşzamanlı talep/onay, yeni delille yarış, eski sürüm, rollback, tekrar gönderim, kaldırma sonrası yeni koruma dönemi ve korunmuş geçmiş.
4. Yerel HTTP + dört dil ekranı. Hedefli testler: yetkisiz/mode-off/origin/gövde denetimi, yeni durum geçişleri, sayfalama ve 360/390 px uzun metin/hata mesajları. Eski giriş, ihale, ödeme veya galeri akışları tekrarlanmaz.
5. Salt okunur önizleme uyumu: uygun kaldırma sonrası sadece aktif manuel engelin kalkması, diğer korumaların sürmesi ve hiçbir mesajın silinmemesi. Etkilenen dosyalar için typecheck ve CI'a yalnızca yeni hedefli test komutu eklenir.

Bu listedeki testler **planlanmıştır, çalıştırılmamıştır**. Uygulama görevi ayrıca başlatıldığında yalnızca yeni/değişen kapsam doğrulanır. Production veya gerçek sağlayıcı kabulü bu planın parçası değildir.

## Bu dokümantasyon adımının sonucu

PM-26F kararları kaydedildi; PM-26G planı hazırlandı. Kod, şema, veritabanı, runtime bayrakları ve hukuki yayın değiştirilmedi. Tamamlanan testler tekrarlanmadı. Sıradaki öneri: PM-26G planını yerel modda uygulamaya almak; silme yine kapalı kalır.
