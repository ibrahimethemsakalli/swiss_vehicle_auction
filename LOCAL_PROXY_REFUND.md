# PM-25H — Gerekçeli yerel iade

Yalnızca `/local-proxy` ortamında, gerçek API olmadan çalışır. Production/uzak ortam/gerçek sağlayıcı anahtarı engelleri korunur. Gerçek satış, ödeme veya kullanıcı itiraz tablolarını değiştirmez.

## Davranış

- Yalnızca COMPLETED ve yerel CHF 30 tahsilat kaydı bulunan satışın kazananı talep açabilir. İstek ve karar gerekçeleri kırpıldıktan sonra 10–400 karakterdir.
- İhale başına bir talep vardır. Bu prototipte ret/onay nihai; yeniden başvuru, kararı değiştirme ve kısmi iade yoktur. Bu sınırlama dört dilde ekranda belirtilir; canlı hizmetin hukuki iade politikası olarak sunulmaz.
- Yerel admin/sentetik satıcı PENDING talebi gerekçeyle onaylar veya reddeder. Onay tam CHF 30 sahte iade oluşturur; ret para hareketi oluşturmaz.
- LocalProxyRefundCase tahsilat kaydına bağlıdır; LocalProxyRefund talebe bağlı, auctionId birincil anahtarıyla tekildir. Tahsilat, CAPTURED rezervasyon ve COMPLETED satış geçmişi değiştirilmez. İade ayrı kayıt olarak görünür; satış/teklif yeniden açılmaz.
- Kimlik/rol/üyelik transaction içinde kontrol edilir. Talep/karar yazıları teklif/kapanış/teyitle aynı ihale kilidini kullanır. RequestId + normalleştirilmiş içerik özeti aynı isteği tekrarlanabilir kılar; aynı anahtarla farklı içerik 409 verir. Farklı anahtarla aynı nihai karar/gerekçe tekrar yazılmaz; karşıt karar reddedilir.
- Karar, iade, olay, sürüm ve komut kaydı atomiktir. Ortak olaylar gerekçe veya hesap bilgisi içermez. Talep ve karar yalnızca kazanan ile yerel admin/satıcıya gösterilir; diğer alıcılara refundCase=null döner.

## HTTP ve veri

POST `/api/local-proxy`: `{action:"requestRefund"|"approveRefund"|"rejectRefund",auctionId,requestId,reason}`. Tutar/hesap/hold alanları gövdede kabul edilmez. Miktar doğrulanmış tahsilattan alınır.

Migration `202610280019_local_proxy_refund`: PENDING/APPROVED/REJECTED enum'u, LocalProxyRefundCase ve LocalProxyRefund. Ana yerel DB'ye uygulandı; istemci üretildi ve gerçek sağlayıcıları kapalı sunucu yeniden başlatıldı.

## Yalnızca yeni/değişen kapsamın testleri

`pnpm test:local-proxy-refund`: geçici yerel PostgreSQL DB üzerinde yetki, kısa/uzun gerekçe ve tutar enjeksiyonu reddi, talep gizliliği, aynı istek/çelişkili içerik, tek iade, ret sonrası onay engeli, karşıt eşzamanlı kararlar, talep/kararın son adımına hata enjekte ederek rollback, ilk tahsilatın değişmeden kalması ve migration uyumu geçti. Geçici DB temizlendi, gerçek iş tabloları boş kaldı.

Typecheck ve değişen komut/çeviri kontrolleri geçti. Tam test paketi, eski kullanıcı akışları, production build ve uzak CI çalıştırılmadı. Yeni izole test CI'a eklendi.

Tarayıcı: önceki PM-25G tamamlanmış sentetik satışta kazananın gerekçeli talebi, bekleyen durum, admin gerekçe zorunluluğu ve onay sonucu doğrulandı. Karar sonrası düğmeler kaldırıldı. Salt okunur DB kontrolü: bir tahsilat, bir iade, CHF 30; satış COMPLETED kaldı. Yeni alıcı/admin formları ve hataları dört dilde 360/390 px genişliklerinde taşmıyor. Ret ve karşıt karar yarışları HTTP/DB testlerinde doğrulandı. Önceki satış/teklif akışları tekrar çalıştırılmadı.

## Sıradaki öneri: PM-25I

Yerel ödeme defteri ve tutarlılık denetimi: tahsilat/iade toplamları, mükerrer veya eksik kayıt uyarıları, salt okunur admin raporu. Böylece ayrı yerel senaryoların muhasebe tutarlılığı gerçek sağlayıcı entegrasyonundan önce birlikte incelenebilir.

PM-25I tamamlandı: [yerel ödeme defteri ve test sonuçları](LOCAL_PROXY_LEDGER.md).
