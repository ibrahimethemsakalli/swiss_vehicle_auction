# PM-06 — Yerel işletim ve kurtarma

27 Ekim 2026. Yeni sağlık/telemetri ve kurtarma bölümleri kontrol edildi. İhale, teklif, tahsilat, satış, SMS ve galeri akışları tekrar çalıştırılmadı.

## Sağlık ve worker takibi

| Adres | Erişim / sonuç |
| --- | --- |
| `GET /api/health/live` | Herkese açık, bağımlılıksız `200 {status: alive}`. Yalnızca HTTP uygulamasının cevap verdiğini gösterir. |
| `GET /api/health/ready` | Herkese açık, `200 ready` veya `503 not_ready`; DB bağlantısı/temel şema ve mevcut custom-server instance'ının taze worker kaydı gerekir. Ayrıntı/sır dönmez. DB sorgusu 2 sn statement timeout, ortak probe için HTTP beklemesi en çok 3,5 sn. |
| `GET /api/admin/operations` | İkinci faktörlü admin oturumu ve rol kontrolü. Worker son başlangıç/bitiş/başarı, hata zamanı/sayacı, devre dışı veya takılma durumu, kuyruk sayıları ve en eski iş yaşı. `no-store`. |

Worker kaydı `.local/operations/<instance UUID>.json` içinde atomik dosya yenilemeyle saklanır. Ham exception metni, şifre, bağlantı URL'si, ödeme bilgisi veya müşteri kaydı yazılmaz. `worker.failed` yapılandırılmış konsol olayı ve `WORKER_FAILED` kodu kullanılır. Yeni süreç yeni UUID kullanır; eski dosya yeni süreci sağlıklı göstermez. Bu bir yerel durum kaydıdır; merkezi log/arşiv veya dış alarm servisi değildir. `OPERATIONS_DIR` ile web kökü dışında, yazılabilir ve kalıcı bir dizin seçilebilir. Git'e eklenmez.

- Heartbeat 5 sn; 20 sn'den eski heartbeat hazır sayılmaz.
- İşlevlerin başlangıç/bitiş ve hata/toparlanma kayıtları ayrı tutulur. Hata sonrası son hata zamanı ve toplam hata sayısı korunur.
- Aynı worker veya business-cycle üst üste çalışmaz; atlanan çakışmalar sayılır. Mevcut iş sırası korunur: kapanış → teklif süresi → capture → release → reconciliation. Bunlar paralel çalıştırılmadı. Bir işlevin yakalanan hatası sonraki işlevin çalışmasını engellemez.
- Uzayan çalışma ve beklenen aralığı aşan sessizlik `stale` olarak işaretlenir. Uzayan iş zorla tekrar başlatılmaz; kilitli işin ikinci kopyası oluşturulmaz.
- Medya temizliği saatlik, outbox 500 ms, business-cycle 15 sn. İlk çalışma beklenirken durum `waiting`; bu başarı kaydı değildir. Yapılandırılmamış DB/ödeme worker'ları `disabled` görünür. Sağlık endpoint'i ödeme/SMS sağlayıcısına istek atmaz ve bunların canlı kabulü anlamına gelmez.
- Capture/release işlevleri tekil iş hatalarını kendi retry kayıtlarında tutar. Bu yüzden worker turu `ok` olsa da `payment_retrying`, `payment_failed`, `payment_stuck` sayaçları ayrıca incelenmelidir. Retry sayacı politika/itiraz nedeniyle bekleyen işleri de içerebilir; her kayıt bir sağlayıcı arızası demek değildir. `oldestAgeSeconds` işin ilk oluşturulmasından itibaren yaşıdır. `outbox_pending` yalnızca açık artırma güncellemelerini sayar.
- SIGINT/SIGTERM yeni turları durdurur, readiness'i kapatır, HTTP/socket bağlantılarını kapatır ve çalışan işler için 30 sn bekler. Daha uzun süren işlerin güvenli tamamlanması garanti edilmez; mevcut kalıcı işlem kayıtları üzerinden recovery gerekir.

