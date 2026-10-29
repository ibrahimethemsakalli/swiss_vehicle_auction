# PM-18 — Admin kuyrukları ve dosya sorumluluğu

28 Ekim 2026. Yerel kapsam tamamlandı; gerçek sağlayıcı çağrısı ve para hareketi yapılmadı.

## Yönetim ekranı

`/admin` artık ilanlar, ödeme rezervasyonları, satışlar, itirazlar, kimlikler ve operatör geçmişini aynı filtreli görünümde sunar. İlan/mesaj moderasyonu bağlantıları korunur.

- Her sayfa 20 kayıt; toplam eşleşme ve sayfa sayısı ayrı gösterilir. Sıralama `createdAt` ve eşit tarihlerde `id` ile belirlenir. İlk 100 kayıttan sonraki kayıtlar da erişilebilir. Yeni kayıtlar arasında gezinirken eklenirse offset sayfaları değişebilir; Yenile güncel durumu getirir.
- Kuyruk, durum, arama, başlangıç/bitiş tarihi ve eski/yeni sıralaması. Filtreler Uygula ile işlenir; sayfa 1'e döner. Temizle seçili kuyruğu korur ve diğer filtreleri kaldırır.
- İlanla ilgili kuyruklarda marka/model, Stammnummer ve kayıt ID; kimliklerde e-posta/şirket/ID aranır. Geçmişte kayıt veya operatör ID tam eşleşir. Arama 100 karakterle sınırlıdır; SQL metni olarak birleştirilmez.
- Tarihler UTC oluşturulma zamanını filtreler; bitiş gününün tamamı dahildir. Ters/geçersiz aralık reddedilir. Gösterilen **kayıt yaşı oluşturulmadan beri geçen tam gün sayısıdır**; mevcut durumda bekleme süresi veya SLA iddiası değildir. Yenile ile yeniden hesaplanır.
- İlgili dosyanın mevcut ilan inceleme, satış, itiraz veya kimlik formu açılır. Bu formların karar ve ödeme kuralları değiştirilmedi. Ödeme rezervasyonundan ilişkili satışa geçilir; satış yoksa finansal işlem düğmesi eklenmez. Karardan sonra üst liste Yenile ile güncellenir.
- Admin geçmişindeki olaylar: ilan kararı, kimlik kararı, satış işlemi, itiraz kararı ve PM-18 dosya ataması. Eski kayıtlarda olmayan kimlik/gerekçeler uydurulmaz. PM-17 değerlendirme/ilan şikâyet kararları kendi moderasyon ekranında kalır.

## Dosya sorumluluğu

Bir admin kayıt üzerinde gerekçe ile **üstlenme** veya kendi atamasını **bırakma** yapabilir. Diğer aktif adminin ataması devralınamaz; askıya alınmış veya artık admin olmayan bir sorumlunun dosyası yeniden üstlenilebilir. Bu bir iş koordinasyonu bilgisidir, karar yetkisini genişletmez veya diğer adminlere özel karar kilidi koymaz.

`AdminWorkItem` `(kind, recordId)` benzersizdir. PostgreSQL transaction kilidi ve sürüm kontrolü aynı dosyaya eşzamanlı ilk atamayı ve eski ekrandan yazmayı korur. Atama ve geçmiş olayı aynı transaction içinde kaydedilir. Yanlış sahip, eski sürüm ve olmayan kayıt reddedilir. Kayıtlar silinmez; bırakma sorumluyu boşaltıp sürümü artırır. Operatör, işlem, önceki sorumlu, sürüm, gerekçe ve zaman `admin.assignment` olayıyla saklanır; ekranda düzenleme/silme işlemi yoktur.

Tüm yeni veri uçları güncel veritabanı rolü ve askı durumunu kontrol eder; örnek hesaplar admin işlemi yapamaz. Mutasyon same-origin, katı şema ve 4096 bayt gövde sınırı kullanır. Yanıtlar `private, no-store`; sistem/veritabanı hata ayrıntıları kullanıcıya verilmez. Yeni sahte veya anonim admin veri modu eklenmedi.

