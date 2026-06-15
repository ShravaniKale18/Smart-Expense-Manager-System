const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const DB_FILE = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(DB_FILE);

// Initialize tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    expense_date TEXT NOT NULL,
    tags TEXT,
    recurring_id INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS incomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    amount REAL NOT NULL,
    income_date TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, category),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS recurring_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    frequency TEXT NOT NULL,
    next_date TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Migrate JSON data if SQLite database is empty
  migrateFromJson();
});

function migrateFromJson() {
  const jsonPath = path.join(__dirname, 'data.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      
      db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (!err && row && row.count === 0) {
          console.log("Migrating data from data.json to SQLite database...");
          
          db.serialize(() => {
            // Import users
            if (Array.isArray(data.users) && data.users.length > 0) {
              const stmt = db.prepare("INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)");
              data.users.forEach(u => {
                stmt.run(u.id, u.name, u.email, u.password_hash, u.created_at);
              });
              stmt.finalize();
            }
            
            // Import expenses
            if (Array.isArray(data.expenses) && data.expenses.length > 0) {
              const stmt = db.prepare("INSERT INTO expenses (id, user_id, title, amount, category, description, expense_date, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
              data.expenses.forEach(e => {
                const tagsStr = Array.isArray(e.tags) ? e.tags.join(',') : (e.tags || '');
                stmt.run(e.id, e.user_id, e.title, e.amount, e.category, e.description, e.expense_date, tagsStr, e.created_at);
              });
              stmt.finalize();
            }

            // Import sessions
            if (Array.isArray(data.sessions) && data.sessions.length > 0) {
              const stmt = db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)");
              data.sessions.forEach(s => {
                stmt.run(s.token, s.user_id, s.created_at);
              });
              stmt.finalize();
            }

            // Import incomes, budgets, recurring
            if (Array.isArray(data.incomes) && data.incomes.length > 0) {
              const stmt = db.prepare("INSERT INTO incomes (id, user_id, source, amount, income_date, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
              data.incomes.forEach(i => {
                stmt.run(i.id, i.user_id, i.source, i.amount, i.income_date, i.description, i.created_at);
              });
              stmt.finalize();
            }

            if (Array.isArray(data.budgets) && data.budgets.length > 0) {
              const stmt = db.prepare("INSERT INTO budgets (id, user_id, category, amount, created_at) VALUES (?, ?, ?, ?, ?)");
              data.budgets.forEach(b => {
                stmt.run(b.id, b.user_id, b.category, b.amount, b.created_at);
              });
              stmt.finalize();
            }

            if (Array.isArray(data.recurring_expenses) && data.recurring_expenses.length > 0) {
              const stmt = db.prepare("INSERT INTO recurring_expenses (id, user_id, title, amount, category, frequency, next_date, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
              data.recurring_expenses.forEach(r => {
                stmt.run(r.id, r.user_id, r.title, r.amount, r.category, r.frequency, r.next_date, r.description, r.created_at);
              });
              stmt.finalize();
            }
          });
          console.log("Migration complete!");
        }
      });
    } catch (e) {
      console.error("Error migrating from data.json:", e);
    }
  }
}

// Promise wrapper functions
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

