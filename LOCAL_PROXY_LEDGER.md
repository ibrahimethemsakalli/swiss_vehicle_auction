# PM-25I — Yerel ödeme defteri ve tutarlılık denetimi

Admin, `/local-proxy` ekranındaki ödeme defteri düğmesiyle raporu açar. DE/FR/IT/EN desteklenir. Bu salt okunur rapor yalnızca ayrı LocalProxy tablolarını inceler; gerçek ödeme veya sağlayıcı API çağrısı yapmaz.

## Kapsam

- Tahsilat, iade, net CHF toplamı, işlem sayıları ve zaman sıralı hareketler gösterilir. Rezervasyonlar gelir sayılmaz. Hatalı CHF kayıtları da kaydedilmiş toplamda bulunur; farklı para birimleri toplamdan dışlanır ve sayıları gösterilir.
- Tamamlanmış satışta eksik tahsilat, onaylanmış talepte eksik iade, beklenmeyen/mükerrer tahsilat veya iade, birden fazla tahsil edilmiş rezervasyon, eşleşmeyen veya bağlantısız rezervasyon, sahipsiz kayıt ve yanlış tutar/para birimi işaretlenir.
- “Yalnızca sorunlu kayıtlar” filtresi hareket listesini süzer; genel toplamları veya sorun listesini değiştirmez. Kayıt bulunmayan ihale sorunları da denetim bölümünde görünür.
- Rapor tek RepeatableRead transaction içinde yetki kontrolü ve tutarlı veri görüntüsüyle hazırlanır. Her tabloda 10.000 kayıt sınırı vardır; aşılırsa yanıltıcı kısmi toplam yerine hata döner.
- Rapor anlık bir görüntüdür; Yenile ile güncellenir. Otomatik onarım yapmaz. Hesap kimlikleri, özel limitler, rezervasyon kimlikleri ve iade gerekçeleri çıktıya dahil edilmez.
- GET `/api/local-proxy?view=ledger`: yalnızca doğrulanmış yerel admin; alıcılar 403, oturumsuz istek 401, kapalı yerel özellik 404. Yerel ortam/sağlayıcı anahtarı engelleri korunur, yanıt no-store'dur. Yeni migration yoktur.

## Hedefli doğrulama — 2026-10-28

- Dört birim testi: toplamlar, boş veri, salt okunurluk/gizlilik, eksik/mükerrer kayıtlar, tutar/para birimi/rezervasyon eşleşmeleri ve dört dil anahtarları geçti.
- `scripts/local-proxy-ledger-tests.mjs`: geçici PostgreSQL veritabanında doğrudan minimal kayıtlar oluşturuldu; eski teklif/satış akışları tekrarlanmadı. Yetki, toplamlar, bozuk kayıt enjeksiyonu, verilerin değişmeden kalması, gerçek DB tekillik kısıtları, devre dışı mod ve migration uyumu geçti. Geçici DB temizlendi.
- Typecheck geçti. `pnpm test:local-proxy-ledger` komutu ve CI adımı eklendi; uzak GitHub Actions bu tur çalıştırılmadı.
- Tarayıcıda mevcut yerel veriler: 2 ihale, 1 tahsilat CHF 30, 1 iade CHF 30, net CHF 0, tutarsızlık yok. Sorunlu kayıt filtresi boş liste gösterirken toplamlar korundu. Yeni raporda DE/FR/IT/EN, 360 ve 390 px yatay taşma kontrolü geçti.
- Tam test paketi, production build ve tamamlanan kullanıcı akışları tekrarlanmadı. Gerçek API kullanılmadı. Ekran kanıtı: `.local/pm25i-ledger.png` (yerel, Git dışında).

## Sıradaki öneri

PM-25J: bu yerel raporun tarih/sorun filtreleri ve güvenli CSV dışa aktarımı. Dışa aktarılan kapsam ve toplamlar açıkça belirtilmeli; CSV formül enjeksiyonu engellenmeli, özel hesap/limit/gerekçe bilgileri dışarı verilmemeli. Gerçek sağlayıcı mutabakatı ayrı kalır.

PM-25J tamamlandı: [tarih filtreleri, güvenli CSV ve hedefli test sonuçları](LOCAL_PROXY_LEDGER_EXPORT.md).
