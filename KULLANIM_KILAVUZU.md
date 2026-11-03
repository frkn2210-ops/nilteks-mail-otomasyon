# 🌿 NİLTEKS B2B Tek Tanıtım E-Postası & Dijital Katalog Paneli
## Kullanım ve Yapılandırma Kılavuzu

Bu proje, **Nilteks Üretim Takip Sistemi'nden (ÜTS) tamamen bağımsız**, doğrudan potansiyel müşterilere tek bir kurumsal tanıtım e-postası göndermek ve kataloglarınızı **3D kitapçık kapakları** halinde web tarayıcısında açtırmak için geliştirilmiş bağımsız bir masaüstü web panelidir.

---

### 🚀 1. Paneli Başlatma

Klasördeki **`Eposta_Paneli_Baslat.command`** dosyasına çift tıklayın. Otomatik olarak sunucuyu başlatıp tarayıcınızda **http://localhost:4000** adresini açacaktır.

Dilerseniz Terminal üzerinden de başlatabilirsiniz:
```bash
cd "/Users/furkanaydin/Desktop/Nilteks Mail Otomasyonu"
node server.js
```

---

### 📬 2. Yeni Düzen Gönderim Sistemi (Eski Outlook İhtiyacı Kaldırıldı)

Önceki sürümlerde Mac Outlook'un "Eski Düzen" (Legacy Outlook) moduna geçirilmesi gerekiyordu çünkü eski AppleScript otomasyonu Yeni Outlook'ta hata veriyordu (`-1728`).

**Yeni Mimaride Bu Kısıtlama Tamamen Kaldırıldı:**
1. **Modern Kurumsal Gönderim (mail.niltex.com.tr:587):**
   - E-postalar arka planda doğrudan kurumsal e-posta hesabınız üzerinden iletilir (`furkan@niltex.com.tr`, Reply-To: `furkan@nilteks.com.tr`).
   - Outlook masaüstü uygulamasını açık tutmanıza veya "Eski Düzen" moduna geçmenize **hiç gerek yoktur**.
   - Gönderimler anında (1 saniyeden kısa sürede) gerçekleşir.
2. **Yeni Outlook'ta Aç / Taslak Olarak İncele:**
   - Paneldeki herhangi bir müşterinin yanındaki mavi **"Outlook"** butonuna veya üstteki **"Outlook'ta Aç"** seçeneğine bastığınızda; sistem mesajı hazırlar ve doğrudan Mac'inizdeki **Microsoft Outlook (Yeni Düzen)** uygulamasında hazır taslak penceresi olarak açar.
   - Böylece e-postayı doğrudan Yeni Outlook'un kendi penceresinde inceleyip tek tıkla gönderebilirsiniz.

---

### 📖 3. Boyut Sınırına Kesin Çözüm: "Kitapçık Görselleri & Tarayıcıda Açılış"

Daha önce karşılaşılan `552 Message size exceeds fixed maximum message size` hatası, 40 MB'lık katalogların mesaja fiziksel ek (attachment) yapılmasından kaynaklanıyordu.

- **Fiziksel Ek Yok:** PDF'ler e-postaya iliştirilmez. E-posta boyutu yalnızca **~40 KB**'tır. Bu sayede hiçbir kota veya spam filtresine takılmaz.
- **3D Kitapçık Tasarımı:** E-posta içerisinde kataloglarınız kitap sırtı ve gölgeli şık kapak görselleriyle yan yana listelenir.
- **Doğrudan Tarayıcıda Açılış:** Müşteri kapağa veya **"📖 Kataloğu Aç (PDF) →"** butonuna tıkladığında ilgili katalog müşterinin Chrome, Safari, Edge veya telefon tarayıcısında tam sayfa olarak anında açılır.

---

### ✍️ 4. Panel Özellikleri

1. **Tanıtım Yazısı & Katalog Kitapçıkları Sekmesi:**
   - E-posta Konusu (Subject), Giriş Tanıtım Yazısı ve Kapanış/İmza alanlarını dilediğiniz gibi düzenleyip anında kaydedebilirsiniz.
   - Sağ taraftaki **Canlı Önizleme** kutusundan müşterinin e-postayı nasıl göreceğini görebilir, kitapçıklara basarak tarayıcıda açılışını test edebilirsiniz.
   - **"Yeni PDF Katalog Ekle"** butonuyla yeni PDF yükleyebilirsiniz (Sistem 1. sayfadan otomatik kitapçık kapağı oluşturur).
2. **Adres Tara / Manuel Ekle & Mail Gönder Sekmesi:**
   - **Hemen Gönder:** Hedef firmanın e-posta adresini yazıp 1 tıkla anında iletin.
   - **Outlook'ta Aç:** Mesajı Mac Yeni Outlook uygulamasında açarak inceleyin.
   - **Web Sitesi Taraması:** Müşteri web sitesini taratarak çıkan kurumsal adreslere tek tek veya toplu onay vererek gönderim yapın.
3. **Gönderim Geçmişi & Loglar Sekmesi:**
   - Yapılan tüm gönderimler tarih ve durum bilgisiyle bu sekmede saklanır.

---

### 📁 5. Bağımsız Dosya Yapısı

```
/Users/furkanaydin/Desktop/Nilteks Mail Otomasyonu/
├── Eposta_Paneli_Baslat.command  # Çift tıklayarak başlatan kısayol
├── server.js                     # Web sunucusu ve API
├── mailer.js                     # Modern e-posta ve Yeni Outlook entegrasyonu
├── scraper.js                    # Web sitesi e-posta tarayıcısı
├── db.js                         # SQLite veritabanı sürücüsü
├── .env                          # E-posta ve sunucu kimlik bilgileri
├── catalogues/
│   ├── pdf/                      # Sunulan katalog PDF dosyaları
│   └── covers/                   # 1. sayfadan üretilen 3D kitapçık kapakları
├── data/
│   ├── campaign_config.json      # E-posta metinleri ve katalog ayarları
│   ├── drip_campaigns.sqlite     # Müşteri ve log veritabanı
│   └── drafts/                   # Yeni Outlook taslak dosyaları (.eml)
└── panel/
    └── index.html                # Modern yönetim paneli arayüzü
```
