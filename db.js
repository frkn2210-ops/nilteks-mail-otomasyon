const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

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
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ SQLite veritabanı bağlantı hatası:', err.message);
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

    // 2. Email Gönderim Logları Tablosu (Açılma ve PDF Tıklama Takibi Dahil)
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
        FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
      )
    `);

    // Mevcut tablolara yeni takip sütunlarını güvenle ekle (Migration)
    const migrations = [
      'ALTER TABLE email_logs ADD COLUMN opened INTEGER DEFAULT 0',
      'ALTER TABLE email_logs ADD COLUMN opened_at DATETIME',
      'ALTER TABLE email_logs ADD COLUMN open_count INTEGER DEFAULT 0',
      'ALTER TABLE email_logs ADD COLUMN pdf_clicked INTEGER DEFAULT 0',
      'ALTER TABLE email_logs ADD COLUMN pdf_clicked_at DATETIME',
      'ALTER TABLE email_logs ADD COLUMN clicked_catalogue TEXT'
    ];
    for (const sql of migrations) {
      db.run(sql, () => {});
    }

    // İndeksler
    db.run(`CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_email_logs_opened ON email_logs(opened)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_email_logs_pdf ON email_logs(pdf_clicked)`);

    // Başlangıç Loglarını Yükle (Eğer boşsa)
    db.get('SELECT COUNT(*) as count FROM email_logs', (err, row) => {
      if (!err && row && row.count === 0) {
        try {
          const seedPath = path.join(__dirname, 'data', 'initial_seed.json');
          if (fs.existsSync(seedPath)) {
            const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
            if (seed.leads && Array.isArray(seed.leads)) {
              for (const l of seed.leads) {
                db.run(
                  `INSERT OR IGNORE INTO leads (id, email, company_name, source_url, category, status, current_step, step1_sent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [l.id, l.email, l.company_name || '', l.source_url || '', l.category || 'general', l.status || 'sent', l.current_step || 0, l.step1_sent_at, l.created_at, l.updated_at]
                );
              }
            }
            if (seed.logs && Array.isArray(seed.logs)) {
              for (const log of seed.logs) {
                db.run(
                  `INSERT OR IGNORE INTO email_logs (id, lead_id, email, step, subject, attachment_name, status, error_message, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [log.id, log.lead_id, log.email, log.step || 1, log.subject, log.attachment_name, log.status, log.error_message, log.sent_at]
                );
              }
            }
          }
        } catch (e) {}
      }
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

// Veri Yönetim Fonksiyonları
async function addOrGetLead(leadData) {
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
  return await get('SELECT * FROM leads WHERE id = ?', [result.lastID]);
}

async function getAllLeads() {
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
  return await get('SELECT * FROM leads WHERE id = ?', [id]);
}

async function updateLead(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  values.push(new Date().toISOString());
  values.push(id);
  await run(`UPDATE leads SET ${fields}, updated_at = ? WHERE id = ?`, values);
  return await getLeadById(id);
}

async function markLeadSent(id, subject) {
  const now = new Date().toISOString();
  await run(
    `UPDATE leads SET status = 'sent', step1_sent_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
    [now, now, id]
  );
  return await getLeadById(id);
}

async function deleteLead(id) {
  await run('DELETE FROM email_logs WHERE lead_id = ?', [id]);
  return await run('DELETE FROM leads WHERE id = ?', [id]);
}

async function logEmail(lead_id, email, step, subject, attachment_name, status, error_message = null) {
  return await run(
    `INSERT INTO email_logs (lead_id, email, step, subject, attachment_name, status, error_message, sent_at, opened, open_count, pdf_clicked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
    [lead_id, email, step || 1, subject, attachment_name || 'Katalog Bağlantıları', status, error_message, new Date().toISOString()]
  );
}

async function recordEmailOpen(logId) {
  const now = new Date().toISOString();
  return await run(`
    UPDATE email_logs 
    SET opened = 1, 
        opened_at = COALESCE(opened_at, ?), 
        open_count = COALESCE(open_count, 0) + 1 
    WHERE id = ?
  `, [now, logId]);
}

async function recordPdfClick(logId, catalogueTitle) {
  const now = new Date().toISOString();
  return await run(`
    UPDATE email_logs 
    SET opened = 1, 
        opened_at = COALESCE(opened_at, ?), 
        pdf_clicked = 1, 
        pdf_clicked_at = COALESCE(pdf_clicked_at, ?), 
        clicked_catalogue = ? 
    WHERE id = ?
  `, [now, now, catalogueTitle || 'Katalog Kitapçığı', logId]);
}

async function getEmailLogs(limit = 200) {
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
      const existing = await get('SELECT id FROM email_logs WHERE email = ? AND sent_at = ?', [log.email, log.sent_at]);
      if (existing) {
        if (log.opened || log.pdf_clicked) {
          await run(
            `UPDATE email_logs 
             SET opened = MAX(opened, ?), 
                 opened_at = COALESCE(opened_at, ?), 
                 open_count = MAX(open_count, ?), 
                 pdf_clicked = MAX(pdf_clicked, ?), 
                 pdf_clicked_at = COALESCE(pdf_clicked_at, ?), 
                 clicked_catalogue = COALESCE(clicked_catalogue, ?)
             WHERE id = ?`,
            [log.opened ? 1 : 0, log.opened_at, log.open_count || 1, log.pdf_clicked ? 1 : 0, log.pdf_clicked_at, log.clicked_catalogue, existing.id]
          );
        }
      } else {
        await run(
          `INSERT INTO email_logs (lead_id, email, step, subject, attachment_name, status, error_message, sent_at, opened, opened_at, open_count, pdf_clicked, pdf_clicked_at, clicked_catalogue)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [log.lead_id || null, log.email, log.step || 1, log.subject, log.attachment_name, log.status, log.error_message, log.sent_at || new Date().toISOString(), log.opened ? 1 : 0, log.opened_at || null, log.open_count || 0, log.pdf_clicked ? 1 : 0, log.pdf_clicked_at || null, log.clicked_catalogue || null]
        );
      }
    }
  }
}

async function getStats() {
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
  getStats
};
