# PM-25C — Otomatik teklif kuralları ve yerel simülasyon

28 Ekim 2026: önerilen kuralların saf fonksiyon simülasyonu ve dört dilli geliştirme ekranı tamamlandı. **Canlı otomatik teklif özelliği değildir; kurallar ürün önerisidir.**

## Deneme

Development sunucusunda `/bid-simulator` açılır. A ve B tamamen kurgusaldır; hesap, araç, ağ isteği, veritabanı, gerçek veya sahte ödeme kaydı kullanılmaz. Formun hesaplaması tarayıcı belleğindedir, yenilemede sıfırlanır. Sayfa production ortamında `notFound()` ile kapalıdır. Tüm siteye ait oturum/bildirim gibi mevcut üst çerçeve istekleri devam edebilir; simülasyonun kendisi istek göndermez.

Başlangıç fiyatı, artış, A/B limitleri ve B geldiğindeki kalan saniye değiştirilebilir. İlk olay 0, başlangıçtaki kapanış 600 saniyedir. İki limit de öğretici örnekte açık gösterilir; gerçek alıcı azami tutarı burada girilmemelidir. Bu ekranın görünürlüğü gerçek gizli limit depolama/erişim güvenliğini kanıtlamaz.

## Önerilen kesin kurallar

1. Tutarlar tam sayı rappen olarak işlenir. CHF girişinde nokta ve en fazla iki ondalık, pozitif tutar, en fazla 999999999.99 kabul edilir.
2. İlk geçerli limit en az başlangıç fiyatıdır; görünen fiyat başlangıç fiyatı olur.
3. Rakibin yeni limiti mevcut fiyat + asgari artış kadar olmalıdır. Altındaki komut reddedilir, fiyat/bitim/rezervasyon kararı değişmez.
4. Rakibin limiti liderinkini geçerse rakip lider olur. Fiyat `min(yeni limit, eski lider limiti + artış)` olur.
5. Rakibin limiti daha düşük veya eşitse mevcut lider kalır. Fiyat `min(lider limiti, rakip limit + artış)` olur. Eşit limitte daha önce kabul edilmiş lider limiti önceliklidir. Yarışlarda gerçek sunucu kabul sırası kullanılmalı; istemci saati öncelik kanıtı olamaz.
6. Lider yalnızca kendi limitini artırabilir. Bu işlem görünen fiyatı ve bitişi değiştirmez; rezervasyonu kendiliğinden yenilemez. Azaltma/geri çekme bu prototipte reddedilir, bağlayıcı taahhüt geri alınmaz.
7. Başarılı rekabetçi komut geldiğinde kalan süre `0 < kalan <= 180 saniye` ise eski bitişe bir kez 120 saniye eklenir. Türetilmiş karşı teklifler için yeniden uzatma yoktur. Tam bitiş anı kapalıdır. Ayrı sonraki komut yeni bitişe göre yeniden uzatabilir; bu mevcut `auctionEndAfterBid` kuralıyla aynıdır.
8. Komut kimliğinin birebir tekrarı yeni işlem oluşturmaz. Aynı kimlikte farklı veri reddedilir. Simülasyon 50 kabul edilmiş olayla sınırlıdır ve zamanı geriye götürmez.
9. Her işlemde yeni tarafın ve mevcut liderin kurgusal rezervasyon süresi geçerli olmalıdır. Liderin rezervasyonu bittiyse işlem durur; kendiliğinden başka kazanan seçilmez. Yenileme, iptal veya kapanış politikası bu aşamada simüle edilmez.
10. Kazanan tarafın kurgusal 30 CHF rezervasyonu tutulur, kaybedenin serbest bırakılacağı sonuç olarak belirtilir. Gerçek `PaymentHold` satırı veya para hareketi yoktur. Kaybeden tekrar katılırsa geçerli yeni rezervasyon gerekecektir; kaybetmiş ajan arka planda yeniden etkinleşmez.

## Örnekler

Başlangıç 1.000 CHF, artış 100 CHF, A limiti 3.000 CHF:

