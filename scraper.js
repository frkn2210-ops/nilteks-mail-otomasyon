const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const db = require('./db');

// HTTPS Sertifika Hatalarını ve SSL engellerini tolere eden ajan
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true
});
const httpAgent = new http.Agent({
  keepAlive: true
});

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Geçersiz / Çöp filtreleri
const IGNORED_DOMAINS = [
  'example.com', 'test.com', 'domain.com', 'sentry.io', 'wixpress.com', 
  'cloudflare.com', 'schema.org', 'w3.org', 'googleapis.com', 'gravatar.com',
  'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com', 'youtube.com'
];

const INVALID_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.css', '.js', 
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.pdf'
];

// Cloudflare Email Protection Çözücü (__cf_email__)
function decodeCloudflareEmail(hex) {
  if (!hex || typeof hex !== 'string') return null;
  try {
    let email = '';
    const k = parseInt(hex.substr(0, 2), 16);
    for (let i = 2; i < hex.length; i += 2) {
      email += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ k);
    }
    return email.trim().toLowerCase();
  } catch {
    return null;
  }
}

// HTML Entity ve Karakter Temizleme (&#64; -> @, %40 -> @ vb.)
function cleanAndDecodeHtmlEntities(text) {
  if (!text) return '';
  let str = text;

  // URL Encode
  try {
    str = decodeURIComponent(str);
  } catch {}

  // Yaygın HTML entities
  str = str
    .replace(/&#64;/gi, '@')
    .replace(/&#064;/gi, '@')
    .replace(/&commat;/gi, '@')
    .replace(/&#46;/gi, '.')
    .replace(/&period;/gi, '.')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, ''); // Sıfır genişlikli boşlukları temizle

  return str;
}

// E-posta Geçerlilik Kontrolü
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const cleaned = cleanAndDecodeHtmlEntities(email).trim().toLowerCase();
  if (cleaned.length < 5 || cleaned.length > 80) return false;

  // Dosya uzantısı kontrolü (logo@2x.png vb. durumlar için)
  for (const ext of INVALID_EXTENSIONS) {
    if (cleaned.endsWith(ext)) return false;
  }

  // Geçersiz / sahte alan adları
  for (const domain of IGNORED_DOMAINS) {
    if (cleaned.includes(domain)) return false;
  }

  // Standart regex kontrolü
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return regex.test(cleaned);
}

// Departman / Kategori Belirleme
function categorizeEmail(email) {
  const lower = email.toLowerCase();

  // Satın Alma & Tedarik
  if (lower.includes('purchasing') || lower.includes('purchase') || lower.includes('buying') || 
      lower.includes('procurement') || lower.includes('satin') || lower.includes('tedarik') || 
      lower.includes('buyer') || lower.includes('einkauf')) {
    return { type: 'Satın Alma (Purchasing)', priority: 1, badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
  }

  // Yönetim, Dış Ticaret & İhracat
  if (lower.includes('export') || lower.includes('ihracat') || lower.includes('import') || 
      lower.includes('ithalat') || lower.includes('director') || lower.includes('manager') || 
      lower.includes('ceo') || lower.includes('geschaeftsfuehrer') || lower.includes('owner') ||
      lower.includes('founder') || lower.includes('yonetim')) {
    return { type: 'Yönetim / Dış Ticaret', priority: 2, badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-300' };
  }

  // Satış & B2B Sipariş
  if (lower.includes('sales') || lower.includes('satis') || lower.includes('order') || 
      lower.includes('siparis') || lower.includes('vertrieb') || lower.includes('b2b') ||
      lower.includes('wholesale') || lower.includes('toptan')) {
    return { type: 'Satış / Sipariş', priority: 3, badgeClass: 'bg-blue-100 text-blue-800 border-blue-300' };
  }

  // İletişim, Danışma & Genel Bilgi
  if (lower.includes('info') || lower.includes('contact') || lower.includes('iletisim') || 
      lower.includes('kontakt') || lower.includes('hello') || lower.includes('office') || 
      lower.includes('mail') || lower.includes('support') || lower.includes('desk') ||
      lower.includes('kundenservice') || lower.includes('service')) {
    return { type: 'İletişim / Genel Bilgi (Info)', priority: 4, badgeClass: 'bg-amber-100 text-amber-800 border-amber-300' };
  }

  return { type: 'Diğer Kurumsal Adres', priority: 5, badgeClass: 'bg-slate-100 text-slate-800 border-slate-300' };
}

// Gizlenmiş / Maskelenmiş (Obfuscated) e-postaları yakalama
// Örn: info [at] domain.com, contact(at)domain.de, purchasing AT domain DOT com
function extractObfuscatedEmails(text) {
  const found = new Set();
  if (!text) return found;

  const patterns = [
    /([a-zA-Z0-9._%+-]+)\s*(?:\[|\(|\{)?\s*(?:at|@)\s*(?:\]|\)|\})?\s*([a-zA-Z0-9.-]+)\s*(?:\[|\(|\{)?\s*(?:dot|\.|\s*\.\s*)\s*(?:\]|\)|\})?\s*([a-zA-Z]{2,})/gi
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const user = match[1].trim();
      const domain = match[2].trim().replace(/\.$/, '');
      const tld = match[3].trim();
      const reconstructed = `${user}@${domain}.${tld}`.toLowerCase();
      if (isValidEmail(reconstructed)) {
        found.add(reconstructed);
      }
    }
  }

  return found;
}

// Bir HTML içeriğinden tüm yöntemlerle e-postaları çıkarma
function extractAllEmailsFromHtml(rawHtml) {
  const emails = new Set();
  if (!rawHtml || typeof rawHtml !== 'string') return emails;

  const html = cleanAndDecodeHtmlEntities(rawHtml);
  const $ = cheerio.load(html);

  // 1. Cloudflare Obfuscation Yakala
  $('[data-cfemail]').each((_, el) => {
    const hex = $(el).attr('data-cfemail');
    const decoded = decodeCloudflareEmail(hex);
    if (decoded && isValidEmail(decoded)) {
      emails.add(decoded);
    }
  });

  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const hex = href.split('#')[1];
    const decoded = decodeCloudflareEmail(hex);
    if (decoded && isValidEmail(decoded)) {
      emails.add(decoded);
    }
  });

  // 2. mailto: Bağlantıları
  $('a[href^="mailto:"]').each((_, el) => {
    let href = $(el).attr('href') || '';
    let email = href.replace(/^mailto:/i, '').split('?')[0].split('&')[0].trim();
    email = cleanAndDecodeHtmlEntities(email);
    if (isValidEmail(email)) {
      emails.add(email.toLowerCase());
    }
  });

  // 3. Özel data- ve value etiketleri
  $('[data-email], [data-mail], [data-address], [data-contact]').each((_, el) => {
    const val = $(el).attr('data-email') || $(el).attr('data-mail') || $(el).attr('data-address') || $(el).attr('data-contact');
    if (val && isValidEmail(val)) {
      emails.add(val.toLowerCase().trim());
    }
  });

  // 4. JSON-LD / Schema.org Yapılandırılmış Veriler
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const jsonContent = $(el).html();
      const emailMatches = jsonContent.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi) || [];
      for (const m of emailMatches) {
        if (isValidEmail(m)) emails.add(m.toLowerCase().trim());
      }
    } catch {}
  });

  // 5. Standart Regex ile Tüm Metin ve Body Taraması
  const standardRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
  const matches = html.match(standardRegex) || [];
  for (const m of matches) {
    const cleanMail = m.trim().toLowerCase();
    if (isValidEmail(cleanMail)) {
      emails.add(cleanMail);
    }
  }

  // 6. Maskelenmiş (info [at] domain.com) metinleri çıkar
  const obfuscated = extractObfuscatedEmails(html);
  for (const o of obfuscated) {
    emails.add(o);
  }

  return emails;
}

