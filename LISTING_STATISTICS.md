# PM-22 — Satıcı ilan istatistikleri

28 Ekim 2026. Yerel kapsam tamamlandı. Kullanıcı panelindeki **İlan istatistikleri** bağlantısı `/statistics` ekranını açar; DE/FR/IT/EN desteklenir.

## Gösterilen verinin anlamı

- **Görüntülenme günleri:** son 30 UTC tarihindeki kaydedilmiş nitelikli hesap–ilan–gün sayısı. Aynı hesap aynı ilanı aynı gün en fazla bir kez artırır; 30 günde aynı kişinin farklı günlerdeki ziyaretleri ayrı sayılır. Tekil ziyaretçi sayısı değildir. Aktivasyondan önceki geçmiş bilinmez; 0 yalnızca kaydedilmiş olay bulunmadığı anlamına gelir.
- **Mevcut favoriler:** veritabanındaki güncel favori ilişkileri. Kaldırılan favori sayıyı azaltır. Misafir tarayıcısında kalan favoriler dahil değildir. Satıcının kendi favorisi ve örnek/askıya alınmış hesaplar dışlanır.
- **Yeni iletişimler:** aynı UTC penceresinde açılmış ve görünür bir alıcı mesajı bulunan konuşmalar. Mesajların sayısı değil konuşmaların sayısıdır. Boş konuşma, satıcının kendi mesajı ve yalnızca gizlenmiş mesajlar sayılmaz.
- Bu üç ölçüm aynı kohort veya aynı olay türünü temsil etmez; dönüşüm yüzdesi, global ziyaretçi hunisi veya geçmişe dönük sahte sayaç üretilmez. Satıcı sadece kendi ilanlarını, sayfa başına 20 kayıtla görür. Örnek ilanlar rapordan dışlanır. İlan adı ve toplamlardan başka alıcı kimliği, mesaj içeriği veya görüntüleyen listesi dönmez.

## Yerel görüntülenme toplama sınırı

Toplama yalnızca production olmayan süreçte `LOCAL_TEST_PAYMENTS=true` ve oturum sırrı mevcutken çalışır. Production'da görüntülenme toplama kesin olarak kapalıdır; ekran bunu açıkça söyler ve görüntülenmeler için `—` gösterir. Favori/iletişim toplamları mevcut işlemsel kayıtlardan okunabilir. Sadece ortam değişkeniyle canlı analitik açma yolu eklenmedi: gizlilik açıklaması, hukuki dayanak/tercihler ve saklama kararı kullanıcıyla netleşmeden canlı etkinleştirme yapılmayacak.

Tarayıcı, görünür sayfada kesintisiz 5 saniye ve açık oturum sonrası bildirim gönderir. Sunucu e-posta doğrulamasını, ACTIVE/süresi bitmemiş ilanı, örnek/askıya alınmış hesapları, sahipliği, admin rolünü ve bilinen bot kullanıcı aracısı desenlerini kontrol eder. Görünürlük/bekleme istemci sinyalidir, kriptografik kanıt değildir. Kullanıcı aracısı taklit edilebilir; bu mekanizma tüm botları veya sahte hesapları kesin olarak ayıklamaz. Hesap başına günde en fazla 100 farklı ilan kaydı ve eşzamanlı isteklerde atomik günlük tekrar engeli bulunur.

## Veri ve saklama

`ListingViewDay` yalnızca ilan kimliği, UTC günü ve oturum sırrıyla HMAC'lenmiş günlük hesap belirtecini saklar. Ham hesap kimliği, IP, kullanıcı aracısı, yönlendiren URL, çerez veya cihaz parmak izi bu tabloda tutulmaz. Günlük belirteç takma adlı veridir; anonimlik iddiası yoktur. Aynı günün kayıtları kota için ilişkilendirilebilir, farklı günlerde belirteç değişir. Belirteç/sır satıcıya veya tarayıcıya dönmez.

Yerel teknik test tercihi 30 UTC gündür; henüz onaylanmış canlı saklama politikası değildir. Saatlik `statistics.cleanup` worker'ı pencere dışındaki en fazla 10.000 kaydı siler; hata/durum mevcut worker izleme sisteminde görülür. Worker kapalıysa fiziksel silme gecikebilir; okuma eski günleri yine dışlar. İlan silinince görüntülenme satırları cascade ile silinir. Hesap silme/veri başvurusu ve yedeklerde saklama politikası canlı hazırlık kapsamında ayrıca ele alınmalıdır.

## Kontroller

- 2 hedefli birim testi: günlük belirteç değişimi, UTC pencere sınırı, bilinen botlar, gövde doğrulama, varsayılan kapalı mod ve 12 yeni çeviri anahtarı/değişken eşleşmesi.
- İzole PostgreSQL: paralel tekrarlar, sahip/admin/bot/örnek/kapalı ilan/askıya alınmış ve doğrulanmamış kullanıcı dışlama; günlük 100 ilan kotası; favori kaldırma ve gizli mesaj sayımı; sahiplik; 20'li sayfalama; üretimde kapalı mod; zaman aşımı temizliği; 401/403/400/no-store sınırları; migration/schema uyumu. Test veritabanı kaldırıldı.
- Tarayıcı: örnek alıcının geçici test ilanını görmesi → satıcı panelinde 1 görüntülenme ve gerçek 0/0 sayaçları. DE/FR/IT/EN × 360/390 px kontrolleri ve boş liste görüldü. Geçici ilan ve ona ait görüntülenme kaydı kaldırıldı. Yeni ekrana ait kanıtlar `.local/pm22-browser-checks.json`, `.local/pm22-statistics-mobile.png` (Git dışında).
- Typecheck ve CI yapılandırma kontrolü. GitHub Actions'a yeni izole test eklendi; bu görevde push veya uzak CI çalıştırılmadı.

`pnpm test:listing-statistics` yalnızca yeni istatistik testlerini çalıştırır. Eski teklif, ödeme, satış, galeri ve mesaj gönderme iş akışları tekrarlanmadı; gerçek harici API kullanılmadı.

Sıradaki PM-23: araç verisinin kaynak/tarih/doğrulama düzeyi ve manuel düzeltme hazırlığı. Otomatik değerleme, model-yıl ve standart donanım doğrulaması için lisanslı veri/API gerekir; API olmadan kesin fiyat veya donanım bilgisi uydurulmayacak.
