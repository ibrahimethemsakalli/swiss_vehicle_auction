# PM-25J — Tarih filtreleri ve güvenli CSV

Yerel adminin `/local-proxy` ödeme defterinde DE/FR/IT/EN başlangıç/bitiş tarihi, temizleme ve CSV indirme alanları eklendi. Yeni endpoint, migration veya sağlayıcı entegrasyonu yoktur. Mevcut yetkili, salt okunur rapor görüntüsü tarayıcıda filtrelenir; veritabanı değişmez.

## Kapsam ve sınırlar

- Tarihler UTC takvim günleridir. İki uç da dahil, boş uç sınırsızdır. Takvim dışı/ters aralık reddedilir; liste ve filtreli toplamlar gösterilmez, CSV düğmesi kapanır. Tarih girişleri input ve change olaylarını işler.
- Tarih ve mevcut sorun filtresi birlikte uygulanır. Filtreli tahsilat/iade/net CHF toplamları aynı hareket kümesinden hesaplanır. Genel toplamlar ve tüm veri üzerindeki tutarlılık denetimi değişmez; tarih dışında veya hareket kaydı bulunmayan eksikler böylece gizlenmez.
- CSV, ekranda seçilen hareketleri ve aynı toplamları içerir. Rapor zamanı, aralık, sorun filtresi ve kapsam açıklaması dosyaya eklenir. Boş sonuçta başlıklar ve sıfır toplamlar indirilir. Bu, tam denetim raporu veya gerçek muhasebe belgesi değildir.
- CSV istemcide Blob olarak üretilir, sabit güvenli dosya adıyla indirilir; geçici URL sonradan serbest bırakılır. Yeni dış ağ isteği yoktur. Yenileme sırasında indirme devre dışıdır; dosya mevcut görüntünün zamanını içerir.
- Yalnızca ihale kimliği, işlem türü, tutar, para birimi ve UTC zaman alanları dışa aktarılır. Hesap/rezervasyon kimlikleri, özel limitler ve talep/karar gerekçeleri eklenmez.
- UTF-8 BOM, CRLF, her hücrede tırnak ve çiftlenmiş iç tırnak kullanılır. Kontrol karakterleri boşluğa çevrilir; boşluk/BOM arkasına saklanmış olanlar dahil `= + - @` başlangıçları apostrofla etkisizleştirilir. Negatif net tutarlar da güvenlik nedeniyle metin hücresi olarak yazılır. Tutarlar noktalı iki ondalıkla, BigInt kuruş toplamlarından üretilir; CHF dışı tutarlar toplamlara dahil edilmez.

## Yalnızca değişen kapsamın testleri — 2026-10-28

- `pnpm test:local-proxy-ledger-export`: dört test geçti. UTC gün sınırları/açık aralıklar, artık yıl/geçersiz tarih/ters aralık, sorun filtresiyle toplam eşleşmesi, verinin değişmemesi; formül enjeksiyonu, tırnak/virgül/kontrol karakterleri; dört dil CSV kapsamı, izinli alanlar, kesin ondalıklar ve boş çıktı doğrulandı.
- Typecheck geçti. Yeni test mevcut CI unit keşfine otomatik dahildir; uzak CI çalıştırılmadı.
- Tarayıcıda tarih girişi değişikliklerinin filtreye yansımama durumu giderildi. Ters aralıkta dört dilde hata/indirme engeli, 360/390 px taşma kontrolü geçti. Boş tarih sonucunda filtreli toplamlar sıfırlandı; genel toplamlar korundu. Sorun filtresiyle birlikte seçim ve temizleme doğrulandı.
- 2026-10-28 aralığındaki CSV tarayıcıdan indirildi ve dosya okundu: bir CHF 30 tahsilat, bir CHF 30 iade, net CHF 0, doğru tarih/kapsam ve yalnızca izinli sütunlar. Yerel ekran kanıtı `.local/pm25j-ledger.png`.
- Gerçek API, eski teklif/satış/iade iş akışları, DB testleri, tam test paketi ve production build çalıştırılmadı; bunların kodu bu aşamada değişmedi.

## Sıradaki öneri: PM-26

Yerel prototipi yeni alt adımlarla büyütmek yerine canlıya hazırlık ve karar matrisi: mevcut ürün/sağlayıcı sınırlarından tek bir yayın kontrol listesi çıkarılması, işletme ve otomatik teklif kurallarındaki açık kararların belirlenmesi, gerçek ödeme/SMS/e-posta doğrulamalarının sorumlu ve kabul ölçütleriyle ayrılması. Önce belge ve kapsam netleştirilir; gerçek API veya para hareketi yapılmaz.

PM-26 tamamlandı: [tek canlıya hazırlık ve karar matrisi](GO_LIVE_MATRIX.md). İlk yayın kart + manuel teklif; otomatik teklif/TWINT kapalı. Prototipin gerçek ödeme/ilan entegrasyonu tamamlanmış sayılmaz.
