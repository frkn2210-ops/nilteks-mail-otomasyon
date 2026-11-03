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

// Geçerli Ticari ve Ülke TLD Listesi
const VALID_TLDS = new Set([
  'com', 'net', 'org', 'de', 'tr', 'com.tr', 'org.tr', 'net.tr', 'biz.tr', 'info.tr', 'gen.tr',
  'uk', 'co.uk', 'eu', 'fr', 'it', 'es', 'nl', 'at', 'ch', 'be', 'dk', 'se', 'no', 'fi',
  'pl', 'cz', 'gr', 'bg', 'ro', 'ru', 'ua', 'us', 'ca', 'au', 'nz', 'info', 'biz',
  'co', 'io', 'me', 'pro', 'store', 'shop', 'ltd', 'gmbh', 'online', 'textiles', 'fashion',
  'group', 'global', 'trade', 'int', 'cc', 'tv', 'ws'
]);

// Dosya ve Medya Uzantıları (Kesinlikle e-posta olamaz)
const INVALID_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.css', '.js', '.map',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp4', '.mp3', '.pdf', '.zip',
  '.gz', '.json', '.xml', '.wasm', '.ico', '.bmp', '.tif', '.tiff', '.avif',
  '.min.js', '.min.css'
];

// E-posta Taramasında Hariç Tutulacak Servis / Kütüphane / Takip Alan Adları
const IGNORED_DOMAINS = [
  'example.com', 'test.com', 'domain.com', 'sample.com', 'yourcompany.com', 'yourname.com', 'email.com', 'site.com',
  'sentry.io', 'wixpress.com', 'cloudflare.com', 'schema.org', 'w3.org', 'googleapis.com', 'gstatic.com',
  'gravatar.com', 'github.com', 'gitlab.com', 'bootstrapcdn.com', 'unpkg.com', 'cdnjs.com', 'jsdelivr.net',
  'polyfill.io', 'fontawesome.com', 'akamaized.net', 'wp.org', 'wordpress.org', 'automattic.com',
  'facebook.com', 'twitter.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'tiktok.com', 'pinterest.com',
  'doubleclick.net', 'google.com', 'google-analytics.com', 'googletagmanager.com', 'clarity.ms', 'hotjar.com',
  'trustpilot.com', 'usercentrics.eu', 'cookiebot.com', 'onetrust.com', 'criteo.com', 'bing.com',
  'mailchimp.com', 'klaviyo.com', 'sendgrid.com', 'hubspot.com', 'intercom.io', 'zendesk.com', 'freshdesk.com',
  'shopify.com', 'myshopify.com', 'privacymanager.io', 'typekit.net', 'adobe.com'
];

// Sahte / Hatalı Kullanıcı Adı (Local-part) Filtresi
const IGNORED_USERNAMES = new Set([
  'u0026', 'u003c', 'u003e', 'undefined', 'null', 'false', 'true', 'placeholder',
  'username', 'yourname', 'name', 'test', 'sample', 'privacy', 'cookie', 'gdpr', 'abuse',
  'noreply', 'no-reply', 'donotreply', 'support-bot', 'webmaster'
]);

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

