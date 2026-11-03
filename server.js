const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
const scraper = require('./scraper');
const mailer = require('./mailer');

const app = express();
const PORT = process.env.PORT || 4000;

// Multer PDF Katalog Yükleme Yapılandırması
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, mailer.CATALOGUES_PDF_DIR);
  },
  filename: function (req, file, cb) {
    let originalName = file.originalname;
    try {
      originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {}
    const safeName = path.basename(originalName).replace(/[^\w\d\.\-_ \(\)çğıöşüÇĞİÖŞÜ]/g, '_');
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // Azami 50 MB PDF
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Yalnızca PDF formatında katalog dosyaları yüklenebilir.'));
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Statik panel ve katalog dosyalarını sun
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'panel')));

// API Rotaları

// 1. Genel Sistem Durumu ve İstatistikler
app.get('/api/status', async (req, res) => {
  try {
    const stats = await db.getStats();
    const config = mailer.getCampaignConfig();
    const connectionCheck = await mailer.verifyConnection();
    const engineInfo = mailer.getEngineInfo();
    const sender = mailer.getSenderInfo();

    res.json({
      success: true,
      stats,
      config,
      engine: engineInfo,
      connection: connectionCheck,
      sender,
      smtp: {
        configured: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
        host: process.env.SMTP_HOST || 'mail.niltex.com.tr',
        port: process.env.SMTP_PORT || '587',
        user: process.env.SMTP_USER || 'furkan@niltex.com.tr',
        replyTo: sender.replyTo,
        from: sender.fromHeader
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Kampanya Yapılandırmasını Getir (Tanıtım metni, konu, kataloglar)
app.get('/api/campaign/config', (req, res) => {
  try {
    const config = mailer.getCampaignConfig();
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Kampanya Yapılandırmasını Kaydet
app.post('/api/campaign/config', (req, res) => {
  try {
    const newConfig = req.body;
    if (!newConfig || !newConfig.subject) {
      return res.status(400).json({ success: false, error: 'Konu başlığı zorunludur.' });
    }
    const saved = mailer.saveCampaignConfig(newConfig);
    res.json({ success: true, config: saved, message: 'E-posta içeriği ve katalog ayarları başarıyla kaydedildi.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. E-posta Canlı HTML Önizlemesi
app.get('/api/campaign/preview', (req, res) => {
  try {
    const config = mailer.getCampaignConfig();
    const html = mailer.generateEmailHtml(config, { isPreview: true });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<h3>Önizleme Hatası:</h3><pre>${err.message}</pre>`);
  }
});

// 5. Kapak Görsellerini Sun
app.get('/api/covers/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(mailer.CATALOGUES_COVERS_DIR, filename);

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.status(404).send('Cover image not found');
  }
});

// 6. PDF Kataloğu Doğrudan Tarayıcıda Aç (View Inline)
app.get(['/catalogues/view/:filename', '/api/catalogues/view/:filename'], (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(mailer.CATALOGUES_PDF_DIR, filename);

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.status(404).send('Katalog PDF dosyası bulunamadı.');
  }
});

// 7. Yeni PDF Katalog Yükle ve Kapak Üret
app.post('/api/catalogues/upload', upload.single('catalogPdf'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Lütfen bir PDF dosyası seçin.' });
  }

  try {
    const pdfFilename = req.file.filename;
    const pdfPath = path.join(mailer.CATALOGUES_PDF_DIR, pdfFilename);
    const baseName = path.basename(pdfFilename, path.extname(pdfFilename));
    const coverFilename = `${baseName}_cover.jpg`;
    const coverPath = path.join(mailer.CATALOGUES_COVERS_DIR, coverFilename);

    // Python ile kapak görselini çıkar
    const coverSuccess = mailer.generateCoverFromPdf(pdfPath, coverPath);

    // Konfigürasyona ekle
    const config = mailer.getCampaignConfig();
    const newCatalog = {
      id: `cat-${Date.now()}`,
      title: req.body.title || baseName.replace(/_/g, ' '),
      subtitle: req.body.subtitle || 'Product Collection',
      filename: pdfFilename,
      coverImage: coverSuccess ? coverFilename : 'default_cover.jpg',
      customUrl: req.body.customUrl || '',
      enabled: true,
      order: (config.catalogues || []).length + 1
    };

    config.catalogues = config.catalogues || [];
    config.catalogues.push(newCatalog);
    mailer.saveCampaignConfig(config);

    res.json({
      success: true,
      message: `"${newCatalog.title}" kataloğu başarıyla yüklendi ve kapak görseli oluşturuldu!`,
      catalog: newCatalog,
      config
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Katalog yükleme hatası: ' + err.message });
  }
});

// 8. Katalog Aktif/Pasif Durumunu Değiştir
app.post('/api/catalogues/toggle/:id', (req, res) => {
  try {
    const id = req.params.id;
    const config = mailer.getCampaignConfig();
    const item = (config.catalogues || []).find(c => c.id === id);
    if (!item) return res.status(404).json({ success: false, error: 'Katalog bulunamadı' });

    item.enabled = !item.enabled;
    mailer.saveCampaignConfig(config);
    res.json({ success: true, catalog: item, config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Katalog Sil
app.delete('/api/catalogues/:id', (req, res) => {
  try {
    const id = req.params.id;
    const config = mailer.getCampaignConfig();
    const index = (config.catalogues || []).findIndex(c => c.id === id);
    if (index === -1) return res.status(404).json({ success: false, error: 'Katalog bulunamadı' });

    const [removed] = config.catalogues.splice(index, 1);
    mailer.saveCampaignConfig(config);

    try {
      const pdfPath = path.join(mailer.CATALOGUES_PDF_DIR, removed.filename);
      if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      const coverPath = path.join(mailer.CATALOGUES_COVERS_DIR, removed.coverImage);
      if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
    } catch {}

    res.json({ success: true, message: 'Katalog listeden kaldırıldı.', config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. TEK TANITIM E-POSTASINI GÖNDER (Modern Kurumsal Motor)
app.post('/api/campaign/send', async (req, res) => {
  const { email, company_name, source_url, category } = req.body;
  if (!email || !scraper.isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Lütfen geçerli bir e-posta adresi girin.' });
  }

  try {
    const lead = await db.addOrGetLead({
      email,
      company_name: company_name || '',
      source_url: source_url || 'Doğrudan Gönderim',
      category: category || 'İletişim / Bilgi'
    });

    const result = await mailer.sendSingleCampaignEmail(lead.email);

    await db.markLeadSent(lead.id, result.subject);
    await db.logEmail(lead.id, lead.email, 1, result.subject, 'Katalog Kitapçık Bağlantıları', 'success', null);

    const updatedLead = await db.getLeadById(lead.id);
    res.json({
      success: true,
      message: `Tanıtım e-postası başarıyla gönderildi -> ${lead.email}`,
      lead: updatedLead,
      result
    });
  } catch (err) {
    console.error('Gönderim hatası:', err.message);
    try {
      const lead = await db.addOrGetLead({ email, company_name });
      await db.updateLead(lead.id, { status: 'failed', last_error: err.message });
      await db.logEmail(lead.id, email, 1, 'Tanıtım E-Postası', 'Katalog Bağlantıları', 'failed', err.message);
    } catch {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Yeni Düzen Outlook'ta Aç / Taslak Oluştur
app.post('/api/campaign/open-outlook', async (req, res) => {
  const { email, company_name } = req.body;
  if (!email || !scraper.isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Lütfen geçerli bir e-posta adresi girin.' });
  }

  try {
    const result = await mailer.openInNewOutlook(email);
    res.json({
      success: true,
      message: `E-posta Microsoft Outlook (Yeni Düzen) uygulamasında açıldı. İnceleyip gönderebilirsiniz.`,
      result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. Test E-postası Gönder (Kendime Gönder)
app.post('/api/mail/test', async (req, res) => {
  const { to } = req.body;
  if (!to || !scraper.isValidEmail(to)) {
    return res.status(400).json({ success: false, error: 'Lütfen geçerli bir test e-posta adresi girin.' });
  }

  try {
    const result = await mailer.sendTestEmail(to);
    const engineInfo = mailer.getEngineInfo();
    res.json({
      success: true,
      message: `Tanıtım e-postanız başarıyla iletildi! (${to})`,
      details: result,
      engine: engineInfo
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. Web Sitesi Tara (Gelişmiş Çok Dilli E-posta Keşfi)
app.post('/api/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ success: false, error: 'Lütfen geçerli bir web sitesi adresi girin.' });
  }

  try {
    const scrapeData = await scraper.scrapeWebsite(url);
    res.json({ success: true, data: scrapeData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. Müşteri Listesi
app.get('/api/leads', async (req, res) => {
  try {
    const leads = await db.getAllLeads();
    res.json({ success: true, leads });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 15. Manuel Müşteri Ekle
app.post('/api/leads', async (req, res) => {
  const { email, company_name, source_url, category } = req.body;
  if (!email || !scraper.isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Geçerli bir e-posta adresi belirtin.' });
  }

  try {
    const lead = await db.addOrGetLead({ email, company_name, source_url, category });
    res.json({ success: true, lead });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 16. Müşteri Sil
app.delete('/api/leads/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.deleteLead(id);
    res.json({ success: true, message: 'Müşteri kaydı silindi.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 17. Gönderim Logları
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await db.getEmailLogs(200);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sunucuyu Başlat (Yerel ortamda doğrudan çalıştırılırsa)
if (require.main === module) {
  app.listen(PORT, () => {
    const sender = mailer.getSenderInfo();
    console.log('========================================================');
    console.log('  🌿 NİLTEKS B2B DİJİTAL KATALOG & E-POSTA PANELİ');
    console.log('========================================================');
    console.log(`  👉 Panel Adresi  : http://localhost:${PORT}`);
    console.log(`  👉 Gönderici     : ${sender.fromHeader}`);
    console.log(`  👉 Reply-To      : ${sender.replyTo}`);
    console.log(`  👉 Gönderim Modu : Modern Kurumsal Gönderim (Yeni Düzen)`);
    console.log(`  👉 Posta Sunucusu: mail.niltex.com.tr:587`);
    console.log('========================================================');
  });
}

module.exports = app;
