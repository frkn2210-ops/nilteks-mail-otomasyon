const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const remoteStore = require('./remote_store');

const isVercel = !!process.env.VERCEL;
const dbDir = isVercel ? '/tmp/data' : path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'drip_campaigns.sqlite');
if (isVercel && !fs.existsSync(dbPath)) {
  const sourceDb = path.join(__dirname, 'data', 'drip_campaigns.sqlite');
  if (fs.existsSync(sourceDb)) {
    try { fs.copyFileSync(sourceDb, dbPath); } catch {}
  }
}

let initResolve;
const initPromise = new Promise((resolve) => {
  initResolve = resolve;
});

async function ensureReady() {
  await initPromise;
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ SQLite veritabanı bağlantı hatası:', err.message);
    initResolve();
  } else {
    console.log('📦 SQLite veritabanına bağlanıldı:', dbPath);
    initTables();
  }
});

function initTables() {
  db.serialize(() => {
    // 1. Leads Tablosu
    db.run(`
      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        company_name TEXT,
        source_url TEXT,
        category TEXT DEFAULT 'general',
        status TEXT DEFAULT 'not_started',
        current_step INTEGER DEFAULT 0,
        step1_sent_at DATETIME,
        step2_due_at DATETIME,
        step2_sent_at DATETIME,
        step3_due_at DATETIME,
        step3_sent_at DATETIME,
        last_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Email Gönderim Logları Tablosu (Açılma, PDF İnceleme ve Takip Kimliği Dahil)
    db.run(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER,
        email TEXT NOT NULL,
        step INTEGER NOT NULL DEFAULT 1,
        subject TEXT,
        attachment_name TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        opened INTEGER DEFAULT 0,
        opened_at DATETIME,
        open_count INTEGER DEFAULT 0,
        pdf_clicked INTEGER DEFAULT 0,
        pdf_clicked_at DATETIME,
        clicked_catalogue TEXT,
        tracking_id TEXT,
        FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
      )
    `);

    // Tablo şema güncellemeleri (Migration)
    const migrations = [
      'ALTER TABLE email_logs ADD COLUMN opened INTEGER DEFAULT 0',
      'ALTER TABLE email_logs ADD COLUMN opened_at DATETIME',
      'ALTER TABLE email_logs ADD COLUMN open_count INTEGER DEFAULT 0',
      'ALTER TABLE email_logs ADD COLUMN pdf_clicked INTEGER DEFAULT 0',
      'ALTER TABLE email_logs ADD COLUMN pdf_clicked_at DATETIME',
      'ALTER TABLE email_logs ADD COLUMN clicked_catalogue TEXT',
      'ALTER TABLE email_logs ADD COLUMN tracking_id TEXT'
    ];
    for (const sql of migrations) {
      db.run(sql, () => {});
    }

    // İndeksler
    db.run(`CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_email_logs_opened ON email_logs(opened)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_email_logs_pdf ON email_logs(pdf_clicked)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_email_logs_tracking ON email_logs(tracking_id)`);

    // Uzak kalıcı depodan (GitHub data-store) en güncel verileri çek ve senkronize et
    syncFromRemoteStore()
      .catch(e => console.warn('Uzak veri senkronizasyon uyarısı:', e.message))
      .finally(() => {
        if (typeof initResolve === 'function') initResolve();
      });
  });
}

// Promisified DB Helpers
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// ========================================================
// UZAK KALICI VERİ DEPOSU ENTEGRASYONU (CROSS-DEVICE SYNC)
// ========================================================

