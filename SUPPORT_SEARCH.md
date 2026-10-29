# PM-29 — Destek kuyruğu arama ve filtreleri

DE/FR/IT/EN tamamlandı. Admin için tüm atamalar, bana atanmış ve atanmamış seçimi; kullanıcıya özel okunmamış yanıt filtresi; konu ve tam talep kimliği araması eklendi. Durum filtresiyle birlikte AND mantığıyla çalışır. Atanmamış, sorumlu alanı boş olan taleptir; yetkisini kaybetmiş eski admin ataması otomatik değiştirilmez.

Konu içinde büyük/küçük harf duyarsız metin araması yapılır. Tam talep kimliği birebir aranır; kimliğin parçası arama değildir. `%`, `_` ve ters eğik çizgi düz karakter olarak işlenir. Mesaj/kanıt içeriği aranmaz. Arama 160 karakterle sınırlıdır. Talep kimliği kart ve ayrıntıda görünür.

Arama düğmeyle uygulanır; seçimler anında uygulanır. Her filtre değişimi ilk sayfaya döner. Temizleme durum, atama, okunmamış ve arama alanlarını birlikte sıfırlar. Ayrıntıya gidip kuyruk düğmesiyle dönünce mevcut filtreler korunur. Yüklenme ve eşleşmeyen sonuç ayrılır; eski istek cevapları AbortController ile engellenir. Arama ve okunmamış filtresi kullanıcı ekranında da yalnızca kendi kayıtlarına uygulanır. Atama filtreleri admin kuyruğu dışından reddedilir.

Yeni iki birim testi, izole PostgreSQL/HTTP testi ve typecheck geçti. Kombine filtreler, role/sahibe göre görünürlük, birebir ID, özel karakterler, mesaj gövdesinin aranmaması, okuma/atama değişimi sonrası sonuçlar ve 23 kayıtla sayfalama doğrulandı. Geçici test DB kaldırıldı. `pnpm test:support-search` ve CI adımı eklendi; YAML kontrolü geçti. Eski akışlar ve gerçek API çalıştırılmadı. Şema/migration değişmedi.

Sonraki öneri PM-30: destek kuyruğu filtrelerini URL ile korumak; sayfa yenileme, geri/ileri ve paylaşılan bağlantıda aynı görünümü açmak. Bağlantı erişim yetkisi vermemeli; dört dil ve yalnızca yeni gezinme testleriyle uygulanmalı.

Tarayıcıda konu + bana atanmış, okunmamış eklenince boş sonuç, tüm filtreleri temizleme ve atanmamış + okunmamış birleşimi doğrulandı. Dört dilde yeni filtre seçenekleri kontrol edildi. Ekran kanıtı: .local/pm29-support-search.png. Yerel test kayıtları değiştirilmedi.
