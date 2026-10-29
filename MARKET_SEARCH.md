# PM-21 — Veritabanında arama sıralaması ve sayfalama

28 Ekim 2026. Yerel kapsam tamamlandı. Gerçek ödeme/SMS/harita veya başka harici API kullanılmadı.

## Değişiklik

`/api/market` eşleşen bütün fiyat satırlarını uygulamaya çekip JavaScript ile sıralamak yerine PostgreSQL'de `ORDER BY`, `LIMIT 24` ve `OFFSET` kullanır. Sonra yalnızca o sayfanın ilan detayları yüklenir. Dönüş biçimi, 24 kayıtlık sayfalar, katalog ve dört dilde kullanılan mevcut arayüz korunur. Demo modu değişmedi.

Fiyat hesabı aynıdır: sabit fiyatlı ilanda buyNowPrice veya startPrice; ihalede currentPrice veya startPrice. Eşit fiyat/bitiş zamanında id artan sıralanır; bitişi olmayan kayıtlar sona gelir. Mevcut ACTIVE koşulu, filtreler, model yılı/boş bilgiler, MFK tarihi, örnek ilan davranışı ve arama wildcard anlamları değiştirilmedi. Bu iş ilan kapanış kurallarını yeniden tanımlamaz.

İstek değerleri SQL parametreleridir. Sıralama seçenekleri ve kolon adları kaynak koddaki izinli listelerden gelir. Count, sayfa kimlikleri, ilan detayları ve katalog tek `RepeatableRead` transaction içinde aynı anlık görüntüyü okur. Bir sonraki istek güncel durumu alır; farklı sayfa istekleri arasında tüm piyasanın sabit kalması garanti edilmez.

Yeni DB kolonu/migration gerekmiyor. Bitiş sıralaması için denenen ek indeks ölçülen sorgu planında kullanılmadığından çıkarıldı. Mevcut status/make/model indeksi filtreli sorguda kullanılabiliyor. Daha fazla indeks yalnızca üretim verisi ve sorgu ölçümüyle değerlendirilmelidir.

## Yapılan kontroller

- İki birim testi: SQL parametre güvenliği, izinli kolonlar, deterministik sıralama, NULL bitiş sırası, sayfa sınırları.
- İzole yerel PostgreSQL'de eski Prisma filtre sorgusu ve JavaScript sıralaması referans alınarak **378 karşılaştırma**: 42 filtre bileşimi × 3 sıralama × 3 sayfa. Marka/model/kelime, şehir/posta/kanton, fiyat, kilometre, model yılı, MFK, donanım, tüm seçenek ve sayı alanları, NULL değerler, tam sayı sınırları, wildcard ve saldırı metni dahil.
- API yanıt şekli, no-store ve hatalı filtre/sayfa yanıtları; boş ve sonraki sayfalar.
- İlan kimlikleri okunduktan sonra başka bağlantıdan satış durumu değiştirildi: aynı isteğin sayısı ve detayları tutarlı kaldı, sonraki istek değişikliği gördü.
- 20.000 sentetik ilanla `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` ve her senaryoda beş ölçüm. Geçici test veritabanı kaldırıldı; ana veritabanına test ilanı eklenmedi.
- Typecheck, CI yapılandırma kontrolü. Yeni izole test GitHub Actions'a eklendi; uzak CI/push çalıştırılmadı. Eski kullanıcı, ödeme ve galeri akışları tekrar edilmedi.

## Son yerel performans ölçümü

İki satıcı rolü, farklı fiyatlar, bitiş zamanları, konumlar ve durumlarla 20.000 sentetik ilan. Bunlar eşzamanlı üretim trafik testi veya gerçek kullanıcı verisi değildir. User ve Vehicle istatistikleri ölçüm öncesi ANALYZE edildi.

| Senaryo | Sayfa | Medyan | Beş ölçümde en yüksek |
|---|---:|---:|---:|
| Bitiş zamanı | 1 | 27,22 ms | 56,12 ms |
| Fiyat artan | 1 | 26,78 ms | 28,42 ms |
| Şehir + marka, fiyat azalan | 1 | 22,97 ms | 24,04 ms |
| Fiyat artan, tüm satıcılar | 500 | 108,99 ms | 118,19 ms |

Yeni süreler count, ilan detayları ve katalog dahil `searchMarket` süresidir. Eski yöntem yalnızca fiyat satırlarını getirirken 12.307 satır ve 92,90 ms ölçüldü; bu eski uç noktanın toplam süresi değildir, doğrudan hızlanma oranı olarak kullanılmamalıdır. Yeni yöntem yalnızca 24 ilan kimliği ve o ilanların detaylarını taşır. Katalog yine tüm ACTIVE ilanların benzersiz marka/model çiftlerini içerir.

Planlar: ilk sayfada sınırlı top-N sıralaması; derin sayfada daha geniş sıralama. Count ve CASE fiyat hesabı uygun durumlarda tarama yapmaya devam eder. OFFSET derinlikle maliyetlenir. Büyük hacimde cursor sayfalama, fiyat ifadesi istatistikleri/indeksi ve katalog önbelleği gerçek yük hedefine göre ayrıca değerlendirilmelidir. Çoklu Socket.IO/worker dağıtımı PM-06 operasyon kapsamına bağlıdır ve bu görevde kurulmadı.

Komut: `pnpm test:market-search`. Sadece plan/ölçüm tekrarına ihtiyaç varsa `node --import tsx scripts/market-search-tests.mjs --performance-only`; bu seçenek tamamlanan işlevsel karşılaştırmaları çalıştırmaz. Ham yerel kanıt: `.local/pm21-search-performance.json` (Git dışında). Sabit zaman eşiği CI'ı engellemez; doğruluk hataları engeller.

Sıradaki PM-22: gizlilik gözeten satıcı istatistikleri ve ürün hunisi. Analitik/saklama politikası kararı canlı yayın öncesi ayrıca netleştirilecek; veri bulunmadığında sayaç uydurulmayacak.
