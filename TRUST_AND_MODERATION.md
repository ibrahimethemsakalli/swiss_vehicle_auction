# PM-17 — İlan şikâyetleri ve işlem değerlendirmeleri

28 Ekim 2026. Yerel kapsam; gerçek ödeme, SMS, e-posta veya başka harici API çağrısı yapılmadı.

## Kullanım ve kurallar

- İlan detayında satıcının tamamlanmış satışlarına bağlı yayımlanmış değerlendirmeler, ortalama ve cevaplar gösterilir. Yorum yoksa açıkça belirtilir. Bu bir bağımsız ekspertiz veya kimlik garantisi değildir.
- `/trust`: değerlendirilebilen tamamlanmış satışlar, yazılan/alınan değerlendirmeler, kendi ilan şikâyetleri ve satıcıya iletilen kararlar. Her satışta alıcı ve satıcı birer değerlendirme yazabilir; alıcı/satıcı kimliği sunucuda türetilir. Alıcıya verilen puan, satıcının herkese açık ortalamasına karışmaz.
- Puan 1–5, metin 5–1000 karakter. Yalnızca e-posta/telefonu doğrulanmış, askıda olmayan ve örnek kullanıcı olmayan hesaplar yazabilir. Örnek ilanlar puan oluşturmaz. Yerel testte tamamlanan sentetik satışlar yalnızca test kanıtıdır.
- Değerlendirilen kişi bir defa cevap verebilir. Yazar veya değerlendirilen kişi değerlendirme/cevap için bir itiraz açabilir. Şikâyet ve itiraz metinleri herkese açık değildir; değerlendirme ve cevap metinleri açıktır. Form kişisel veri yazılmaması konusunda uyarır; otomatik kişisel veri sansürü uygulanmaz.
- İlan başına kullanıcı başına bir şikâyet; kullanıcı başına günde en fazla 10. Kendi ilanını şikâyet etme reddedilir. Kategori: yanıltıcı bilgi, dolandırıcılık şüphesi, kişisel veri, yasak içerik veya diğer.
- `/admin/trust`: açık/kapalı ilan şikâyetleri ve değerlendirme itirazları; 20 kayıtlık sayfalar. Admin gerekçe ile şikâyeti reddeder, uyarı kaydeder veya ek işlem için yönlendirir. İtirazda yayımlamayı korur veya değerlendirme ile cevabı gizler. Gizlenen değerlendirme herkese açık listeden ve puan ortalamasından çıkar; tarafların özel geçmişinde kalır.
- Karar, gerekçe, admin kimliği ve zaman veritabanında saklanır; kapalı karar üzerine yazılamaz. Admin kendi şikâyetini/kendi ilanını veya tarafı olduğu değerlendirmeyi karara bağlayamaz. Eşzamanlı yazımlar satır kilitleri ve benzersiz indekslerle korunur.
- Satıcıya şikâyetçinin kimliği veya özel şikâyet metni iletilmez. Karar gerekçesi ilgili taraflara gösterilir; moderatör bu alanda şikâyetçinin kimliğini açıklamamalıdır. İlgili kullanıcılara uygulama içi bildirim kaydedilir.

## Bilinçli sınırlar

Uyarı/yönlendirme kararı bir moderasyon kaydıdır; otomatik ilan kapatma, hesap askıya alma, satış iptali, tahsilat veya para iadesi yapmaz. Ek işlem mevcut ayrı yönetim ekranında uygulanır. Yönlendirme kapatılmış dosyanın karar türüdür; ayrı atanabilir takip kuyruğu değildir. Tam kullanıcı profili/düzenleme sayfası yerine ilan içinde satıcı değerlendirme özeti sunulur. Operatörün itiraz süreleri, saklama ve yaptırım politikaları ayrıca netleştirilmelidir. Canlı işlem veya sağlayıcı kabul testi yapılmadı.

## Veri ve hedefli test kanıtı

Migration: `202610280008_trust` — ListingReport, SaleReview, ReviewAppeal; yerel veritabanına uygulandı ve Prisma istemcili sunucu sağlayıcıları kapalı olarak yeniden başlatıldı.

- `node scripts/ci-check.mjs unit trust.test.ts`: üç yeni test geçti (katı komut/puan/metin doğrulaması; sorgu/sayfalama sınırları; dört dil anahtar/değişken uyumu).
- `node --import tsx scripts/trust-tests.mjs`: izole PostgreSQL üzerinde 19 migration, yetki/sahiplik, yinelenen ve eşzamanlı değerlendirme, tamamlanmış satış şartı, cevap/itiraz, KEEP/HIDE kararları, çıkar çatışması, kararın değişmezliği, özel veri sınırları, HTTP origin/oturum/gövde sınırı ve ödeme kayıtlarının değişmemesi geçti. Test veritabanı kaldırıldı.
- `node scripts/ci-check.mjs typecheck`: geçti.
- Tarayıcı: mevcut yerel hesapta değerlendirme formları ve ilan şikâyet formu DE/FR/IT/EN × 360/390 px; yeni alanlarda yatay taşma bulunmadı. Zorunlu seçim ve metin hataları dört dilde gösterildi. Form kontrollerinde kayıt gönderilmedi. Admin karar işlemleri tarayıcıda yeniden oynatılmadı; izole DB/API testinde doğrulandı.
- Eski galeri, favori, ödeme ve ihale iş akışları tekrarlanmadı. Genel production build veya uzak GitHub Actions bu turda çalıştırılmadı.

Tekrar çalıştırma: `pnpm test:trust`. CI yapılandırmasına yeni izole entegrasyon komutu eklendi. Sıradaki iş PM-18: mevcut admin kuyruklarının sayfalama, arama/durum/tarih filtreleri, kuyruk yaşı, sorumluluk ve denetim geçmişi.
