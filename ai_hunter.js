/**
 * Nilteks B2B AI Karar Verici & E-Posta Avcısı (AI Hunter Engine)
 * 
 * Amaç:
 * 1. Web sitesinin Künye (Impressum), Hakkımızda, Ekip ve İletişim sayfalarından
 *    gerçek yönetici ve satın alma yetkilisi isimlerini tespit eder.
 * 2. Firmanın alan adına göre kurumsal e-posta desenlerini analiz eder (Örn: furkan@niltex.com.tr).
 * 3. Satın Alma, Kategori Yöneticisi, CEO/Kurucu ve İthalat sorumlularının doğrudan e-postalarını tahmin eder.
 * 4. LinkedIn ve dış kaynaklarda hedeflenmiş satın alma araması linki üretir.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const httpAgent = new http.Agent({ keepAlive: true });
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Türkçe karakterleri İngilizce e-posta standartlarına dönüştür
function slugifyName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

// Temiz alan adı çıkarımı (örn: https://www.niltex.com.tr -> niltex.com.tr)
function cleanDomain(inputUrl) {
  try {
    let raw = inputUrl.trim();
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
      raw = 'https://' + raw;
    }
    const parsed = new URL(raw);
    return parsed.hostname.replace(/^(www\.|m\.)/i, '').toLowerCase();
  } catch {
    return inputUrl.replace(/^(https?:\/\/)?(www\.)?/i, '').split('/')[0].toLowerCase().trim();
  }
}

// İsim ve Alan Adından Olası Kurumsal E-posta Varyasyonlarını Üret
function generateEmailPatterns(fullName, domain, role = '') {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];

  const firstRaw = parts[0];
  const lastRaw = parts.length > 1 ? parts[parts.length - 1] : '';

  const first = slugifyName(firstRaw);
  const last = slugifyName(lastRaw);
  const firstInitial = first.charAt(0);

  const cleanDom = cleanDomain(domain);
  const patterns = [];

  // 1. ad@domain.com (Örn: furkan@niltex.com.tr - Kullanıcının Nilteks Deseni!)
  if (first) {
    patterns.push({
      email: `${first}@${cleanDom}`,
      patternName: 'ad@domain (Nilteks Formatı)',
      confidence: 96,
      badge: 'Yüksek İhtimal (En Çok Kullanılan)',
      isDirectPerson: true
    });
  }

  // 2. ad.soyad@domain.com (Örn: furkan.aydin@niltex.com.tr)
  if (first && last) {
    patterns.push({
      email: `${first}.${last}@${cleanDom}`,
      patternName: 'ad.soyad@domain',
      confidence: 94,
      badge: 'Yüksek İhtimal (Uluslararası Kurumsal)',
      isDirectPerson: true
    });
  }

  // 3. asoyad@domain.com (Örn: faydin@niltex.com.tr)
  if (firstInitial && last) {
    patterns.push({
      email: `${firstInitial}${last}@${cleanDom}`,
      patternName: 'asoyad@domain',
      confidence: 88,
      badge: 'Olası Alternatif',
      isDirectPerson: true
    });
  }

  // 4. ad_soyad@domain.com (Örn: furkan_aydin@niltex.com.tr)
  if (first && last) {
    patterns.push({
      email: `${first}_${last}@${cleanDom}`,
      patternName: 'ad_soyad@domain',
      confidence: 82,
      badge: 'Alternatif Format',
      isDirectPerson: true
    });
  }

  return patterns;
}

// Hedef Departman Doğrudan E-Postaları Üret
function generateDepartmentEmails(domain) {
  const cleanDom = cleanDomain(domain);
  return [
    {
      role: 'Satın Alma & Kategori Yöneticisi (Purchasing / Buyer)',
      department: 'purchasing',
      email: `purchasing@${cleanDom}`,
      alternativeEmails: [`buyer@${cleanDom}`, `sourcing@${cleanDom}`, `procurement@${cleanDom}`, `einkauf@${cleanDom}`],
      confidence: 95,
      badge: 'Doğrudan Satın Alma Masası',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300'
    },
    {
      role: 'Dış Ticaret & İthalat Sorumlusu (Import / Trade)',
      department: 'import',
      email: `import@${cleanDom}`,
      alternativeEmails: [`trade@${cleanDom}`, `export@${cleanDom}`, `sourcing@${cleanDom}`],
      confidence: 92,
      badge: 'İthalat & Tedarik Masası',
      badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-300'
    },
    {
      role: 'Üst Yönetim & Genel Müdürlük (CEO / Management)',
      department: 'management',
      email: `management@${cleanDom}`,
      alternativeEmails: [`director@${cleanDom}`, `ceo@${cleanDom}`, `office@${cleanDom}`],
      confidence: 90,
      badge: 'Yönetim Masası',
      badgeClass: 'bg-purple-100 text-purple-800 border-purple-300'
    },
    {
      role: 'B2B & Toptan Sipariş İletişim',
      department: 'b2b',
      email: `b2b@${cleanDom}`,
      alternativeEmails: [`wholesale@${cleanDom}`, `order@${cleanDom}`, `sales@${cleanDom}`],
      confidence: 88,
      badge: 'Kurumsal B2B Masası',
      badgeClass: 'bg-blue-100 text-blue-800 border-blue-300'
    }
  ];
}

// Web Sayfalarından Yetkili İsimlerini Çıkaran Semantik Ayrıştırıcı
function extractNamedDecisionMakers(html) {
  if (!html || typeof html !== 'string') return [];
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, canvas, iframe, code, pre, template').remove();
  const text = $('body').text().replace(/\s+/g, ' ');

  const foundPersons = [];
  const seenNames = new Set();

  // Yetkili Tanımlama Kalıpları (TR, EN, DE, FR)
  const patterns = [
    // DE (Impressum standartları: Vertreten durch: Max Mustermann, Geschäftsführer: ...)
    /(?:Geschäftsführer|Geschäftsführung|Vertreten durch|Inhaber|Vorstand)\s*[:\-\–]\s*([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+){1,3})/g,
    // EN (Managing Director: John Doe, CEO: Jane Smith, Head of Purchasing: ...)
    /(?:Managing Director|CEO|President|Founder|Owner|Head of Purchasing|Purchasing Manager|Sourcing Director|Category Buyer|General Manager)\s*[:\-\–]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/g,
    // TR (Genel Müdür: Ahmet Yılmaz, Satın Alma Müdürü: ...)
    /(?:Genel Müdür|Şirket Müdürü|Yönetim Kurulu Başkanı|Kurucu|Satın Alma Müdürü|Satın Alma Sorumlusu|Dış Ticaret Müdürü)\s*[:\-\–]\s*([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+){1,3})/g
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const rawName = match[1].trim();
      const cleanName = rawName.replace(/[,.;].*$/, '').trim();
      const words = cleanName.split(/\s+/);
      
      // Geçerli 2 ila 3 kelimelik isim
      if (words.length >= 2 && words.length <= 4 && !seenNames.has(cleanName.toLowerCase())) {
        // Çöp kelimeleri filtrele
        const invalidTokens = ['gmbh', 'ltd', 'inc', 'co', 'holding', 'sanayi', 'ticaret', 'und', 'and', 'the', 'der', 'die', 'das'];
        const hasInvalid = words.some(w => invalidTokens.includes(w.toLowerCase()));
        if (!hasInvalid) {
          seenNames.add(cleanName.toLowerCase());
          foundPersons.push({
            fullName: cleanName,
            detectedRole: match[0].split(/[:\-\–]/)[0].trim()
          });
        }
      }
    }
  }

  return foundPersons.slice(0, 5); // En alakalı ilk 5 yetkili
}

// AI Hunter: Belirtilen URL veya Firma için Karar Vericileri Bul ve E-Postaları Tahmin Et
async function huntDecisionMakers(targetUrlOrDomain) {
  const domain = cleanDomain(targetUrlOrDomain);
  const companyBase = domain.split('.')[0];
  const companyName = companyBase.charAt(0).toUpperCase() + companyBase.slice(1);

  let targetUrl = targetUrlOrDomain.trim();
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + domain;
  }

  // 1. LinkedIn & Google Dış Arama Bağlantısı Üret
  const linkedinSearchQuery = `site:linkedin.com/in ("${companyName}" OR "${domain}") ("purchasing" OR "buyer" OR "sourcing" OR "einkauf" OR "satın alma" OR "director" OR "managing")`;
  const linkedinSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(linkedinSearchQuery)}`;

  // 2. Departman Masaları (Varsayılan olarak üretilir)
  const departmentInboxes = generateDepartmentEmails(domain);

  // 3. Web Sitesini İnceleyip Gerçek İsimleri Çekmeye Çalış
  const discoveredPersons = [];
  const targetSubpaths = ['/impressum', '/imprint', '/about', '/about-us', '/team', '/kontakt', '/contact', '/hakkimizda'];

  const axiosInstance = axios.create({
    timeout: 8000,
    httpsAgent,
    httpAgent,
    headers: { 'User-Agent': USER_AGENT }
  });

  // Ana sayfa ve alt sayfaları tara
  const urlsToTry = [targetUrl, ...targetSubpaths.map(p => `https://${domain}${p}`)];
  for (const u of urlsToTry.slice(0, 4)) {
    try {
      const resp = await axiosInstance.get(u, { validateStatus: s => s === 200 });
      if (resp && typeof resp.data === 'string') {
        const found = extractNamedDecisionMakers(resp.data);
        for (const p of found) {
          if (!discoveredPersons.some(dp => dp.fullName.toLowerCase() === p.fullName.toLowerCase())) {
            discoveredPersons.push(p);
          }
        }
        if (discoveredPersons.length >= 3) break;
      }
    } catch {}
  }

  // 4. Bulunan Gerçek Kişiler İçin E-Posta Şablonları Oluştur
  const personResults = [];
  for (const p of discoveredPersons) {
    const patterns = generateEmailPatterns(p.fullName, domain, p.detectedRole);
    personResults.push({
      fullName: p.fullName,
      role: p.detectedRole || 'Yönetici / Karar Verici',
      primaryEmail: patterns[0]?.email || `info@${domain}`,
      confidence: patterns[0]?.confidence || 90,
      badge: patterns[0]?.badge || 'AI Tahmini',
      patterns: patterns,
      isRealPerson: true
    });
  }

  return {
    success: true,
    domain,
    companyName,
    linkedinSearchUrl,
    linkedinSearchQuery,
    namedDecisionMakers: personResults,
    departmentInboxes,
    sampleDomainPattern: `ad@${domain} (Örn: furkan@${domain})`
  };
}

module.exports = {
  cleanDomain,
  slugifyName,
  generateEmailPatterns,
  generateDepartmentEmails,
  extractNamedDecisionMakers,
  huntDecisionMakers
};
