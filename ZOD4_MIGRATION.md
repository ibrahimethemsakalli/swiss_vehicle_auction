# PM-07B — Zod 4 doğrulama geçişi

27 Ekim 2026. Doğrudan Zod bağımlılığı **3.25.76 → 4.6.7** olarak sabitlendi. Güvenlik bildirimi GHSA-mrhx-c7xc-m3w5 için düzeltilmiş alt sınır 4.6.6; resmî npm kaydındaki güncel kararlı 4.6.7 seçildi. Uygulamada `zod/v3` uyumluluk katmanı kullanılmıyor.

## Şema uyarlamaları

- Filtrelerin `specs` ve `ranges` sözlükleri iki parametreli `z.record(key, value)` kullanır. Kısmi sözlük, isteğe bağlı alanlar ve mevcut varsayılanlar korundu; enum-key record'un Zod 4'teki zorunlu tüm-anahtar davranışı bu alanlara taşınmadı.
- UUID ve e-posta biçimleri `z.uuid()` / `z.email()` API'lerine geçirildi. UUID variant bitleri artık Zod 4'ün RFC doğrulamasına tabidir; keyfi UUID-benzeri değerler kabul edilmiyor. Gerçek UUID üretimi/DB kayıtları değişmedi.
- Ortak e-posta girdisi boşlukları temizler, küçük harfe çevirir, 254 karakter sınırı ve ardından biçim kontrolü uygular. Kayıt ve kurtarma/güvenlik mesajı girdileri aynı normalizasyonu kullanır. Zod 4'ün e-posta biçim doğrulaması esas alınır.
- Yeni parola doğrulaması kayıt, mevcut recovery ve e-posta recovery hizmetlerinde ortaklaştırıldı: en az 12 karakter ve en çok 72 UTF-8 bayt. Bayt limiti, Unicode karakter sayısıyla karıştırılmıyor. Mevcut parolalar veya hash'ler değiştirilmedi.
- Araç ve admin tarih şemaları takvim günü (`YYYY-MM-DD`), ISO timestamp veya Date kabul eder. Gelecek/bozuk tarih ve `null`, boolean, sayısal epoch'a örtük dönüşüm reddedilir. Eski gevşek date coercion ile `null` değerinin 1970'e dönüşmesi artık mümkün değildir.
- Dealer için eksik şirket/sicil bilgileri ayrı alanlara bağlanır. Seçenek enum'ları, para biçimi, kabul boolean'ları, collection max/min, strict unknown-field reddi ve güvenli tamsayı kontrolleri korunur. Yinelenen fotoğraflar ayrı mesaj anahtarı döndürür.
- `.strict()` gibi Zod 4'ün desteklediği uyumluluk metotları gereksiz toplu refactor yapılmadan bırakıldı. Kaldırılmış `.errors`/`errorMap` API'sine yeni bağımlılık eklenmedi; hata aktarımı `.issues` üzerinden yapılır.

## Hata sözleşmesi ve dört dil

Merkezî API doğrulama hatası önceki **`REQUEST_REJECTED` / HTTP 400** kodunu korur ve isteğe bağlı `validation` alanı ekler. Market için `INVALID_FILTERS`, admin review için `REVIEW_REJECTED`, legal query için önceki kod/status korunur. Eski istemcilerin genel hata metinleri çalışmaya devam eder.

`validation`, en çok 10 `{field, key, values?}` kaydı içerir. Alanlar ve çeviri anahtarları allowlist'ten seçilir. `values` yalnızca şemadaki limit sayılarıdır; girilen parola/e-posta, bilinmeyen alan adları, ham Zod mesajı veya veri objesi dönmez. Bilinmeyen yollar genel “Form” alanına çevrilir. Çeviri global Zod locale'i değiştirilerek yapılmaz; eşzamanlı farklı dil istekleri birbirinin ayarını değiştirmez.

`readValidation` istemcide de payload'ı sınırlar, bilinmeyen alan/anahtarları ve eksik/sahte sayı parametrelerini reddeder. Böylece `{{count}}` gibi çözülmemiş placeholder görüntülenmez. Sayısal strict `>`/`<` sınırları `≥`/`≤` metinlerinden ayrıdır.

