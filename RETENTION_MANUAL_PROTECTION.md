# PM-26E — Gerekçeli manuel koruma ve inceleme

> Güncel durum: PM-26G yerel uygulaması tamamlandı: kanıt doğrulama, iki adminli kararlar, sürümlü geçmiş ve veri silmeden manuel koruma kaldırma. Uygulama/kanıt ve sınırlar: [RETENTION_REVIEW.md](RETENTION_REVIEW.md). Sonraki öneri PM-26H mevcut admin kuyruğu ve uygulama içi bildirim entegrasyonu; yeni süre, e-posta/SMS veya silme eklemeden. Aşağıdaki plan ve önceki aşama notları tarihsel karar/uygulama kapsamını korur.

> Güncel durum: PM-26F üç karar kullanıcı tarafından onaylandı. [PM-26G uygulama planı](RETENTION_REVIEW_IMPLEMENTATION_PLAN.md) hazır; henüz uygulanmadı. Aşağıdaki önceki aşama notları tarihsel kapsamı belirtir. Silme kapalı, belirsiz süreler değişmedi.

Yerel admin `/admin/retention` ekranında konuşma kimliği ve 10–1000 karakter gerekçe ile kalıcı koruma kaydı açar. Kayıt konuşmanın mevcut ve gelecekteki bütün mesajlarını saklama önizlemesinde aday olmaktan çıkarır. Tek konuşma için tek kayıt vardır; yeniden gönderim ve eşzamanlı oluşturma mükerrer kayıt üretmez.

İnceleme kuyruğu bekleyen ve incelenmiş kayıtları ayrı gösterir, 50 satırlık sayfalarla ilerler. Admin 10–1000 karakter inceleme notuyla kaydı tamamlar. İnceleme korumayı **kaldırmaz**; gerekçe, oluşturan admin/zaman ve inceleyen admin/zaman korunur. İnceleme tek seferliktir, eşzamanlı karar ikinci kez yazılmaz. Kayıt güncelleme, silme, serbest bırakma ve süre atama uçları yoktur. Korumayı kaldırma yetkisi/ölçütleri ayrıca kararlaştırılmalıdır; bilinmeyen süre süresiz saklama onayı değildir.

Kapsam konuşma mesajlarıdır. Genel dosya/log/yedek silme kilidi değildir. İşlem/onay ve açık/kapalı uyuşmazlık saklama süreleri belirsizdir. Koruma kayıtlarının kendi saklama süresi de belirsiz; envanterde delil olarak korunan sınıfındadır. Önizleme salt okunur kalır; yalnızca yeni koruma/inceleme uçları bu yeni tabloya yazar. Hukuki yayın ve gerçek silme açılmadı.

HTTP: `/api/admin/retention/protections`, GET kuyruğu ve POST create/review. Var olan oturum/admin ikinci faktör kontrolü kullanılır; işlem içinde güncel rol, askıya alınma ve örnek hesap kontrol edilir. Yerel ortam/yerel DB ve sağlayıcı kapısı korunur; mutasyonlarda aynı origin zorunludur. Gövde 8 KiB ile sınırlıdır; bilinmeyen alan/komutlar reddedilir. Yanıtlar private/no-store. Gerekçeler yalnızca admin kuyruğunda görünür, genel sayfalara ve sayısal envantere taşınmaz. Arayüz notları HTML olarak yorumlamaz.

Model: `RetentionProtection`, konuşma ve admin kullanıcılarına RESTRICT ilişkileri; nullable inceleme alanlarının birlikte bulunması DB kısıtıyla korunur. Son kullanma tarihi eklenmedi. Migration: `202610280020_retention_protection`.

## Hedefli doğrulama

- Yeni 2 birim testi: komut/gerekçe sınırları, kaldırma/silme komutlarının reddi, dört dil anahtarları.
- İzole geçici PostgreSQL testi: yeni migration, yetki/yerel/origin kontrolleri, bulunamayan konuşma, büyük gövde, eşzamanlı oluşturma ve inceleme, kuyruk/cursor, inceleme öncesi ve sonrası koruma, değişmeyen mesajlar. Başarılı; geçici veritabanı kaldırıldı.
- Prisma generate ve typecheck başarılı. Yeni migration yerel autoveri DB'ye uygulandı. Yeni modeli yüklemek için yerel sunucu sağlayıcılar kapalı olarak yeniden başlatıldı.
- Tarayıcıda yalnızca yeni alanlar: yerel test konuşması için koruma oluşturma ve gerekçeli inceleme başarılı. Yeni form/inceleme hata mesajları DE/FR/IT/EN, 360/390 px genişliklerinde taşmadan görüntülendi. İnceleme kaydı saklanır; test konuşması `fa7f507a-749a-4f44-b4b8-6ba2967898b3`, ilanı yayında değildir. Mesaj silinmedi.
- Yeni komut `test:retention-protection` ve izole CI adımı eklendi. Eski kullanıcı akışları ve tüm test paketi tekrarlanmadı; gerçek API ve uzak CI kullanılmadı.

Sıradaki öneri **PM-26F:** korumanın yeniden incelenmesi ve kaldırılması için karar/yetki matrisini netleştirmek. Hangi kanıtın gerekli olduğu, ikinci admin onayı ve kapalı dosyaların ele alınması birlikte kararlaştırılır; süreler uydurulmaz ve silme yine açılmaz.
