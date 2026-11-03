const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');

const isVercel = !!process.env.VERCEL;

// Dizin Yolları
const CATALOGUES_PDF_DIR = fs.existsSync(path.join(__dirname, 'public', 'catalogues', 'pdf'))
  ? path.join(__dirname, 'public', 'catalogues', 'pdf')
  : path.join(__dirname, 'catalogues', 'pdf');
const CATALOGUES_COVERS_DIR = fs.existsSync(path.join(__dirname, 'public', 'catalogues', 'covers'))
  ? path.join(__dirname, 'public', 'catalogues', 'covers')
  : path.join(__dirname, 'catalogues', 'covers');
const DRAFTS_DIR = isVercel ? '/tmp/drafts' : path.join(__dirname, 'data', 'drafts');
const CONFIG_PATH = isVercel ? '/tmp/campaign_config.json' : path.join(__dirname, 'data', 'campaign_config.json');

// Gerekli klasörlerin varlığını garantiye al
[CATALOGUES_PDF_DIR, CATALOGUES_COVERS_DIR, DRAFTS_DIR, path.dirname(CONFIG_PATH)].forEach(dir => {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
});

// Varsayılan Kampanya Yapılandırması
const DEFAULT_CAMPAIGN_CONFIG = {
  subject: "Discover Nil Home | Your Home Textile Manufacturing Partner in Türkiye",
  introText: `Dear Sir/Madam,

We would love to introduce you to Nilteks, a textile manufacturer based in Denizli, Türkiye, with over 30 years of experience.

Our story started with kitchen towels, and over the years, we have expanded our expertise to a wide variety of home textiles. Today, we combine our manufacturing experience with modern designs and evolving market trends to create products that meet the needs of customers worldwide.

In addition to our Nil Home collections, we offer private label production, helping our partners bring their own designs and brands to life. We take pride in offering competitive prices without compromising on quality, providing our partners with excellent value and reliable manufacturing.

Please find our latest product catalogues below. You can click on any booklet cover to view the full PDF catalogue directly in your web browser:`,
  closingText: `We would be happy to learn more about your needs and explore what we can create together.

Looking forward to hearing from you!

Best Regards,
Furkan Aydın
Nilteks Tekstil San. ve Tic. Ltd. Şti.
Denizli / Türkiye • www.niltex.com.tr
Email: furkan@nilteks.com.tr`,
  publicBaseUrl: "http://localhost:4000",
  catalogues: [
    {
      id: "cat-general",
      title: "Kitchen Towels Collection",
      subtitle: "Kitchen & Tea Towel Collections",
      filename: "Nilteks_General_Catalogue.pdf",
      coverImage: "Nilteks_General_Catalogue_cover.jpg",
      customUrl: "",
      enabled: true,
      order: 1
    },
    {
      id: "cat-bedding",
      title: "Nil Home Bedding Collection",
      subtitle: "Bed Linens, Duvet Sets & Pillows",
      filename: "NilHome_Bedding_Catalog.pdf",
      coverImage: "NilHome_Bedding_Catalog_cover.jpg",
      customUrl: "",
      enabled: true,
      order: 2
    },
    {
      id: "cat-towel",
      title: "Towel & Bathrobe Collection",
      subtitle: "Premium Cotton Towels & Bathrobes",
      filename: "Towel_and_Bathrobe_Collection.pdf",
      coverImage: "Towel_and_Bathrobe_Collection_cover.jpg",
      customUrl: "",
      enabled: true,
      order: 3
    },
    {
      id: "cat-bathmat",
      title: "Bath Mat Collection",
      subtitle: "Non-Slip & Luxury Bath Mats",
      filename: "Bath_Mat_Catalog.pdf",
      coverImage: "Bath_Mat_Catalog_cover.jpg",
      customUrl: "",
      enabled: true,
      order: 4
    },
    {
      id: "cat-christmas",
      title: "Christmas & Kitchen Collection",
      subtitle: "Seasonal Designs & Kitchen Towels",
      filename: "Christmas_Collection.pdf",
      coverImage: "Christmas_Collection_cover.jpg",
      customUrl: "",
      enabled: true,
      order: 5
    }
  ]
};