## Veri değişiklikleri

`202610280009_admin_queue`: AdminWorkItem ve altı kuyruk için ilgili sıralama indeksleri. Yerel veritabanına uygulandı; Prisma istemcisi üretildi ve yerel sunucu gerçek sağlayıcı anahtarları kapalı olarak yeniden başlatıldı.

Yeni migration/şema karşılaştırması, PM-17 tablolarında mevcut veritabanının `ON DELETE NO ACTION` kuralının şemada açık belirtilmediğini yakaladı. Şemaya mevcut kuralla eşleşen `onDelete: NoAction` eklendi; geçmiş migration veya mevcut silme davranışı değiştirilmedi.

## Sadece değişen alanların kanıtı

- Dört yeni birim testi: sorgu/durum/tarih sınırları, UTC son gün, atama yetkisi alanı enjeksiyonları ve dört dil metin uyumu — geçti.
- İzole PostgreSQL: **altı kuyruğun her birinde 105 kayıt**, eşit tarihlerle altı sayfa ve tekrar etmeyen 105 ID; arama/durum/tarih/boş sayfa; rol/askı; iki eşzamanlı üstlenmeden yalnızca biri; yanlış sahip ve eski sürüm; bırakma/yeniden üstlenme; pasif sorumlu kurtarma; tarihçenin korunması; HTTP oturum/origin/gövde kontrolleri — geçti.
- Yeni işlemler sonunda 105 rezervasyon AUTHORIZED ve 105 ilan PENDING_VERIFICATION kaldı; ödeme transaction sayısı sıfır. Sentetik fixture'lar satış/ödeme iş akışlarını çalıştırmadan doğrudan izole veritabanına kondu; test veritabanı kaldırıldı.
- Prisma migration/schema diff sıfır; typecheck geçti.
- Tarayıcı: standart kullanıcı admin verisine erişemedi. Yerel adminle örnek satış arandı, üstlenilip bırakıldı, her iki olay operatör/gerekçe ile geçmişte görüldü. Seçilen tek satışın mevcut detayına erişildi; satış veya ödeme kararı gönderilmedi.
- Tarih alanının seçilen değeri filtre state'ine taşımaması tarayıcıda yakalanıp yerel `onInput` işlemesiyle düzeltildi. Ters aralık hata verdi; geçerli aynı gün aralığı geçmişi 3 kayıttan 2 yeni atama olayına daralttı. Temizle kuyruk seçimini korudu. 31 ilan 20 + 11 olarak iki sayfada, tekrarsız gösterildi.
- DE/FR/IT/EN × 360/390 px: yeni filtreler, geçmiş metinleri, ID'ler ve tarih aralığı hata mesajında yatay taşma yok. Kanıtlar `.local/pm18-browser-checks.json` ve `.local/pm18-admin-mobile.png` (yerel, Git dışında).
- Tamamlanmış galeri, ihale, ödeme ve kayıt iş akışları yeniden test edilmedi. Tam production build, gerçek sağlayıcı kabulü ve uzak GitHub Actions bu turda çalıştırılmadı. Kullanıcı garajının eski varsayılan 100 kayıtlık genel listeleri bu admin kapsamının dışındadır; yeni admin çalışma alanı bunlara dayanmaz.

Hedefli komut: `pnpm test:admin-queue`. Yeni izole entegrasyon komutu GitHub Actions yapılandırmasına eklendi; push yapılmadı.

Sıradaki PM-19: ortak teslim kontrol listesi ve teslim özeti. Alıcı teyidi, itiraz süresi, tahsilat zamanı ve hukuki belge niteliği için ürün kararları ayrıca netleştirilmeli; mevcut tahsilat kuralları veya ücretler sessizce değiştirilmemeli.
