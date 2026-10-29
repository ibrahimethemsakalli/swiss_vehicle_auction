# PM-20 — Arama motoru ve paylaşım hazırlığı

28 Ekim 2026. Yerel teknik kapsam tamamlandı; canlı indeksleme açılmadı.

- Ana sayfa ve herkese açık ilanlarda DE/FR/IT/EN başlık, açıklama, Open Graph ve Twitter metadata sunucuda üretilir. İlan içeriği de ilk HTML içinde gelir; mevcut canlı güncelleme, teklif ve galeri davranışı korunur. Taslak/bekleyen/reddedilen veya bulunamayan ilan 404 verir.
- Dil URL stratejisi `?lang=de|fr|it|en`; varsayılan DE. URL, herkese açık sayfalarda tarayıcının eski dil tercihinden önceliklidir. Dil değişimi URL'yi günceller, arama parametrelerini korur. Ana liste–ilan–geri bağlantıları seçili dili taşır. Kullanıcının ilan açıklaması otomatik çevrilmez.
- Onaylanmış `PUBLIC_SITE_URL` yoksa canonical/hreflang ve mutlak paylaşım bağlantısı üretilmez; alan adı tahmin edilmez. Alan adı girilince her dilin kendine canonical'ı, dört alternatif ve DE x-default üretilir. Filtre/favori/arama parametreli ana sayfalar noindex; canonical temiz dil URL'sidir.
- İndeksleme için ayrıca `SEO_INDEXING_ENABLED=true`, production, DB yapılandırması ve iki yerel test modunun kapalı olması gerekir. Varsayılan kapalıdır. Test/staging ortamlarını ayrıca erişim kontrolüyle koruyun; noindex bir kimlik doğrulama mekanizması değildir.
- Özel paneller, API ve test yolları `X-Robots-Tag: noindex, nofollow` alır. Yerel ortamda tüm yanıtlar bu başlığı alır. robots.txt, botların noindex yönergesini okuyabilmesi için taramaya izin verir; yayına hazır ortamda sitemap bağlantısını ekler.
- Sitemap yalnızca ACTIVE, süresi geçmemiş ihaleler veya aktif sabit fiyat ilanlarını içerir. Örnek ilanlar, örnek/askıya alınmış/test e-postalı sahipler, LOCAL test ilanları ve iptal edilmiş satışlar dışlanır. SOLD/EXPIRED ilanlar paylaşılabilir ama noindex kalır. `/sitemap.xml` dizini ve `/sitemaps/0` vb. parçalar, parça başına 1.000 ilanı dört dilde taşır. Sahte son değişiklik tarihi yazılmaz. Offset sayfalama canlı değişiklikler arasında tam anlık görüntü garantisi vermez; üretim hacmi/sorgu maliyeti PM-21 kapsamındadır.
- Yapılandırılmış veri yalnızca indekslemeye uygun gerçek aktif ilanlarda Schema.org `Car` olarak çıkar. Bilinen model yılı ve kilometre kullanılabilir; ilk tescil yılı model yılı sayılmaz. İhale teklifi satın alma fiyatı değildir: `Offer`, değerlendirme puanı, VIN ve kişisel adres eklenmez. JSON script kaçışı uygulanır. Zengin arama sonucu garantisi verilmez.

## Yapılan yeni kontroller

- Dört hedefli birim testi: canlı yayın koşulları, dört dil/canonical/kapanış durumları, JSON ve görsel URL güvenliği, sitemap ve dil parametresi.
- Geçici yerel PostgreSQL: herkese açık veri seçimi/özel ilan reddi; örnek, kapanmış, askıya alınmış ve test hesaplı ilanların dışlanması; 1.001 ilanla iki sitemap parçasında tekrar/kayıp kontrolü. Geçici veritabanı kaldırıldı.
- Yerel HTTP: dört dilde HTML lang, başlık, ilk HTML içinde ilan, OG; özel/test yanıtlarında noindex; boş yerel sitemap ve 404.
- Tarayıcı: dil seçiminin URL/metadata ile eşleşmesi ve ana listeden ilana geçerken dilin korunması; 360/390 px dil değişimi. Eski satış/ödeme/galeri akışları tekrarlanmadı.
- Typecheck. GitHub Actions'a yalnızca yeni izole SEO testi eklendi; uzak çalıştırma/push bu görevde yapılmadı.

## Canlıya çıkışta kalanlar

İşletme ve alan adı teyidi, hukuki yayın hazırlığı, gerçek hosting üzerinde bot erişimi, görsel erişimi ve arama motoru doğrulaması. Search Console'a gönderim veya gerçek sosyal platform önizlemesi yapılmadı. Yerel test, arama motorunun gerçekten indekslediğini kanıtlamaz.

Kaynaklar: [Next metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata), [Next sitemap](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap), [Google noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing), [Schema.org Car](https://schema.org/Car).