// Kampanya Konfigürasyonunu Yükle
function getCampaignConfig() {
  try {
    if (isVercel && !fs.existsSync(CONFIG_PATH)) {
      const src = path.join(__dirname, 'data', 'campaign_config.json');
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, CONFIG_PATH); } catch {}
      }
    }
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      return JSON.parse(raw);
    }
    const fallbackSrc = path.join(__dirname, 'data', 'campaign_config.json');
    if (fs.existsSync(fallbackSrc)) {
      return JSON.parse(fs.readFileSync(fallbackSrc, 'utf8'));
    }
  } catch (err) {
    console.error('Konfigürasyon okunamadı, varsayılan yükleniyor:', err.message);
  }
  saveCampaignConfig(DEFAULT_CAMPAIGN_CONFIG);
  return DEFAULT_CAMPAIGN_CONFIG;
}

// Genel Erişim URL'sini Çözümle (Vercel veya Özel Domain)
function resolveBaseUrl(config, options = {}) {
  if (options.baseUrl) return options.baseUrl.replace(/\/$/, '');
  if (config.publicBaseUrl && config.publicBaseUrl.startsWith('http') && !config.publicBaseUrl.includes('localhost')) {
    return config.publicBaseUrl.replace(/\/$/, '');
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return (config.publicBaseUrl || 'http://localhost:4000').replace(/\/$/, '');
}

// Kampanya Konfigürasyonunu Kaydet
function saveCampaignConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return config;
  } catch (err) {
    console.error('Konfigürasyon kaydedilemedi:', err.message);
    throw err;
  }
}

// PDF'in 1. Sayfasından Kitapçık Kapak Görseli Üret
function generateCoverFromPdf(pdfPath, outCoverPath) {
  try {
    const pythonScript = `
import sys
import fitz # PyMuPDF
from PIL import Image
import io

pdf_path = sys.argv[1]
out_path = sys.argv[2]

doc = fitz.open(pdf_path)
page = doc[0]
pix = page.get_pixmap(dpi=150)
img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
img.thumbnail((600, 800), Image.Resampling.LANCZOS)
img.save(out_path, "JPEG", quality=85, optimize=True)
doc.close()
print("OK")
`;
    const res = require('child_process').spawnSync('python3', ['-c', pythonScript, pdfPath, outCoverPath], {
      encoding: 'utf8',
      timeout: 15000
    });
    if (res.status === 0 && fs.existsSync(outCoverPath)) {
      return true;
    }
    console.warn('Python kapak üretme çıktısı:', res.stdout, res.stderr);
    return false;
  } catch (err) {
    console.warn('Kapak üretilemedi:', err.message);
    return false;
  }
}

// ========================================================
// E-POSTA GÖNDERİM MOTORU (MODERN DÜZEN / SMTP & YENİ OUTLOOK)
// ========================================================

function getTransporter() {
  const host = process.env.SMTP_HOST || 'mail.niltex.com.tr';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER || 'furkan@niltex.com.tr';
  const pass = process.env.SMTP_PASS || 'cGue1JtV';

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });
}

function getSenderInfo() {
  const name = process.env.FROM_NAME || 'Furkan Aydın';
  const email = process.env.FROM_EMAIL || 'furkan@niltex.com.tr';
  const replyTo = process.env.REPLY_TO || 'furkan@nilteks.com.tr';
  return {
    name,
    email,
    replyTo,
    fromHeader: `"${name}" <${email}>`
  };
}

