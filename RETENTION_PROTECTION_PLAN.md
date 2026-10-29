# PM-26B — Yayımlanmamış taslaklar ve silme/koruma istisnaları planı

> Güncel durum: PM-26G yerel uygulaması tamamlandı: kanıt doğrulama, iki adminli kararlar, sürümlü geçmiş ve veri silmeden manuel koruma kaldırma. Uygulama/kanıt ve sınırlar: [RETENTION_REVIEW.md](RETENTION_REVIEW.md). Sonraki öneri PM-26H mevcut admin kuyruğu ve uygulama içi bildirim entegrasyonu; yeni süre, e-posta/SMS veya silme eklemeden. Aşağıdaki plan ve önceki aşama notları tarihsel karar/uygulama kapsamını korur.

> Güncel durum: PM-26F üç karar kullanıcı tarafından onaylandı. [PM-26G uygulama planı](RETENTION_REVIEW_IMPLEMENTATION_PLAN.md) hazır; henüz uygulanmadı. Aşağıdaki önceki aşama notları tarihsel kapsamı belirtir. Silme kapalı, belirsiz süreler değişmedi.

> Güncelleme: PM-26E tamamlandı: dört dilde gerekçeli manuel konuşma koruması ve bekleyen/incelenmiş kuyruğu hazır. İnceleme korumayı kaldırmaz; saklama süreleri belirsiz, silme kapalı. Kanıt: [RETENTION_MANUAL_PROTECTION.md](RETENTION_MANUAL_PROTECTION.md). Sıradaki öneri PM-26F korumanın yeniden inceleme/kaldırma karar ve yetki matrisi; uygulamadan önce ürün kararı gerekir.

> Güncel durum (28 Ekim 2026): PM-26D tamamlandı: kullanıcı son etkinlik ve ihtiyatlı koruma kapsamını onayladı; yalnızca mesajlar için salt okunur aday önizlemesi açıldı. Kurallar ve hedefli doğrulama: [RETENTION_MESSAGE_PREVIEW.md](RETENTION_MESSAGE_PREVIEW.md). İşlem/uyuşmazlık süreleri belirsiz; silme ve hukuki yayın kapalı. Sıradaki öneri PM-26E gerekçeli manuel koruma kaydı ve inceleme kuyruğu. Aşağıdaki PM-26B/C kontrol notları tarihsel kapsamı anlatır.

28 Ekim 2026. Durum: **belge ve uygulama planı hazır; yayın ve otomatik silme yok**. Onay kaynağı [GO_LIVE_MATRIX.md](GO_LIVE_MATRIX.md), PM-26A'dır. Aşağıdaki teknik tasarım önerileri uygulanmış özellik veya kullanıcı tarafından kararlaştırılmış yeni saklama süreleri değildir.

## Dört dilde inceleme paketi

- [Deutsch](docs/policy-drafts/pm26b-de.md)
- [Français](docs/policy-drafts/pm26b-fr.md)
- [Italiano](docs/policy-drafts/pm26b-it.md)
- [English](docs/policy-drafts/pm26b-en.md)

Her taslak aynı yedi bölümü içerir: kapsam/açık bilgiler, yazılı destek, satış iptali ve hizmet bedeli, gerekçeye göre iade, saklama hedefleri, koruma istisnaları ve yayın sınırı. Dört metin de 2 iş günü ilk yanıt hedefini, 6 aylık iki sınırlı kategoriyi ve 30 günlük log/yedek hedeflerini taşır. Bunlar tam kullanım koşullarının veya mevcut gizlilik metninin yerine geçmez; mevcut belgelerle birleştirme daha sonraki yayın hazırlığıdır.

Dosyalar `docs/policy-drafts/` altında tutulur; uygulamanın `src/data/legal-copy.json` kaynağına import edilmez, `public/` altında sunulmaz. Hukuki profil, `readyForPublication:false`, yayın/onay tabloları ve mevcut kabul sürümleri değişmedi. Git'e ileride gönderilmeleri depo görünürlüğüne tabi olur; buradaki “yayımlanmamış” ifadesi uygulamada etkin hukuki yayın olmadığını belirtir, gizli belge garantisi değildir.

## Kategori eşlemesi

