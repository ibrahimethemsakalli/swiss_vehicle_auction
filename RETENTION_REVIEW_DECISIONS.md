# PM-26F — Onaylanan yeniden inceleme ve koruma kaldırma kararları

> Güncel durum: PM-26G yerel uygulaması tamamlandı: kanıt doğrulama, iki adminli kararlar, sürümlü geçmiş ve veri silmeden manuel koruma kaldırma. Uygulama/kanıt ve sınırlar: [RETENTION_REVIEW.md](RETENTION_REVIEW.md). Sonraki öneri PM-26H mevcut admin kuyruğu ve uygulama içi bildirim entegrasyonu; yeni süre, e-posta/SMS veya silme eklemeden. Aşağıdaki plan ve önceki aşama notları tarihsel karar/uygulama kapsamını korur.

Durum: **ürün kararları onaylandı; uygulama henüz yapılmadı**. Kullanıcı 28 Ekim 2026 tarihinde “Üç önerini de kabul ediyorum” diyerek kanıt zorunluluğunu, ihtiyatlı kaldırma koşulunu ve iki adminli modeli kabul etti. Mevcut PM-26D/E onayları korunur. Bu belge hukuki süre belirlemez ve çalışma ortamında koruma kaldırmayı etkinleştirmez. Teknik uygulama planı: [PM-26G](RETENTION_REVIEW_IMPLEMENTATION_PLAN.md).

## Değişmeyen sınırlar

- İnceleme tamamlamak korumayı kaldırmaz. Silme kapalıdır.
- Açık veya kapanmış işlem/uyuşmazlık/rapor ilişkilerinin mevcut otomatik koruması devam eder. Dosyanın kapanması tek başına kaldırma gerekçesi değildir.
- İşlem, sözleşme/onay, uyuşmazlık ve koruma/inceleme kayıtlarının saklama süreleri belirsizdir. Periyodik inceleme aralığı da atanmaz.
- PM-26E şu anda tek inceleme notu saklar. Aşağıdaki tekrar inceleme, ayrı onay ve kaldırma durumları henüz uygulanmadı.

## Onaylanan kapsam ve uygulama sınırları

| ID | Kural | Sınır |
| --- | --- | --- |
| F01 | Yeni kanıt, yanlış konuşmaya koruma konması, gerekçenin değişmesi veya ilgili dosyadaki değişiklik üzerine yetkili admin yeniden inceleme açabilir. Önceki kararlar değiştirilmeyen geçmiş olarak korunur. | Periyodik otomatik takvim önerilmiyor; sıklık belirsiz kalır. Yeni başvuru korumayı kendiliğinden kaldırmaz. |
| F02 | Talepte konuşma/koruma kimliği, yeniden inceleme nedeni, erişim kontrollü iç kanıt/dosya referansı ve önceki gerekçenin neden artık geçerli olmadığı bulunur. Kanıt yetersizse ek bilgi beklenir ve koruma sürer. | Serbest metin tek başına yeterli sayılmaz; mesajların tamamı veya gereksiz kişisel bilgi nota kopyalanmaz. Harici kanıta otomatik erişim yoktur. |
| F03 | Kaldırma yalnızca manuel koruma için önerilebilir. Önceki gerekçenin hatalı veya sona ermiş olduğu kanıtlanmalı; sistemde otomatik koruma bağlantısı veya sınıflandırma belirsizliği bulunmamalıdır. | **İhtiyatlı seçenek kabul edildi.** Diğer bağlantılar varken sadece manuel korumayı kaldıran esnek seçenek seçilmedi. |
| F04 | Bir admin talep açar; talebi açan kişiden farklı ve konuşmanın alıcı/satıcısı olmayan ikinci admin karar verir. Konuşmanın tarafı olan admin talep/karar işlemini yapamaz. Güncel admin yetkisi ve mevcut ikinci faktör kontrol edilir. | **İki adminli model kabul edildi.** Korumayı koyan admin talep açabilir; kendi talebini onaylayamaz. İkinci uygun admin yoksa kaldırma bekler; tek-admin istisnası yoktur. |
| F05 | Sonuçlar: korumayı sürdür, ek bilgi iste veya uygun kaldırma talebini onayla. Ret/ek bilgi halinde koruma sürer. Her kararın gerekçesi, aktörü, zamanı ve dayandığı kayıt sürümü saklanır. | Talep geri çekilirse de koruma sürer. Karar kaydı silinmez veya üstüne yazılmaz; saklama süresi belirsizdir. |
| F06 | Gelecekte onay uygulanırken bağlantılar, kayıt sürümü ve yetki işlem içinde yeniden kontrol edilir. Yeni delil/rapor veya değişmiş gerekçe varsa eski onay uygulanmaz, yeniden inceleme gerekir. | Hata, eksik erişim veya belirsizlikte koruma kaldırılmaz. Sınırlı süreli onay/son kullanım tarihi uydurulmaz. |
| F07 | Manuel koruma kaldırılmış olsa bile veri silinmez; salt okunur envanter onaylı mesaj kuralına göre yeniden sınıflandırır. Sonradan yeni gerekçe doğarsa yeni koruma dönemi açılabilmeli, önceki geçmiş korunmalıdır. | Eski PM-26E tek-konuşma/tek-kayıt modeli sonraki geliştirmede geçmişi koruyacak şekilde evrilmelidir. Kaldırma “silme onayı” değildir. |

## Bu adımda yapılanlar

Mevcut koruma uygulaması, koruma planı ve karar matrisi okundu. Yalnızca bu karar taslağı hazırlandı. Test, migration, sunucu değişikliği, veri mutasyonu, gerçek API, hukuki yayın, koruma kaldırma ve silme yapılmadı.

Onay sonrası: seçimler karar matrisine kaydedildi ve PM-26G uygulama planı hazırlandı. Bu güncellemede yalnızca belgeler değişti; kod, veritabanı ve çalışma ortamı değişmedi, testler çalıştırılmadı.