// Kitapçık Görünümlü Responsive HTML E-posta Üretici
function generateEmailHtml(config, options = {}) {
  const baseUrl = resolveBaseUrl(config, options);

  // Tanıtım Paragrafları
  const introParagraphs = (config.introText || '')
    .split('\n\n')
    .filter(p => p.trim())
    .map(p => `<p style="margin: 0 0 16px 0; line-height: 1.68; color: #334155; font-size: 15px;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  // Kapanış Paragrafları
  const closingParagraphs = (config.closingText || '')
    .split('\n\n')
    .filter(p => p.trim())
    .map(p => `<p style="margin: 0 0 14px 0; line-height: 1.6; color: #334155; font-size: 14.5px;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  // Aktif Katalog Kitapçıkları
  const activeCatalogues = (config.catalogues || []).filter(c => c.enabled !== false);

  // Kitapçık Kartları (Yan Yana Sıralı HTML Tablo Düzeni)
  const bookletCardsHtml = activeCatalogues.map((cat) => {
    // PDF Linki: Eğer özel URL varsa onu kullan, yoksa yerel sunucu endpoint'i
    const pdfUrl = (cat.customUrl && cat.customUrl.trim().startsWith('http'))
      ? cat.customUrl.trim()
      : `${baseUrl}/catalogues/view/${encodeURIComponent(cat.filename)}`;

    // Kapak Görseli URL'si
    const coverUrl = `${baseUrl}/api/covers/${encodeURIComponent(cat.coverImage)}`;

    return `
      <!-- Kitapçık Kartı -->
      <td align="center" valign="top" style="padding: 14px 10px; width: 220px;">
        <div style="max-width: 220px; margin: 0 auto; text-align: center;">
          <!-- Tıklanabilir Kitapçık Kapağı -->
          <a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; display: block; color: inherit;">
            <div style="display: inline-block; position: relative; border-radius: 4px 12px 12px 4px; border: 1px solid #cbd5e1; border-left: 7px solid #0f766e; box-shadow: -5px 9px 22px rgba(0,0,0,0.22); background-color: #ffffff; overflow: hidden; transition: transform 0.2s ease;">
              <img src="${coverUrl}" alt="${cat.title}" width="190" style="display: block; width: 190px; height: auto; max-height: 270px; object-fit: cover; border-radius: 0 10px 10px 0;" />
            </div>
            
            <!-- Başlık ve Kategori -->
            <div style="margin-top: 12px; font-weight: 700; color: #0f172a; font-size: 14px; line-height: 1.35; padding: 0 4px;">
              ${cat.title}
            </div>
            ${cat.subtitle ? `<div style="margin-top: 3px; font-size: 11.5px; color: #64748b; line-height: 1.3;">${cat.subtitle}</div>` : ''}
            
            <!-- Doğrudan Web Tarayıcısında Aç Butonu -->
            <div style="margin-top: 10px; display: inline-block; background-color: #0f766e; color: #ffffff; padding: 8px 18px; border-radius: 20px; font-size: 12px; font-weight: 700; text-decoration: none; letter-spacing: 0.3px; box-shadow: 0 2px 6px rgba(15,118,110,0.35);">
              📖 Kataloğu Aç (PDF) &rarr;
            </div>
          </a>
        </div>
      </td>
    `;
  });

  // 2'şerli Satırlara Böl
  const columnsPerRow = 2;
  const rows = [];
  for (let i = 0; i < bookletCardsHtml.length; i += columnsPerRow) {
    const rowCards = bookletCardsHtml.slice(i, i + columnsPerRow).join('');
    rows.push(`<tr>${rowCards}</tr>`);
  }
  const bookletsTableHtml = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0 28px 0; border-collapse: separate;">
      ${rows.join('')}
    </table>
  `;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.subject || 'Nilteks - Home Textiles'}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; }
    .container { max-width: 660px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
    .header { background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); padding: 30px 36px; color: #ffffff; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.5px; }
    .header p { margin: 5px 0 0 0; font-size: 13px; color: #ccfbf1; font-weight: 500; }
    .body-content { padding: 36px 36px 20px 36px; }
    .divider { height: 1px; background: #e2e8f0; margin: 24px 0; border: none; }
    .footer { background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 36px; font-size: 12px; color: #64748b; line-height: 1.6; }
    .footer strong { color: #1e293b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>NİLTEKS</h1>
      <p>Home Textiles Manufacturer &bull; Private Label Production &bull; Denizli, Türkiye</p>
    </div>

    <div class="body-content">
      <!-- Tanıtım Yazısı -->
      ${introParagraphs}

      <hr class="divider" />

      <!-- Kitapçık Görünümlü Yan Yana Kataloglar -->
      <div style="text-align: center; margin-bottom: 8px;">
        <span style="display: inline-block; background-color: #f0fdfa; border: 1px solid #ccfbf1; color: #0f766e; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
          ✨ Ürün Koleksiyonlarımız (PDF)
        </span>
      </div>

      ${bookletsTableHtml}

      <hr class="divider" />

      <!-- Kapanış ve İletişim -->
      ${closingParagraphs}
    </div>

    <div class="footer">
      <p style="margin: 0 0 4px 0;"><strong>Nilteks Tekstil San. ve Tic. Ltd. Şti.</strong></p>
      <p style="margin: 0 0 4px 0;">Denizli / Türkiye &bull; <a href="https://niltex.com.tr" style="color: #0f766e; text-decoration: none; font-weight: 600;">www.niltex.com.tr</a></p>
      <p style="margin: 0; color: #94a3b8;">Email: furkan@nilteks.com.tr | furkan@niltex.com.tr</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// Düz Metin Alternatifi
function generatePlainText(config) {
  const activeCatalogues = (config.catalogues || []).filter(c => c.enabled !== false);
  const baseUrl = resolveBaseUrl(config);

  const catalogLinks = activeCatalogues.map(c => {
    const url = (c.customUrl && c.customUrl.trim().startsWith('http'))
      ? c.customUrl.trim()
      : `${baseUrl}/catalogues/view/${encodeURIComponent(c.filename)}`;
    return `- ${c.title}: ${url}`;
  }).join('\n');

  return `
${config.introText}

PRODUCT CATALOGUES (Click links to view in browser):
${catalogLinks}

${config.closingText}
  `.trim();
}

// ========================================================
// YENİ DÜZEN GÖNDERİM & YENİ OUTLOOK ENTEGRASYONU
// ========================================================

// 1. Doğrudan Yüksek Hızlı Kurumsal Gönderim (Varsayılan - Eski Outlook İhtiyacı Yok)
async function sendSingleCampaignEmail(toEmail, customConfig = null) {
  const config = customConfig || getCampaignConfig();
  const subject = config.subject || "Discover Nil Home | Your Home Textile Manufacturing Partner in Türkiye";
  const htmlContent = generateEmailHtml(config);
  const plainText = generatePlainText(config);

  console.log(`✉️ [Modern Gönderim] Tanıtım maili iletiliyor -> ${toEmail}`);
  const transporter = getTransporter();
  const sender = getSenderInfo();

  const mailOptions = {
    from: sender.fromHeader,
    to: toEmail,
    replyTo: sender.replyTo,
    subject,
    text: plainText,
    html: htmlContent
  };

  const info = await transporter.sendMail(mailOptions);
  return {
    success: true,
    method: 'modern',
    messageId: info.messageId,
    subject,
    email: toEmail
  };
}

// 2. Yeni Outlook'ta Aç / Taslak Oluştur (Mac Yeni Düzen Outlook ile Doğrudan Uyumlu)
async function openInNewOutlook(toEmail, customConfig = null) {
  const config = customConfig || getCampaignConfig();
  const subject = config.subject || "Discover Nil Home | Your Home Textile Manufacturing Partner in Türkiye";
  const htmlContent = generateEmailHtml(config);
  const sender = getSenderInfo();

  // RFC 822 formatında standart .eml oluştur
  const safeFilename = `nilteks_draft_${Date.now()}.eml`;
  const emlPath = path.join(DRAFTS_DIR, safeFilename);

  const emlData = [
    `From: ${sender.fromHeader}`,
    `To: ${toEmail}`,
    `Reply-To: ${sender.replyTo}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(htmlContent, 'utf8').toString('base64')
  ].join('\r\n');

  fs.writeFileSync(emlPath, emlData, 'utf8');

  // Yeni Outlook veya sistemin varsayılan e-posta istemcisinde aç
  return new Promise((resolve, reject) => {
    exec(`open -a "Microsoft Outlook" "${emlPath}" || open "${emlPath}"`, (err) => {
      if (err) {
        return reject(new Error('Microsoft Outlook açılamadı: ' + err.message));
      }
      resolve({
        success: true,
        message: 'E-posta Microsoft Outlook (Yeni Düzen) penceresinde açıldı.',
        emlPath,
        email: toEmail,
        subject
      });
    });
  });
}