| Kategori | Onaylanan hedef / başlangıç | Kaynak veya mevcut boşluk | Silme öncesi koruma kontrolü |
| --- | --- | --- | --- |
| Kapanmış destek yazışmaları | Kapanıştan sonra 6 ay | Ayrı bir destek bileti/kapanış kaydı bu incelemede bulunmadı. İleride seçilecek destek kanalı ve ticket modeli eşlenmeli; Dispute otomatik olarak destek bileti sayılamaz. | İşlem/uyuşmazlık delili veya yeniden açılmış dosya ise genel aday listesinden çıkar. Kapanış bilinmiyorsa tarih üretme. |
| İşlemle bağlantısız kullanıcı mesajları | Son etkinlikten sonra 6 ay | `Conversation`, `ChatMessage`; Conversation araç ve katılımcılara bağlı, Appointment ve MessageReport ilişkileri var. | Araç bağlantısı tek başına “satış gerçekleşti” veya “işlem yok” kanıtı değil. Bid/Settlement/Dispute/rapor/randevu ilişkileri sınıflandırılmalı. İlgili delil veya sınıflandırması belirsiz kayıt otomatik silinmez. |
| Güvenlik/teknik loglar | 30 gün | Yerel operasyon dosyaları ve ileride hosting/log sağlayıcısı. Tüm kaynakların envanteri gerekli. | Ödeme olayları, AuctionLog, işlem outbox'ı, webhook tekilleştirme kayıtları ve hukuki onaylar sadece adında log/olay geçtiği için bu sınıfa alınmaz. Olay delili ayrılır. |
| Yedekler | 30 günlük döngüsel saklama | Yerel yedek komutları mevcut; zamanlama/offsite sağlayıcısı ve otomatik retention yok. | İlgili delilin tek kopyasını kaldırma. Gerekli kayıtları kapsamlı bir yedeği süresiz tutmak yerine ayrı kontrollü koruma alanına ayırma tasarlanmalı. Koruma/silme kararı belli değilse otomasyon öncesi operatör incelemesi gerekir. |
| Ödeme/işlem, sözleşme ve onay kayıtları | **Belirsiz** | Bid, Settlement, PaymentHold, Transaction, LegalAcceptance/Document/Release ve ilişkili kanıtlar; immutable belge/onay kısıtları var. | Genel 6 ay/30 gün kuralından hariç. Süreyi 0, varsayılan süre veya sonsuz olarak atama. Ayrı karar gerekir. |
| Açık ve kapanmış uyuşmazlık kayıtları | **Belirsiz** | Dispute ve ilişkili kanıtlar; ilgili MessageReport/ListingReport/ReviewAppeal dosyaları ayrıca değerlendirilir. | Dosyanın kapatılması korumayı kendiliğinden kaldırmaz. İlgili delil yazışmalarını/loglarını genel silmeden çıkar. |
| Hesaplar, medya, diğer kategoriler | Bu görevde yeni süre **atanmadı** | User, MediaAsset, ilanlar, taslaklar, bildirimler, favoriler, aramalar, istatistikler, LocalProxy verileri vb. | Mevcut özel temizlik davranışları ayrı kalır. Yeni genel süreyi yayma; silme talebi ve ilişki etkisini ayrıca değerlendir. |

## Uygulama tasarımı — henüz uygulanmadı

