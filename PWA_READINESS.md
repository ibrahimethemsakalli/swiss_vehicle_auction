# PM-25B — Kurulum ve güvenli çevrimdışı ekran

28 Ekim 2026: yerel hazırlık tamamlandı. Gerçek sağlayıcı/API, yeni bağımlılık veya veritabanı migration'ı yok.

## Eklenenler

- `/install`: DE/FR/IT/EN kurulum açıklamaları, hazırlık/hata durumu, destekleyen tarayıcının kendi kurulum istemini kullanıcı tıklamasıyla açma ve Safari/diğer tarayıcılar için yönerge. Kurulum kabulü tek başına başarı sayılmaz; kurulu durumu `appinstalled` veya standalone modundan gelir.
- `/manifest.webmanifest`: uygulama kimliği, kapsam, başlangıç URL'si, standalone pencere, tema ve yerel 192/512 PNG ikonları; ayrıca maskable ve Apple ikon tanımı. İkon repo içinde SVG geometriyle üretildi; dış fotoğraf/lisans yok.
- `/sw.js`: yalnızca aynı origin'deki GET belge navigasyonunu ağdan alır (`cache: no-store`). Ağ isteği başarısız olursa sabit HTML döndürür. Sunucunun 401/403/404/503 gibi gerçek yanıtları değiştirilmez.
- API ve `_next` yolları, POST/diğer metotlar, RSC/ön yükleme, resim ve başka origin istekleri service worker tarafından ele alınmaz. CacheStorage, IndexedDB, işlem kuyruğu, background sync, push veya otomatik yeniden gönderme yoktur.
- Çevrimdışı HTML service worker kodunda sabittir. Kullanıcı, ilan, fotoğraf, mesaj, ödeme veya URL parametresi içermez. Dört dil seçimi CSS/radyo kontrolleriyle, JavaScript ve internet olmadan çalışır; ilk dil DE'dir. Önceki dil/hesap bilgileri okunmaz. “Tekrar dene” aynı adrese tam navigasyon yapar.
- Ekranda hiçbir form yoktur. CSP dış kaynakları ve betikleri kapatır. Offline yanıt `503`, `no-store`, `noindex` taşır. `/offline.html` yalnızca bu ekranın çevrimiçi önizlemesidir.

## Yaşam döngüsü ve sınırlar

Production varsayılan açık, development varsayılan kapalıdır. `PWA_ENABLED=true` yerel testte açar; `PWA_ENABLED=false` kaydı kaldırır. Kaldırılmış worker'ın mevcut kontrolü açık sekmeler kapanıp yeniden açılana kadar sürebilir. Kayıt kaldırma yalnızca bu uygulamanın `/sw.js` kaydını hedefler; başka kayıt/önbellek silmez. Yeni sürümler açık işlemleri kesmemek için zorla `skipWaiting` veya sayfa yenilemesi yapmaz; eski sekmeler kapandıktan sonra etkinleşir.

Worker hiçbir uygulama yanıtını saklamaz. Bu, tarayıcının zaten açık sayfa/React belleğini veya eski history görüntüsünü zorla silme anlamına gelmez; ekrandaki açıklama bunu belirtir. Kurulum çevrimdışı alışveriş sağlamaz. Kesintiye uğrayan işlemden sonra kullanıcı güncel sunucu durumunu kontrol etmelidir.

Kurulum/worker için güvenli bağlam gerekir: HTTPS veya localhost. Telefonun HTTP Wi-Fi adresi bu kapsamda yeterli değildir. Gerçek telefonda ana ekrana yükleme, işletim sistemi kurulum diyaloğu ve HTTPS dağıtım kabul testi yapılmadı. Tarayıcı otomatik kurulum olayı sunmazsa sahte kurulum düğmesi gösterilmez. Native mağaza paketi, push izni/teslimatı ve çevrimdışı form taslağı bu kapsamda yoktur.

## Üretim ve test

- `pnpm pwa:generate`: dört dilde statik ekran, worker ve yerel ikonları üretir. Kaynak: `scripts/generate-pwa.mjs`; oluşturulan dosyalar Git'e dahildir.
- `pnpm test:pwa`: oluşturulan metinlerin kaynakla eşleşmesi ve dört hedefli test. Ağ kesilmesi/fallback, özel yol/POST/RSC/resim bypass, online durum kodları, önbellek/tekrar kuyruğu olmaması, manifest/ikon boyutu ve opaklık, etkinleştirme seçenekleri ve dört dilli statik ekran geçti.
- `node scripts/pwa-http.mjs`: çalışan localhost sunucuda sadece yeni manifest/ikon/worker/offline dosyalarının HTTP başlıklarını test eder. Scope, MIME, no-store ve CSP geçti; dış istek yapmaz.
- Typecheck ve CI yapılandırma kontrolü geçti. Statik kaynak tutarlılığı Actions'a eklendi; dört unit testi mevcut unit işine dahildir. Uzak Actions veya production build bu adımda çalıştırılmadı.
- Tarayıcıda gerçek service worker hazırlığı görüldü. Yerel sunucu durdurulup `/dashboard` açıldı: yalnızca genel çevrimdışı ekran geldi. Dört dil seçimi ve 360/390 px taşma kontrolleri hem kurulumda hem çevrimdışı ekranda geçti. Sunucu yeniden açılıp “Tekrar dene” ile normal, giriş korumalı sayfaya dönüldü. Yerel sunucu çalışır bırakıldı; gerçek sağlayıcılar kapalı.
- Tamamlanan ilan/ödeme/mesajlaşma iş akışları yeniden çalıştırılmadı; yeni test için DB kaydı oluşturulmadı.

Teknik kaynaklar: [Next.js PWA rehberi](https://nextjs.org/docs/app/guides/progressive-web-apps), [MDN kurulum istemi](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt), [MDN service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

Sıradaki PM-25C: otomatik teklif ajanının gizli azami tutar, eşit tutarda öncelik, artış, anti-sniping ve rezervasyon kurallarını açıkça tasarlamak; ardından yerel simülasyonla doğrulamak. Gerçek ödeme ve push teslimi ayrı kalır. PM-25'in tamamı bitmiş değildir.
