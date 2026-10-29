# PM-25D — İzole yerel otomatik teklif motoru

28 Ekim 2026: gizli limit/rezervasyon modeli ve atomik yerel motor hazır. PM-25C önerisini gerçek PostgreSQL işlemleriyle uygular; gerçek veya mevcut yerel ilan/ödeme akışını çağırmaz. **Canlı otomatik teklif aktivasyonu değildir.**

> Güncelleme PM-25E: yerel hesap eşlemesi ve HTTP/ekran bağlantısı artık hazır; [LOCAL_PROXY_WORKSPACE.md](LOCAL_PROXY_WORKSPACE.md). Aşağıdaki test/sunucu notları PM-25D aşamasının tarihsel durumudur.

## Veri modeli

Migration `202610280015_local_proxy` beş tablo ve bir durum enum'u ekler:

| Tablo | İçerik ve erişim |
| --- | --- |
| LocalProxyAuction | Kurgusal satıcı/alıcı UUID'leri, başlangıç/artış/görünen fiyat, lider, başlangıç/bitiş, sürüm |
| LocalProxyLimit | İhale + sahip bazında özel azami tutar ve bağlı rezervasyon; tutarlar rappen BigInt |
| LocalProxyHold | Yalnızca `local-proxy`, CHF 30, AUTHORIZED/RELEASED, son geçerlilik ve serbest bırakma zamanı |
| LocalProxyCommand | İhale/sahip/istek UUID'si benzersizliği, normalleştirilmiş isteğin özel özeti ve ilk yanıt |
| LocalProxyEvent | Sürüm başına tek ortak olay; yalnızca ihale ID, görünen fiyat, lider, bitiş, sürüm |

Üretim User, Vehicle, Bid, PaymentHold ve OutboxEvent modellerine ilişki kurulmaz. Kurgusal katılımcılar `createFixture` tarafından üretilir; gerçek kişi veya hesap değildir.

“Gizli” burada limitin ortak snapshot/olay/başka katılımcı sorgusuna verilmemesidir. Sayısal limit veritabanında özel tabloda tutulur; uygulama düzeyinde disk şifrelemesi veya DB operatöründen gizleme sağlanmış değildir. Gerçek kullanıma geçişte veri saklama, DB erişimi/şifrelemesi ve yönetici denetimi ayrıca kararlaştırılmalıdır.

## Sınırlar ve kullanım

`src/lib/local-proxy-engine.ts` içindeki `createLocalProxyEngine(databaseUrl)` dahili, güvenilir çağıran API'sidir. `createFixture`, `submit`, `view`, `ownLimit`, `events`, `disconnect` sağlar. `ownLimit` yalnızca çağıran kurgusal alıcının limitini döndürür; satıcıya limit erişimi yoktur. Ortak yanıtlarda açık alan listesi kullanılır.

Actor UUID'si **oturum doğrulaması değildir**. Modül henüz HTTP'ye açılmadı; çağıran kimliğini istemciden alan bir endpoint eklenmemelidir. PM-25E'de yerel test hesabıyla kurgusal katılımcı eşlemesi ve sunucu tarafı kimlik doğrulama gerekir. Bu aşamada yeni ön yüz/çeviri yoktur; PM-25C simülatörü değişmedi.

Güvenlik kapısı her işlemde yeniden denetlenir:

- Açık `LOCAL_PROXY_ENGINE=true` ve yalnızca `development`/`test` ortamı.
- PostgreSQL loopback adresi; `/autoveri` veya sınırlandırılmış `autoveri_*_test` adı. URL override parametreleri reddedilir, yalnızca tek `schema=public` kabul edilir.
- Gerçek Stripe/Twilio/Datatrans anahtarı veya canlı Stripe bayrağı varsa reddedilir. Ağ gateway'si enjekte edilemez.
- Production daima kapalıdır. Mevcut sunucuda bu bayrak açılmadı; yeni tablolar boştur.

## İşlem kuralları