// Derin Link Arama: Tüm dillerdeki iletişim ve kurumsal sayfaları bul
function findDeepContactLinks($, baseUrl) {
  const contactLinks = new Set();
  const baseObj = new URL(baseUrl);

  // Çok dilli anahtar kelimeler (İngilizce, Almanca, Türkçe, Fransızca, İtalyanca, İspanyolca)
  const contactKeywords = [
    // EN
    'contact', 'contact-us', 'about', 'about-us', 'imprint', 'impressum', 'reach', 'team',
    'support', 'help', 'locations', 'stores', 'wholesale', 'purchasing', 'b2b', 'company',
    // DE
    'kontakt', 'impressum', 'uber-uns', 'ueber-uns', 'anfahrt', 'kundenservice', 'unternehmen', 'grosshandel',
    // TR
    'iletisim', 'hakkimizda', 'bize-ulasin', 'kurumsal', 'subeler', 'magazalar', 'toptan', 'musteri-hizmetleri',
    // FR
    'a-propos', 'mentions-legales', 'qui-sommes-nous', 'nous-contacter',
    // IT / ES
    'contatti', 'chi-siamo', 'dove-siamo', 'contacto', 'sobre-nosotros', 'quienes-somos', 'aviso-legal'
  ];

  $('a[href]').each((_, el) => {
    try {
      const href = $(el).attr('href');
      const text = ($(el).text() || '').toLowerCase().trim();
      if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:') || href.startsWith('#')) return;

      const absoluteUrl = new URL(href, baseUrl);
      
      // Sadece aynı hostname (veya alt alan adı) içindeki bağlantılar
      if (absoluteUrl.hostname === baseObj.hostname || absoluteUrl.hostname.endsWith('.' + baseObj.hostname)) {
        const linkPath = absoluteUrl.pathname.toLowerCase();
        
        const isMatch = contactKeywords.some(kw => 
          linkPath.includes(kw) || text.includes(kw)
        );

        if (isMatch && absoluteUrl.href !== baseUrl) {
          // Parametre ve hashleri temizle
          absoluteUrl.hash = '';
          contactLinks.add(absoluteUrl.href);
        }
      }
    } catch {}
  });

  // En fazla 8 adet yüksek öncelikli iç sayfayı tara
  return Array.from(contactLinks).slice(0, 8);
}

