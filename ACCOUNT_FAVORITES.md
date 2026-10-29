# PM-13 — Hesap favorileri

Yerel kapsam 28 Ekim 2026 tarihinde tamamlandı. DE/FR/IT/EN desteklenir.

## Davranış

- Giriş yapan kullanıcının favorileri PostgreSQL'de kullanıcı/araç benzersiz anahtarıyla saklanır. Misafir favorileri yalnızca tarayıcıda kalır; girişte otomatik aktarılmaz.
- Kullanıcı açıkça aktarımı seçerse iki liste birleştirilir; mevcut hesap kayıtları korunur. Tekrarlar çoğaltılmaz, geçersiz veya erişilemeyen ilanlar atlanır. Başarılı işlemden sonra yalnızca işlenen misafir kayıtları tarayıcıdan temizlenir.
- Hesap başına sınır 200 kayıttır. Kotayı aşan birleştirme bütünüyle reddedilir; kısmi kayıt veya misafir listesinin kaybı oluşmaz. Eşzamanlı yazmalar kullanıcı satır kilidiyle korunur.
- Hesap listesi açılışta, pencereye dönünce ve 30 saniyelik aralıklarla yenilenir. Farklı cihazlar aynı hesap listesini okur; favori eklemeleri için anlık WebSocket eşitlemesi yoktur.
- Satılmış, iptal edilmiş ve süresi dolmuş ilanların mevcut durum gösterimi korunur. Sonradan özel duruma geçen kayıt için erişilemez ilan satırı ve kaldırma düğmesi gösterilir. Araç fiziksel olarak silinirse ilişkili favori de silinir.
- Hesap değişiminde eski hesabın listesi gösterilmez. Başarısız sunucu yazması sessizce misafir kaydına dönüştürülmez.

## Veri ve erişim

`202610280005_favorites` migration'ı yerel veritabanına uygulandı (16 migration). `GET/POST /api/favorites` oturum sahibini esas alır; istemciden sahip kimliği kabul etmez. Yazma aynı origin kontrolü, katı şema ve 24.000 bayt gövde sınırı kullanır. Yanıtlar private/no-store ve Vary: Cookie ile döner. Askıya alınmış ve örnek vitrin kullanıcıları reddedilir. Ödeme veya ihale kayıtları değiştirilmez.

## Hedefli doğrulama

- İki yeni birim testi: komut sınırları/sahiplik enjeksiyonu, misafir liste ayrıştırma ve dört dil anahtar/değişken eşliği geçti.
- İzole PostgreSQL testi: migration, bağlantı yenilendiğinde kalıcılık, kullanıcı ayrımı, açık birleştirme/tekrar/atlama kuralları, eşzamanlı ekleme, erişilemez kaydı kaldırma, 200 kayıt kotasında atomik ret ve HTTP yetki/origin/gövde/cache kontrolleri geçti. Test veritabanı temizlendi; ödeme işlemi oluşturulmadı.
- Typecheck geçti. Komut: `pnpm test:favorites`. GitHub Actions'a hedefli DB testi eklendi; bu değişikliklerin uzak CI sonucu henüz doğrulanmadı.
- Tarayıcıda yeni favoriyi hesaba ekleme, yenilemeden sonra korunması, kaldırma ve tekrar yenilemede kaldırılmış kalması doğrulandı. Misafir kaydının otomatik aktarılmadığı ve hesap listesinden ayrı kaldığı gözlendi. Yeni açıklamalar dört dilde kontrol edildi.
- Tarayıcıda önceden kalmış misafir kayıtlarını değiştirmemek için toplu aktarım düğmesi çalıştırılmadı; birleştirme davranışı izole DB testinde doğrulandı. İkinci fiziksel cihaz testi yapılmadı.
- Tarayıcı testi için eklenen Audi favorisi hem hesaptan hem misafir listesinden kaldırıldı; önceki misafir kaydı korundu.

Gerçek sağlayıcı API'si, eski ihale/ödeme/sayaç iş akışları ve tam production build tekrar çalıştırılmadı.