**Custom server gerekir:** `pnpm dev`, `pnpm start` veya mevcut yerel mod komutları kullanılır. `next dev`, `next start` veya yalnızca sayfa önizlemesi worker runtime'ı başlatmaz; liveness cevap verse de readiness 503 olur. Kaynak değişiklikleri için eski çalışan custom server yeniden başlatılmalıdır. Bu görevde mevcut kullanıcı sunucusu durdurulmadı veya iş akışları çalıştırılmadı.

## Yerel yedekleme

Araçlar `pg_dump` custom-format + medya kopyası + boyut/SHA-256 manifesti üretir. Tabloların yanında indeks, foreign key, trigger, fonksiyon ve migration kayıtları da dump'a dahildir. Başarılı paket `.local/backups/<zaman>-<UUID>/` içinde oluşur. Hatalı çalışma `.incomplete` olarak kalır; tamamlanmış paket sayılmaz.

1. Uygulamayı ve worker'ları durdurun; fotoğraf yazımı da durmalı. PostgreSQL sunucusu çalışmaya devam eder. `--quiesced` bu durdurmanın operatör tarafından yapıldığının açık beyanıdır; araç diğer makinelerdeki süreçleri otomatik durdurmaz. Böylece DB snapshot'ı ve medya kopyası arasında uygulama yazımı olmaz.
2. `pg_dump/pg_restore` hazırlayın. Bu bilgisayarda resmî EDB PostgreSQL 18.6 arşivi, yayımlanan SHA-256 ile doğrulanıp `.local/pg-tools` içine çıkarıldı; sistem servisi kurulmadı. Tekrar hazırlama: `powershell -NoProfile -File scripts/setup-pg-tools.ps1`. Başka ortamda `PG_BIN` tam istemci araçları dizinini gösterebilir. Araç sürümü kaynak PostgreSQL'i desteklemeli.
3. `pnpm backup:create --quiesced`
4. `pnpm backup:verify FOLDER`

`DATABASE_URL` yalnızca loopback `autoveri` veya `_test` DB'si olabilir; production/uzak DB reddedilir. `UPLOAD_DIR` yoksa `.uploads` kullanılır; klasör yoksa tam yedek başarısız olur. Bilerek yalnızca DB almak için `pnpm backup:create --quiesced --database-only` vardır; manifest `mediaIncluded:false` gösterir ve bu bir tam medya yedeği sayılmaz.

Bağlantı parolası işlem argümanlarına veya manifest'e yazılmaz; alt süreç ortamıyla iletilir. `.env`, API anahtarları, test posta kutusu, yerel admin giriş dosyası ve statik örnek fotoğrafları bu pakete dahil değildir. Sırlar ayrıca güvenli biçimde saklanmalıdır; örnek fotoğraflar kaynak depo/dağıtım paketinden gelir. Yedek gerçek hesap/veri ve parola hash'leri içerebilir; otomatik şifreleme yapılmaz. Dosya erişimini koruyun; offsite/şifreli kopyalama aşağıdaki harici işler kapsamındadır. Manifest kazara bozulmayı saptar, imzalı güven kaynağı değildir; yalnızca kendi güvenilir yedeğinizi yükleyin.

## Geri yükleme

Araç mevcut `autoveri` veritabanına geri yazamaz. Otomatik DROP/--clean/overwrite seçeneği yoktur.

1. Yerel PostgreSQL'de boş, yeni bir `autoveri_restore_<isim>_test` veritabanı oluşturun. Uygulama/worker'ları bu hedefe bağlı başlatmayın.
2. PowerShell ortamında `RESTORE_DATABASE_URL` değerini bu DB'nin bağlantısına, `RESTORE_UPLOAD_DIR` değerini `.local/restores/<yeni-klasör>` mutlak yoluna ayarlayın. URL/parolayı Git'e veya paylaşılan terminal çıktısına koymayın. Medya hedefi mevcut olmamalı ve `.local/restores` doğrudan alt dizini olmalıdır.
3. `pnpm backup:restore FOLDER --quiesced`
4. Satırları, medya sahipliğini ve dosya hash'lerini kontrol edin. Kaynakla hedef ayrıdır; otomatik uygulama yönlendirmesi veya eski DB silme yapılmaz. Yeni hedefe geçiş ayrıca operatörün planladığı bir işlem olmalıdır.

