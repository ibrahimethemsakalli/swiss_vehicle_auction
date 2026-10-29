# PM-25F — Yerel kapanış ve rezervasyon yaşam döngüsü

Migration `202610280017_local_proxy_lifecycle` ayrı yerel ihale tablosuna OPEN/WON/NO_BIDS/REVIEW/CANCELLED durumu, kazanan, kapanış ve iptal zamanlarını ekler. Mevcut ilan/satış/ödeme tablolarına bağlanmaz.

## Kurallar

- Kapanış DB saatiyle son uzatılmış bitişten sonra mümkündür. Teklif, kapanış ve iptal aynı ihale satır kilidini kullanır. Kilit alındıktan sonra süre yeniden kontrol edilir.
- Teklif yoksa NO_BIDS. Liderin geçerli CHF 30 yerel rezervasyonu ve yeterli limiti varsa WON; kazanan ve görünen son fiyat sabitlenir. Geçersiz/süresi dolmuş rezervasyonda REVIEW, kazanan yok; başka alıcı otomatik seçilmez.
- Kazananın geçerli rezervasyonu kendi son geçerlilik tarihine kadar tutulur. Süresi dolunca RELEASED olur; kazanan değiştirilmez ve ihale yeniden açılmaz. Yenileme ve tahsilat yoktur.
- Admin/sentetik satıcı OPEN veya kapanmış ihaleyi iptal edebilir. CANCELLED kazananı kaldırır, tüm AUTHORIZED rezervasyonları aynı transaction içinde serbest bırakır. Kapanışın tarihsel kaydı korunur; iptal zamanı ayrıca tutulur.
- Tekrar kapanış/iptal yeni sonuç, olay veya release üretmez. Yeni teklifler terminal durumlarda reddedilir; eski başarılı teklif isteğinin tekrarı yalnızca eski makbuzu döndürür, yeni işlem yapmaz.
- Son olay yazılamazsa durum ve release değişiklikleri birlikte geri alınır. Olaylarda limit/hold/hesap bilgisi yoktur.

## HTTP, worker ve ekran

Yerel `/api/local-proxy` POST komutları: `{action:"close",auctionId}` ve `{action:"cancel",auctionId}`. Oturum, üyelik, admin rolü ve sentetik satıcı eşlemesi transaction içinde denetlenir. Durum geçişleri doğal olarak tekrarlanabilirdir; komutla kazanan veya süre verilemez. Erken kapatma 409 döndürür.

`local-proxy.lifecycle` worker'ı 15 saniyede en fazla 100 aday işler. Worker monitöründe durum/hata takibi vardır; bir sonraki tur yarım kalan adayları tekrar alır. UTC zaman sorgusu kullanılır. BACKGROUND_WORKERS_ENABLED=false ise worker çalışmaz; admin süresi bitmiş odayı elle kapatabilir. LOCAL_PROXY_ENGINE ve mevcut yerel güvenlik kapısı korunur; production kapalıdır.

Dört dilde sonuç, kazanan, kapanış/iptal düğmeleri ve rezervasyon açıklaması eklendi. Alıcı yeni teklif veremez; satıcı alıcı limitini göremez. WON, gerçek satış veya tahsilat anlamına gelmez.

## Hedefli doğrulama

`pnpm test:local-proxy-lifecycle`: geçici yerel PostgreSQL DB'sinde winner/no-bids/review, erken kapanış ve yetkisiz iptal reddi, iptal sonrası release/teklif engeli, kazanan rezervasyonu süresi, eşzamanlı kapanış ve teklif/iptal yarışları, uzatılmış süre, tekrar işlemleri ve zorunlu olay hatasında rollback geçti. Migration schema diff sıfır; üretim iş tabloları boş; geçici DB temizlendi. İlk testte bulunan release sorgusu hatası düzeltildi.

Prisma generate, typecheck ve değişen komut/çeviri unit testleri geçti. Gerçek API, eski kullanıcı iş akışları, tam test paketi veya production build çalıştırılmadı. CI'a hedefli test eklendi; uzak CI çalıştırılmadı.

Tarayıcıda mevcut sentetik PM-25E odası üzerinde worker kapanışı, kazanan/son fiyat ve admin iptali doğrulandı. İptal sonrası kazanan alanı yok; kontroller kapalı. Yeni kontroller DE/FR/IT/EN ve 360/390 px genişliklerinde taşmıyor. Worker monitörü ok, hata sayısı sıfır. Eski sayfa kabuğunun bazı masaüstü dillerindeki yatay taşması bu değişikliğin dışında bırakıldı.

## Sıradaki PM-25G

Yerel kazanan için rezervasyon yenileme ve satış teyidi/sahte hizmet bedeli tahsilatı: süresi dolmuş veya iptal edilmiş rezervasyondan tahsilatı engelleme, tek tahsilat ve tekrar istek güvenliği. Gerçek ödeme sağlayıcısı ve canlı manuel teklif entegrasyonu ayrı tutulmalı.

PM-25G güncellemesi: yerel kazanan rezervasyonu yenileme, satış teyidi ve tek sahte platform hizmet bedeli tahsilatı hazır. [LOCAL_PROXY_SALE.md](LOCAL_PROXY_SALE.md); hedefli test: `pnpm test:local-proxy-sale`. Önceki aşamanın yenileme/tahsilat olmadığına ilişkin notları bu güncellemeyle aşılmıştır.
