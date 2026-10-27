# PM-05 — Ödeme ve SMS kabul durumu

27 Ekim 2026. Bu çalışma gerçek ödeme/SMS çağrısı yapmaz. Yerel sonuçlar banka, operatör veya sağlayıcı kabulü olarak sunulmaz. Önceki teklif, satış, iptal, itiraz ve rezervasyon iadesi senaryoları tekrar çalıştırılmadı.

## Yerelde tamamlanan yeni eksikler

| Değişiklik | Hedefli kanıt |
| --- | --- |
| Yerel ödeme bayrağı açıkken guard başarısızsa gerçek Stripe'a geçiş engellendi. Stripe istemcisinin doğrudan oluşturulması ve webhook kabulü de kapatıldı. | Gerçek anahtar biçiminde sahte anahtarla create/retrieve/release/capture ve webhook reddi; dış istek yok. |
| Yerel ve gerçek ödeme kimliklerinin karışması engellendi. Kayıtlı gateway alanı olan oluşturma/kurtarma çağrılarında gateway uyumu kontrol ediliyor. | `local_` / `pi_` kimlikleri ve kayıtlı gateway için sınır testleri. Mod kapalıyken yerel kimlik gerçek sağlayıcıya iletilmiyor. |
| Kesin kart reddi, müşteri aksiyonu beklemekten ayrıldı; reddedilen rezervasyon `FAILED` kaydediliyor. | Sahte Stripe yanıtı; izole PostgreSQL'de yalnızca `syncHold` testi. Sonraki authorized yanıtı terminal FAILED durumunu yeniden açmıyor. |
| Twilio ulaşım katmanı sahte yanıtlarla test edilebilir hale getirildi. | +423 hedef numarası ve DE/FR/IT/EN locale parametreleri, POST, timeout signal ve no-store kontrolü. |
| Yerel/bozuk SMS kimlikleri gerçek API'ye gönderilmeden reddediliyor. Yanlış alıcı/kanal/gönderim durumu kabul edilmiyor. | Sıfır istek sayacı; doğru SID + approved dışında onay yok. |
| SMS 429, 5xx, ağ/zaman aşımı ve bozuk JSON, kullanıcı hatasından ayrılıp sağlayıcı kullanılamıyor olarak işleniyor. | Yalnızca sahte fetch yanıtları; gerçek SMS yok. |
| Webhook imza sınırı sağlayıcıya bağlanmadan kontrol edildi. | SDK ile üretilmiş yerel imza; bozulmuş gövde/imza reddi, imzalı ilgisiz olay kabulü. Gerçek olay teslimi veya eski webhook tekrar işleme senaryosu çalıştırılmadı. |

`pnpm test:providers`: 9 yeni birim/sınır testi + 1 izole DB test grubu. DB testi yalnızca loopback ve `_test` veritabanını kabul eder; geçici kayıtlarını temizler. Yerel PostgreSQL'in ve mevcut migration'ların hazır olması gerekir. Gerçek kullanıcı girişleri, açık artırma, tahsilat veya rezervasyon serbest bırakma çalıştırmaz. TypeScript kontrolü ayrıca geçti. Bu değişiklikte UI değişmedi.

Yerel ödeme simülasyonunu `pnpm dev:local-payments` açar. PM-04 mesaj simülasyonunu da içerir. `.env` NEXTAUTH_URL ile açılan loopback adresi aynı olmalı. Gerçek Stripe anahtarı varken yerel ödeme modu çalışmaz; bu artık gerçek sağlayıcıya sessiz geçiş yapmaz. Yerel provizyonun 8 günlük örnek süresi gerçek banka garantisi değildir; gerçek yolda charge içindeki `capture_before` dikkate alınır.

## Gerçek sağlayıcı gerektiren kabul işleri

| İş | Gerekli erişim / karar | Durum |
| --- | --- | --- |
| Kart ödemesinde gerçek Payment Element, 3DS, ret ve banka zaman aşımı | Stripe test hesabı, public/secret test anahtarları ve test kartları | Bekliyor. Sahte pending yanıtı gerçek 3DS testi değildir. |
| Webhook teslimi, sağlayıcı retry ve sırasız olaylar | Stripe test hesabı, webhook secret ve CLI veya erişilebilir HTTPS endpoint | Bekliyor. Yerel imza sınırı doğrulandı; gerçek teslim doğrulanmadı. |
| Provizyonun gerçek süresi, yenileme ve banka ekstresinde çözülme | Uygun Stripe hesabı/kartlar; sonrasında kontrollü canlı kabul | Bekliyor. Daha önceki yerel yenileme/release akışları yeniden test edilmedi. |
| 30 CHF capture ve işletmeye aktarım, ücretler ve mutabakat | İşletme, Stripe merchant hesabı, payout ve muhasebe kararları | Bekliyor. Temerrüt ücreti işletmede kalır; satıcıya ödeme yapılmaz. |
| Tahsilat sonrası gerçek para iadesi / chargeback | Destek-iade politikası, yetki ve muhasebe kararı; sağlayıcı hesabı | Bekliyor. Mevcut rezervasyonu serbest bırakma, tahsil edilmiş tutarı iade etmez. Uygulamada ayrı refund/chargeback yönetimi henüz tamamlanmış sayılmaz. |
| TWINT | Mevcut ön provizyon modelinden farklı ürün/sağlayıcı çözümü kararı | Stripe TWINT **manual capture desteklemiyor**. Mevcut kart provizyonuna TWINT eklenmedi; Datatrans desteği varsayılmadı. |
| Gerçek SMS teslimi (+41 ve +423), dört dilde mesaj, gecikme/operatör filtresi | Twilio Verify hesabı, servis, ülke izinleri, test alıcıları ve bütçe | Bekliyor. Biçim ve taşıma katmanı sahte yanıtlarla kontrol edildi; teslim doğrulanmadı. |
| SMS maliyet/fraud sınırları ve üretim izleme | Hesap limitleri, ülke allowlist, operasyon sorumlusu | Bekliyor. Uygulama istek sınırları var; sağlayıcı hesabı ayarları doğrulanmadı. |

Bu tabloda bekleyenler için anahtar eklenmedi, dış hesap açılmadı ve canlı tahsilat/SMS denenmedi. İşletme ve destek/iade politikaları hâlâ kullanıcı kararı bekliyor.

## Resmî kaynaklar

- [Stripe: ayrı provizyon ve tahsilat](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) — süre ödeme/kart ağına bağlıdır; gerçek `capture_before` esas alınmalı.
- [Stripe TWINT](https://docs.stripe.com/payments/twint) — manual capture support: No.
- [Stripe webhook](https://docs.stripe.com/webhooks) — imzalı gövde doğrulaması ve gerçek endpoint/CLI kurulumu.
- [Twilio Verify](https://www.twilio.com/docs/verify/api) — SMS başlatma pending, doğru kod kontrolü approved.