1. **Önce salt okunur sınıflandırma:** adayları `eligible`, `protected`, `unknown` şeklinde ayıran rapor tasarlanır. Yalnızca açıkça sınıflandırılmış, süre kaynağı mevcut, süresi dolmuş ve korumasız kayıt eligible olabilir. Unknown sessizce eligible olmaz; manuel karar kuyruğuna alınır. Belirsizlik süresiz saklama onayı değildir; gözden geçirme sorumlusu gerektirir.
2. **Zamanın anlamı:** PM-26D ile mesajlar için 6 UTC takvim ayı ve ay sonuna sınırlama onaylandı. Son etkinlik konuşma oluşturma, son mesaj ve son randevu oluşturma/güncelleme zamanlarının en yenisidir; okuma/görüntüleme ve Conversation.updatedAt dahil değildir. Log için olay zamanı ve yedek için başarılı tamamlanma zamanı önerilir; yeni süre üretilmez. Eksik/geçersiz zaman unknown olur.
3. **Koruma kaydı önerisi:** nesne türü/kimliği, ilişkili dosya, gerekçe kodu, uygulayan yetkili, başlangıç, inceleme durumu ve kaldıran yetkili için sınırlı erişimli bir kayıt tasarlanır. Yeni model/endpoint bu turda eklenmedi. Son tarih bilinmiyorsa süre uydurulmaz; periyodik gözden geçirme aralığı ve sorumlusu ayrı karar bekler.
4. **Koruma önceliği ve yarışlar:** aday üretiminden sonra yeni itiraz/işlem oluşabilir. Gelecekteki silme adımı işlem anında ilişkileri ve korumayı tekrar kontrol etmeli, koruma oluşturmayla aynı kilit/transaction stratejisini kullanmalı. Şüpheli/başarısız kontrolde silme durmalı. Dry-run raporu sonradan değişmeden yürütülebilir bir silme yetkisi değildir.
5. **Silme ile anonimleştirme:** isim gizlemek veya hashlemek tek başına anonimleştirme değildir. Serbest metin ve dosyalardaki kişisel bilgiler dahil geri ilişkilendirme riski değerlendirilir. Bu görev yöntemi seçmez. DB foreign key/cascade ve immutable onay kısıtları atlatılmaz; User/Conversation toplu silmesiyle ilişkili delil yok edilmez.
6. **İşlem güvenliği:** gelecekte küçük partiler, yeniden deneme/idempotency, aday sonrası son kontrol ve tamamlanma kaydı gerekir. Dosya/DB/harici sağlayıcı silmeleri atomik değilse kısmi başarı izlenir. Denetim kaydına silinen mesajın tam metni veya sır yazılmaz; bu yeni denetim kaydının kendi saklama süresi de ayrıca belirlenir.
7. **Yedekten dönüş:** restore öncesi güvenilir silme/koruma karar kaydı eşlenir. Silinmiş veri geri geldiyse uygulama ve worker açılmadan önce kararlar yeniden uygulanır; aksi halde veri yeniden görünür hale getirilmez. Bu karar kaydının alanları, erişimi ve süresi belirsizdir; ödeme/uyuşmazlık verisini yedek döngüsüyle dolaylı silme planı yapılmaz.
8. **Mevcut temizliklerle uyum:** PM-02 sahipsiz medya, süresi dolan kodlar/rate-limit ve mevcut istatistik temizliği ayrı mekanizmalardır. Bu belge onları değiştirmez. Delil olarak kullanılan dosyanın ilan bağlantısının kaldırılıp sahipsiz temizliğe düşmesi dahil ilişki geçişleri, gelecekte koruma entegrasyonunda ele alınmalı. Planın varlığı mevcut worker'ların bütün delil korumasını zaten sağladığı anlamına gelmez.
9. **Harici depolar:** sağlayıcılar belirsizken e-posta kutusu/log/obje depolama/yedek yaşam döngüsü ayarı yapılmaz. Seçim sonrası her kopya ve silme gecikmesi envantere alınır. Uygulamada silmenin sağlayıcının yedeğinden anında silme olduğu söylenmez.

## Açık kararlar ve etkinleştirme kapısı

İşlem ve açık/kapanmış uyuşmazlık süreleri **belirsiz kalır**. Ayrıca gerçek destek sorumlusu/kanalı, iş takvimi, çözüm/karar süreleri, ret sonrası inceleme, kısmi iade/chargeback ayrıntıları, log kaynağı listesi, silme/anonimleştirme yöntemi, korumayı kaldırma yetkisi ve restore karar kayıtlarının süresi açık kalır. Bunlar bu dokümanla onaylanmış sayılmaz.

Uygulama tasarımının kabulü, yalnızca değişen alanlara yönelik doğrulama, işletme/sağlayıcı/politika boşluklarının tamamlanması ve dört dil metin incelemesi sonrası hukuki yayın ayrı işlem olarak ele alınır. Süre kararı tamamlanmamış kategoriler için otomatik silme açılmaz. Gerçek sağlayıcı ve iade işlemleri bu planla başlatılmaz.

## Bu görevde yapılan kontrol

Yalnızca yeni belgelerin bölüm, süre, istisna ve bağlantı tutarlılığı kontrol edildi; dört taslakta aynı onaylı kararlar ve açık süreler korundu. Mevcut şema/mesaj/medya kaynakları planın ilişki sınırları için okundu. Eski testler, build, migration, kullanıcı akışları, gerçek API, yayın ve silme çalıştırılmadı. Mevcut hukuki içerik kaynağı ve profil değişmedi.

**Sıradaki öneri PM-26C:** bu plana göre yalnızca salt okunur veri saklama envanteri ve aday/korunan/belirsiz sınıflandırma raporu hazırlamak. Yeni rapor gerçek silme yapmamalı, süreleri bilinmeyen kayıtları aday göstermemeli ve yalnızca yeni sınıflandırma davranışı hedefli test edilmelidir.