// HTML Entity ve Karakter Temizleme
function cleanAndDecodeHtmlEntities(text) {
  if (!text) return '';
  let str = text;
  try {
    str = decodeURIComponent(str);
  } catch {}

  str = str
    .replace(/&#64;/gi, '@')
    .replace(/&#064;/gi, '@')
    .replace(/&commat;/gi, '@')
    .replace(/&#46;/gi, '.')
    .replace(/&period;/gi, '.')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  return str;
}

// Alan Adını Temizle
function extractCleanHostname(urlStr) {
  try {
    let str = urlStr.trim();
    if (!str.startsWith('http://') && !str.startsWith('https://')) str = 'https://' + str;
    const obj = new URL(str);
    return obj.hostname.replace(/^(www\.|m\.)/i, '').toLowerCase();
  } catch {
    return '';
  }
}

// Kesin ve Güvenilir E-posta Geçerlilik Kontrolü
function isValidEmail(email, targetHostname = '') {
  if (!email || typeof email !== 'string') return false;
  const cleaned = cleanAndDecodeHtmlEntities(email).trim().toLowerCase();

  // Uzunluk kontrolü
  if (cleaned.length < 6 || cleaned.length > 80) return false;

  // Boşluk, tırnak, parantez veya geçersiz karakter içeremez
  if (/[\s'"<>\\()[\]{}:;,/!#$%^&*]/.test(cleaned.replace('@', ''))) {
    // Özel izinli semboller: . _ - +
    const localAndDomain = cleaned.split('@');
    if (localAndDomain.length !== 2) return false;
  }

  const parts = cleaned.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;

  // Kullanıcı adı (local) kuralları
  if (!local || local.length < 2 || local.length > 40) return false;
  if (/^[._-]|[._-]$/.test(local)) return false; // nokta/tire ile başlayıp bitemez
  if (/\.{2,}/.test(local)) return false; // ardışık nokta olamaz
  if (IGNORED_USERNAMES.has(local)) return false;

  // Harf olmayan veya geçersiz kelime ikameleri (Örn: b@hroom, loc@ed, discrimin@ion)
  if (/^[0-9]+$/.test(local)) return false; // Sadece rakamdan oluşan kullanıcı adlarını engelle

  // Alan adı (domain) kuralları
  if (!domain || domain.length < 4 || domain.length > 60) return false;
  if (!domain.includes('.')) return false;
  if (/^[.-]|[.-]$/.test(domain)) return false;
  if (/\.{2,}/.test(domain)) return false;

  // Dosya uzantısı kontrolü (.png, .jpg vb.)
  for (const ext of INVALID_EXTENSIONS) {
    if (domain.endsWith(ext) || cleaned.endsWith(ext)) return false;
  }

  // Kara listedeki servis / çöp alan adları
  for (const ign of IGNORED_DOMAINS) {
    if (domain === ign || domain.endsWith('.' + ign)) return false;
  }

  // TLD (uzantı) kontrolü
  const domainParts = domain.split('.');
  const tld = domainParts[domainParts.length - 1];
  const secondLevelTld = domainParts.length >= 3 ? `${domainParts[domainParts.length - 2]}.${tld}` : null;

  const hasValidTld = VALID_TLDS.has(tld) || (secondLevelTld && VALID_TLDS.has(secondLevelTld));
  if (!hasValidTld) return false;

  // Standart E-posta Biçimi Regex'i
  const standardRegex = /^[a-zA-Z0-9](?:[a-zA-Z0-9._%+-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
  if (!standardRegex.test(cleaned)) return false;

  return true;
}

// Departman / Kategori Belirleme
function categorizeEmail(email, targetHostname = '') {
  const lower = email.toLowerCase();
  const domain = lower.split('@')[1] || '';
  const cleanTarget = extractCleanHostname(targetHostname);

  const isCompanyDomain = cleanTarget && (domain === cleanTarget || domain.endsWith('.' + cleanTarget));

  // Satın Alma & Tedarik
  if (lower.includes('purchasing') || lower.includes('purchase') || lower.includes('buying') || 
      lower.includes('procurement') || lower.includes('satin') || lower.includes('tedarik') || 
      lower.includes('buyer') || lower.includes('einkauf')) {
    return {
      type: 'Satın Alma (Purchasing)',
      priority: 1,
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      isCompanyDomain
    };
  }

  // Yönetim, Dış Ticaret & İhracat / İthalat
  if (lower.includes('export') || lower.includes('ihracat') || lower.includes('import') || 
      lower.includes('ithalat') || lower.includes('director') || lower.includes('manager') || 
      lower.includes('ceo') || lower.includes('geschaeftsfuehrer') || lower.includes('owner') ||
      lower.includes('founder') || lower.includes('yonetim') || lower.includes('inhaber')) {
    return {
      type: 'Yönetim / Dış Ticaret',
      priority: 2,
      badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-300',
      isCompanyDomain
    };
  }

  // Satış & B2B Sipariş
  if (lower.includes('sales') || lower.includes('satis') || lower.includes('order') || 
      lower.includes('siparis') || lower.includes('vertrieb') || lower.includes('b2b') ||
      lower.includes('wholesale') || lower.includes('toptan')) {
    return {
      type: 'Satış / B2B Sipariş',
      priority: 3,
      badgeClass: 'bg-blue-100 text-blue-800 border-blue-300',
      isCompanyDomain
    };
  }

  // İletişim, Danışma & Genel Bilgi (Info)
  if (lower.includes('info') || lower.includes('contact') || lower.includes('iletisim') || 
      lower.includes('kontakt') || lower.includes('hello') || lower.includes('office') || 
      lower.includes('mail') || lower.includes('desk') || lower.includes('support')) {
    return {
      type: 'İletişim / Genel Bilgi (Info)',
      priority: isCompanyDomain ? 4 : 5,
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
      isCompanyDomain
    };
  }

  // Şahıs / Yetkili Adresi (ad@domain.com vb.)
  if (isCompanyDomain) {
    return {
      type: 'Firma İçi Yetkili / Şahıs Adresi',
      priority: 2,
      badgeClass: 'bg-teal-100 text-teal-800 border-teal-300',
      isCompanyDomain: true
    };
  }

  return {
    type: 'Diğer Kurumsal Adres',
    priority: 6,
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
    isCompanyDomain: false
  };
}

// Gizlenmiş / Maskelenmiş (Obfuscated) e-postaları yakalama
function extractObfuscatedEmails(text, targetHostname = '') {
  const found = new Set();
  if (!text) return found;

  const patterns = [
    /([a-zA-Z0-9._%+-]{2,30})\s*(?:\[|\(|\{)?\s*(?:at|@)\s*(?:\]|\)|\})?\s*([a-zA-Z0-9.-]{2,30})\s*(?:\[|\(|\{)?\s*(?:dot|\.|\s*\.\s*)\s*(?:\]|\)|\})?\s*([a-zA-Z]{2,10})/gi
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const user = match[1].trim();
      const domain = match[2].trim().replace(/\.$/, '');
      const tld = match[3].trim();
      const reconstructed = `${user}@${domain}.${tld}`.toLowerCase();
      if (isValidEmail(reconstructed, targetHostname)) {
        found.add(reconstructed);
      }
    }
  }

  return found;
}

// Bir HTML içeriğinden SADECE GERÇEK E-POSTALARI Çıkarma
function extractAllEmailsFromHtml(rawHtml, targetHostname = '') {
  const emails = new Set();
  if (!rawHtml || typeof rawHtml !== 'string') return emails;

  const html = cleanAndDecodeHtmlEntities(rawHtml);
  const $ = cheerio.load(html);

  // 1. ÖNEMLİ: Çöp HTML öğelerini tamamen temizle (Script, Stil, SVG, vb.)
  // Bu işlem Google Fonts, Webpack paketleri, SVG kimlikleri gibi sahte eşleşmeleri %100 engeller!
  $('script, style, noscript, svg, canvas, iframe, code, pre, template, head, link, meta, video, audio').remove();

  // 2. mailto: Bağlantıları (En Yüksek Güvenilirlik - İnsan Tarafından Yazılmış)
  $('a[href^="mailto:"]').each((_, el) => {
    let href = $(el).attr('href') || '';
    let email = href.replace(/^mailto:/i, '').split('?')[0].split('&')[0].trim();
    email = cleanAndDecodeHtmlEntities(email);
    if (isValidEmail(email, targetHostname)) {
      emails.add(email.toLowerCase());
    }
  });

  // 3. Cloudflare Email Protection
  $('[data-cfemail]').each((_, el) => {
    const hex = $(el).attr('data-cfemail');
    const decoded = decodeCloudflareEmail(hex);
    if (decoded && isValidEmail(decoded, targetHostname)) {
      emails.add(decoded);
    }
  });

  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const hex = href.split('#')[1];
    const decoded = decodeCloudflareEmail(hex);
    if (decoded && isValidEmail(decoded, targetHostname)) {
      emails.add(decoded);
    }
  });

  // 4. Özel data- etiketleri
  $('[data-email], [data-mail]').each((_, el) => {
    const val = $(el).attr('data-email') || $(el).attr('data-mail');
    if (val && isValidEmail(val, targetHostname)) {
      emails.add(val.toLowerCase().trim());
    }
  });

  // 5. Temizlenmiş Metin Üzerinde Standart Regex Taraması
  const cleanBodyText = $('body').text();
  const standardRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}/gi;
  const matches = cleanBodyText.match(standardRegex) || [];
  for (const m of matches) {
    const cleanMail = m.trim().toLowerCase();
    if (isValidEmail(cleanMail, targetHostname)) {
      emails.add(cleanMail);
    }
  }

  // 6. Maskelenmiş (info [at] domain.com) metinleri çıkar
  const obfuscated = extractObfuscatedEmails(cleanBodyText, targetHostname);
  for (const o of obfuscated) {
    emails.add(o);
  }

  return emails;
}

// Derin Link Arama: İletişim, Satın Alma, Impressum sayfalarını keşfet
function findDeepContactLinks($, baseUrl) {
  const contactLinks = new Set();
  const baseObj = new URL(baseUrl);

  const contactKeywords = [
    'contact', 'contact-us', 'about', 'about-us', 'imprint', 'impressum', 'team',
    'support', 'wholesale', 'purchasing', 'b2b', 'company', 'einkauf',
    'kontakt', 'ueber-uns', 'anfahrt', 'kundenservice', 'unternehmen',
    'iletisim', 'hakkimizda', 'bize-ulasin', 'kurumsal', 'toptan',
    'a-propos', 'mentions-legales', 'contatti', 'contacto'
  ];

  $('a[href]').each((_, el) => {
    try {
      const href = $(el).attr('href');
      const text = ($(el).text() || '').toLowerCase().trim();
      if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:') || href.startsWith('#')) return;

      const absoluteUrl = new URL(href, baseUrl);
      if (absoluteUrl.hostname === baseObj.hostname || absoluteUrl.hostname.endsWith('.' + baseObj.hostname)) {
        const linkPath = absoluteUrl.pathname.toLowerCase();
        const isMatch = contactKeywords.some(kw => linkPath.includes(kw) || text.includes(kw));

        if (isMatch && absoluteUrl.href !== baseUrl) {
          absoluteUrl.hash = '';
          contactLinks.add(absoluteUrl.href);
        }
      }
    } catch {}
  });

  return Array.from(contactLinks).slice(0, 8);
}

// Web Sitesini Derinlemesine Tara
async function scrapeWebsite(inputUrl) {
  let targetUrl = inputUrl.trim();
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  const parsedUrl = new URL(targetUrl);
  const targetHostname = parsedUrl.hostname.replace(/^(www\.|m\.)/i, '').toLowerCase();
  const companyGuess = targetHostname.split('.')[0];
  const companyName = companyGuess.charAt(0).toUpperCase() + companyGuess.slice(1);

  const scannedPages = [];
  const foundEmailsMap = new Map();

  const axiosInstance = axios.create({
    timeout: 12000,
    httpsAgent,
    httpAgent,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7,de;q=0.6',
      'Cache-Control': 'no-cache'
    },
    maxRedirects: 4,
    validateStatus: (status) => status >= 200 && status < 500
  });

  async function processUrl(urlToFetch) {
    try {
      const resp = await axiosInstance.get(urlToFetch);
      scannedPages.push({ url: urlToFetch, status: resp.status });

      if (resp.status >= 200 && resp.status < 400 && typeof resp.data === 'string') {
        const emails = extractAllEmailsFromHtml(resp.data, targetHostname);
        for (const email of emails) {
          if (!foundEmailsMap.has(email)) {
            foundEmailsMap.set(email, {
              sources: new Set([urlToFetch]),
              category: categorizeEmail(email, targetHostname)
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

  // 1. Ana Sayfayı Tara
  let main$ = await processUrl(targetUrl);

  // HTTPS başarısız olursa HTTP ile dene
  if (!main$ && targetUrl.startsWith('https://')) {
    const httpFallback = targetUrl.replace('https://', 'http://');
    main$ = await processUrl(httpFallback);
    if (main$) targetUrl = httpFallback;
  }

  // 2. Alt sayfaları keşfet ve tara
  if (main$) {
    const deepLinks = findDeepContactLinks(main$, targetUrl);
    await Promise.allSettled(deepLinks.map(link => processUrl(link)));
  }

  // 3. Veritabanı ile eşleştir
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
      isCompanyDomain: meta.category.isCompanyDomain,
      inDatabase: !!existingInDb,
      dbLeadId: existingInDb ? existingInDb.id : null,
      campaignStatus: existingInDb ? existingInDb.status : 'not_started',
      currentStep: existingInDb ? existingInDb.current_step : 0
    });
  }

  // Şirket alan adına ait e-postaları ve Satın Alma masalarını en üste al
  results.sort((a, b) => {
    if (a.isCompanyDomain && !b.isCompanyDomain) return -1;
    if (!a.isCompanyDomain && b.isCompanyDomain) return 1;
    return a.priority - b.priority;
  });

  return {
    targetUrl,
    hostname: targetHostname,
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
  decodeCloudflareEmail,
  extractCleanHostname
};