async function syncFromRemoteStore() {
  try {
    const data = await remoteStore.fetchRemoteData();
    if (!data) return;

    if (Array.isArray(data.leads) && data.leads.length > 0) {
      for (const l of data.leads) {
        if (!l.email) continue;
        await run(
          `INSERT OR REPLACE INTO leads (id, email, company_name, source_url, category, status, current_step, step1_sent_at, step2_due_at, step2_sent_at, step3_due_at, step3_sent_at, last_error, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [l.id, l.email, l.company_name || '', l.source_url || '', l.category || 'general', l.status || 'sent', l.current_step || 0, l.step1_sent_at || null, l.step2_due_at || null, l.step2_sent_at || null, l.step3_due_at || null, l.step3_sent_at || null, l.last_error || null, l.created_at || new Date().toISOString(), l.updated_at || new Date().toISOString()]
        );
      }
    }

    if (Array.isArray(data.logs) && data.logs.length > 0) {
      for (const log of data.logs) {
        if (!log.email) continue;
        const existing = await get('SELECT * FROM email_logs WHERE id = ? OR (tracking_id IS NOT NULL AND tracking_id = ?)', [log.id || 0, log.tracking_id || '__none__']);
        if (existing) {
          // Asla mevcut pozitif okunma ve tıklanma kaydını geriye düşürme (Monotonic merge)
          const mergedOpened = Math.max(existing.opened || 0, log.opened ? 1 : 0);
          const mergedCount = Math.max(existing.open_count || 0, log.open_count || 0);
          const mergedPdf = Math.max(existing.pdf_clicked || 0, log.pdf_clicked ? 1 : 0);
          const mergedOpenedAt = existing.opened_at || log.opened_at || null;
          const mergedPdfAt = existing.pdf_clicked_at || log.pdf_clicked_at || null;
          const mergedCat = existing.clicked_catalogue || log.clicked_catalogue || null;

          await run(`
            UPDATE email_logs 
            SET opened = ?, 
                opened_at = ?, 
                open_count = ?, 
                pdf_clicked = ?, 
                pdf_clicked_at = ?, 
                clicked_catalogue = ?,
                tracking_id = COALESCE(tracking_id, ?)
            WHERE id = ?
          `, [mergedOpened, mergedOpenedAt, mergedCount, mergedPdf, mergedPdfAt, mergedCat, log.tracking_id || null, existing.id]);
        } else {
          await run(`
            INSERT INTO email_logs (id, lead_id, email, step, subject, attachment_name, status, error_message, sent_at, opened, opened_at, open_count, pdf_clicked, pdf_clicked_at, clicked_catalogue, tracking_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [log.id || null, log.lead_id || null, log.email, log.step || 1, log.subject, log.attachment_name, log.status, log.error_message, log.sent_at || new Date().toISOString(), log.opened ? 1 : 0, log.opened_at || null, log.open_count || 0, log.pdf_clicked ? 1 : 0, log.pdf_clicked_at || null, log.clicked_catalogue || null, log.tracking_id || null]);
        }
      }
    }
    console.log('🔄 Uzak depodan yerel SQLite veritabanı başarıyla güncellendi.');
  } catch (err) {
    console.warn('⚠️ syncFromRemoteStore error:', err.message);
  }
}

async function persistToRemoteStore() {
  try {
    const leads = await all(`SELECT * FROM leads ORDER BY id ASC`);
    const logs = await all(`SELECT * FROM email_logs ORDER BY id ASC`);
    remoteStore.queueSave({
      leads,
      logs,
      updated_at: new Date().toISOString()
    }, 1500);
  } catch (err) {
    console.warn('⚠️ persistToRemoteStore error:', err.message);
  }
}

// Veri Yönetim Fonksiyonları
async function addOrGetLead(leadData) {
  await ensureReady();
  const { email, company_name, source_url, category } = leadData;
  const existing = await get('SELECT * FROM leads WHERE email = ?', [email.toLowerCase().trim()]);
  if (existing) {
    return existing;
  }
  const result = await run(
    `INSERT INTO leads (email, company_name, source_url, category, status, current_step)
     VALUES (?, ?, ?, ?, 'not_started', 0)`,
    [email.toLowerCase().trim(), company_name || '', source_url || '', category || 'general']
  );
  const newLead = await get('SELECT * FROM leads WHERE id = ?', [result.lastID]);
  persistToRemoteStore().catch(() => {});
  return newLead;
}

