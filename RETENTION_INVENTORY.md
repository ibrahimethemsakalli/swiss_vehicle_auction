# PM-26C — Salt okunur saklama envanteri

> Güncelleme: PM-26E tamamlandı: dört dilde gerekçeli manuel konuşma koruması ve bekleyen/incelenmiş kuyruğu hazır. İnceleme korumayı kaldırmaz; saklama süreleri belirsiz, silme kapalı. Kanıt: [RETENTION_MANUAL_PROTECTION.md](RETENTION_MANUAL_PROTECTION.md). Sıradaki öneri PM-26F korumanın yeniden inceleme/kaldırma karar ve yetki matrisi; uygulamadan önce ürün kararı gerekir.

> Güncel durum (28 Ekim 2026): PM-26D tamamlandı: kullanıcı son etkinlik ve ihtiyatlı koruma kapsamını onayladı; yalnızca mesajlar için salt okunur aday önizlemesi açıldı. Kurallar ve hedefli doğrulama: [RETENTION_MESSAGE_PREVIEW.md](RETENTION_MESSAGE_PREVIEW.md). İşlem/uyuşmazlık süreleri belirsiz; silme ve hukuki yayın kapalı. Sıradaki öneri PM-26E gerekçeli manuel koruma kaydı ve inceleme kuyruğu. Aşağıdaki PM-26B/C kontrol notları tarihsel kapsamı anlatır.

28 Ekim 2026. Admin ekranı `/admin/retention`, GET `/api/admin/retention`. DE/FR/IT/EN desteklenir. Admin panelinden bağlantı vardır. Yenile ile yeni görüntü alınır; rapor veri silmez, süre veya koruma kaydı yazmaz.

## Sınıflandırmanın kesin sınırı

- `public` şemasındaki tablolar (Prisma migration geçmişi hariç) katalogdan bulunur; her tablo için tam satır sayısı alınır. Kişisel kayıt, mesaj içeriği, hesap/işlem kimliği veya sır dönmez. Toplamlar BigInt ile hesaplanıp ondalık string olarak iletilir.
- Ödeme, sözleşme/onay ve delil tabloları korunan sınıfındadır. Tam liste `src/lib/retention-inventory.ts` içindedir. Bu, raporda adaylardan hariç tutmadır; mevcut silme worker'larına eklenmiş bir koruma kilidi değildir.
- ChatMessage için aynı konuşmadaki herhangi bir rapor veya ilgili araçtaki teklif, satış ya da ilan raporu bağlantısı ihtiyatlı biçimde tüm konuşma mesajlarını korunan sayar. Kapanmış rapor da korumadan çıkarılmaz. Bu, her mesajın hukuken delil olduğu iddiası değildir; potansiyel delilin yanlışlıkla aday gösterilmesini önler.
- Diğer kayıtlar (yeni/bilinmeyen tablolar ve LocalProxy tabloları dahil) belirsizdir. Bir bağlantı bulunmaması silmenin güvenli olduğunu kanıtlamaz. Çok eski mesajlar dahi son etkinlik ve koruma kapsamı netleşmeden aday olmaz.
- **Bu ilk sürümde silme adayı sayısı daima 0'dır:** eksiksiz onaylanmış ve kaynaklara eşlenmiş adaylık kuralı henüz yoktur. Bu durum API'de `candidateAssessment: blocked_pending_rules` ve dört dilde ekran açıklamasıyla belirtilir. Süresi dolmuş veri olmadığı veya silme değerlendirmesinin tamamlandığı iddia edilmez. Sahte bir olumlu aday üretilmedi.
- Destek posta kutuları, dosya tabanlı teknik/güvenlik logları ve yedekler taranmaz; `unscanned` içinde bildirilir, boş veya sıfır sayılmaz. Süreleri bilinmeyen işlem/uyuşmazlık kayıtlarına süre atanmaz. Mevcut temizlik kodları değiştirilmedi.

## Erişim ve salt okunurluk

Mevcut LOCAL_PROXY_ENGINE yerel/provider-free kapısı tekrar kullanılır: açık bayrak, development/test, loopback PostgreSQL ve izinli DB adı; gerçek sağlayıcı anahtarları ve production reddedilir. Bu seçim envanteri otomatik teklif motoruna veya ödeme işlerine bağlamaz; bayrak bu turda değiştirilmedi.

Uç yalnızca GET sunar. Mevcut `requireUser`/NextAuth oturumu (admin MFA kontrolü dahil) ve transaction içindeki güncel admin/suspended/isSample kontrolü geçmelidir. Yanıtlar `private, no-store` olur. Hesap değişiminde UI raporu sıfırlanır. Yetkisiz 401/403, kapalı yerel ortam 404, sorgu hatası 503 döner; iç hata veya kısmi rapor verilmez.

RepeatableRead transaction içinde ilk işlem `SET TRANSACTION READ ONLY`; ardından sorgu başına 2 saniye timeout, transaction için 15 saniye ve katalog için 100 tablo sınırı. Tablo adları istemciden alınmaz; katalogdan gelen adlar yine de kaçışlanır. Boyut veya süre sınırı aşılırsa kısmi toplam gösterilmez. Büyük üretim DB performansı bu yerel raporla kanıtlanmış sayılmaz.

## Yalnızca yeni kapsamın doğrulaması

- 3 birim testi geçti: belirsiz süreler için aday üretmeme, delil sınıfı, karışık mesaj sayımı ve güvenli sayı sınırını aşan kesin toplamlar, dört dil etiketleri.
- İzole PostgreSQL/HTTP handler kontrolü geçti: 401/403 ve askıya alınmış admin, no-store, 2000 yılına ait mesajların belirsiz kalması, kapanmış raporun konuşma delillerini koruması, kişisel metin/kimliklerin çıktıda bulunmaması, kaynak mesajların değişmemesi ve kapalı mod. Rapora kasıtlı yazma enjekte edildiğinde PostgreSQL READ ONLY reddetti; hesap verisi değişmedi. Test fixture'ındaki ilan türü/MFK alanı eksikleri düzeltildi; geçici DB her denemeden sonra temizlendi.
- Typecheck geçti. Test komutu `pnpm test:retention-inventory`. Unit keşfi otomatik; izole test CI'a eklendi. Uzak CI bu tur çalıştırılmadı.
- Tarayıcı: mevcut admin oturumunda yeni ekran raporu **315 toplam / 0 aday / 186 korunan / 129 belirsiz** gösterdi. Bunlar o andaki yerel sayımlardır. Dört dilde 360/390 px yatay taşma yok. Kanıt `.local/pm26c-retention.png`.
- Gerçek API, tam test paketi, eski iş akışları veya production build çalıştırılmadı. Yeni migration ve mevcut uygulama verilerinde yazma/silme yok.

## Sıradaki öneri PM-26D

Mesajların “son etkinlik” tanımını ve işlem/rapor/randevu ilişkilerinin koruma kapsamını kullanıcıyla kesinleştirmek; ardından yalnızca salt okunur aday önizlemesini bu onaylara göre geliştirmek. İşlem/uyuşmazlık süreleri belirsiz kalabilir; bu kategoriler otomatik aday yapılmaz. Silme worker'ı bu sonraki önerinin de kapsamında değildir.
