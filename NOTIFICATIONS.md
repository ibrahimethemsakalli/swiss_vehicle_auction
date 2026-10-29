# PM-08 — Kalıcı uygulama içi bildirimler

Yerel uygulama içi kapsam tamamlandı. `/notifications` ekranına giriş sonrası üst çubuktaki zil üzerinden erişilir. DE, FR, IT ve EN desteklenir. Bildirimler PostgreSQL'de saklanır; dil değişimi kayıtları değiştirmez.

## Olaylar

| Olay | Alıcı |
| --- | --- |
| Teklifin geçilmesi | Önceki aktif teklif sahibi (kendi teklifini yükseltme hariç) |
| İhale kazanma / kapanış | Kazanan, satıcı ve katılımcılar; kişi başına bir kayıt |
| İlan onayı / reddi | Satıcı |
| Sabit fiyat teklifinin kabulü | Alıcı |
| Rezervasyon yenileme hatırlatması | Uygun aktif/kazanılmış teklifin sahibi |
| İtiraz kararı | Alıcı ve satıcı |

Olay kayıtları ilgili iş işlemiyle aynı transaction içinde yazılır. `(userId,eventKey)` benzersizliği tekrar teslimleri engeller. Geçmiş olaylar geriye dönük doldurulmaz. Adminin özel notları veya ödeme bilgileri bildirim metnine kopyalanmaz.

## Ekran ve erişim

- Okunmamış sayacı, okunmamış filtresi, tek bildirimi okundu işaretleme ve 20 kayıtlık cursor sayfalama.
- Okunma zamanı ilk işlemde saklanır; tekrar işaretleme zamanı değiştirmez.
- GET/PATCH kimliği oturumdan alır. Başkasının kaydı okunamaz veya değiştirilemez; askıya alınmış ve örnek katalog hesapları erişemez.
- PATCH aynı origin şartı ve 1 KiB gövde sınırı uygular. Yanıtlar `private, no-store` kullanır.
- Zil görünür sekmede 45 saniyede, odaklanınca ve okunma değişince güncellenir. Açık liste için Yenile düğmesi bulunur; WebSocket teslim garantisi iddia edilmez.
- `notifications.renewal` worker'ı 60 saniyede uygun rezervasyonları tarar; en fazla 100 yeni kayıt üretir. Gerçek ödeme/SMS/e-posta çağırmaz ve rezervasyon durumunu değiştirmez. Worker kapatma ayarına uyar.

## Kurulum ve yeni testler

`prisma/migrations/202610270004_notifications` yerel autoveri veritabanına uygulandı. Yeni ortamlarda standart `prisma migrate deploy` ve `prisma generate` gerekir.

`pnpm test:notifications`: iki bildirim birim testi ve yalnızca yeni bildirim servisini çalıştıran izole PostgreSQL/API testleri. Geçici veritabanı sonunda kaldırılır. Testler atomiklik/rollback, tekilleştirme, kullanıcı izolasyonu, kalıcı okunma zamanı, sayfalama, sayaç, origin ve gövde sınırı ile yenileme uygunluğunu kapsar. Typecheck geçti.

Tarayıcıda yerel hesapla yeni kutu, okundu işaretleme, zil sayacının güncellenmesi, yenileme sonrası kalıcılık, okunmamış filtresi ve dört dil kontrol edildi. Test bildirimleri ayrı `pm08-ui-test:` anahtarıyla oluşturulup temizlenir. Eski teklif, satış, ödeme ve galeri akışları tekrar çalıştırılmadı. `127.0.0.1` geliştirme kaynaklarının engellenmesi için yalnızca loopback adresi `allowedDevOrigins` listesine eklendi.

E-posta/SMS/push teslimi, kullanıcı bildirim tercihleri ve saklama/silme politikası bu uygulama içi kapsamın dışında; sağlayıcı ve işletme kararları ayrıca gereklidir.
