# PM-25E — Yerel hesap, HTTP ve limit ekranı

28 Ekim 2026: `/local-proxy`, PM-25D motoruna oturum doğrulamalı bir test ekranı ekler. Gerçek ilan, ödeme veya satın alma yükümlülüğü oluşturmaz. DE/FR/IT/EN desteklenir.

## Kullanım ve sınırlar

- `LOCAL_PROXY_ENGINE=true`, development/test, loopback PostgreSQL ve loopback HTTP gerekir. Production kapalıdır; gerçek sağlayıcı anahtarı varsa işlem reddedilir. Örnek ortamda bayrak varsayılan kapalıdır.
- Doğrulanmış `admin@local.autoveri.test` test ihalesi oluşturur ve satıcı olarak izler. `private_user@local.autoveri.test` ve `dealer@local.autoveri.test` alıcıdır. E-posta yanında rol, özel yerel telefon işareti, doğrulamalar ve askıya alınma durumu her istekte denetlenir.
- Başlangıç CHF 1.000, artış CHF 100, süre 30 dakika; rezervasyon sahte CHF 30 ve bir saat geçerlidir. En fazla 50 test odası oluşturulabilir. Kapatma, yenileme, tahsilat ve iptal bu aşamada bağlı değildir.
- Kullanıcı yalnızca kendi limitini ve rezervasyonunu görür. Satıcı alıcı limitlerini göremez. Fiyat beş saniyede yenilenir; okuma başarısızsa eski teklif formu kaldırılır. Hesap değişimi özel ekran durumunu temizler. Limit tarayıcı depolamasına yazılmaz.

## Uçlar ve veri

`GET /api/local-proxy` üye olunan odaları; `GET /api/local-proxy?auctionId=<uuid>` ortak durum ve yalnızca oturum sahibinin özel alanlarını döndürür.

`POST /api/local-proxy` iki sıkı komut kabul eder:

```json
{"action":"create","requestId":"<uuid>"}
{"action":"bid","auctionId":"<uuid>","requestId":"<uuid>","maximum":"3000.17"}
```

Kimlik, katılımcı, rezervasyon ve ihale ayarları gövdeden alınmaz. Aynı kaynak kontrolü, JSON/2 KiB sınırı, özel no-store yanıtları ve güvenli hata kodları vardır. Teklif yetkisi motorun kilitli transaction'ında yeniden denetlenir. Başarılı yazma sonrası güncel durum ayrı okunur; eski tekrar yanıtı ekranı geriye götürmez.

Migration `202610280016_local_proxy_workspace`, LocalProxyRoom/LocalProxyMember ile yerel hesabı kurgusal katılımcıya eşler. Üretim Vehicle/Bid/PaymentHold tablolarına bağlanmaz. Hesap ID'leri dış yanıtlara eklenmez. Gizlilik DB operatöründen şifreleme anlamına gelmez.

## Yalnızca değişen alanların doğrulaması

- `node scripts/ci-check.mjs unit local-proxy-workspace.test.ts`: 2 test geçti.
- `node --import tsx scripts/local-proxy-http-tests.mjs`: izole DB'de migration uyumu, atomik oda oluşturma/tekrar, rol ve doğrulama, başka hesaba erişim, sahte actor gönderme, CSRF/host/gövde/sorgu sınırları, no-store, yetki callback rollback ve süre engeli geçti; test DB'si temizlendi.
- Typecheck geçti. Ana yerel DB migration'ı ve istemci üretimi tamamlandı.
- Tarayıcıda admin oda açma/satıcı gizliliği, iki alıcının limitleri, lider değişimi, ilk alıcının RELEASED rezervasyonu, hesaplar arası özel veri ayrımı ve yeni sayfaya giriş yönlendirmesi doğrulandı.
- Yeni form ve düşük limit hatası DE/FR/IT/EN, 360/390 px'de taşmadan görüntülendi. Polling hata mesajını silmiyor.
- Yeni sayfaya giriş yönlendirmesi ve polling'in işlem hatasını temizlemesi düzeltildi. Gerçek API, eski kullanıcı akışları, tüm test paketi, production build veya uzak Actions çalıştırılmadı.

## Sıradaki PM-25F

Yerel motor için kapanış, kazanan sonucu, iptal ve rezervasyon serbest bırakma yaşam döngüsü; tekrar çalıştırmada tek sonuç, süre dolmuş hold ve yeniden teklif engeli. Gerçek tahsilat ve canlı manuel teklif entegrasyonu ayrı kalır.

PM-25F yerel kapanış, kazanan, iptal ve rezervasyon yaşam döngüsü tamamlandı: [LOCAL_PROXY_LIFECYCLE.md](LOCAL_PROXY_LIFECYCLE.md). Hedefli test: `pnpm test:local-proxy-lifecycle`. Önceki aşamanın kapanışın bağlı olmadığına ilişkin notları bu güncellemeyle aşılmıştır.
