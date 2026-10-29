# PM-24 — Bayi profili ve CSV stok taslakları

28 Ekim 2026: yerel kapsam tamamlandı. Gerçek servis çağrısı yapılmadı.

## Kullanım ve sınırlar

- Bayi hesabının panelinden `/dealer` açılır. E-posta, telefon ve hesap kimliği doğrulanmış, sicil numarası girilmiş DEALER rolü gerekir. Askıya alınmış ve örnek vitrin hesapları erişemez. Admin rolü bu kontrolü atlamaz.
- Şirket adı, kanton, şehir, posta kodu ve açıklama açık yayımlama seçimiyle `/dealers/[id]` adresinde görünür. Telefon, e-posta ve sicil numarası API yanıtına eklenmez. Şirket bilgileri bayi beyanıdır; ticaret sicili bağlantısı ve doğrulanmış şirket rozeti yoktur.
- Vitrinde yalnızca aktif, örnek olmayan, süresi dolmamış ve satışı iptal edilmemiş ilanlar 12'li sayfalanır. Taslaklar görünmez.
- UTF-8 CSV, virgül/noktalı virgül, BOM, tırnak ve çok satırlı hücreler desteklenir. En fazla 50 kayıt ve 256000 bayt; hesapta toplam 20 açık taslak. Başlıklar ve enum değerleri ekranda, indirilebilir örnek şablonda bulunur.
- Taslak için yalnızca marka/model zorunludur. Bilinmeyen yıl, donanım, tarih ve fotoğraflar uydurulmaz. İçe aktarma yalnızca özel taslak oluşturur; yayımlama için mevcut eksik bilgi/fotoğraf tamamlama ve inceleme süreci gerekir.
- Önizlemede kayıt/alan/hata gösterilir. Bir hatalı kayıt tüm aktarımı engeller. Hata CSV'si ham hücre içeriğini içermez. Kayıt numarası fiziksel satır değil, başlıktan sonraki mantıksal kayıt sırasıdır.
- Bilinmeyen başlıklar, formül başlangıçları, geçersiz değerler ve yinelenen VIN reddedilir. VIN kontrolü mevcut araçlar ve sahibinin taslaklarıyla yapılır. Fotoğraf URL'si indirilmez.
- Kullanıcı kilidiyle kota ve eşzamanlı aktarım korunur. Aynı istek kimliği tekrar gönderilirse aynı taslaklar döner. İçerik özeti ve kurallar sunucuda yeniden kontrol edilir. Profil sürümü eski güncellemelerin üzerine yazılmasını engeller.
- Dosya seçimi önizlemeyi sıfırlar; geçersiz/büyük yeni dosya önceki içeriğin aktarılmasına izin vermez.

## Veri ve doğrulama

Migration: `202610280014_dealer_inventory`. DealerProfile ve DealerImport tabloları; aktarım kaydında ham CSV yerine içerik özeti, istek kimliği ve oluşturulan taslak kimlikleri tutulur.

Hedefli komut: `pnpm test:dealer-inventory`. Üç unit testi ve izole PostgreSQL testleri geçti: rol/kimlik, sahiplik, kota, atomiklik, paralel istek/tekrar, VIN, profil sürümü/yayımı, özel alanların gizliliği, aktif stok sayfalaması, HTTP origin/gövde sınırı ve migration farkı. Geçici test veritabanı silindi. Typecheck ve CI yapılandırma kontrolü geçti; yeni test GitHub Actions'a eklendi (uzak çalışma bu adımda başlatılmadı).

Tarayıcı: yerel bayiyle profil kaydı, hatalı CSV ve kapalı aktarım, iki taslak oluşturma/kota 18, taslak düzenleyiciye doğru aktarım, vitrinde taslakların görünmemesi, dosya seçimi ve fazla büyük dosyada eski önizlemenin kaldırılması geçti. Yeni ekran/hata/format açıklamaları DE/FR/IT/EN, 360 ve 390 px'de yatay taşma olmadan kontrol edildi. Geçici iki taslak, aktarım kaydı ve profil temizlendi. Tamamlanan ödeme/ihale/kullanıcı akışları tekrar test edilmedi; production build bu adımda çalıştırılmadı.

## Ayrı kalanlar

Gerçek ticaret sicili doğrulaması, ücretli bayi planı/abonelik, harici stok entegrasyonu ve fotoğraf aktarımı yoktur. İçe aktarma kayıtlarının saklama politikası işletmeyle belirlenecek. Bayi sayfaları mevcut noindex korumasını korur; bayi dizini/SEO yayını ayrı karardır.
