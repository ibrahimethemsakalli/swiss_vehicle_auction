# PM-31 — Destek taslağı ayrılma koruması

Gönderilmemiş mesaj, yeni talep konusu veya kaydedilmemiş atama gerekçesi varken destek içi gezinme, normal bağlantılar ve çıkış düğmeleri DE/FR/IT/EN onay penceresi açar. Varsayılan odak düzenlemeye devam et seçeneğidir; kapatma/Escape taslağı korur. Onaylanan geçiş taslağı bırakır. Metin URL, tarayıcı depolaması veya sunucuya kaydedilmez.

Yanıt başarıyla kaydedilince yalnızca yanıt/konu temizlenir; ayrı bir atama gerekçesi varsa ayrıntı sayfasında kalınır. Başarılı atama yalnızca gerekçeyi temizler. Hata yanıtları taslağı temizlemez. Yenile düğmesi metinleri korur. Yeni sekme, indirme ve aynı sayfanın çapa bağlantıları ayrılma sayılmaz.

Yenileme/sekme kapatma `beforeunload` kullanır: metni ve dili tarayıcı belirler; özellikle mobil işletim sistemi uygulamayı sonlandırırsa uyarı garantisi yoktur. Aynı belge içindeki geri/ileri koruması iptal edilebilir Navigation API olayını kullanır. Bu API bulunmayan eski tarayıcılarda aynı-belge geri/ileri koruması garanti edilmez; normal bağlantı, destek düğmeleri ve belge boşaltma korumaları çalışır. Bu bir kalıcı taslak saklama özelliği değildir.

## Hedefli doğrulama

- Typecheck ve diff boşluk kontrolü geçti. Komut: `pnpm test:support-draft-guard`; mevcut CI birim test taraması yeni dosyayı kapsar.
- Beş yeni birim testi: bağımsız taslaklar, iptal/onay ve yeniden düzenlemede korumanın etkinleşmesi, temiz kayıt ve listener temizliği, beforeunload ve geri/ileri, dört dil, bağlantı istisnaları.
- Yerel tarayıcı: EN yanıt taslağında kuyruk geçişi iptali ve metnin korunması; geri gezinme uyarısı; DE atama gerekçesi uyarısı; FR çıkış iptali; IT bağlantı uyarısı ve onaylanan hedefe geçiş; geri gezinme onayıyla kuyruğa dönüş.
- Kanıt: `.local/pm31-draft-warning.png`. Testlerde gerçek sağlayıcı API’si veya mesaj gönderimi kullanılmadı; önceki iş akışları tekrar çalıştırılmadı.

## Sonraki öneri

PM-32: destek yanıtı/atama sırasında başka bir adminin yaptığı değişiklikle oluşan sürüm çakışmasını dört dilde anlaşılır şekilde göstermek; taslağı koruyarak güncel talebi yükleme ve yeniden inceleme olanağı eklemek. Gerçek API kullanmadan yalnızca çakışma ve taslak koruma davranışını test etmek.
