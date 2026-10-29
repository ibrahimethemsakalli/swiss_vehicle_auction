# L11 — Sağlayıcıdan bağımsız üretim iadesi ve mutabakat tasarımı

> Yerel kurulum (29 Ekim 2026): L11 migration'ları uygulama DB'sine kuruldu; sahte ödeme modunda bilgi hatırlatma worker'ı etkin ve hatasız. Aşağıdaki eski “ana DB kurulmadı” notları tarihsel durumu anlatır. Üretim/gerçek sağlayıcı kabulü açık; güncel kanıt LAUNCH_CLOSURE.md içindedir.

> Güncel durum (29 Ekim 2026): ürün sahibinin onayladığı 1–10 A politikalarının yerel uygulanabilir bölümleri mevcut servis/HTTP/dört dil ekranına eklendi. Aşağıdaki önceki tasarım ve test bölümleri tarihsel kayıttır. Güncel uygulama, test kanıtı ve kalan sınırlar [LAUNCH_CLOSURE.md](LAUNCH_CLOSURE.md#güncel-politika-kararı--29-ekim-2026) içindedir. İşletme/sağlayıcı ve saklama süreleri hâlâ belirsiz; ana ortam kurulumu ve gerçek finansal kabul yapılmadı.

28 Ekim 2026. Durum: **tasarım hazır; uygulama, politika onayı ve sağlayıcı kabulü açık**. Bu belge bir sağlayıcı seçimi, hukuki görüş, yeni ticari politika veya para hareketi yetkisi değildir. Kod/migration/ortam değişikliği yapılmadı. Tek aktif takip: [LAUNCH_CLOSURE.md](LAUNCH_CLOSURE.md), L11.

## Mevcut kaynaktan fark

Kaynaklar: src/lib/payments.ts (PaymentGateway: create/retrieve/release/capture), src/lib/settlement-state.ts (queueRelease/recordCapture), src/lib/disputes.ts (REFUND_REQUIRED → ACTION_REQUIRED), prisma/schema.prisma (PaymentHold, Transaction, Settlement, Dispute, WebhookEvent). Transaction mevcut iş kuyruğudur; tutarlı ve değişmez muhasebe defteri olduğu varsayılmaz. PaymentHold tahsilat geçmişini taşır, iade geçmişini taşımaz. LocalProxyRefundCase/Refund yalnızca ayrı yerel prototiptir; üretime kopyalanacak politika değildir.

Onaylı kurallar korunur: ücret CHF 30, araç bedeli değil; başarılı satışta kazanan alıcı öder; onaylı temerrütte işletmede kalır. Açık itiraz henüz gerçekleşmemiş tahsilatı durdurur. Tahsil edilmemiş hold serbest bırakılır; tahsil edilmiş bedel ayrı iade işlemidir. Mükerrer/hatalı tahsilat ve platform/satıcı kaynaklı durumlar gerekçeli incelemeye alınır. İade satış/ihale/teklif geçmişini yeniden açmaz. Vergi, ücret kesintisi veya satıcıya aktarım uydurulmaz.

## Veri sözleşmesi (önerilen yeni kayıtlar)

Tüm finansal tutarlar para biriminin en küçük biriminde tamsayıdır (CHF 30 = 3000); float kullanılmaz. Mevcut Decimal tutar dönüşümü kesinlik ve para birimi kontrolü ister. Her dış referans provider + merchantAccount + environment (test/live) ile kapsamlanır.

| Kayıt | Asgari alanlar ve güvence |
| --- | --- |
| PaymentCapture | holdId, settlementId, payerId, sağlayıcı kapsamı, captureRef, amountMinor, currency, confirmedAt, kanıt kaynağı. captureRef kapsam içinde tekil. Yenilenen her hold doğru tahsilata bağlanır. Beklenmeyen capture da REVIEW işaretiyle korunur. |
| RefundCase | captureId, requesterId, reasonCode, açıklama/özel kanıt referansları, kaynak disputeId, durum, version, policyVersion, karar gerekçesi/aktör/zaman. Bir tahsilata birden fazla inceleme mümkün; talep sayısı politikası henüz kararlaştırılmadı. |
| RefundOperation | caseId, captureId, amountMinor, currency, immutable idempotencyKey, payloadHash, status, externalRefundRef, attempts, lease, lastErrorCode, timestamps. Case karar revizyonu başına tek komut; farklı talepler aynı capture bütçesini paylaşır. |
| PaymentEvidence / Inbox | kapsamlı externalEventId tekil, objectRef, occurredAt/receivedAt, doğrulama yöntemi, minimal normalize veri ve hash. Ham sır/kart/kimlik verisi saklanmaz; saklama süresi belirlenmedi. |
| PaymentLedgerEntry | değişmez ekonomik olay: CAPTURE, REFUND, DISPUTE_DEBIT, DISPUTE_CREDIT, PROVIDER_FEE, PAYOUT, ADJUSTMENT; currency, amountMinor, sourceRef, effectiveAt, recordedAt, ilişkiler. Aynı ekonomik hareket webhook/poll/ekstreyle tekrar yazılmaz. Düzeltme silerek değil bağlantılı ters/düzeltme kaydıyla. |
| ReconciliationRun / Finding | hesap/ortam/döviz, pencere ve watermark, veri kaynağı/tamlık, başlangıç/bitiş bakiye, fark kodu, ilgili kimlikler, owner, durum, çözüm kanıtı. INCOMPLETE sonuç temiz mutabakat sayılmaz. |

Bunlar Prisma migration'ı değil, uygulama sözleşmesidir. Mevcut audit/outbox/bildirim yapıları yeniden kullanılabilir. RefundCase erişimi ve finansal referanslar ortak araç olaylarına sızmaz. İşlem/uyuşmazlık/kanıt saklama süreleri belirsiz kalır; silme açılmaz.

## Durum ve geçişler

İnceleme: REQUESTED → IN_REVIEW → APPROVED veya REJECTED. Eksik politika/kanıt için NEEDS_INFORMATION; karar para hareketi değildir. Karar değişikliği/reopen için yeni denetlenebilir revizyon gerekir; hangi yeniden inceleme haklarının açılacağı L05 kararıdır. Retten sonra sonsuza kadar başvuru yasağı prototipten devralınmaz.

| İşlem geçişi | Şart / sonuç |
| --- | --- |
| Onay → QUEUED | Güncel yetki, politika, sürüm ve doğrulanmış capture; bloke olmayan iade bütçesi; karar + bütçe rezervi + işlem + outbox tek DB transaction. |
| QUEUED → SUBMITTING | Worker süreli lease alır, uygunluk/blokajı tekrar kontrol eder. Dış çağrı DB kilidi tutulmadan yapılır. |
| SUBMITTING → PENDING / SUCCEEDED | Sağlayıcı yanıtı kapsam, capture, tutar ve döviz eşleşirse; kabul edildi yanıtı başarı sayılmaz. |
| SUBMITTING → UNKNOWN | Timeout/bağlantı kopması/çelişkili cevap. Bütçe tutulur; yeni anahtarla ikinci iade yok. Önce aynı referans/anahtarla sağlayıcı sorgusu. |
| PENDING / UNKNOWN → SUCCEEDED | İmzalı/doğrulanmış olay veya güvenilir retrieve/ekstre kanıtı; tek defter kaydı, outbox ve durum güncellemesi atomik. |
| PENDING / UNKNOWN → FAILED_CONFIRMED | Kesin olumsuz kanıt ve sonradan başarı riski uzlaştırılmışsa bütçe bırakılır. Ağ hatası bu duruma geçirmez. Yeniden komut ayrı denetlenen karar gerektirir. |
| QUEUED → CANCELLED_BEFORE_SEND | Yalnızca dışarı gönderilmediği ve lease/işçi yarışının kilitle engellendiği kanıtlıysa. Gönderilmiş komut yerel iptal ile başarısız sayılamaz. |
| Herhangi bir çelişki → REVIEW_REQUIRED | Başarı geçmişi silinmez; tutar/kapsam veya terminal durum çelişkisi bulgu oluşturur. Yeni para çıkışı bloklanır. |

SUCCEEDED, sağlayıcıda tamamlanmış iadeyi anlatır; bankada görünme süresi garantisi vermez. Ana PaymentHold CAPTURED_FEE/COMPENSATION kaydı korunur; iade toplamı ayrı projeksiyondur. Başarılı iadeden sonra geç gelen pending/failed olayı durumu geriye götürmez. REFUND_REQUIRED bir inceleme dayanağıdır, otomatik iadeye izin değildir. Hold tahsilatsızsa release akışına yönlendirilir. Capture sonucu belirsizse önce uzlaştırma yapılır.

## Yetki matrisi

Aşağıdaki teknik yetki sınırları tasarım önerisidir; gerçek personel ataması L15 ve onay politikası L05 ile kapanır. Her yazıda oturum, askı durumu, role/capability, sahiplik ve optimistic version sunucuda tekrar kontrol edilir. CSRF/origin, doğrulama ve oran sınırları uygulanır; istemciden payer/amount/provider hesabı güvenilir kabul edilmez.

| Aktör | İzin / sınır |
| --- | --- |
| Ödemeyi yapan alıcı | Kendi capture'ı için gerekçeli talep ve kendi sonuçları. Başkasının ödeme referansları/özel admin notları yok; kendi iadesini onaylayamaz. |
| Satıcı | Kendi satışına ilişkin delil/itiraz sunabilir; alıcının adına para çıkışı veya iade kararı veremez. Yalnızca satış için gerekli sonuç bilgisi. |
| Yetkili inceleyen admin | Gerekçeli inceleme/karar; işlem tarafıysa veya çıkar çatışması varsa karar engeli. Yalnızca ADMIN etiketi sınırsız para yetkisi sayılmaz; refund.review capability ayrıca gerekir. |
| Ödeme operasyonu | refund.execute capability ile onaylı komutu işleme alma/uzlaştırma; gerekçe veya tutarı sessizce değiştiremez. |
| Worker | Yalnızca kalıcı onaylı komutu yürütür; kullanıcı talebinden doğrudan ödeme üretemez. |
| Mutabakat görevlisi | payment.reconcile ile rapor/bulgu okuma ve kanıtlı çözüm kaydı; tutar düzeltmesi ayrı denetlenebilir komuttur. |

Ödeme için iki farklı admin zorunluluğu **henüz onaylanmadı**. PM-26G'nin iki admin kuralı koruma kaldırmaya aittir, buraya otomatik taşınmaz. Karar sayısı/eşik ve inceleyen-yürüten kişinin aynı olabilmesi yapılandırılabilir tasarlanır; üretim yetki politikası tanımlanmadan para komutu yürütülmez. Admin kimlik doğrulaması/ikinci faktör L13/L15 bağımlılığıdır.

## Sağlayıcı portu ve tekrar güvenliği

Önerilen port: capabilities(), submitRefund(captureRef, amountMinor, currency, idempotencyKey), retrieveRefund(ref), lookupRefundByCommand(key), listFinancialEvents(cursor, window). Son iki yetenek sağlayıcıda yoksa rapor/manuel kanıt yolu tanımlanır; yokluk başarı veya başarısızlık sayılmaz. Normalize cevap: scope, captureRef, refundRef?, amountMinor, currency, state(pending/succeeded/failed/unknown), observedAt, evidenceRef. Desteklenmeyen kısmi iade sessizce tam iadeye dönüşmez.

Komut anahtarı sunucuda üretilir, aynı ekonomik işlemde sabittir; key + payloadHash değişirse CONFLICT. Sağlayıcının idempotency saklama penceresi belirsizdir: pencere aşımında kör tekrar yok, önce kanıtlı lookup/manuel uzlaştırma. Provider çağrısı ile DB atomik olmadığı için inbox/outbox, lease ve yeniden okuma gerekir. Worker çağrıdan sonra çökerse aynı komut uzlaştırılır. Webhook, worker ve poll aynı transition fonksiyonunu ve capture kilidini kullanır. Sabit kilit sırası araç → capture → case/operation; uygun yerlerde sürüm karşılaştırması. Sağlayıcı hesabı/ortamı değişince eski işlem yeni hesaba gönderilmez.

Her capture için confirmedRefunds + queued/submitting/pending/unknown reservedRefunds toplamı confirmedCapture tutarını aşamaz. Aritmetik kontrol aynı capture kilidi altında yapılır. Açık chargeback/dispute veya açıklanamayan dış iade varsa kalan bütçe güvenilir sayılmaz, REVIEW_REQUIRED ile yeni iade durur. Dışarıda gerçekleşmiş fazla/çift hareket verisi gizlenmez: deftere gerçek kanıtı yazılır ve kritik fark açılır.

## Mutabakat sözleşmesi

Üç katman: (1) karar/komut ile sağlayıcı nesnesi, (2) sağlayıcı nesnesi ile finansal bakiye hareketi, (3) payout ile banka ekstresi. Sağlayıcının refund başarısı banka/payout kanıtını kapatmaz. Pencere UTC [başlangıç,bitiş); geç gelen kayıtlar occurredAt ve receivedAt ayrımı, örtüşen yeniden okuma ve tekil kaynak kimliğiyle yakalanır. Sayfalama tamamlanmazsa veya kur/döviz/bakiye verisi eksikse run INCOMPLETE olur; boş sonuç sıfır işlem iddiası değildir.

| Bulgu | Davranış |
| --- | --- |
| Uygulamada var, sağlayıcıda yok / tersi | Komut anahtarı ve capture referansını eşleştir; yalnızca tutar/tarihle otomatik eşleştirme yapma. Sahipsiz dış kaydı karantinaya al. |
| Aynı kaynak için mükerrer kayıt | Ekonomik tekillik kontrolü; ikinci capture/refund gerçekten olmuşsa iki gerçek hareketi de koru ve kritik bulgu aç. |
| Tutar, döviz, ortam veya hesap uyumsuzluğu | İşlem başarılı sayılmaz, para komutu durur ve inceleme gerekir. |
| Başarılı iade, eksik defter / eski yerel durum | Güvenilir kanıtla idempotent projeksiyon onarımı; yeni sağlayıcı çağrısı yok. |
| UNKNOWN veya uzun bekleyen işlem | Önce retrieve/kanıt; eskalasyon eşiği henüz belirlenmedi, süre uydurulmaz. |
| Chargeback, fee veya payout farkı | Ayrı olay ve imzalı etki; refund olarak yeniden yazma. Kazanılan dispute credit önceki debit'i silmez. |

CHF için iade sonrası brüt = doğrulanmış capture − doğrulanmış refund. Bu tutar net gelir veya bankadaki para değildir. Sağlayıcı bakiye kontrolü: açılış + capture − refund − dispute debit + dispute credit − fee − payout ± kanıtlı diğer düzeltmeler = kapanış; sağlayıcının bakiye/valör modeli adaptörde eşlenir. Dövizler ayrı tutulur; kur yokken toplam çevrilmez. Payout ile banka farkında kesinti/kur/valör kanıtı gerekir. Bekleyen rezervler gerçekleşmiş nakit gibi sayılmaz. Vergi kaydı/muhasebe hesap planı L04 bekler.

Bulgu çözümü aktör, gerekçe ve kanıt taşır; “çözüldü” düğmesi para veya defter gerçeğini değiştirmez. Mutabakat kayıtları değişmez denetim geçmişiyle sürümlenir. CSV dışa aktarımı yapılacaksa ayrı izin, kapsam minimizasyonu ve formül enjeksiyonu koruması gerekir; LocalProxy CSV üretim raporu değildir.

## Açık politika kararları — doldurulmadı

L05: başvuru/karar süreleri, ret sonrası yeniden inceleme, kısmi iade, delil yeterliliği ve chargeback yanıt sorumluluğu/süreleri. L15: para yetkisi atamaları, iki onay gerekip gerekmediği, eşikler ve görev ayrılığı. L04: vergi/makbuz, ücret kesintilerinin muhasebesi. L07: finansal/uyuşmazlık/kanıt saklama süreleri. L08–10: sağlayıcı, idempotency garantileri, refund iptali/durumları, olay/rapor yetenekleri. L17: alarm ve eskalasyon eşikleri. Bunların hiçbiri varsayılan ticari kurala çevrilmez; ilgili karar eksikse işlem incelemede kalır.

UI sözleşmesi DE/FR/IT/EN karşılıklarıyla “talep alındı / bilgi gerekli / incelemede / onaylandı, henüz gönderilmedi / sağlayıcıda bekliyor / sonuç doğrulanıyor / iade tamamlandı / reddedildi / operasyon incelemesi” durumlarını ayırmalı. Onaylandı mesajı “para iade edildi” dememeli. Bu tur ekran veya çeviri uygulaması yapılmadı.

## Uygulama ve yalnızca yeni doğrulama planı

1. Saf domain durumları, port ve bütçe/yetki invariants; sahte portla sözleşme testleri. Belirsiz politika NONE/UNCONFIGURED olarak bloke edilmeli.
2. Yeni DB kayıtları, kesin Decimal dönüşümü, denetim/outbox/inbox ve kilitler; izole DB'de yarış, rollback ve crash sonrası uzlaştırma. Tarihsel capture yalnızca doğrulanabilen referanslarla aktarılır; eksik olan REVIEW, sahte geçmiş yok.
3. Yetkili HTTP/admin/alıcı görünümü ve dört dil; yalnızca yeni yetki, sahiplik, conflict ve durum sunumu kontrolleri.
4. L08 sonrası gerçek adaptör, sağlayıcı test kabulü (L09/L10), yayın adayı (L18), ayrı canlı kabul (L12). Bu adımlar henüz yapılmadı.

Hedef yeni senaryolar: iki eşzamanlı talebin bütçeyi aşamaması; timeout ve worker crash sonrası ikinci ödeme olmaması; key/payload çelişkisi; yanlış hesap/ortam/capture; duplicate ve sıra dışı webhook; sonradan gelen başarı; açık chargeback ile iade yarışı; tahsilatsız hold release ayrımı; üçüncü kişinin erişim reddi; yetki iptali sonrası kuyruğun durması; dışarıdan iade ve eksik sayfa; eksik defterin çağrısız onarımı; belirsiz politikanın işlem açmaması. Sağlayıcı tarafından son anda gelen chargeback yarışı tamamen yerel kilitle önlenemez; kanıt uzlaştırması ve inceleme zorunludur.

Bu tur yalnızca kaynak-belge uyumu, bağlantılar ve L11 kapanış kaydının tutarlılığı kontrol edildi. Tamamlanan testler, build veya gerçek API çalıştırılmadı. Tasarımın varlığı L11'i kapatmaz.

## L11 saf model uygulaması — 28 Ekim 2026

src/lib/refund-domain.ts eklendi: immutable capture/operation snapshot'ları, açık RefundPolicy sözleşmesi, capability ve taraf kontrolü, karar/komut tekilliği, capture bütçesi ve sürüm kontrolü, gönderilmemiş komut iptali, sağlayıcı portu ve kanıt geçişleri. partialRefunds, requiredApprovals, separateExecutor veya inceleme politikası belirsizse POLICY_UNCONFIGURED; üretim varsayılanı yok. Testlerde kullanılan tek onay ve görev ayrılığı yalnızca sentetik politikadır, kullanıcı kararı değildir.

SUBMITTING çağrısı öncesi gelecekteki repository kalıcı kayıt/lease sağlamalıdır. Timeout UNKNOWN bırakır; recoverRefund yalnızca lookup yapar, otomatik yeniden gönderim yoktur. Aynı event tekrarı no-op; hesap/ortam/capture/tutar uyuşmazlığı ve çelişkili kanıt blokaj/bulgu oluşturur. Başarı geçmişi eski pending olayla gerilemez. Kesin başarısızlıktan sonra gelen başarı gibi çelişkiler kanıt olarak korunur ve yeni para çıkışı engellenir; otomatik muhasebeleştirme yapılmaz.

refundTotals yalnızca yerel komut projeksiyonudur; dışarıda gerçekleşmiş çelişkili hareketlerin gerçek ekonomik defteri veya banka bakiyesi değildir. Kalıcı ledger, tam mutabakat raporu, RefundCase inceleme ekranı/durumu, HTTP yetkilendirmesi, migration, DB kilidi/CAS, lease ve sağlayıcı imza doğrulaması henüz uygulanmadı. Port yalnızca güvenilir adaptör içindir; ağdan gelen veri doğrudan bu modele verilmemeli. Aynı eski snapshot'ı paralel işçilere vermek saf fonksiyonla engellenemez; kalıcı repository entegrasyonunun yarış/crash testleri sonraki adımdır. Mevcut PaymentGateway, LocalProxy veya çalışan ödeme akışı değişmedi.

Yeni doğrulama: ağ engelli ci-check üzerinden yalnızca refund-domain.test.ts içindeki 11 test geçti. Belirsiz politika, taraf/yetki, iptal edilmiş onay, görev ayrılığı, aynı anahtar/çelişen içerik, tutar/bütçe/sürüm, iptal, timeout/lookup, olay tekrarları ve sırası, hesap/ortam/tutar uyuşmazlığı ve kesin başarısızlık kanıtları kontrol edildi. Yalnızca iki yeni dosyaya strict TypeScript kontrolü geçti. Bunlar DB eşzamanlılık veya gerçek sağlayıcı kabul testi değildir; önceki testler/build çalıştırılmadı.

## L11 kalıcı kayıt ve kilitler — 29 Ekim 2026

src/lib/refund-repository.ts, pg Pool üzerinden transaction ve capture satırında FOR UPDATE kilidi uygular. Snapshot version CAS, komut anahtarı global tekilliği ve capture/case/decisionVersion tekilliği vardır. Snapshot, komut ve sürümlü audit aynı transaction'dadır. Sağlayıcı sonucu güncel kilitli snapshot'a birleştirilir; eski işçi snapshot'ı veriyi ezmez. Başarılı normalleştirilmiş iadeler RefundReceipt'e tekil kayıt olur; receipt ve audit UPDATE/DELETE trigger ile engellenir. Bu receipt tablosu tam muhasebe/chargeback/payout defteri değildir.

202610290001_refund_repository migration'ı beş tablo ekler: RefundRuntimePolicy, RefundCaptureState, RefundCommandState, RefundStateEvent, RefundReceipt. Policy/grant için seed veya üretim varsayılanı yoktur. Policy/grant yoksa yazma engellenir; transaction sırasında FOR SHARE ile okunur. Bu dahili grant kayıtları gerçek User/oturum/capability atama yönetimine henüz bağlanmadı. queue approvalIds yalnızca güvenilir servis katmanından gelmelidir; kalıcı gerekçeli RefundCase kararı ve HTTP yetkilendirme sınırı henüz yoktur. register yalnızca doğrulanmış capture içe alma servisi için iç arayüzdür, kullanıcı girdisi için değildir. Portta imza/kimlik doğrulaması gelecekteki adaptörün sorumluluğudur.

İşçi SUBMITTING ve rastgele leaseToken'ı dış çağrıdan önce commit eder. 60 saniye lease teknik kilit süresidir; iade politikası/karar süresi değildir. Süresi dolan SUBMITTING/PENDING/UNKNOWN yalnızca lookup ile kurtarılır. Eski token'lı işçinin sonucu atılır; güncel işçi sağlayıcı kanıtını yeniden okur. Hiç gönderilmeden kesilmiş SUBMITTING bile kör yeniden gönderilmez; UNKNOWN rezervi tutar ve sonraki incelemeyi bekler. Dış çağrı transaction dışında yapılır; başka bir işçi süresi dolmuş kaydı alsa da submit tekrarlamaz. Commit sonrası yetki iptali ile başlamış dış çağrıyı geri alma garantisi verilmez; aktif token/kalıcı başlangıç işlem sınırıdır. Dağıtık transaction veya banka düzeyinde exactly-once iddiası yoktur.

Yeni test komutu: pnpm test:refund-repository. Yalnızca loopback PostgreSQL'de rastgele autoveri_l11_<uuid>_test DB oluşturur, sadece yeni migration'ı uygular, finally bloğunda kendi DB'sini kaldırır. Mevcut autoveri verisi ve önceki migration/test akışları çalıştırılmaz. Enjekte edilen Fake dışında sağlayıcı yoktur; SDK veya uygulamanın ödeme servisi içe aktarılmaz.

11 yeni grup geçti: eksik politika rollback; capture bütçe yarışı; aynı komutun eşzamanlı tekrarı; sekiz işçiden tek gönderim/receipt; son audit yazısında rollback; yanıt kaybından lookup kurtarma; sağlayıcı başarısından sonra kesinti ve eski token engeli; gönderim öncesi kesintide rezervin korunması; sonuç kaydı hatasında receipt rollback ve ikinci ödeme olmadan kurtarma; yetki iptalinin dispatch öncesi tekrar okunması; audit/receipt değişmezliği. Kesinti testleri claim/sağlayıcı/finish sınırlarında kontrollü hata ve lease expiry ile simüle edildi, gerçek OS süreci öldürülmedi. Hata enjeksiyonundaki SQL sözdizimi düzeltildikten sonra yeni test grubu geçti. İki yeni TypeScript dosyası strict kontrolünden, Prisma şeması validate kontrolünden geçti. Önceki saf model testleri, eski kullanıcı akışları, build ve gerçek API çalıştırılmadı.

Migration ana yerel DB'ye uygulanmadı; Prisma istemcisi yenilenmedi (repository raw pg kullanır). Production rollout, tarihsel capture importu, gerçek User/grant/karar bağı, HTTP/ekran, olay inbox/outbox/bildirim ve tam finansal mutabakat hâlâ eksiktir. Saklama süreleri/politika kararları doldurulmadı; L11 açık kalır.

## L11 gerekçeli karar ve mevcut kullanıcı yetkisi — 29 Ekim 2026

src/lib/refund-decisions.ts ve 202610290002_refund_decisions eklendi. RefundCaptureBinding gerçek PaymentHold/Vehicle ilişkisine bağlanır; tahsil edilmiş durum, provider referansı, tutar/döviz ve alıcı/satıcı eşleşmesi tekrar doğrulanır. Binding yalnızca güvenilir capture içe alma katmanı tarafından oluşturulmalıdır; otomatik geçmiş aktarımı yapılmadı.

RefundCase: gerçek User FK'si, idempotent requestId, zorunlu kırpılmış 20–2000 karakter gerekçe, tahsilattan sabitlenen amountMinor/currency, sürüm ve politika sürümü. Talep yalnızca ödemeyi yapan kullanıcıya açıktır. Bu adım tam tahsilatın incelemesini kaydeder; kısmi iade tutarı kullanıcı girdisi değildir. RefundDecision: User FK'si olan inceleyen, requestId, onay/ret, gerekçe, beklenen sürüm ve politika sürümü; append-only trigger ile korunur. Karar ve case güncellemesi atomiktir. Aynı karar isteği tekrar yazılmaz, çelişkili içerik ve sürüm reddedilir. Aynı admin aynı dosyada ikinci oy veremez; yeniden inceleme/değiştirme politikası uygulanmış veya ticari olarak reddedilmiş sayılmaz.

RefundRuntimePolicy içindeki yetki ataması artık tek başına yeterli değildir: gerçek User rolü ADMIN, suspendedAt boş ve isSample false olmalı; işlem tarafları karar/yürütme yapamaz. Grant aktif olmalı ve ilgili review/execute capability bulunmalı. Kullanıcı ve grant/policy satırları transaction içinde SHARE kilidiyle okunur. queue çağıranın approvalIds listesini kaldırdı: APPROVED case'in kalıcı kararları, sürümü, tutarı/dövizi ve politika sürümü esas alınır; gönderim öncesinde karar ve gerçek kullanıcı yetkileri yeniden okunur. İki onay yalnızca TEST-ONLY fixture politikasıdır, üretimde varsayılan veya kullanıcı kararı değildir.

Eksik politika ile talep toplanabilir; tanımlanmamış inceleme/onay sayısı karar oluşturmayı, tanımlanmamış kısmi iade/görev ayrılığı ise para kuyruğunu engeller. Karar tek başına sağlayıcı çağırmaz. Alıcıya kendi talep durumu/gerekçesi/tutarı sunulur; iç admin karar geçmişi verilmez. Yetkili, taraf olmayan inceleyen geçmişi okuyabilir. Satıcı veya üçüncü kullanıcı erişemez.

Servis userId'yi güvenilir sunucu oturumundan bekler; JSON şeması actor/requester/amount/approval enjeksiyonunu kabul etmez. Bu tur HTTP route, mevcut session middleware bağlantısı, UI veya grant yönetim ekranı eklenmedi. Dolayısıyla web üzerinden kullanılabilir iade akışı tamamlandı denmez. Mevcut User kayıtlarına bağlı servis ve repository yetki sınırı uygulanmıştır; session/CSRF/rate-limit ve dört dil ekran sonraki entegrasyondur. Ana yerel DB'ye migration uygulanmadı, Prisma client yeniden üretilmedi; yeni tablolar pg üzerinden kullanılıyor.

Yeni test: pnpm test:refund-decisions; gerçek şema/migration'lar sadece rastgele loopback autoveri_l11_decisions_<uuid>_test DB'ye kurulur, sentetik User/Vehicle/PaymentHold oluşturulur ve finally ile sadece o DB kaldırılır. 9 yeni grup geçti: sahiplik/strict giriş/replay; güncel rol/askı/taraf/gerekçe; kalıcı bağımsız oy ve kuyruk; gönderimden önce rol iptali; alıcı/admin/üçüncü kişi görünümü; karşıt karar yarışı; belirsiz politika; ret/örnek hesap/eksik capability/geçersiz tahsilat; rollback ve değişmez gerekçe. Test fixture'ının MFK kısıtı düzeltildi. Gerçek API/para çağrısı sıfırdır.

Değişen TypeScript dosyalarının strict kontrolü ve Prisma validate geçti. Önceki repository testinin fixture'ları yeni User/binding/decision önkoşullarına uyarlandı, eski test akışı yeniden çalıştırılmadı. Yeni migration zincirinin uygulanması eski iş akışlarının tekrar testi değildir. Build, tüm test paketi, eski kullanıcı akışları ve harici API kullanılmadı. Açık politika/saklama süreleri doldurulmadı; L11 açık kalır.

## L11 HTTP ve dört dil ekran — 29 Ekim 2026

/api/refunds dinamik GET/POST uçları mevcut requireUser (NextAuth sunucu oturumu) ile bağlandı. HTTP gövdesi aktör kimliği kabul etmez. GET: kimlik ile yetkili detay veya admin/page parametreleriyle 20 kayıtlık liste; alıcı yalnızca kendi talepleri ve bağlı tahsilat seçimlerini görür, yetkili admin kendi taraf olmadığı dosyaları görür. Ortak DTO sağlayıcı referansı, hesap veya sır taşımaz. Kullanıcı/rol/grant/suspension denetimleri serviste tekrar yapılır.

POST aynı origin zorunluluğu, JSON/strict şema, 16 KB akış boyut sınırı ve oturum kullanıcısı başına 60 saniyede 20 yazma isteği teknik sınırı kullanır. Eksik oturum 401; CSRF/yetki 403; sürüm/politika engeli 409; hız 429; belirsiz DB hatası ayrıntısız 503. Tüm yanıtlar private, no-store ve Vary: Cookie taşır. Yalnızca request/decide eylemleri vardır; queue/claim/execute/refund sağlayıcı çağrısı HTTP'den sunulmaz.

/refunds alıcı listesi, tahsilat seçimi, gerekçeli talep ve durum; /admin/refunds inceleme listesi, gerekçeler, karar geçmişi ve onay/ret ekranıdır. Ana menü ve admin çalışma alanına bağlantılar eklendi. DE/FR/IT/EN başlık, durum, açıklama, hata ve form metinleri eklendi. Esnek genişlik/satır kırma stilleri kullanılır. Onay durumu açıkça tamamlanmış para iadesinden ayrılır. Ödeme yürütme butonu yoktur. Tanımlanmamış politika veya mevcut karar nedeniyle inceleme uygun değilse karar düğmesi kapalıdır. Kısmi iade/görev ayrılığı belirsizliği korunur; yalnızca inceleme kararının verilmesi para komutuna izin değildir.

Başarısız gönderimde aynı içerik aynı requestId ile denenir. Çakışmada gerekçe korunur, tekrar gönderme güncel detay yüklenene kadar kapanır. Dosya bazlı taslaklar yalnızca bileşen belleğinde tutulur; farklı dosyaya taşınmaz, oturum değişiminde silinir. Geç gelen eski oturum yanıtları görünümü güncellemez. Bu kapsam sunucu taslak kaydı veya kalıcı kullanıcı metni saklama değildir.

Yeni doğrulama: ağ engelli 4 HTTP sınır testi ve 1 dört dil buyer/admin render testi (durumlar, kaçırılmış HTML, kapalı karar düğmesi) geçti. Ayrı geçici autoveri_l11_http_<uuid>_test DB'de HTTP+gerçek servis bütünleşmesi geçti: session bağlamı, alıcı/admin liste kapsamı, gizli DTO, talep/karar, eksik politika, askı, karar uygunluğu; sıfır ödeme komutu ve sıfır receipt. Typecheck geçti. Render testi tarayıcı etkileşimi/360–390 px görsel testi olarak sunulmaz. Önceki saf model/repository/karar testleri ve eski kullanıcı akışları tekrar çalıştırılmadı. Gerçek API yok.

Ana yerel DB'ye L11 migration'ları veya fixture verisi uygulanmadı; yeni tablolar/bindings yoksa ekran güvenli şekilde hizmet kullanılamıyor veya boş durum gösterir. Yeni şema yalnızca izole DB'de kuruldu ve temizlendi. Üretimde capture içe alma/binding güveni, grant/politika yönetimi, tam mutabakat ve gerçek sağlayıcı kabulü hâlâ gereklidir. Bunlar HTTP ekranı eklendi diye tamamlandı sayılmaz.

## L11 salt okunur yerel mutabakat — 29 Ekim 2026

/admin/refunds/reconciliation ekranı ve /api/refunds/reconciliation GET ucu eklendi. Admin çalışma alanından erişilir. Yetki: mevcut oturum + aktif, örnek olmayan ADMIN User + açık payment.reconcile capability. refund.review veya yalnızca ADMIN rolü yeterli değildir; otomatik yetki/varsayılan politika atanmadı. POST 405 döner; başka ödeme/düzeltme uçları yoktur. Kimlik/rol/askı durumu her okumada kontrol edilir. Yanıt private/no-store, hatalar ayrıntısızdır.

Rapor REPEATABLE READ READ ONLY transaction ile tutarlı anlık görüntü alır; 5 saniye statement timeout vardır. DB'ye rapor sonucu bile yazılmaz. Her sayfada 20 capture; ilişkili komutlar, case kararları, receipt'ler, son audit snapshot ve PaymentHold bağlantısı okunur. Salt okunur rapor sınıfı sağlayıcı portu/SDK çağırmaz. Sayfa başına toplamlar test/live olarak ayrı, CHF küçük birim tamsayıları BigInt ile hesaplanıp string DTO'ya çevrilir. Tüm veritabanının toplamı veya net gelir değildir. Geçersiz snapshot toplamlardan çıkarılır ve eksik rapor uyarısı gösterilir. Boş sayfa sağlayıcı tarafında hiç işlem olmadığı anlamına gelmez.

Kontroller: snapshot kimliği/kapsam/sürüm; binding ve tahsilat tutar/döviz/durum uyumu; snapshot komutunun kalıcı kaydı veya fazladan komut; onaylı karar sürümü/tutarı; başarılı işlemde eksik receipt; receipt'in durum/tutar/döviz/kapsam/referans uyumsuzluğu; aynı snapshot'taki mükerrer anahtar/referans; son audit kaydı ile snapshot uyumu; capture'ı aşan iade/rezervasyon; pending/unknown ve mevcut inceleme/blokaj. Bir kayıt birden fazla bulgu alabilir. Zaman eşiği/saklama süresi uydurulmaz. Rapor dahili capture kimliği, bulgu kodları ve toplamları sunar; gerekçeleri, kullanıcı kimliklerini, sağlayıcı referanslarını veya sırları dışarı vermez.

DE/FR/IT/EN tüm rapor, kapsam, izin, bulgu ve boş/eksik durum metinleri eklendi. Birbiriyle eşleşen yerel kayıtlar yalnızca kontrol edilen kayıtlar arasında fark bulunmadığı şeklinde gösterilir. Banka/sağlayıcı ekstresi, ücret, chargeback, payout, dışarıda oluşmuş fakat hiç içe alınmamış işlem, audit zincirinin tüm tarihsel sürümleri ve farklı capture'lardaki snapshot referans tekrarları bu sürümün tam doğrulaması değildir. Bu nedenle L11'in gerçek finansal mutabakatı tamamlandı sayılmaz. Silme, düzeltme, capture/release/refund çağrısı yoktur.

Yeni test komutları: test:refund-reconciliation (5 ağ engelli model/HTTP/dört dil render testi) ve test:refund-reconciliation-db (yeni izole DB kontrolü). Kontrol edilenler: doğru yerel toplam, eksik/çelişkili/geçersiz kayıt, mükerrer snapshot/bütçe, belirsiz sonuç, read-only HTTP, yetki ve hata sızıntısı, dört dilde bulgu etiketleri; gerçek şemalı geçici loopback DB'de 22 capture ile sayfalama, ayrı ortam toplamları, explicit capability, rol/askı, veri minimizasyonu ve okuma öncesi/sonrası tablo sayılarının değişmemesi. Test DB'si finally ile kaldırıldı. Typecheck geçti. Ana yerel DB değişmedi. Önceki iade/satış/karar testleri ve gerçek API çalıştırılmadı. Render testi tarayıcı/mobil görsel kontrolü değildir.

Açık kalanlar: güvenilir capture/binding ve dış kanıt içe alma, tutarlı sağlayıcı kapsamlı olay kimlikleri/tamlık, banka/payout/chargeback karşılaştırması, politika ve sağlayıcı kabulü, ana ortam kurulumu. Bu rapor için yeni migration gerekmez; önceki L11 tabloları kurulu değilse kontrollü kullanılamıyor yanıtı alınır.

## L11 dış kanıt sözleşmesi ve sentetik tamlık — 29 Ekim 2026

src/lib/refund-external-evidence.ts sağlayıcıdan bağımsız, saf bir önizleme/staging sözleşmesi ekler. Girdi yalnızca version=1, provenance=synthetic ve environment=test kabul eder. Gerçek ortam veya doğrulanmış kaynak iddiası reddedilir. Kaynak türü provider/bank ayrıdır; bu, gerçek bağlantı veya doğrulanmış banka verisi anlamına gelmez. HTTP, DB yazısı, sağlayıcı adaptörü, otomatik düzeltme ve ödeme akışına bağlantı yoktur. Staged events yalnızca bellek içi çıktı; kalıcı içe alma yapılmadı.

Manifest alanları: batchId, provider/merchant/account/environment/currency kapsamı, UTC milisaniyeli [from,to) penceresi, kaynağın kapsadığını bildirdiği watermark, beklenen sayfa ve benzersiz olay sayıları, nullable açılış/kapanış bakiyeleri. Bilinmeyen bakiye null kalır, sıfır varsayılmaz. Olay: eventId, ekonomik hareket kimliği economicId, normalize tür, UTC zaman, pozitif tamsayı küçük birim tutarı, credit/debit yönü ve döviz. Negatif bakiye mümkündür; tutar float veya ondalık JSON sayı olarak kabul edilmez. BigInt aritmetiği kullanılır. Capture/dispute credit/bank credit artış, refund/fee/payout/dispute debit/bank debit azalış; ADJUSTMENT yönü açık verilir. Banka ve sağlayıcı olay türleri karıştırılmaz. Bunlar normalize sözleşme kurallarıdır; gerçek adaptör kaynak anlamını ayrıca eşlemelidir.

Tamlık: 1'den başlayan kesintisiz sayfa dizisi, başlangıç cursor=null, takip zinciri, tek terminal nextCursor=null, döngüsüz cursor, beklenen sayfa/benzersiz olay sayısı, tüm sayfalarda aynı batch/kapsam, pencere ve döviz/yön/tür doğruluğu, watermark>=to, bilinen açılış/kapanış ve açılış+credit-debit=kapanış. Aynı sayfanın veya olayın bire bir tekrarı idempotenttir; değişmiş sayfa/olay ve farklı eventId altında aynı economicId çelişkidir. Olayın pencere bitişine eşit zamanı dışarıda kalır. Sırasız sayfa teslimi normalize edilir.

Çıktı REJECTED, INCOMPLETE veya COMPLETE_SYNTHETIC; authentic her zaman false. Eksik veya çelişkili pakette stagedEvents boş ve contentHash null kalır. Geçerli ama eksik kapsamın toplamları PARTIAL_WINDOW etiketi taşır; eksik sayfaların kısmi bakiyesi tam pencere kapanışıyla karşılaştırılıp yanlış bakiye farkı üretilmez. Tüm kapsam tamamken tamlık ve bakiye ayrı kontrol edilir. Başarılı sentetik paket kanonik içerik SHA-256 özeti üretir; bu hash kaynak imzası, doğruluk veya güven kanıtı değildir. Beklenen sayılar, watermark ve bakiyeler sentetik beyanlardır; gerçek kaynak tamlığını ispatlamaz. Boş seri yalnızca açıkça sıfır olay ve tek terminal boş sayfa ile uygun bakiyeler varsa sentetik olarak tamamdır.

Sınırlar: manifest en fazla 100 sayfa / 10000 beklenen olay; her sayfa 1000 olay; tekrarlar dahil en fazla 200 sayfa girdisi; kimlikler 160 karakter, tutarlar 30 basamak. Strict şema bilinmeyen alanları kabul etmez. Yerel JSON CLI ayrıca dosya boyutunu 2 MiB ile sınırlar; ağ/veritabanı importu yapmaz. Örnek: pnpm refund:evidence:preview tests/fixtures/l11-external-evidence.json. Terminal yalnızca özet/durum/kod/toplam/hash gösterir; olaylar ve batch kimliği yazdırılmaz. Çıkış kodları: sentetik tam=0, eksik/reddedilmiş=2, bozuk dosya=1. Örnek dosyanın tüm kimlikleri sentetiktir.

Yalnızca yeni testler: test:refund-external-evidence ile ağ engelli 10 test geçti. Tam paket, eksik/erken sonlanan/döngülü cursor, tekrar/sıra değişimi, olay çelişkisi ve ekonomik tekrar, kapsam/döviz/yön/kaynak/zaman uyuşmazlığı, eksik bakiye/watermark/sayı, boş seri, gerçek ortam/yanlış provenance/fazla alan/boyut, büyük tamsayı, CLI özet ve eksik çıkış kodu kontrol edildi. Ondalıklı tutarda refinement'ın BigInt çağrısıyla fırlattığı hata düzeltildi; artık şema reddi döner. Sadece üç yeni TypeScript dosyasının strict kontrolü geçti. Önceki rapor/HTTP/DB/ödeme testleri, build veya gerçek API çalıştırılmadı. DB ve runtime değişmedi.

Sınır: gerçek sağlayıcı/banka adaptörü, imza ve kaynak doğrulama, güvenilir hesap bağlama, kalıcı karantina ve içe alma kaydı, dış kanıtı yerel defterle eşleştirme ve üretim tamlık garantisi hâlâ açık. Yeni politika, süre, otomatik iade veya silme açılmadı. L11 kapanmadı.

## L11 kalıcı sentetik kanıt ve karantina — 29 Ekim 2026

src/lib/refund-evidence-store.ts ve 202610290003_evidence_import migration'ı eklendi. SyntheticEvidenceImport paket/manifest, güvenli sayfalar ve özet; SyntheticEvidenceAttempt aktör/istek/içerik özeti; SyntheticEvidenceEvent normalize tekil sentetik olay; SyntheticEvidenceLink paket–olay ilişkisini saklar. Tüm dört tabloda UPDATE/DELETE engelleyen append-only trigger vardır. Bunlar ödeme defteri değildir; RefundReceipt/RefundCommandState/PaymentHold değişmez.

İçe alma yalnızca synthetic/test manifest, production olmayan süreç, loopback PostgreSQL sunucu adresi ve autoveri veya autoveri_*_test veritabanı adı altında çalışır. En fazla 2 MiB JSON, strict zarf ve mevcut tamlık sözleşmesi uygulanır. Gerçek ortam veya geçersiz manifest kimliği yazılmadan reddedilir; geçerli sentetik manifestli eksik/çelişkili sayfalar QUARANTINED olur. Tam ve çelişkisiz paket STAGED_SYNTHETIC olur; authentic false kalır. STAGED sentetik kabul gerçek finansal doğrulama değildir.

Aktif, örnek olmayan gerçek ADMIN User ve açık payment.evidence.import capability gerekir. Salt okunur sonuç erişimi bu yetki veya payment.reconcile ister. Review/admin rolü tek başına yetmez. Yetki her çağrıda ve tekrar istekte yeniden okunur. Varsayılan kullanıcı, yetki, sağlayıcı veya politika atanmadı. Servis userId'yi güvenilir sunucu çağrısından bekler; HTTP/yükleme ekranı eklenmedi.

İki kilit sırası: aktör+requestId advisory transaction kilidi, ardından kaynak/provider/merchant/account/environment/currency kapsam kilidi. Aynı aktör/istek ve aynı içerik mevcut sonucu döndürür; aynı istekte farklı içerik CONFLICT. Tam paketin normalize hash'i sayfa teslim sırası ve bire bir tekrarlarından bağımsızdır; yeni istek eski pakete bağlanırken ayrı immutable attempt bırakır. Paket, yeni olaylar, bağlantılar ve attempt tek transaction'dadır. Son adım başarısızsa hepsi rollback olur.

Kapsam içindeki eventId ve economicId tekildir. Farklı paket aynı olayı aynı içerikle getirirse yeni olay oluşturmaz, mevcut kayda bağlanır. Aynı kimlikte değişmiş içerik veya başka eventId ile aynı ekonomik hareket karantinaya gider; paket kısmen kabul edilmez. Önceden staged aynı batch'in farklı tam içeriği BATCH_CONFLICT olarak saklanır. Eksik karantinadaki paketin düzeltilmiş içeriği yeni immutable kayıt olarak eklenebilir; eski karantina silinmez veya otomatik serbest bırakılmaz. İçerik/hash kaynak özgünlüğü sağlamaz.

Karantinada güvenli biçimli ve aynı kapsamlı sentetik sayfalar saklanabilir. Şeması bozuk, bilinmeyen alanlı veya farklı kapsamlı sayfaların ham payload'ı saklanmaz; pages null, yalnızca girdi hash'i ve kodlu özet vardır. Başarısız kimlik/yetki kontrolü veya geçersiz manifest için payload kaydı açılmaz. Saklama süresi doldurulmadı; silme, karantina çözme ve ödeme düzeltme fonksiyonu yoktur.

Yeni doğrulama: pnpm test:refund-evidence-store ile yalnızca rastgele autoveri_l11_import_<uuid>_test DB'de 10 grup geçti: gerçek rol/capability ve kalıcı yeniden okuma; altı eşzamanlı aynı isteğin tekilleşmesi; değiştirilmiş request ve normalize batch tekrarı; eksik→tam yeni kayıt ve ortak olay bağlantısı; değişmiş kabul edilmiş batch; paketler arası ekonomik tekrar; güvensiz ham alanların saklanmaması; gerçek ortam/boyut engeli; son attempt yazısında rollback; karşıt eşzamanlı paketlerin scope kilidi; değişmezlik ve askı sonrası tekrar engeli. Sonuçta ödeme receipt/command sayıları sıfırdır. Geçici DB finally ile kaldırıldı. Tip kontrolü ve Prisma validate geçti. Mevcut saf sözleşme, mutabakat, HTTP ve ödeme testleri tekrar çalıştırılmadı; gerçek API yoktur.

Ana yerel DB'ye migration veya örnek kayıt uygulanmadı. Kalıcı staging/karantina yerel servis katmanında hazırdır; gerçek kaynak imzası/hesap bağlama, kanıtı yerel ödeme kayıtlarıyla eşleştirme, operatör inceleme ekranı ve canlı kabul hâlâ açık. Belirsiz politikalar değişmedi; L11 kapanmadı.

## L11 sentetik kanıt–yerel ödeme eşleştirmesi — 29 Ekim 2026

src/lib/refund-evidence-matching.ts ve 202610290004_evidence_matching eklendi. Yalnızca staged sentetik provider paketindeki CAPTURE ve REFUND olayları eşleştirilir. Tutar/tarih benzerliğine göre otomatik eşleştirme yapılmaz. Yetkili kullanıcı, olay satırını açıkça bir RefundCaptureState id veya RefundReceipt commandKey ile gerekçeli olarak bağlar; kapsam/provider/merchant/test/döviz, tutar, kayıt durumu ve yerel referans tutarlılığı denetlenir. Capture için gerçek yerel PaymentHold binding/tahsilat durumu da kontrol edilir. Kaynak account alanının doğruluğu bu sentetik gerekçeli bağlama dayanır; sağlayıcı hesabı doğrulaması değildir.

SyntheticEvidenceMapping olay FK'si, hedef tür/id, User FK'si ve 20–2000 karakter gerekçe taşır. Bir olayın tek hedefi ve bir hedefin tek olay eşlemesi olur. İki advisory transaction kilidi sabit sırayla alınır; eşzamanlı aynı istek tek kayıt döndürür, farklı aktör/gerekçe/hedef veya ikinci hesap aynı hedefi alamaz. Kayıt UPDATE/DELETE ile değiştirilemez. Yanlış eşleme için düzeltme mekanizması bu yerel serviste yoktur; üretim operatör entegrasyonuna dahil edilmelidir, sessizce üzerine yazılmaz.

Mevcut yerel/sentetik ortam kapıları ve permission'lar korunur: eşleme yazımı payment.evidence.import; rapor payment.reconcile veya import yetkisi; aktif, örnek olmayan ADMIN. Varsayılan yetki yok. Quarantined paket eşleştirilmez. Tamlık/geçerlilik yeterli değilse açık hata döner. Rapor repeatable-read/read-only transaction içinde güncel yerel durumu yeniden inceler; immutable mapping kaydını sürekli geçerli finansal doğrulama saymaz. Eksik yerel hedef, kapsam, tutar veya durum değişimi ayrı bulgu döndürür.

Rapor MATCHED_SYNTHETIC, UNMAPPED, UNSUPPORTED, LOCAL_MISSING, SCOPE_MISMATCH, AMOUNT_MISMATCH veya STATE_MISMATCH üretir. Coverage IMPORTED_EVENTS_ONLY, authentic=false ve automaticCorrection=false sabittir. Banka/fee/payout/chargeback/adjustment kayıtları mevcut yerel modelde karşılığı tamamlanmadığından UNSUPPORTED kalır; başarılı eşleşme gibi gösterilmez. Henüz içe alınmamış olayları veya tam yerel hesap hareketlerini bu raporun kapsadığı iddia edilmez. Eşleme servis katmanındadır; HTTP/ekran veya ana DB kurulumu bu tur yapılmadı. PaymentHold, RefundReceipt ve ödeme komutları değişmez.

Yalnızca yeni testler: test:refund-evidence-matching ile geçici loopback *_test DB'de 6 grup geçti. Gerekçe/yetki ve otomatik tahmin yapılmaması; capture/receipt eşleştirme, paralel tekrar ve yeni servis örneğinden kalıcılık; değişen tutar/live kapsamına karşı güncel rapor; karantina engeli; farklı hesabın aynı hedefe bağlanamaması; değişmezlik/askı ve ödeme tablolarının aynı kalması. Hedefli strict TypeScript ve Prisma validate geçti. Önceki içe alma, rapor, iade, HTTP ve satış testleri tekrarlanmadı; gerçek API yok. Migration yalnızca izole test DB'ye uygulandı, DB sonra kaldırıldı.

## L11 için sabit kapanış sınırı

Bu turdan sonra kalanlar üç kapanış grubudur; üç küçük kod değişikliği anlamına gelmez. Önceki dokümanlardaki art arda küçük sonraki öneriler bu sabit sınırın yerine geçmez. Güncel takip LAUNCH_CLOSURE.md içindedir. Yeni PM/L maddesi açılmaz; tamamlanan saf model, repository, karar, HTTP, rapor, sentetik içe alma ve eşleştirme yeniden iş olarak yazılmaz.
