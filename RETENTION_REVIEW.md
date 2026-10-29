# PM-26G — Yerel kanıtlı, iki adminli koruma kaldırma

PM-26F kararları yerel modda uygulandı. `/admin/retention` ekranı DE/FR/IT/EN dillerinde aktif/kaldırılmış koruma dönemlerini, bağımsız inceleme talebini, kanıt seçimini, engelleri ve karar geçmişini gösterir. Silme veya anonimleştirme eklenmedi; belirsiz saklama süreleri ve otomatik inceleme aralığı doldurulmadı.

## Davranış

- İç kanıt izin listesi: aynı konuşmanın görünür mesajı veya randevusu. Kimlik, tür ve ilişki sunucuda doğrulanır; gizli/eksik/ilgisiz kayıt reddedilir. Serbest URL, harici dosya indirme ve yalnızca serbest metinle kaldırma yoktur. UI bir kanıt seçer; HTTP en fazla beş farklı referansı kabul eder.
- Yeni kanıt, yanlış konuşma, gerekçe/dosya değişikliğiyle talep açılır. Ek bilgi isteme, kanıt ekleme/yeniden gönderme, korumayı sürdürme ve geri çekme desteklenir. Bu işlemler korumayı kaldırmaz.
- Onaylayan admin talep sahibinden farklı olmalı; konuşmanın alıcı/satıcısı talep/karar işlemi yapamaz. Her mutasyonda güncel rol, askıya alınma, örnek hesap ve taraflık kontrol edilir. Kararda talep sahibinin güncel uygunluğu da kontrol edilir. HTTP mevcut admin ikinci faktörlü oturum kontrolünü kullanır; tek-admin istisnası yoktur.
- Kapanmış rapor dahil herhangi bir otomatik koruma bağlantısı, bilinmeyen durum veya geçersiz/gelecek tarih kaldırmayı engeller. Normal 6 aylık sürenin henüz dolmaması tek başına belirsizlik değildir: manuel koruma kalkabilir, mesaj yine süre nedeniyle korunur.
- Kaynakların özeti ve sürüm değişmişse eski talep onaylanamaz; talep sahibi güncel kanıtla yeniden gönderir. Son kontrol, RELEASED geçişi ve karar olayı aynı transaction içindedir. Komut kimliği/özeti tekrar gönderimde ikinci karar oluşmasını önler; aynı kimlikle farklı içerik çatışmadır.
- Eski tek-not inceleme komutu kapatıldı; yeni kuralların yanından geçemez. Yeniden koruma gerekiyorsa yeni aktif dönem açılır; kaldırılmış dönemler ve kararlar kalır. Konuşma başına en fazla bir aktif koruma, dönem başına en fazla bir açık inceleme vardır.

## Saklama ve geçiş

`202610280021_retention_review` eski kimlik/gerekçe/not/zamanları korur ve tüm PM-26E kayıtlarını ACTIVE taşır. Eski oluşturma/inceleme kayıtları tarihsel olaylara alınır; eski inceleme kaldırma onayı sayılmaz. `RetentionReviewEvent` UPDATE/DELETE işlemlerini DB trigger'ıyla reddeder. Önceki kanıt/notlar olaylarda korunur; talep tablosu güncel durumu taşır.

Envanter sadece ACTIVE manuel dönemleri mesaj koruması sayar; koruma, talep ve olay kayıtlarının kendisi belirsiz süreli delil sınıfındadır. Kaldırma sonrası mesajlar yeniden sınıflanır, silinmez. Bu genel dosya/log/yedek koruma veya silme sistemi değildir.

## Yerel çalışma sınırları

PostgreSQL advisory kilidi ve kaynak tablolarında kısa SHARE kilidi kullanılır. Bu, uygulamanın başka yollarından gelen INSERT/UPDATE/DELETE işlemlerini de kritik bölüm boyunca bekletir; yalnızca koruma satırını kilitlemenin yaratacağı yeni-delil yarışını önler. İşlem anında READ COMMITTED ile kaynaklar tekrar okunur. Kilit bekleme 2 saniye, sorgu 4 saniye, transaction 15 saniye ile sınırlıdır; hata halinde kaldırma geri alınır. Yerel prototip için bilinçli seçimdir; üretim ölçeği/performans kabulü değildir.

Konuşmada 1000 mesaj veya 1000 randevu sınırı aşılırsa eksik veriyle kaldırma yapılmaz. Kuyruk ve olay geçmişi 50 kayıtla sayfalanır. Gerekçeler ve kanıt içeriği yalnızca yetkili admin görünümündedir; sayısal envantere çıkmaz. Gerçek sağlayıcılar kapalı, yerel DB kapısı ve aynı-origin/gövde sınırları aktiftir.

## Hedefli doğrulama

- İki yeni birim testi: sürüm/kanıt/komut sınırları ve dört dil anahtarları geçti.
- İzole PostgreSQL: gerçek eski kayıt üzerinde migration, iki admin ve taraf/yetki kontrolleri, eksik/gizli/ilgisiz kanıt, ek bilgi/yeniden gönderme, güncelliğini yitirmiş kaynak, kapalı rapor ve diğer engeller, aynı komutun eşzamanlı tekrarı, olay yazma hatasında rollback, değiştirilemeyen geçmiş, yeni koruma dönemi, sürdürme/geri çekme ve iki yöndeki kaynak yazma kilitleri geçti. Mesajların silinmediği doğrulandı; geçici DB kaldırıldı.
- Prisma generate, yerel migrate deploy ve typecheck geçti. Yeni `test:retention-review` komutu ve izole CI adımı eklendi; uzak CI çalıştırılmadı. Eski PM-26E testi kaldırılan tek-inceleme beklentisine göre güncellendi; eski akış tekrar çalıştırılmadı.
- Tarayıcı: ayrı bir yerel test admininin açtığı talep mevcut admin oturumunda kanıtıyla incelendi; gerekçesiz karar engellendi, gerekçeli kaldırma kaydedildi. Kaldırılmış dönem ve farklı talep/karar adminleri geçmişte doğrulandı. DE/FR/IT/EN karar alanları/hata mesajları 360/390 px'de taşmadı. Test konuşması `528da774-8342-4186-b65c-bf117bd2d2b4` ve yayında olmayan ilanı yerelde bırakıldı; talep sahibi fixture hesabının kullanılabilir giriş parolası yoktur. Mevcut giriş, ödeme, ihale ve galeri akışları tekrarlanmadı; gerçek API kullanılmadı.

Tamamlanan **PM-26H** (RETENTION_ROUTING.md): yeniden inceleme taleplerini mevcut admin iş kuyruğu ve uygulama içi bildirim kutusuna bağlamak. Uygun ikinci adminin talepten haberdar olması, ek bilgi isteminin talep sahibine ulaşması ve kendi talebini onaylayamama kuralının bu girişlerde de korunması; e-posta/SMS ve yeni süre olmadan.

PM-26H: [yerel inceleme kuyruğu ve bildirimler](RETENTION_ROUTING.md) tamamlandı. İki admin kuralı korunur; silme kapalıdır. Sonraki öneri PM-27: dört dilde uygulama içi destek talebi ve yanıt takibi; gerçek API olmadan.