// User & Auth Functions
async function registerUser({ name, email, password }) {
  const normalizedEmail = email.toLowerCase();
  
  const existing = await get("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
  if (existing) {
    const err = new Error('An account with this email already exists.');
    err.code = 'DUPLICATE';
    throw err;
  }

  const p_hash = hashPassword(password);
  const created_at = new Date().toISOString();
  
  const res = await run(
    "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
    [name.trim(), normalizedEmail, p_hash, created_at]
  );
  
  const user = await get("SELECT * FROM users WHERE id = ?", [res.lastID]);
  return sanitizeUser(user);
}

async function loginUser({ email, password }) {
  const user = await get("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    const err = new Error('Invalid email or password.');
    err.code = 'INVALID';
    throw err;
  }
  return sanitizeUser(user);
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const created_at = new Date().toISOString();
  await run("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", [token, userId, created_at]);
  return token;
}

async function deleteSession(token) {
  await run("DELETE FROM sessions WHERE token = ?", [token]);
}

async function getUserByToken(token) {
  if (!token) return null;
  const session = await get("SELECT * FROM sessions WHERE token = ?", [token]);
  if (!session) return null;
  const user = await get("SELECT * FROM users WHERE id = ?", [session.user_id]);
  return sanitizeUser(user);
}

async function getUserById(id) {
  const user = await get("SELECT * FROM users WHERE id = ?", [id]);
  return sanitizeUser(user);
}

// Expenses Functions
async function getExpenses(userId, filters = {}) {
  let sql = "SELECT * FROM expenses WHERE user_id = ?";
  const params = [userId];

  if (filters.category) {
    sql += " AND category = ?";
    params.push(filters.category);
  }

  if (filters.month && filters.year) {
    const monthStr = `${filters.year}-${String(filters.month).padStart(2, '0')}`;
    sql += " AND expense_date LIKE ?";
    params.push(`${monthStr}%`);
  } else if (filters.year) {
    sql += " AND expense_date LIKE ?";
    params.push(`${filters.year}%`);
  }

  if (filters.search) {
    const q = `%${filters.search.toLowerCase()}%`;
    sql += " AND (LOWER(title) LIKE ? OR LOWER(category) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags) LIKE ? OR CAST(amount AS TEXT) LIKE ?)";
    params.push(q, q, q, q, q);
  }

  if (filters.start_date) {
    sql += " AND expense_date >= ?";
    params.push(filters.start_date);
  }
  if (filters.end_date) {
    sql += " AND expense_date <= ?";
    params.push(filters.end_date);
  }

  if (filters.min_amount) {
    sql += " AND amount >= ?";
    params.push(Number(filters.min_amount));
  }
  if (filters.max_amount) {
    sql += " AND amount <= ?";
    params.push(Number(filters.max_amount));
  }

  if (filters.tag) {
    sql += " AND tags LIKE ?";
    params.push(`%${filters.tag}%`);
  }

  sql += " ORDER BY expense_date DESC, created_at DESC";

  const rows = await all(sql, params);
  
  return rows.map(r => ({
    ...r,
    tags: r.tags ? r.tags.split(',') : []
  }));
}

async function getExpenseById(id, userId) {
  const row = await get("SELECT * FROM expenses WHERE id = ? AND user_id = ?", [id, userId]);
  if (row) {
    row.tags = row.tags ? row.tags.split(',') : [];
  }
  return row || null;
}

async function createExpense(userId, { title, amount, category, description, expense_date, tags }) {
  const parsedTags = Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim().replace(/^#/, '')) : []);
  const tagsStr = parsedTags.join(',');
  const created_at = new Date().toISOString();
  
  const res = await run(
    "INSERT INTO expenses (user_id, title, amount, category, description, expense_date, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [userId, title, Number(amount), category, description || null, expense_date, tagsStr, created_at]
  );
  
  const expense = await get("SELECT * FROM expenses WHERE id = ?", [res.lastID]);
  if (expense) {
    expense.tags = expense.tags ? expense.tags.split(',') : [];
  }
  return expense;
}

async function updateExpense(id, userId, updates) {
  const sets = [];
  const params = [];
  
  if (updates.title !== undefined) { sets.push("title = ?"); params.push(updates.title); }
  if (updates.amount !== undefined) { sets.push("amount = ?"); params.push(Number(updates.amount)); }
  if (updates.category !== undefined) { sets.push("category = ?"); params.push(updates.category); }
  if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description || null); }
  if (updates.expense_date !== undefined) { sets.push("expense_date = ?"); params.push(updates.expense_date); }
  if (updates.tags !== undefined) { 
    const parsedTags = Array.isArray(updates.tags) ? updates.tags : (updates.tags ? updates.tags.split(',').map(t => t.trim().replace(/^#/, '')) : []);
    sets.push("tags = ?");
    params.push(parsedTags.join(','));
  }
  
  if (sets.length === 0) return await getExpenseById(id, userId);

  params.push(id, userId);
  await run(`UPDATE expenses SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
  
  return await getExpenseById(id, userId);
}

async function deleteExpense(id, userId) {
  const res = await run("DELETE FROM expenses WHERE id = ? AND user_id = ?", [id, userId]);
  return res.changes > 0;
}

async function getStats(userId, filters = {}) {
  const expenses = await getExpenses(userId, filters);
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  const byCategory = {};
  expenses.forEach(e => {
    if (!byCategory[e.category]) byCategory[e.category] = { category: e.category, total: 0, count: 0 };
    byCategory[e.category].total += e.amount;
    byCategory[e.category].count++;
  });

  const categories = Object.values(byCategory).sort((a, b) => b.total - a.total);
  const topCategory = categories[0] || null;

  return {
    total,
    count: expenses.length,
    average: expenses.length ? total / expenses.length : 0,
    topCategory,
    byCategory: categories
  };
}

// Budget management Functions
async function getBudgets(userId) {
  return await all("SELECT * FROM budgets WHERE user_id = ?", [userId]);
}

async function setBudget(userId, { category, amount }) {
  await run(
    "INSERT INTO budgets (user_id, category, amount, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, category) DO UPDATE SET amount = excluded.amount",
    [userId, category, Number(amount), new Date().toISOString()]
  );
  return await get("SELECT * FROM budgets WHERE user_id = ? AND category = ?", [userId, category]);
}

async function deleteBudget(userId, category) {
  const res = await run("DELETE FROM budgets WHERE user_id = ? AND category = ?", [userId, category]);
  return res.changes > 0;
}

// Income management Functions
async function getIncomes(userId, filters = {}) {
  let sql = "SELECT * FROM incomes WHERE user_id = ?";
  const params = [userId];

  if (filters.month && filters.year) {
    const monthStr = `${filters.year}-${String(filters.month).padStart(2, '0')}`;
    sql += " AND income_date LIKE ?";
    params.push(`${monthStr}%`);
  } else if (filters.year) {
    sql += " AND income_date LIKE ?";
    params.push(`${filters.year}%`);
  }

  sql += " ORDER BY income_date DESC, created_at DESC";
  return await all(sql, params);
}

async function createIncome(userId, { source, amount, income_date, description }) {
  const created_at = new Date().toISOString();
  const res = await run(
    "INSERT INTO incomes (user_id, source, amount, income_date, description, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, source, Number(amount), income_date, description || null, created_at]
  );
  return await get("SELECT * FROM incomes WHERE id = ?", [res.lastID]);
}

async function updateIncome(id, userId, updates) {
  const sets = [];
  const params = [];
  
  if (updates.source !== undefined) { sets.push("source = ?"); params.push(updates.source); }
  if (updates.amount !== undefined) { sets.push("amount = ?"); params.push(Number(updates.amount)); }
  if (updates.income_date !== undefined) { sets.push("income_date = ?"); params.push(updates.income_date); }
  if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description || null); }
  
  if (sets.length === 0) return await get("SELECT * FROM incomes WHERE id = ? AND user_id = ?", [id, userId]);

  params.push(id, userId);
  await run(`UPDATE incomes SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
  return await get("SELECT * FROM incomes WHERE id = ? AND user_id = ?", [id, userId]);
}

async function deleteIncome(id, userId) {
  const res = await run("DELETE FROM incomes WHERE id = ? AND user_id = ?", [id, userId]);
  return res.changes > 0;
}

// Recurring Expenses management Functions
async function getRecurringExpenses(userId) {
  return await all("SELECT * FROM recurring_expenses WHERE user_id = ?", [userId]);
}

async function createRecurringExpense(userId, { title, amount, category, frequency, next_date, description }) {
  const created_at = new Date().toISOString();
  const res = await run(
    "INSERT INTO recurring_expenses (user_id, title, amount, category, frequency, next_date, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [userId, title, Number(amount), category, frequency, next_date, description || null, created_at]
  );
  return await get("SELECT * FROM recurring_expenses WHERE id = ?", [res.lastID]);
}

async function deleteRecurringExpense(id, userId) {
  const res = await run("DELETE FROM recurring_expenses WHERE id = ? AND user_id = ?", [id, userId]);
  return res.changes > 0;
}

function getNextOccurrence(dateStr, frequency) {
  const d = new Date(dateStr + 'T00:00:00');
  if (frequency === 'Daily') d.setDate(d.getDate() + 1);
  else if (frequency === 'Weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'Monthly') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'Yearly') d.setFullYear(d.getFullYear() + 1);
  
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function processRecurringExpenses(userId) {
  const recurrings = await all("SELECT * FROM recurring_expenses WHERE user_id = ?", [userId]);
  const todayStr = new Date().toISOString().split('T')[0];

  for (const r of recurrings) {
    let nextDate = r.next_date;
    let created = false;
    
    while (nextDate <= todayStr) {
      const created_at = new Date().toISOString();
      await run(
        "INSERT INTO expenses (user_id, title, amount, category, description, expense_date, tags, recurring_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [userId, r.title, r.amount, r.category, r.description || `Generated from recurring: ${r.title}`, nextDate, 'recurring', r.id, created_at]
      );
      nextDate = getNextOccurrence(nextDate, r.frequency);
      created = true;
    }
    
    if (created) {
      await run("UPDATE recurring_expenses SET next_date = ? WHERE id = ?", [nextDate, r.id]);
    }
  }
}

// Reports management Functions
async function getMonthlyReport(userId) {
  const expenses = await all("SELECT amount, expense_date FROM expenses WHERE user_id = ?", [userId]);
  const incomes = await all("SELECT amount, income_date FROM incomes WHERE user_id = ?", [userId]);
  
  const monthsMap = {};
  
  expenses.forEach(e => {
    const monthKey = e.expense_date.substring(0, 7); // "YYYY-MM"
    if (!monthsMap[monthKey]) {
      monthsMap[monthKey] = { monthKey, income: 0, expense: 0 };
    }
    monthsMap[monthKey].expense += e.amount;
  });
  
  incomes.forEach(i => {
    const monthKey = i.income_date.substring(0, 7); // "YYYY-MM"
    if (!monthsMap[monthKey]) {
      monthsMap[monthKey] = { monthKey, income: 0, expense: 0 };
    }
    monthsMap[monthKey].income += i.amount;
  });
  
  const report = Object.values(monthsMap).map(m => {
    const savings = m.income - m.expense;
    const savingsRate = m.income > 0 ? (savings / m.income) * 100 : 0;
    return {
      monthKey: m.monthKey,
      income: m.income,
      expense: m.expense,
      savings,
      savingsRate: Math.max(0, savingsRate)
    };
  });
  
  return report.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

module.exports = {
  registerUser, loginUser, createSession, deleteSession, getUserByToken, getUserById,
  getExpenses, getExpenseById, createExpense, updateExpense, deleteExpense, getStats,
  getBudgets, setBudget, deleteBudget,
  getIncomes, createIncome, updateIncome, deleteIncome,
  getRecurringExpenses, createRecurringExpense, deleteRecurringExpense, processRecurringExpenses,
  getMonthlyReport
};
