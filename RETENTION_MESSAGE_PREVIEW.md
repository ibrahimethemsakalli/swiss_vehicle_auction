# PM-26D — Mesaj saklama aday önizlemesi

> Güncelleme: PM-26E tamamlandı: dört dilde gerekçeli manuel konuşma koruması ve bekleyen/incelenmiş kuyruğu hazır. İnceleme korumayı kaldırmaz; saklama süreleri belirsiz, silme kapalı. Kanıt: [RETENTION_MANUAL_PROTECTION.md](RETENTION_MANUAL_PROTECTION.md). Sıradaki öneri PM-26F korumanın yeniden inceleme/kaldırma karar ve yetki matrisi; uygulamadan önce ürün kararı gerekir.

28 Ekim 2026: kullanıcı son etkinlik tanımını ve ihtiyatlı koruma kapsamını açıkça kabul etti. Bu belge PM-26C'nin mesaj adaylarını kapalı tutan geçici kararının yerini alır. Hukuki yayın veya silme yetkisi değildir.

- Son etkinlik: konuşma oluşturma, son mesaj oluşturma, son randevu oluşturma/güncelleme zamanlarının en yenisi. Okuma/görüntüleme ve Conversation.updatedAt süreyi uzatmaz.
- Eşik: UTC üzerinden 6 takvim ayı; hedef ayda aynı gün yoksa son gün. Eşiğe tam ulaşınca değerlendirilir.
- Araçta herhangi bir teklif, rezervasyon, satış veya ilan raporu; konuşmada açık/kapalı mesaj raporu; bekleyen/kabul edilmiş randevu varsa bütün konuşmanın mesajları korunur. Serbest bırakılmış rezervasyon ve kapanmış rapor da korur. Randevunun geçmişte olması durumunu otomatik değiştirmez.
- Bu bağlar yoksa ve süre dolmuşsa mesajlar yalnızca önizlemede adaydır. Süresi dolmayanlar korunan, geçersiz/gelecek tarihler ve tanınmayan randevu durumları belirsizdir. Kesin koruma bağlantısı belirsiz tarihe göre önceliklidir.
- İşlem, sözleşme/onay ve açık/kapalı uyuşmazlık süreleri belirsiz kalır. Diğer veri kategorilerine mesaj süresi uygulanmaz. Korunan sınıfı kalıcı bir silme kilidi değildir.

Yerel admin ekranı `/admin/retention` dört dilde aday, ilişkiler/randevular nedeniyle korunan, 6 ayı dolmayan ve belirsiz mesaj sayılarını gösterir. Mesaj içeriği ve kimlikler rapora çıkmaz. Tek salt okunur repeatable-read transaction içinde veritabanı zamanı ve ilişkiler yeniden okunur. Hata veya 10.000 mesajlı konuşma sınırı aşımında kısmi rapor sunulmaz. Yenileme yeni ilişkileri yeniden sınıflandırır; eski rapor silme izni değildir. Dosyalar, posta kutuları ve yedekler taranmaz. Şema değişikliği, silme komutu veya zamanlanmış temizlik eklenmedi.

## Sınırlı doğrulama

- Yeni takvim yardımcı fonksiyonu: 2 test (önceki tur); yeni sınıflandırma: 5 test başarılı.
- İzole geçici veritabanı: 14 mesaj senaryosu, 4 aday / 5 ilişkiden korunan / 3 süresi dolmayan / 2 belirsiz; yeni rapor sonrası aday 3, ilişkiden korunan 6. Mesajların değişmediği doğrulandı. Test veritabanı kaldırıldı.
- Typecheck başarılı. Yeni rapor DE/FR/IT/EN, 360 ve 390 px: yatay taşma yok. Mevcut yerel veride mesaj yok; 315 toplam satır, 0 aday, 186 korunan, 129 belirsiz. Pozitif mesaj örnekleri izole testte doğrulandı.
- Gerçek API, tamamlanmış kullanıcı akışları, build ve tüm test paketi tekrar çalıştırılmadı. Yeni komut `test:retention-preview`; izole test CI'a eklendi, uzak CI çalıştırılmadı.

Sıradaki öneri **PM-26E:** gerekçeli manuel koruma kaydı ve inceleme kuyruğu. Süre uydurmadan ve silmeyi açmadan, otomatik ilişkiler dışında delil korunmasını yönetmek.
