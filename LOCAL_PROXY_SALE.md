# PM-25G — Yerel yenileme, satış teyidi ve tek sahte tahsilat

Yalnızca `/local-proxy` test odalarında çalışır. Gerçek ilan, ödeme sağlayıcısı, SMS veya mevcut satış/ödeme tabloları kullanılmaz. Production ve uzak ortamlar önceki güvenlik kapısıyla kapalıdır.

## Kurallar

- Yalnızca WON durumundaki kazanan alıcı kendi rezervasyonunu yenileyebilir. Süresi dolmuş veya serbest bırakılmış eski rezervasyon yeniden etkinleştirilmez; bir saatlik yeni CHF 30 yerel rezervasyon oluşturulur, limit yeni kayda bağlanır. Geçerli rezervasyona yenileme isteği süreyi uzatmaz.
- Her yenileme requestId ile kaydedilir. Aynı isteği tekrar göndermek yeni rezervasyon üretmez; eski isteğin geçerliliği dolmuş yeni rezervasyonu tekrar yetkilendirmesi de engellenir.
- Yerel admin/sentetik satıcı, sadece WON ve geçerli kazanan rezervasyonu varken satışı teyit edebilir. Teyit, CHF 30 platform hizmet bedeli kaydı ve CAPTURED rezervasyon durumuyla birlikte COMPLETED sonucunu aynı transaction içinde oluşturur. Satıcıya para aktarımı yoktur.
- LocalProxyCapture.auctionId birincil anahtar, holdId benzersizdir. Aynı veya farklı isteklerle eşzamanlı teyit tek tahsilat üretir. İhale kilidi yenileme, teyit, teklif, iptal ve worker işlemleri arasında ortaktır.
- Tamamlanmış satış yeniden teklif, yenileme veya iptal kabul etmez. Tekrar teyit yalnızca başarı döndürür; kaydı değiştirmez. İade ayrı sonraki kapsamdır; tahsilat kaydı silinerek iptal taklidi yapılmaz.
- İptal edilen, teklifsiz veya inceleme gerektiren ihalelerden tahsilat yapılamaz. Miktar, hold ID, kazanan veya satıcı istemciden alınmaz. Her yazma sırasında yerel hesap/üyelik yeniden denetlenir.

## Uçlar ve ekran

POST `/api/local-proxy`: `{action:"renew"|"confirm",auctionId,requestId}`. Yeni hata kodları SALE_NOT_READY/SALE_COMPLETED 409; mevcut yetkisiz ve süresi dolmuş rezervasyon hataları korunur.

DE/FR/IT/EN: kazananın yenileme düğmesi, satıcının teyit düğmesi, yenileme gerekliliği açıklaması, tamamlandı ve sahte ücret tahsil edildi durumları. Salt okunur tahsilat projeksiyonu yalnızca miktar, para birimi ve zamanı içerir; hesap/hold ID veya başkasının limiti açığa çıkmaz.

Migration `202610280018_local_proxy_capture`: COMPLETED/CAPTURED durumları, tek tahsilat tablosu ve kısıtları. Ana yerel DB'ye uygulandı; Prisma istemcisi üretildi ve sağlayıcıları kapalı yerel sunucu yeniden başlatıldı.

## Hedefli testler

`pnpm test:local-proxy-sale`: geçici yerel DB üzerinde kazanan yetkisi, satıcı teyidi, istemciden ücret değiştirmenin reddi, süresi dolmuş rezervasyon engeli, yinelenen/eşzamanlı yenileme, eski yenileme makbuzu, tek tahsilat, iptal/teyit ve iptal/yenileme yarışları, terminal engeller, son makbuz hatasında yenileme/tahsilat rollback ve migration uyumu geçti. Geçici DB temizlendi; gerçek iş tabloları boş kaldı.

Typecheck ve değişen komut/çeviri unit kontrolleri geçti. CI'a yalnızca yeni izole test eklendi; uzak Actions, tüm test paketi, production build veya tamamlanan kullanıcı akışları çalıştırılmadı.

Tarayıcı kanıtı: yalnızca yeni senaryo için sentetik WON/süresi dolmuş rezervasyon hazırlandı. Admin teyidi önce kapalıydı; kazananın yenilemesi AUTHORIZED oldu; admin teyidi COMPLETED sonucunu verdi. Salt okunur DB kontrolünde captureCount=1, amountCents=3000, currency=CHF doğrulandı. Teyit düğmesi kaldırıldı, iptal kapalı. Yenileme ve teyit kontrolleri DE/FR/IT/EN, 360/390 px genişliklerinde taşmıyor. Test odası kullanıcı incelemesi için bırakıldı.

## Sıradaki PM-25H

Yerel tamamlanmış satış için gerekçeli iade talebi ve admin kararı, tek seferlik sahte iade kaydı ve dört dilde sonuç ekranı. Tahsilat geçmişi korunmalı; aynı 30 CHF iki kez iade edilmemeli. Gerçek sağlayıcı ve canlı ilan entegrasyonu ayrı kalmalı.

PM-25H: gerekçeli yerel iade talebi, admin onay/ret kararı ve tek sahte iade hazır. [LOCAL_PROXY_REFUND.md](LOCAL_PROXY_REFUND.md); hedefli test: `pnpm test:local-proxy-refund`. Önceki aşamanın iade bulunmadığına ilişkin notlarını bu güncelleme tamamlar.
