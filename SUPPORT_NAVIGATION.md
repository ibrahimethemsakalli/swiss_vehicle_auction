# PM-30 — URL ile destek görünümü

Destek ve admin destek ekranları uygulanan arama, durum, atama, okunmamış seçimi ve liste sayfasını URL’den okur. Filtre/arama uygulama, temizleme ve sayfalama tarayıcı geçmişine ayrı adım ekler. Aynı görünüm için gereksiz geçmiş girdisi eklenmez. Yenileme ve geri/ileri URL’deki görünümü yeniden kurar; güncel kayıtlar API’den tekrar alınır.

Talep açılınca filtreler ve liste sayfası URL’de korunur; `ticket` ve ayrı `messagePage` ayrıntıyı belirler. Kuyruk düğmesi ayrıntı alanlarını kaldırır, önceki filtreleri ve liste sayfasını korur. Filtre değişiklikleri listeyi ilk sayfaya döndürür. Yeni talep/yanıt sonrası ilgili ayrıntı URL’si açılır. Bildirimlerin mevcut `ticket` bağlantıları desteklenir.

URL yalnızca görünüm bilgisidir. Kullanıcı ekranında admin atama tercihleri yok sayılır; sunucudaki sahiplik/rol denetimi değişmedi. Geçersiz/tekrarlanan parametreler güvenli varsayılanlara döner. Arama 160 karakter, sayfalar 1–10000 arasıdır. Kimlikler doğrulanır; dış yönlendirme parametresi kullanılmaz. Yeni URL’lerde yalnızca izinli görünüm alanları ve varsa DE/FR/IT/EN dil parametresi bulunur.

Arama metni bağlantıda ve tarayıcı geçmişinde görünür. Mesaj, yanıt taslağı, atama gerekçesi veya kimlik doğrulama bilgisi URL’ye yazılmaz. Gönderilmemiş taslaklar bu iş kapsamında kalıcılaştırılmadı. Yeni süre, veri silme veya gerçek API eklenmedi. Veritabanı/migration değişmedi.

## Hedefli doğrulama

Yeni dört test geçti: dört dilde Unicode/özel karakterli URL round-trip, liste/mesaj sayfalarının ayrılması, geçersiz/tekrarlı ve yetki enjekte eden parametreler, gezinme durumlarının serileştirilmesi. Typecheck geçti. Komut: `pnpm test:support-navigation`; mevcut CI birim test taraması yeni dosyayı içerir. Önceki akış testleri çalıştırılmadı.

Tarayıcı doğrulaması (yerel mod): arama ve bana atanmış filtresiyle yenileme; geri/ileri; talep ayrıntısından aynı filtreli kuyruğa dönüş; durum ve okunmamış seçimi; filtre temizleme ve geri tuşuyla tüm seçimlerin geri gelmesi geçti. Ekran kanıtı: `.local/pm30-support-navigation.png`. Mesaj gönderme veya eski kullanıcı akışları tekrar çalıştırılmadı.

## Sonraki öneri

PM-31: gönderilmemiş destek yanıtı veya atama gerekçesi varken sayfadan ayrılma uyarısı eklemek. Taslağı URL’ye veya sunucuya kaydetmeden, dört dilde yalnızca yeni gezinme korumasını test etmek.
