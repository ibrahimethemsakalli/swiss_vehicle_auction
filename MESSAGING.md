# PM-09 — Özel mesajlaşma ve randevu

İlan detayındaki iletişim bağlantısı `/messages?vehicle=…` ekranını açar. Oturum açmış kullanıcı menüsünde **Nachrichten / Messages / Messaggi** bağlantısı bulunur. DE, FR, IT ve EN desteklenir.

## Yetki ve veri sınırları

- İlan başına her alıcı için tek özel konuşma. Yalnızca o alıcı ve satıcı geçmişi okuyabilir. Admin olmak tüm özel konuşmaları okuma yetkisi vermez.
- Yeni konuşma için gerçek uygulama hesabı, e-posta/telefon doğrulaması, aktif ilan ve aktif taraflar gerekir. Süresi biten, satılan veya iptal edilen ilanda yeni konuşmayı yalnızca kayıtlı satışın tarafları açabilir. Mevcut konuşma satış sonrası da kullanılabilir.
- Örnek katalog ilanları/hayali satıcılarla konuşma oluşturulmaz. Yerel doğrulanmış test hesapları desteklenir.
- Mesajlar düz metindir; HTML çalıştırılmaz. Ek dosya, telefon veya e-posta otomatik paylaşımı yoktur. Mesaj gövdesi bildirim kutusuna kopyalanmaz.
- Kullanıcı ve karşı taraf kilitleri eşzamanlı gönderim/engelleme yarışlarını sıralar. Mesaj ve randevu istek kimlikleri tekrar gönderimi tekilleştirir. Yeni olayın uygulama içi bildirimi aynı transaction'da yazılır.
- Gönderme için hesabın doğrulanmış ve iki tarafın aktif olması gerekir. Kullanıcı başına dakika kovasında 20 yeni yazma işlemi sınırı vardır. API gövdesi 12 KiB, mesaj 2000, rapor gerekçesi 1000, yer açıklaması 200 karakterle sınırlıdır. Same-origin POST ve kullanıcıya özel no-store yanıtlar uygulanır.

## Randevular ve engelleme

Bir konuşmada tek gelecek randevu önerilebilir. Tarih 5 dakika–90 gün aralığındadır. Giriş cihazın saat dilimindedir; kayıtta UTC, görüntülemede Europe/Zurich kullanılır. Tarih seçicisi değeri formdan alınır; otomatik liste yenilemesi giriş değerini silmez.

Öneren taraf kendi önerisini kabul edemez. Karşı taraf kabul/ret verebilir; iki taraf da bekleyen veya kabul edilmiş randevuyu iptal edebilir. Bu işlemler satış, ödeme veya teslimat teyidi değildir. Son 20 randevu gösterilir; geçmiş tarihler ayrıca “geçmiş” olarak etiketlenir.

Engel iki yönde mesajı ve yeni randevu/kabulü durdurur. Bu iki kullanıcı arasındaki bekleyen öneriler iptal edilir. Onaylı randevu görünür ve iptal edilebilir; sessizce yok olmaz. Her kullanıcı yalnızca kendi koyduğu engeli kaldırır. Geçmiş kayıtlar ve raporlama engelliyken de erişilebilir.

## Raporlama ve moderasyon

Karşı tarafın mesajı spam, taciz, dolandırıcılık şüphesi, kişisel veri veya diğer gerekçesiyle raporlanabilir. Kendi mesajı ve başka konuşmadaki mesaj raporlanamaz. Kişi/mesaj başına tek rapor vardır.

`/admin/messages` yalnızca ADMIN oturumuna açıktır. En eski 50 açık rapor, gerekçe ve raporlanan mesaj gösterilir. İncelendikçe sıradakiler gelir. Admin raporu reddeder veya mesajı katılımcılardan gizler; inceleyen kimliği, zaman ve karar kalıcı saklanır. Gizlenen metin normal konuşma API'sinde dönmez. Orijinal kayıt inceleme için korunur; fiziksel silme değildir.

## Yükleme ve sınamalar

`202610280001_messaging` yalnızca beş yeni tablo ve ilgili indeks/ilişkileri ekler. Yerel autoveri veritabanına uygulandı; geliştirme sunucusu yeni Prisma istemcisiyle yeniden başlatıldı. Gerçek sağlayıcılar kapalı.

`pnpm test:messaging` yalnızca yeni doğrulama/çeviri birim testlerini ve geçici PostgreSQL veritabanındaki PM-09 testlerini çalıştırır. Senaryolar: özel taraf erişimi, eşzamanlı/idempotent oluşturma ve gönderme, bildirimler, randevu kuralları, çift yönlü engel, moderasyon, sayfalama, kalıcılık, kapalı ilan satış tarafları, askı/doğrulama, origin, gövde boyutu ve hız sınırı. Fixtures doğrudan oluşturulur; ihale ve ödeme akışları yeniden çalıştırılmaz. Geçici veritabanı sonunda kaldırılır. CI'ya bildirimlerden ayrı PM-09 adımı eklendi.

Ekran kontrolü yalnızca yeni mesajlaşma/randevu alanlarında yerel alıcı/satıcı hesaplarıyla yapıldı; dört dil, düz metin gösterimi, gönderme/yanıt, randevu kabulü, engelleme/kaldırma ve raporlama kontrol edildi. Test ilanı/mesajları ayrı geçici fixture'dır.

Yerel admin hesabıyla rapor listesinin açılması ve mesaj gizleme de tarayıcıda doğrulandı. İki mesaj, kabul edilmiş randevu ve incelenmiş/gizlenmiş raporun kalıcı kayıtları kontrol edildi; yalnızca bu testin ilanı ve ilişkili kayıtları temizlendi.

Moderasyon erişimi sırasında iki bağımlılık düzeltildi: arayüz oturumda bulunmayan `role` alanına güvenmek yerine sunucunun yetki sonucunu kullanır; admin kodunun `timestamp` son kullanma karşılaştırması açıkça UTC kullanır. UTC olmayan PostgreSQL oturumunda geçerli ve geçmiş kodlar için dar regresyon kontrolü eklendi. Eski giriş/kayıt test paketi yeniden çalıştırılmadı.

## Sınırlar

- Son mesaj sayfası görünür sekmede 15 saniyede yenilenir. Eski mesaj geçmişi açılınca otomatik yenileme durur; Yenile ile son sayfaya dönülür. Konuşmalar 30, mesajlar 50 kayıtlık sayfalarla gezilir.
- E-posta, SMS, takvim sağlayıcısı, harita ve dosya eki entegrasyonu yoktur; gerçek API gerekmez.
- Uçtan uca şifreleme iddiası yoktur. Üretim TLS/yedek şifrelemesi, saklama/silme süresi, moderasyon görev dağılımı ve itiraz politikası işletme kararlarıyla netleşmelidir.