| B limiti | Lider | Görünen fiyat |
| --- | --- | --- |
| 2.000 CHF | A | 2.100 CHF |
| 2.950 CHF | A | 3.000 CHF |
| 3.000 CHF | A | 3.000 CHF |
| 3.500 CHF | B | 3.100 CHF |

2.950 örneğinde azami tutara kadar olan son karşı artış yalnızca 50 CHF'dir. Bu, önerilen proxy kuralının açık bir istisnasıdır; mevcut manuel minimum artış API'si bunu kabul etmez.

## Mevcut sistemle uyumsuzluklar ve sonraki aşama

- `placeBid` her teklif satırına daha önce kullanılmamış tek bir 30 CHF hold bağlar (`hold.bid` kontrolü). Bir ajanın aynı hold ile tekrar karşı teklif üretmesi bugün mümkün değildir. API'yi döngüde çağırmak çoklu rezervasyon ve serbest bırakma hatası doğurur.
- İşlem çözümleyicisi tek araç kilidi altında manuel teklif ve proxy limitini birlikte çözmelidir. Son fiyat/tek lider/tek uzatma/tek olay yayınını atomik üretmeli; mevcut manuel akışa dokunmadan önce izole sahte gateway ile hazırlanmalıdır.
- Aktif rezervasyonun teklif geçmişi yerine katılımcı taahhüdüne bağlanması, tekrar anahtarları, outbox ve release/capture durumları tasarlanmalıdır. Mevcut 30 CHF ücret kararları değiştirilmez: kazanan alıcıdan hizmet bedeli; onaylı temerrütte işletmede kalır, satıcıya otomatik aktarılmaz.
- Gerçek limitler genel araç API'si, WebSocket, bildirim, istatistik ve loglara çıkmamalıdır. Özel depolama, sahiplik, admin erişiminin sınırı ve denetimi ayrıca uygulanmalıdır. Mevcut simülasyon bunları sağlamaz.
- Manuel tekliflerle birlikte fiyat/öncelik, kısmi son artışın kullanıcıya açıklanması, limit azaltma/iptal ve rezervasyon yenileme/ihale kapanışı politikaları canlı kullanım öncesi açıkça onaylanmalıdır. Henüz koşul metni veya kullanıcı onay sürümü yayımlanmadı.
- Gerçek Stripe/TWINT süreleri veya tahsilat denemeleri yapılmadı. Proxy üretim aktivasyonu, mevcut sözleşme/ödeme akışına bağlanması ve gerçek para kabul testi bu kapsamın dışındadır.

## Hedefli kanıt

`pnpm test:proxy-simulation`: beş yeni test geçti. İlk fiyat, düşük/yüksek/eşit limit, kısmi son artış, 180 saniye sınırı, bir komutta tek uzatma, takip eden uzatma, lider limit yükseltme, kapanmış ihale, geçersiz/süresi dolmuş hold, tekrar/çelişen kimlik, mutasyonsuz hata ve 682 limit kombinasyonunda lider/fiyat sınırları kontrol edildi. Dört dil anahtarları ve prototipin üretimden ayrılması denetlendi. Typecheck geçti; ilk test yardımcı fonksiyonundaki dar requestId tipi düzeltildi.

Tarayıcıda varsayılan örnek B/3.100 CHF/720 saniye sonucunu verdi. Kalan süre 0 olduğunda kapanış hatası çıktı ve önceki sonuç temizlendi. Sonuç ve kapanış hatası DE/FR/IT/EN, 360/390 px'de taşmadan görüldü. Yeni hesap/DB test verisi oluşturulmadı. Gerçek API, ödeme veya teklif yok; eski akışlar ve production build tekrarlanmadı.

PM-25C simülasyon aşaması tamamlandı. Önerilen sonraki PM-25D: bu kurallara göre ayrı, yerel sahte gateway kullanan atomik çözümleyici ve gizli limit/rezervasyon veri modelinin hazırlanması; canlı aktivasyon ayrı kalır. PWA gerçek cihaz/HTTPS kabulü ve push teslimi de ayrı bekler.
