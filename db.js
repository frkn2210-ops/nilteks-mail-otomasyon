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

    // 2. Email Gönderim Logları Tablosu
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
        FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
      )
    `);

    // İndeksler
    db.run(`CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`);
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
    `INSERT INTO email_logs (lead_id, email, step, subject, attachment_name, status, error_message, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [lead_id, email, step || 1, subject, attachment_name || 'Katalog Bağlantıları', status, error_message, new Date().toISOString()]
  );
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

async function getStats() {
  const total = await get('SELECT COUNT(*) as count FROM leads');
  const notStarted = await get("SELECT COUNT(*) as count FROM leads WHERE status = 'not_started'");
  const sent = await get("SELECT COUNT(*) as count FROM leads WHERE status IN ('sent', 'completed')");
  const failed = await get("SELECT COUNT(*) as count FROM leads WHERE status = 'failed'");
  const totalSent = await get("SELECT COUNT(*) as count FROM email_logs WHERE status = 'success'");
  return {
    totalLeads: total ? total.count : 0,
    notStarted: notStarted ? notStarted.count : 0,
    sent: sent ? sent.count : 0,
    failed: failed ? failed.count : 0,
    totalEmailsSent: totalSent ? totalSent.count : 0
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
  getEmailLogs,
  getRecentLogs,
  getStats
};
