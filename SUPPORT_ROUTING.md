# PM-28 — Destek ataması, okunmamış yanıtlar ve bildirimler

Yerel uygulama tamamlandı. DE/FR/IT/EN arayüzü; gerçek sağlayıcı kullanılmadı.

- Güncel, askıya alınmamış, örnek olmayan admin seçilerek gerekçeli atama/devir veya atamayı kaldırma yapılır. Talep sahibi admin kendi talebini atayamaz; kendisi sorumlu seçilemez. Kapalı talebin ataması değiştirilemez. Atama başka uygun adminin yanıt yetkisini kaldırmaz. Sürüm kontrolü eşzamanlı değişiklikleri reddeder; komut kimliği tekrarları tekilleştirir.
- Önceki/yeni sorumlu, işlemi yapan, gerekçe ve tarih kaydedilir. Arayüz son 20 atama değişikliğini gösterir; eski geçmiş silinmez. Kapanış mevcut sorumluyu tarihsel bilgi olarak korur.
- Okuma kaydı kullanıcı ve yanıt bazındadır. Yalnızca ekrandaki yanıt kimlikleri açık düğmeyle okundu işaretlenir. Başka sayfadaki veya daha sonra gelen yanıt etkilenmez. Kendi gönderileri okunmamış sayılmaz. Adminlerin okuma durumu birbirinden bağımsızdır. Önceki kayıtların okundu bilgisi olmadığından kendi gönderileri dışındaki eski yanıtlar ilk etapta okunmamış görünür.
- Admin yanıtı talep sahibine bildirilir. Kullanıcı yanıtı/yeni talep uygun sorumluya, uygun sorumlu yoksa uygun adminlere bildirilir. Atama değişikliği uygun eski/yeni sorumluya bildirilir; işlemi yapan kişiye kendisinin bildirimi gönderilmez. Uygun alıcı yoksa kayıt kuyrukta kalır; otomatik yeni yetki veya atama oluşmaz.
- Bildirimde konu, mesaj veya atama gerekçesi bulunmaz. Bağlantı tam talebi açar. Rol kaybında admin bildirimleri listeden/sayaçtan gizlenir; sahiplik ve güncel yetki ayrıntıda tekrar kontrol edilir. Bildirim okunması ile yanıt okunması ayrı tutulur.
- Bildirim, yanıt/atama ile aynı transaction içindedir. Bildirim yazılamazsa işlem geri alınır. Dış servis, e-posta/SMS veya worker gerekmez. Önceki olaylara bildirim geriye doldurulmaz.
- Silme, otomatik kapanış veya yeni saklama/yanıt süresi eklenmedi. Mevcut iki adminli koruma sistemi değişmedi.

## Hedefli doğrulama

Yeni iki birim testi ve izole PostgreSQL testi geçti: alan enjeksiyonu, uygun admin, tekrar/race, kullanıcıya özel okuma, okunmamış sayaçları, bildirim/yanıt okuma ayrımı, rol kaybı, uygun sorumluya/alternatif alıcıya yönlendirme, başka adminin yanıt hakkı, gizli içerik yokluğu, bildirim hatasında transaction rollback. Geçici test DB kaldırıldı.

Prisma generate, yerel migration ve TypeScript kontrolü geçti. `pnpm test:support-routing` ve GitHub Actions adımı eklendi; değişen CI YAML doğrulandı. Uzak Actions veya tamamlanmış iş akışları çalıştırılmadı.

Tarayıcı: yeni PM-28 test talebinde sorumlu admin kaydedildi; görünen yanıt okundu işaretlenince sayaç 1'den 0'a indi. DE/FR/IT/EN destek bildirimi doğru metinle göründü ve bağlantı `b5148119-2557-4d93-8d1e-6656a018d4df` talebini açtı. Yerel test kaydı panelde bırakıldı. Ekran kanıtı `.local/pm28-support-routing.png`.

## Sonraki öneri

PM-29: destek kuyruğuna “bana atanmış / atanmamış / okunmamış” filtreleri ve konu/talep kimliği araması eklemek. Dört dilde, yalnızca yeni sorgu ve arayüz kontrolleriyle; süre veya gerçek servis eklemeden.