// Web Sitesini Derinlemesine Tara
async function scrapeWebsite(inputUrl) {
  let targetUrl = inputUrl.trim();
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  const parsedUrl = new URL(targetUrl);
  const companyGuess = parsedUrl.hostname.replace(/^(www\.|m\.)/i, '').split('.')[0];
  const companyName = companyGuess.charAt(0).toUpperCase() + companyGuess.slice(1);

  const scannedPages = [];
  const foundEmailsMap = new Map(); // email -> { sources: Set, category }

  const axiosInstance = axios.create({
    timeout: 15000,
    httpsAgent,
    httpAgent,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7,de;q=0.6,fr;q=0.5',
      'Cache-Control': 'no-cache'
    },
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 500
  });

  // Sayfayı Çek ve E-postaları Çıkar Yardımcısı
  async function processUrl(urlToFetch) {
    try {
      const resp = await axiosInstance.get(urlToFetch);
      scannedPages.push({ url: urlToFetch, status: resp.status });

      if (resp.status >= 200 && resp.status < 400 && typeof resp.data === 'string') {
        const emails = extractAllEmailsFromHtml(resp.data);
        for (const email of emails) {
          if (!foundEmailsMap.has(email)) {
            foundEmailsMap.set(email, {
              sources: new Set([urlToFetch]),
              category: categorizeEmail(email)
            });
          } else {
            foundEmailsMap.get(email).sources.add(urlToFetch);
          }
        }
        return cheerio.load(resp.data);
      }
    } catch (err) {
      scannedPages.push({ url: urlToFetch, error: err.message });
    }
    return null;
  }

  // 1. Ana Sayfayı Tara (HTTPS Dene)
  let main$ = await processUrl(targetUrl);

  // Eğer HTTPS başarısız olduysa HTTP ile tekrar dene
  if (!main$ && targetUrl.startsWith('https://')) {
    const httpFallback = targetUrl.replace('https://', 'http://');
    main$ = await processUrl(httpFallback);
    if (main$) {
      targetUrl = httpFallback;
    }
  }

  // 2. Eğer ana sayfa başarıyla çekildiyse alt sayfaları keşfet ve tara
  if (main$) {
    const deepLinks = findDeepContactLinks(main$, targetUrl);
    
    // Alt sayfaları paralel olarak (batch) çek
    await Promise.allSettled(deepLinks.map(link => processUrl(link)));
  }

  // 3. Veritabanındaki Mevcut Kayıtlarla Eşleştir
  const allLeadsInDb = await db.getAllLeads();
  const dbMap = new Map();
  for (const lead of allLeadsInDb) {
    dbMap.set(lead.email.toLowerCase(), lead);
  }

  const results = [];
  for (const [email, meta] of foundEmailsMap.entries()) {
    const existingInDb = dbMap.get(email);
    const sourcesArray = Array.from(meta.sources);

    results.push({
      email,
      companyName,
      sourceUrl: sourcesArray[0] || targetUrl,
      allSources: sourcesArray,
      category: meta.category.type,
      priority: meta.category.priority,
      badgeClass: meta.category.badgeClass,
      inDatabase: !!existingInDb,
      dbLeadId: existingInDb ? existingInDb.id : null,
      campaignStatus: existingInDb ? existingInDb.status : 'not_started',
      currentStep: existingInDb ? existingInDb.current_step : 0
    });
  }

  // Önceliğe göre sırala (Satın Alma > Yönetim > Satış > Info)
  results.sort((a, b) => a.priority - b.priority);

  return {
    targetUrl,
    hostname: parsedUrl.hostname,
    companyName,
    scannedPagesCount: scannedPages.length,
    scannedPages,
    emailsFound: results.length,
    results
  };
}

module.exports = {
  scrapeWebsite,
  isValidEmail,
  categorizeEmail,
  extractAllEmailsFromHtml,
  decodeCloudflareEmail
};