// Test E-postası Gönder
async function sendTestEmail(testRecipient) {
  const config = getCampaignConfig();
  return await sendSingleCampaignEmail(testRecipient, config);
}

// Bağlantı Doğrulama (Modern Kurumsal SMTP)
async function verifyConnection() {
  const transporter = getTransporter();
  try {
    await transporter.verify();
    return {
      success: true,
      method: 'modern',
      message: 'Kurumsal posta sunucusuna (mail.niltex.com.tr:587) başarıyla bağlanıldı ve kimlik doğrulandı.'
    };
  } catch (err) {
    return {
      success: false,
      method: 'modern',
      message: err.message,
      code: err.code,
      details: 'Lütfen .env dosyasındaki sunucu bilgilerini kontrol edin.'
    };
  }
}

function getEngineInfo() {
  return {
    engine: 'modern',
    name: 'Modern Kurumsal Gönderim (Yeni Düzen & Hızlı İletim)',
    isModern: true,
    description: 'Eski Outlook gerektirmez, doğrudan kurumsal posta sunucusu üzerinden anında iletilir.'
  };
}

module.exports = {
  getCampaignConfig,
  saveCampaignConfig,
  generateEmailHtml,
  generatePlainText,
  generateCoverFromPdf,
  sendSingleCampaignEmail,
  openInNewOutlook,
  sendTestEmail,
  verifyConnection,
  getEngineInfo,
  getSenderInfo,
  CATALOGUES_PDF_DIR,
  CATALOGUES_COVERS_DIR
};