async function getAllLeads() {
  await ensureReady();
  return await all(`
    SELECT * FROM leads 
    ORDER BY 
      CASE 
        WHEN status = 'not_started' THEN 1
        WHEN status = 'sent' OR status = 'completed' THEN 2
        WHEN status = 'failed' THEN 3
        ELSE 4
      END,
      created_at DESC
  `);
}

async function getLeadById(id) {
  await ensureReady();
  return await get('SELECT * FROM leads WHERE id = ?', [id]);
}

async function updateLead(id, updates) {
  await ensureReady();
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  values.push(new Date().toISOString());
  values.push(id);
  await run(`UPDATE leads SET ${fields}, updated_at = ? WHERE id = ?`, values);
  const updated = await getLeadById(id);
  persistToRemoteStore().catch(() => {});
  return updated;
}

async function markLeadSent(id, subject) {
  const now = new Date().toISOString();
  await run(
    `UPDATE leads SET status = 'sent', step1_sent_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
    [now, now, id]
  );
  persistToRemoteStore().catch(() => {});
  return await getLeadById(id);
}

async function deleteLead(id) {
  await run('DELETE FROM email_logs WHERE lead_id = ?', [id]);
  const res = await run('DELETE FROM leads WHERE id = ?', [id]);
  persistToRemoteStore().catch(() => {});
  return res;
}

async function logEmail(lead_id, email, step, subject, attachment_name, status, error_message = null, tracking_id = null) {
  await ensureReady();
  const res = await run(
    `INSERT INTO email_logs (lead_id, email, step, subject, attachment_name, status, error_message, sent_at, opened, open_count, pdf_clicked, tracking_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
    [lead_id, email, step || 1, subject, attachment_name || 'Katalog Bağlantıları', status, error_message, new Date().toISOString(), tracking_id]
  );
  persistToRemoteStore().catch(() => {});
  return res;
}

// 1. E-Posta Okundu Olarak İşle (Akıllı ID ve Tracking UUID Desteği)
async function recordEmailOpen(identifier) {
  await ensureReady();
  if (!identifier) return;
  const now = new Date().toISOString();
  const isNum = Number.isInteger(Number(identifier)) && Number(identifier) > 0;
  
  if (isNum) {
    await run(`
      UPDATE email_logs 
      SET opened = 1, 
          opened_at = COALESCE(opened_at, ?), 
          open_count = COALESCE(open_count, 0) + 1 
      WHERE id = ? OR tracking_id = ?
    `, [now, identifier, String(identifier)]);
  } else {
    await run(`
      UPDATE email_logs 
      SET opened = 1, 
          opened_at = COALESCE(opened_at, ?), 
          open_count = COALESCE(open_count, 0) + 1 
      WHERE tracking_id = ?
    `, [now, String(identifier)]);
  }

  persistToRemoteStore().catch(() => {});
}

// 2. Katalog PDF'i Tıklandı ve İncelendi Olarak İşle
async function recordPdfClick(identifier, catalogueTitle) {
  await ensureReady();
  if (!identifier) return;
  const now = new Date().toISOString();
  const isNum = Number.isInteger(Number(identifier)) && Number(identifier) > 0;
  const title = catalogueTitle || 'Katalog Kitapçığı';

  if (isNum) {
    await run(`
      UPDATE email_logs 
      SET opened = 1, 
          opened_at = COALESCE(opened_at, ?), 
          pdf_clicked = 1, 
          pdf_clicked_at = COALESCE(pdf_clicked_at, ?), 
          clicked_catalogue = ? 
      WHERE id = ? OR tracking_id = ?
    `, [now, now, title, identifier, String(identifier)]);
  } else {
    await run(`
      UPDATE email_logs 
      SET opened = 1, 
          opened_at = COALESCE(opened_at, ?), 
          pdf_clicked = 1, 
          pdf_clicked_at = COALESCE(pdf_clicked_at, ?), 
          clicked_catalogue = ? 
      WHERE tracking_id = ?
    `, [now, now, title, String(identifier)]);
  }

  persistToRemoteStore().catch(() => {});
}

async function getEmailLogs(limit = 200) {
  await ensureReady();
  try {
    return await all(`
      SELECT 
        l.id,
        l.lead_id,
        l.email,
        l.step,
        l.subject,
        l.attachment_name,
        l.status,
        l.error_message,
        l.sent_at,
        COALESCE(l.opened, 0) as opened,
        l.opened_at,
        COALESCE(l.open_count, 0) as open_count,
        COALESCE(l.pdf_clicked, 0) as pdf_clicked,
        l.pdf_clicked_at,
        l.clicked_catalogue,
        l.tracking_id,
        COALESCE(leads.company_name, '') as company_name
      FROM email_logs l
      LEFT JOIN leads ON l.lead_id = leads.id
      ORDER BY l.sent_at DESC 
      LIMIT ?
    `, [limit]);
  } catch (err) {
    return await all(`SELECT * FROM email_logs ORDER BY sent_at DESC LIMIT ?`, [limit]);
  }
}

async function getRecentLogs(limit = 100) {
  return await getEmailLogs(limit);
}

async function syncLogsAndLeads(clientLeads = [], clientLogs = []) {
  if (Array.isArray(clientLeads)) {
    for (const l of clientLeads) {
      if (!l.email) continue;
      await run(
        `INSERT OR IGNORE INTO leads (email, company_name, source_url, category, status, current_step, step1_sent_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [l.email, l.company_name || '', l.source_url || '', l.category || 'general', l.status || 'sent', l.current_step || 0, l.step1_sent_at || null, l.created_at || new Date().toISOString(), l.updated_at || new Date().toISOString()]
      );
    }
  }

  if (Array.isArray(clientLogs)) {
    for (const log of clientLogs) {
      if (!log.email) continue;
      const existing = await get('SELECT id, opened, pdf_clicked FROM email_logs WHERE email = ? AND sent_at = ?', [log.email, log.sent_at]);
      if (!existing) {
        await run(
          `INSERT INTO email_logs (lead_id, email, step, subject, attachment_name, status, error_message, sent_at, opened, opened_at, open_count, pdf_clicked, pdf_clicked_at, clicked_catalogue, tracking_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [log.lead_id || null, log.email, log.step || 1, log.subject, log.attachment_name, log.status, log.error_message, log.sent_at || new Date().toISOString(), log.opened ? 1 : 0, log.opened_at || null, log.open_count || 0, log.pdf_clicked ? 1 : 0, log.pdf_clicked_at || null, log.clicked_catalogue || null, log.tracking_id || null]
        );
      }
    }
  }
  persistToRemoteStore().catch(() => {});
}

async function getStats() {
  await ensureReady();
  const total = await get('SELECT COUNT(*) as count FROM leads');
  const notStarted = await get("SELECT COUNT(*) as count FROM leads WHERE status = 'not_started'");
  const sent = await get("SELECT COUNT(*) as count FROM leads WHERE status IN ('sent', 'completed')");
  const failed = await get("SELECT COUNT(*) as count FROM leads WHERE status = 'failed'");
  const totalSent = await get("SELECT COUNT(*) as count FROM email_logs WHERE status = 'success'");
  const totalOpened = await get("SELECT COUNT(*) as count FROM email_logs WHERE opened = 1");
  const totalPdfClicked = await get("SELECT COUNT(*) as count FROM email_logs WHERE pdf_clicked = 1");
  return {
    totalLeads: total ? total.count : 0,
    notStarted: notStarted ? notStarted.count : 0,
    sent: sent ? sent.count : 0,
    failed: failed ? failed.count : 0,
    totalEmailsSent: totalSent ? totalSent.count : 0,
    totalOpened: totalOpened ? totalOpened.count : 0,
    totalPdfClicked: totalPdfClicked ? totalPdfClicked.count : 0
  };
}

module.exports = {
  db,
  run,
  get,
  all,
  addOrGetLead,
  getAllLeads,
  getLeadById,
  updateLead,
  markLeadSent,
  deleteLead,
  logEmail,
  recordEmailOpen,
  recordPdfClick,
  syncLogsAndLeads,
  getEmailLogs,
  getRecentLogs,
  getStats,
  syncFromRemoteStore,
  persistToRemoteStore
};
