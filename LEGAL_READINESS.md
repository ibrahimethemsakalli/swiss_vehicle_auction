# PM-03 — belge ve onay hazırlığı

27 Ekim 2026. Teknik yapı hazır; **işletme ve politikalar tamamlanmadığı için kamuya yönelik hukuki yayın hazır değildir**.

## Kullanıcının doğruladığı kararlar

- Hedef kullanıcı: 18 yaş ve üzeri, İsviçre veya Lihtenştayn'da ikamet eden kişi.
- Başarılı satışın 30 CHF hizmet bedelini kazanan alıcı öder.
- Bağımsız admin tarafından incelenip onaylanan alıcı temerrüdünde 30 CHF işletmede hizmet bedeli olarak kalır; satıcıya tazminat ödemesi yapılmaz.
- İşletme henüz net değil. Alan adı, altyapı/sağlayıcılar ve ülkeleri belirsiz.
- Destek/iade ve genel veri saklama politikaları daha sonra birlikte belirlenecek.

Bu kararlar `src/data/legal-profile.json` içinde bulunur. Belirsiz alanlar `null`, `readyForPublication` ise `false` kalır. Uydurma unvan, adres, e-posta, ülke, iade süresi veya genel saklama süresi yazılmadı.

## Sayfalar

- `/privacy`: veri kategorileri ve amaçları, mevcut kodun çerez/localStorage kullanımı, Unsplash ana sayfa görseli, Stripe/Twilio adaptörleri, PM-02 fotoğraf saklama davranışı ve henüz belirlenmeyen politikalar.
- `/terms`: kapsam, bağlayıcı işlem adımları, açık artırma/teklif kuralları, rezervasyon ve işletmede kalan hizmet bedeli, itiraz/iade sınırları, sürüm değişikliği.
- `/contact`: gerçek bilgiler hazır olana kadar açık eksik alanlar. Çalışıyormuş gibi gösterilen e-posta veya kişisel veri toplayan sahte form yok.
- `/legal/accept`: giriş yapan kullanıcının sürüm kabulü ve kendi geçmişi. Gizlilik bildiriminin sunulduğunu teyit, koşul kabulünden ve yaş/ikamet beyanından ayrıdır. Pazarlama izni istenmez.

DE/FR/IT/EN metinleri `src/data/legal-copy.json`; arayüz etiketleri `src/messages/*.json` içindedir. İşletme/sağlayıcı bilgileri, belge ve onay kutusu metinleri yayında tek bir snapshot'a alınır. Eski sürüm bağlantıları `?version=...&lang=...` biçimindedir.

## Sürüm ve kayıt modeli

- `LegalRelease`: tek sürüm altında sekiz belge (koşullar + gizlilik × dört dil).
- `LegalCurrent`: aktif yayına tek işaretçi. Taslaklar aktif yayına kendiliğinden dönüşmez.
- `LegalDocument`: tam metin, işletme bilgileri, onay ifadeleri, dil ve kanonik SHA-256 özeti.
- `LegalAcceptance`: sunucunun kimlik doğruladığı kullanıcı, yayın ve belge kimlikleri, dil, ayrı olumlu beyanlar, kaynak ve DB zamanı. IP, user-agent, şifre veya kart verisi eklenmez.
- Aynı kullanıcı/sürüm tekrarı tek kayıt döndürür; ilk dil ve zaman değişmez. Kabul ve yayın değişimi PostgreSQL paylaşımlı/özel advisory kilidiyle yarışa karşı korunur.
- Uygulama yalnızca kayıt ekleme/okuma sunar. Belge, yayın ve onay UPDATE işlemleri DB trigger'ıyla engellenir. Yanlış dil/tür/sürüme ait belgeye onay bağlanması da DB'de reddedilir. Ayrıcalıklı DB bakım erişimi bunun dışında bir operasyon yetkisidir; bu yapı nitelikli elektronik imza hizmeti değildir.
- Kayıt oluşturma ve ilk onay aynı transaction'da yapılır; eski sürüm veya eksik beyan durumunda yarım kullanıcı kaydı kalmaz.
- Yeni ilan, teklif ve ilk rezervasyon kayıtları ilgili kabul kaydına bağlanır. Bir sürüm değişiminde yeni işlemler yeniden kabul ister. Bilinen isteğin idempotent tekrarları tarihsel işlemi yeniden yazmaz.
- Mevcut satış, itiraz, serbest bırakma, rezervasyon yenileme ve hesap güvenliği işlemleri yeni ticari koşul kabulüne bağlanmadı.
- Eski hesap veya işlemlere geçmiş tarihli onay eklenmedi.

## Taslak / yerel test davranışı

