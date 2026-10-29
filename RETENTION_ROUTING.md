# PM-26H — Yerel inceleme kuyruğu ve bildirimler

28 Ekim 2026. DE/FR/IT/EN arayüzü; gerçek sağlayıcı çağrısı ve veri silme yok.

## Davranış

- Admin iş kuyruğuna koruma incelemeleri, durum/tarih/kimlik filtreleri, sayfalama ve gerekçeli üstlenme/bırakma eklendi. Üstlenmek onay yetkisi vermez. Talep sahibi kendi talebini üstlenemez; konuşmanın tarafı olan admin kayıt ve bağlantıya erişemez.
- Yeni talep ve ek kanıt, talep sahibi ve konuşma tarafları dışındaki güncel, askıya alınmamış, örnek olmayan adminlere uygulama içi bildirim üretir.
- Ek bilgi, korumayı sürdürme, kaldırma ve geri çekme olayları uygun talep sahibine ve varsa sorumlu admine bildirilir; işlemi yapan kişiye kendisinin bildirimi gönderilmez.
- Bildirim ve değişmez inceleme olayı aynı veritabanı işleminde kaydedilir. Hata bütün işlemi geri alır; yinelenen komut ikinci bildirim üretmez. Kapanan talebin iş ataması temizlenir.
- Bildirimde gerekçe, mesaj veya kanıt içeriği bulunmaz. Bağlantı belirli talebi güncel durumuyla açar; daha sonra yeni talep açılması eski bağlantının hedefini değiştirmez.
- İki farklı uygun admin şartı korunur. İkinci admin yoksa talep kuyrukta bekler ve açıklama gösterilir. Otomatik onay veya yeni süre atanmaz.
- Güncel rol ve katılımcılık bildirim listesi, okunmamış sayısı ve okundu işaretlemede tekrar denetlenir. Yerel mod kapalıysa bu kuyruk ve bildirim türleri erişime kapalıdır.

## Sınırlar

Eski talepler kuyrukta görünür; geçmiş olaylar için bildirim geriye doldurulmaz. Sonradan admin olan kişilere geçmiş bildirimler dağıtılmaz; güncel kuyruk kullanılabilir. E-posta, SMS, zamanlanmış hatırlatma ve otomatik eskalasyon eklenmedi. İşlem/uyuşmazlık saklama süreleri belirsiz kalır. Manuel korumanın kaldırılması veri silmez.

## Hedefli doğrulama

- İki yeni birim testi: yeni kuyruk komutları, olay/bildirim eşlemesi ve dört dil anahtarları geçti.
- İzole PostgreSQL testi: alıcı uygunluğu, tekrar güvenliği, kişisel içerik sızıntısı, eşzamanlı üstlenme, kendi talebini onaylama engeli, eski bağlantı, okuma sahipliği, yetki kaybı, ikinci admin yokluğu, kapanış temizliği ve bildirim hatasında işlem geri alma geçti. Geçici test veritabanı temizlendi.
- Prisma istemci üretimi, yerel migration ve TypeScript kontrolü geçti.
- Yeni test komutu: `pnpm test:retention-routing`; izole test GitHub Actions yapılandırmasına eklendi. Uzak CI bu adımda çalıştırılmadı.
- Tamamlanan kullanıcı akışları yeniden çalıştırılmadı.
- Tarayıcıda yeni kuyruk kartları ve bildirim metinleri DE/FR/IT/EN olarak doğrulandı. Bildirim bağlantısı `1cc9400e-dc7c-4b33-98f9-fead437c71f2` talebini doğru konuşma ve bekleyen durumuyla açtı. Yerel ekran kanıtı `.local/pm26h-routing.png`; bu kontrol eski onay akışını tekrar çalıştırmadı.
- Değişen GitHub Actions YAML kontrolü ve diff boşluk kontrolü geçti.

## Sonraki öneri

PM-27: uygulama içi destek talepleri, admin yanıtı ve durum takibini dört dilde eklemek. Mevcut destek kararlarına dayanmalı; belirsiz saklama sürelerini veya yeni yanıt taahhütlerini uydurmamalı. E-posta/SMS olmadan yerel modda uygulanabilir.