Yeni `ValidationErrors` bileşeni kayıt, ilan wizard'ı ve iki güvenlik/kurtarma formunda alan etiketleriyle mesajları gösterir. DE/FR/IT/EN katalogları ve mevcut native Input/Select/Textarea mesajları korunur. Değişen inputta veya tekrar gönderimde sunucu hata özeti temizlenir. Diğer ekranların mevcut çevrilmiş genel hata fallback'leri korunur; eski hata kodları değiştirilmedi.

## Yalnızca etkilenen doğrulamalardaki test kanıtı

`pnpm test:validation` yalnızca `tests/zod-migration.test.ts` dosyasını, dış ağın kapalı olduğu CI test komutuyla çalıştırır. Toplam **11 hedefli kontrol**:

1. Kayıt normalizasyonu, CH/LI telefonları, izinli roller, dealer alanları ve overposting reddi.
2. UTF-8 parola bayt limitleri, minimum uzunluk ve e-posta biçimi/boyutu.
3. ISO/gün/Date girdileri; leap date, gelecek tarih ve null/boolean/epoch reddi.
4. Araç sayısal sınırları, varsayılan koleksiyonun istekler arasında paylaşılmaması, enum, fotoğraf sayısı ve yinelenme.
5. Filtrelerin kısmi kayıtları/varsayılanları ve geçersiz key/value/range/collection reddi.
6. RFC UUID, para biçimi, consent ve dispute şema şekilleri — yalnızca parse, hiçbir iş eylemi yok.
7. Hata özeti kapasitesi, allowlist, girdi/yol gizliliği ve bozuk istemci DTO'sunun reddi.
8. Dört dilde anahtar ve interpolation uyumu.
9. Geçersiz kayıt/filtre HTTP girdilerinin DB/provider'a ulaşmadan eski hata kodlarıyla reddi.
10. Test-only görüntüleme sayfasının üretimde 404 olması.
11. Exclusive sayısal sınırların doğru mesaj ve limit değeriyle aktarılması.

Typegen/typecheck geçti. Katalogların anahtar/interpolation eşliği ayrıca tek hedefli kontrolle doğrulandı. Tarayıcıda yalnızca yeni hata listesi 4 dil × 360/390 px kontrol edildi: 8 mesaj görünür, yatay taşma veya çözülmemiş parametre yok. Görsel/ölçüm kanıtı `artifacts/pm-07b-validation.png` ve `artifacts/pm-07b-validation-layout.json`.

Tarayıcı sayfası `/dev/validation-audit` yalnızca development'ta açılır; gönderim, hesap değişikliği veya hukuki onay içermez. Geçici önizleme durduruldu. Eski Input/Select/Textarea ve mobil iş akışları, galeri, kayıt oluşturma, SMS/e-posta gönderme, parola sıfırlama, ilan/teklif/satış/itiraz ve backup/restore tekrar çalıştırılmadı. Mevcut `autoveri` DB'sine yazılmadı; migration gerekmedi. Genel build/framework testi bu turda tekrarlanmadı; CI'da tanımlı kontroller yerinde duruyor.

## Güncel güvenlik ve kalanlar

| Ölçüm | PM-07A sonrası | PM-07B sonrası |
| --- | ---: | ---: |
| Critical | 0 | **0** |
| High | 3 | **2** |
| Moderate / Low | 0 / 0 | **0 / 0** |
| Zod bildirimi | 1 | **0** |

Kalan iki high: Prisma config zincirindeki **effect** ve **deepmerge-ts** (PM-07C). High audit kapısı hâlâ başarısız olur; gevşetilmedi. Lockfile hash'i ve kalan bildirimler [docs/dependency-audit-2026-10-27-zod4.json](docs/dependency-audit-2026-10-27-zod4.json) içinde; önceki raporlar tarihsel olarak korundu. Tarama bildirimin kalktığını gösterir, genel request-size/DoS veya penetrasyon testi garantisi değildir.

Gerçek Stripe/SMS/e-posta kabul işleri bu şema geçişinde kullanılmadı veya tamamlanmış sayılmadı. npm sürüm ve audit kaydı yalnızca bağımlılık incelemesi için kullanıldı. GitHub'a push veya uzak Actions çalıştırması yok. Daha önce başlamış sunucu yeni şemaları kullanmak için kontrollü restart ister.

Resmî kaynaklar: [Zod 4 migration rehberi](https://zod.dev/v4/changelog), [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