Yayın yokken gerçek onay POST'u hiçbir ortamda kabul edilmez. Production veya uzak origin/DB/host altında yeni kayıt ve yeni ticari işlemler yayımlanmış belgeler olmadan engellenir.

Yalnızca production olmayan, HTTP loopback origin + loopback HOST + loopback `autoveri`/`*_test` DB ortamında mevcut geliştirme akışları taslak testi olarak sürebilir. Arayüz bunu açıklar; gerçek hukuki kabul istenmez ve onay tablosuna sahte kayıt yazılmaz. Bu, aktif bir yayının onay gerekliliğini atlamaz. `NODE_ENV=production` altında bu yol kapalıdır.

## Yayından önce tamamlanacaklar

1. Resmî unvan/tür, kayıtlı adres ve ülke, varsa sicil/UID, alan adı, destek ve gizlilik adresleri.
2. Gerçekte kullanılacak hosting, DB, fotoğraf, ödeme, SMS, e-posta sağlayıcıları ve işleme ülkeleri; alt işleyenler ve aktarım düzenlemeleri.
3. Saklama/silme/anonimleştirme, yedek ve açık işlem kayıtlarının korunması; veri erişim/silme taleplerini işleyen sorumlu ve kanal.
4. Destek, iade ve itiraz işleyişi; süreler; yeni ücret kuralının hukuki/muhasebesel değerlendirmesi; kesin sözleşme ve uyuşmazlık hükümleri.
5. PM-04 ile +41/+423 kayıt biçimi ve yerel SMS simülasyonu eklendi; gerçek +423 SMS teslimi canlı sağlayıcıyla doğrulanmalı. E-posta ile işlem bildirimleri için gerçek gönderici ve PM-08 hâlâ bağımlılıktır.
6. Dört taslak metindeki henüz belirsiz/draft ifadelerini gerçek bilgilerle düzenleme ve içerik incelemesi. Bu hazırlık, hukuki uygunluk onayı değildir.

Sonrasında `readyForPublication=true` ve `pnpm legal:publish VERSION --reviewed` ile bilinçli yayın yapılır. CLI eksik profil veya draft adlı sürümü reddeder; mevcut sürümün farklı içerikle üzerine yazmaz. Bu turda gerçek `autoveri` ortamında hiçbir sürüm yayımlanmadı. Profil dosyasını değiştirmek tek başına eski kayıtları veya etkin yayını değiştirmez.

`CAPTURE_COMPENSATION` / `CAPTURED_COMPENSATION` teknik adları geriye uyumluluk için korundu; görünür metinler yeni karara göre işletmenin temerrüt hizmet bedelini anlatır. Tahsilat motoru veya tutar değiştirilmedi; satıcıya ödeme sözü verilmez.

## Hedefli kontroller

- 5 yeni politika/belge birim testi; tip ve dört dil anahtar/değişken kontrolü.
- 7 izole `_test` DB/HTTP grubu: taslak engeli, 8 immutable snapshot, kanonik hash, eşzamanlı/idempotent kabul, ilk dil/zamanı koruma, yanlış belge ilişkisi, atomik kayıt, sürüm değişimi, önceki sürüm erişimi, yeni işlem korumaları ve yalnızca kendi onay geçmişine erişim.
- Bu testlerde sahte TEST ONLY belgeleri ve kullanıcılar kullanıldı, sonra kaldırıldı. Gerçek işletme veya kullanıcı onayı üretilmedi. Yeni işlem korumaları sağlayıcı çağrısından önce kontrol edildi; ihale/teslim/ödeme iş akışı yürütülmedi.
- Tarayıcı: yalnızca yeni üç sayfa, üç yeni onay kutusu, değişen ücret açıklamaları ve kayıt ekranındaki yerel taslak mesajı. DE/FR/IT/EN × 360/390 px; gönderim yapılmadan ve kutular işaretlenmeden kontrol edildi.
- Mevcut genel entegrasyon fixture'ları yeni sürüm sözleşmesine uyarlandı; eski senaryolar tekrar çalıştırılmadı.

## Başvurulan resmî kaynaklar

- [FDPIC: internet gizlilik açıklamaları ve dil/erişim](https://www.edoeb.admin.ch/en/privacy-statements-on-the-internet)
- [FDPIC: bilgilendirme yükümlülüğü](https://www.edoeb.admin.ch/en/duty-to-provide-information)
- [SECO: satın alma ve sözleşme öncesi bilgiler](https://www.seco.admin.ch/de/vor-dem-kauf-und-vertragsabschluss)

Bu kaynaklar hangi bilgilerin netleştirilmesi gerektiğine rehberlik etti. İşletmenin doğrulanması ve kesin koşulların incelenmesi yerine geçmez.