Restore önce manifest/hash ve boş hedef kontrollerini yapar. Medyayı yeni hedefe kopyalar; DB'yi `pg_restore --single-transaction --exit-on-error --no-owner --no-privileges` ile yükler. DB hatasında transaction geri alınır; inceleme için yeni medya dizini kalabilir. Symlink/junction ve manifest yol taşmaları reddedilir. Küme rolleri, sistem veritabanları, sunucu ayarları, PITR/WAL geçmişi ve başka cihazlar bu yerel araç kapsamına girmez.

## Bu görevdeki hedefli kanıt

- 4 yeni birim grubu: worker başarı/hata/toparlanma, overlap/disabled/stale/kapanış, yedek güvenlik sınırları, bağımlılıksız liveness ve hazırlıksız 503.
- 4 yeni izole DB/restore grubu: gerçek dump+medya doğrulama; yeni DB'ye restore ve kayıt/sahiplik/migration/trigger eşliği; dolu hedef/bozulma/traversal reddi; gerçek izole DB+taze fixture worker ile readiness 200, kapanışta 503 ve boş kuyruk ölçümleri.
- TypeScript kontrolü. Gerçek `autoveri` verileri yazılmadı. Restore provası yalnızca sentetik veridir; mevcut uygulama verilerinin yedeklendiği iddia edilmez.

Tekrar gerektiğinde `pnpm test:operations` yalnızca bu yeni kontrolleri çalıştırır. Yerel PostgreSQL ve istemci araçları gerekir; iki geçici DB oluşturur/temizler, sentetik yedek paketini inceleme için bırakır. Önceden tamamlanan iş akışlarını içermez.

## Harici ortam veya işletim kararı bekleyenler

| İş | Yerel durum / harici ihtiyaç |
| --- | --- |
| Dışarıdan uptime/readiness takibi ve uyarı | Endpoint'ler hazır. Dış probe, e-posta/mesaj alarmı, sorumlu kişi ve eskalasyon kanalı seçilmedi. Hiçbir bildirim gönderilmedi. |
| Merkezi hata/log saklama ve dashboard | Sır içermeyen yerel worker durumu ve admin JSON ucu hazır. Log toplayıcı, erişim politikası ve saklama süresi bekliyor. |
| Zamanlanmış yedek, retention ve kapasite alarmı | Manuel komut/prova hazır. İşletim sistemi zamanlayıcısı ve saklama/silme politikası kurulmadı; eski yedekler otomatik silinmez. |
| Şifreli, ayrı cihaz/offsite yedek | Harici disk/obje depolama, anahtar yönetimi, ülke/sağlayıcı ve erişim kararı gerekli. Yerel disk arızasına karşı tek başına bu paket yeterli değildir. |
| Yönetilen PostgreSQL backup/PITR ve felaket kurtarma | Hosting, yönetilen DB ve hedef RPO/RTO belirlenmedi. Yerel prova bir üretim RTO/RPO taahhüdü değildir. |
| Gerçek ortamda rollout, restart ve süreç gözetimi | Servis yöneticisi/container ortamı seçilmeli. Eski sunucu yeni kaynaklara otomatik geçmez. PM-06 otomatik deployment yapmaz. |
| Çoklu instance / ayrı worker servisi | Şu anda tek uygulama instance'ı desteklenir. Redis/Socket.IO adapter, paylaşılan worker lease ve merkezi telemetri yok; yatay ölçek üretime hazır sayılmaz. |

Resmî dayanaklar: [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html), [PostgreSQL Windows araçları](https://www.postgresql.org/download/windows/), [EDB binary arşivleri](https://www.enterprisedb.com/download-postgresql-binaries).