1. İhale satır kilidi altında üyelik/satıcı yasağı, tekrar anahtarı, başlangıç/bitiş, liderin rezervasyonu ve limit doğrulanır. Zaman DB `clock_timestamp()` değerinden **epoch milisaniye** olarak alınır; yerel saat dilimi dönüşümünden etkilenmez.
2. Fiyat/öncelik/tek uzatma PM-25C saf hesaplayıcısıyla belirlenir. Kapanış anı teklif kabul etmez. Azami tutarda kısmi son artış önerisi korunur; mevcut manuel `placeBid` çağrılmaz.
3. Yeni katılımda sahte CHF 30 hold oluşturulur; liderin yalnızca limit yükseltmesi aynı hold'u kullanır ve geçerlilik tarihini uzatmaz. Hold süresi bu prototipte bir saattir.
4. Kaybedenin hold'u aynı transaction içinde RELEASED yapılır; liderinki tutulur. Tekrar katılan kaybedene yeni hold gerekir. Limit, fiyat, sürüm, olay ve istek makbuzu birlikte commit edilir.
5. Aynı isteğin tekrarı ilk yanıtı döndürür; yeni işlem/hold/uzatma üretmez. Daha yeni teklifler geldiyse bu makbuz eski snapshot içerir; çağıran güncel durum için `view` kullanmalıdır. Farklı içerikli tekrar reddedilir. Sayısal olarak eşdeğer CHF metinleri aynı içerik kabul edilir.
6. Liderin süresi dolmuş/yanlış tutarlı/yanlış gateway'li rezervasyonu işlemi durdurur. Otomatik yenileme, ikame kazanan veya yeniden yetkilendirme yoktur.
7. Kendi limit yükseltmesinde ortak olay üretilmez; işlem sürümü artar. Olay sürümlerinde bu nedenle boşluk olabilir. Bu outbox sadece yerel tablo; mevcut WebSocket yayınına bağlanmaz.
8. Her fixture ihalesi en fazla 1000 kabul edilmiş komutla sınırlıdır. Yeni komutlar kotada reddedilir, eski makbuz tekrarları çalışır.

İhale kapatma, hold yenileme, satış teyidi/capture, iptal ve fixture temizleme yaşam döngüsü henüz bu motora eklenmedi. Süresi dolan ihalede yeni teklif durur; mevcut hold satırını ayrı bir worker otomatik kapatmaz. Bu nedenle gerçek ilana/ücrete bağlanması güvenli kabul edilmemelidir. Mevcut 30 CHF hizmet bedeli politikası değiştirilmedi.

## Hedefli doğrulama

`pnpm test:local-proxy` yalnızca yeni ortam sınırı testi ve izole PostgreSQL motor testini çalıştırır. Test ortamı sağlayıcı anahtarlarını temizler ve sonunda oluşturduğu veritabanını siler.

Geçen kontroller: migration deploy/schema diff, üretim/uzak DB/URL override/gerçek anahtar reddi, fixture üyeliği/satıcı yasağı, katılımcılar arasında limit izolasyonu, ortak alan listesi, eşzamanlı aynı istek ve eşit/yüksek limit yarışları, tek aktif hold, kaybedenin release/yeniden katılımı, kendi limit artışında hold tekrar kullanımı, tek uzatma, başlangıç/bitiş ve hold süresi, düşük teklifin hold oluşturmaması.

Son komut kaydına zorunlu DB hatası enjekte edildi: hem ilk teklifin hem lider değişiminin tüm yazıları geri alındı. İkinci durumda eski liderin hold'u AUTHORIZED kaldı; yeni alıcının limiti/hold'u oluşmadı. Gerçek User/Vehicle/Bid/PaymentHold/OutboxEvent tabloları test boyunca sıfır kayıt kaldı.

İlk kontrollerde yakalanan `schema=public` yanlış reddi ve DB saat dönüşümü düzeltildi; hedefli testler ardından geçti. Prisma generate, typecheck ve CI yapılandırma kontrolü geçti. Yeni DB testi Actions'a eklendi; uzak Actions/build çalıştırılmadı. Migration ana **yerel** autoveri veritabanına uygulandı; motor için orada fixture/teklif/ödeme oluşturulmadı. Çalışan sunucu yeniden başlatılmadı. Eski kullanıcı akışları ve tarayıcı testleri tekrarlanmadı.

## Sıradaki PM-25E

Yerel örnek hesaplarla sunucu tarafı kimlik eşlemesi, sıkı doğrulamalı yerel HTTP uçları ve dört dilde limit/rezervasyon ekranı. Üretim aktivasyonu ayrı kalmalı. Sonrasında yerel kapanış/yenileme/iptal yaşam döngüsü ve mevcut manuel tekliflerle entegrasyon ele alınmalı.
