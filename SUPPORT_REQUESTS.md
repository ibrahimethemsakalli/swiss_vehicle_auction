# PM-27 — Uygulama içi destek

DE/FR/IT/EN: `/support` üzerinden talep oluşturma, kendi taleplerini durum filtresiyle listeleme ve yanıt geçmişi; `/admin/support` üzerinden admin kuyruğu, yanıt ve durum değişikliği.

Durumlar: OPEN, WAITING_USER, RESOLVED, CLOSED. Kullanıcı yanıtı açık/bekleyen/çözülmüş talebi OPEN yapar. CLOSED talebe kullanıcı yanıtı engellenir; admin gerekçeli yanıtla yeniden açabilir. Her durum değişikliği yanıtla birlikte kaydedilir. Admin kendi talebinde kullanıcı gibi davranır. Destek işlemi ödeme, satış, uyuşmazlık veya iki adminli koruma kararını değiştirmez.

Kayıt sahibi ve güncel admin rolü sunucuda doğrulanır; askıya alınmış/örnek hesaplar erişemez. Kimlik doğrulama mevcut oturum/MFA sisteminden gelir. Aynı kaynak kontrolü, 20 KB gövde sınırı, sıkı şema ve metin sınırları uygulanır. Kullanıcı başına 10 açık/bekleyen talep, saatte 30 yazma komutu kötüye kullanım sınırıdır; bunlar saklama veya destek yanıt süresi değildir. Talep sürümü eşzamanlı değişiklikleri reddeder. Komut kimliği aynı isteğin tekrarında ikinci kayıt oluşmasını önler. Veritabanında yanıt ve durum atomik kaydedilir.

Talep listesi 20, geçmiş 30 kayıtlık sayfalara ayrılır. Metinler HTML olarak çalıştırılmaz. Yanıt ve geçmiş için düzenleme/silme ucu yoktur. Silme ve otomatik kapanış yok; destek kayıtlarının saklama süresi belirsizdir. E-posta/SMS, dosya eki, uygulama içi bildirim dağıtımı ve iş ataması bu adımda eklenmedi. Yeni yanıtlar yenileme ile görünür.

## Doğrulama

- Yeni iki birim testi geçti: şema, yetki alanı enjeksiyonu, metin sınırları, durumlar ve dört dil.
- İzole PostgreSQL testi geçti: sahiplik, admin rolü, geçmiş, tekrar güvenliği, eşzamanlı yanıt, yeniden açma, kapalı talep, askıya alma, kaynak kontrolü, gövde sınırı ve açık talep kotası. Geçici veritabanı kaldırıldı.
- Prisma generate ve yerel migration geçti. TypeScript kontrolü geçti.
- `pnpm test:support` komutu ve GitHub Actions izole test adımı eklendi. Değişen CI YAML kontrolü geçti; uzak Actions çalıştırılmadı.
- Gerçek API ve tamamlanmış kullanıcı akışları çalıştırılmadı.
- Tarayıcıda talep oluşturma ve ayrı yerel örnek müşterinin talebine admin yanıtı/WAITING_USER durumu kaydetme geçti. DE/FR/IT/EN yanıt ve durum seçenekleri doğrulandı. Ekran kanıtı: `.local/pm27-support.png`. Test kayıtları yerel panelde bırakıldı.

## Sonraki öneri

PM-28: destek taleplerine sorumlu admin ataması, okunmamış yanıt göstergesi ve uygulama içi bildirim ekle. Yetki/sahiplik kontrollerini koru; yeni süre veya gerçek sağlayıcı ekleme. Yalnızca bu yeni bağlantıları test et.

PM-28 güncellemesi: sorumlu admin ataması, bağımsız yanıt okuma takibi ve uygulama içi bildirimler eklendi; güncel kapsam SUPPORT_ROUTING.md içinde.
