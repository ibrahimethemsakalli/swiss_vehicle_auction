# PM-04 — Yerel hesap güvenliği

E-posta doğrulama, e-posta ile şifre kurtarma ve admin için parola + e-posta kodu ile iki aşamalı giriş hazırdır. Gerçek e-posta göndericisi henüz seçilmedi; dış API çağrısı yapılmaz. Admin için üretim ortamında giriş, bir e-posta sağlayıcısı eklenene kadar kapalı kalır. Bu sürüm TOTP/passkey sağlamaz.

## Yerelde deneme

1. Yerel PostgreSQL çalışırken `pnpm db:deploy` ve `pnpm db:generate` çalıştırın.
2. `.env` içindeki NEXTAUTH_URL, açacağınız `http://127.0.0.1:3000` adresiyle aynı olmalı. `pnpm dev:local-security` başlatın. Ödeme simülasyonu da gerekiyorsa mevcut `pnpm dev:local-payments` artık mesaj simülasyonunu da etkinleştirir.
3. `/verify` üzerinden e-posta isteyin; `.local/messages` klasöründeki en yeni JSON dosyasında alıcı, amaç, süre ve tek kullanımlık kod bulunur. Hesabınızla giriş yaparak kodu aynı ekranda doğrulayın. `/reset-password` e-posta ile kurtarma ve mevcut çevrimdışı kurtarma kodlarını birlikte sunar.
4. Admin girişinde önce e-posta/parola alanlarını doldurun, “Admin kodu iste” düğmesine basın. `ADMIN` amaçlı yerel mesajdaki kodu girerek oturum açın. Diğer roller için ikinci kod gerekmez. Sabit bir evrensel kod yoktur.

Mesajlar yalnızca `.local/messages` içinde tutulur; HTTP üzerinden sunulmaz, Git’e eklenmez. Dosyalar yerel geliştiriciye açıktır ve gerçek posta kutusu güvenliği anlamına gelmez. Süresi geçen test mesajlarını silebilirsiniz. Kodlar loglara veya API yanıtlarına yazılmaz.

Yerel simülasyon `LOCAL_TEST_MESSAGES=true`, development, loopback HOST ve HTTP origin, loopback `autoveri` veya `_test` veritabanını birlikte gerektirir. Wi-Fi/public binding ve üretimde devreye girmez. Üretim gönderimi için sağlayıcı ve alan adı doğrulaması PM-05 bağımlılığıdır.

## Güvenlik kuralları

- E-posta doğrulama/kurtarma kodları 30 dakika, admin/SMS kodları 5 dakika geçerlidir; veritabanında SHA-256 özeti saklanır. Her hesap/amaç için son kod geçerli; kod bir kez tüketilir.
- Mesaj isteği hesap başına 5/15 dakika ve toplam 100/saat; üretim hesap/amaç başına 3/15 dakika; doğrulama 5/15 dakika. Mevcut giriş/SMS sınırları korunur.
- Kurtarma parolaları en az 12 karakter, en çok 72 UTF-8 bayt. Sıfırlama authVersion artırır, eski oturumları ve kalan kurtarma/doğrulama kodlarını iptal eder. Admin ikinci faktörü sıfırlamayla kaldırılmaz.
- Önceden açılmış, ikinci faktörsüz admin JWT’leri HTTP ve Socket.IO tarafında reddedilir.
- Yeni ilan, medya yükleme, teklif ve rezervasyon işlemleri e-posta doğrulaması ister. Mevcut satış/itiraz/rezervasyon iadesi işlemleri engellenmez.
- Kayıt ve SMS akışları +41 (9 ulusal rakam) ve +423 (7 ulusal rakam) kabul eder. Biçim kontrolü numaranın tahsis edildiğinin veya gerçek SMS tesliminin kanıtı değildir.
- Yerel üç örnek hesabın e-posta doğrulaması, mevcut kontrollü `verify-local-logins.ts` aracıyla tamamlandı; parolalar değişmedi. Gerçek hesaplar otomatik doğrulanmadı.

## Hedefli doğrulama

`pnpm test:security` yalnızca izole `_test` veritabanında geçici hesaplarla PM-04 kontrollerini çalıştırır; hesaplar ve oluşturduğu mesajlar temizlenir. İhale/satış/ödeme akışlarını tekrar çalıştırmaz.
