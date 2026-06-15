const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const CATEGORIES = [
  'Food & Dining',
  'Transport',
  'Education',
  'Rent & Bills',
  'Entertainment',
  'Shopping',
  'Healthcare',
  'Other'
];

async function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  try {
    const user = await db.getUserByToken(token);
    if (!user) return res.status(401).json({ error: 'Please log in to continue.' });
    
    // Process any due recurring expenses for the user dynamically
    await db.processRecurringExpenses(user.id);
    
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).json({ error: 'Authentication check failed.' });
  }
}

app.get('/api/categories', (_req, res) => res.json(CATEGORIES));

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const user = await db.registerUser({ name: name.trim(), email: email.trim(), password });
    const token = await db.createSession(user.id);
    res.status(201).json({ user, token });
  } catch (err) {
    if (err.code === 'DUPLICATE') return res.status(409).json({ error: err.message });
    console.error("Register error:", err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email?.trim() || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await db.loginUser({ email: email.trim(), password });
    const token = await db.createSession(user.id);
    res.json({ user, token });
  } catch (err) {
    if (err.code === 'INVALID') return res.status(401).json({ error: err.message });
    console.error("Login error:", err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/auth/logout', auth, async (req, res) => {
  try {
    await db.deleteSession(req.token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed.' });
  }
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json(req.user);
});

// Expenses endpoints
app.get('/api/expenses', auth, async (req, res) => {
  try {
    const expenses = await db.getExpenses(req.user.id, req.query);
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve expenses.' });
  }
});

app.post('/api/expenses', auth, async (req, res) => {
  const { title, amount, category, description, expense_date, tags } = req.body;

  if (!title?.trim() || !amount || !category || !expense_date) {
    return res.status(400).json({ error: 'Title, amount, category, and date are required.' });
  }
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category.' });
  if (Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero.' });

  try {
    const expense = await db.createExpense(req.user.id, {
      title: title.trim(), amount, category,
      description: description?.trim(), expense_date, tags
    });
    res.status(201).json(expense);
  } catch (err) {
    console.error("Create expense error:", err);
    res.status(500).json({ error: 'Failed to create expense.' });
  }
});

app.put('/api/expenses/:id', auth, async (req, res) => {
  const { title, amount, category, description, expense_date, tags } = req.body;
  if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category.' });
  if (amount !== undefined && Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero.' });

  try {
    const expense = await db.updateExpense(Number(req.params.id), req.user.id, {
      title: title?.trim(), amount, category,
      description: description !== undefined ? description?.trim() : undefined,
      expense_date, tags
    });
    if (!expense) return res.status(404).json({ error: 'Expense not found.' });
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update expense.' });
  }
});

app.delete('/api/expenses/:id', auth, async (req, res) => {
  try {
    const ok = await db.deleteExpense(Number(req.params.id), req.user.id);
    if (!ok) return res.status(404).json({ error: 'Expense not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete expense.' });
  }
});

app.get('/api/stats', auth, async (req, res) => {
  try {
    const stats = await db.getStats(req.user.id, req.query);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve stats.' });
  }
});

// Budgets endpoints
app.get('/api/budgets', auth, async (req, res) => {
  try {
    const budgets = await db.getBudgets(req.user.id);
    res.json(budgets);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve budgets.' });
  }
});

app.post('/api/budgets', auth, async (req, res) => {
  const { category, amount } = req.body;
  if (!category || amount === undefined) {
    return res.status(400).json({ error: 'Category and amount are required.' });
  }
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category.' });
  if (Number(amount) < 0) return res.status(400).json({ error: 'Amount cannot be negative.' });

  try {
    const budget = await db.setBudget(req.user.id, { category, amount });
    res.json(budget);
  } catch (err) {
    res.status(500).json({ error: 'Failed to set budget.' });
  }
});

app.delete('/api/budgets/:category', auth, async (req, res) => {
  try {
    const ok = await db.deleteBudget(req.user.id, req.params.category);
    if (!ok) return res.status(404).json({ error: 'Budget not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete budget.' });
  }
});

// Income endpoints
app.get('/api/incomes', auth, async (req, res) => {
  try {
    const incomes = await db.getIncomes(req.user.id, req.query);
    res.json(incomes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve incomes.' });
  }
});

app.post('/api/incomes', auth, async (req, res) => {
  const { source, amount, income_date, description } = req.body;
  if (!source?.trim() || !amount || !income_date) {
    return res.status(400).json({ error: 'Source, amount, and date are required.' });
  }
  if (Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero.' });

  try {
    const income = await db.createIncome(req.user.id, { source: source.trim(), amount, income_date, description });
    res.status(201).json(income);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add income.' });
  }
});

app.put('/api/incomes/:id', auth, async (req, res) => {
  const { source, amount, income_date, description } = req.body;
  if (amount !== undefined && Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero.' });

  try {
    const income = await db.updateIncome(Number(req.params.id), req.user.id, { source, amount, income_date, description });
    if (!income) return res.status(404).json({ error: 'Income not found.' });
    res.json(income);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update income.' });
  }
});

app.delete('/api/incomes/:id', auth, async (req, res) => {
  try {
    const ok = await db.deleteIncome(Number(req.params.id), req.user.id);
    if (!ok) return res.status(404).json({ error: 'Income not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete income.' });
  }
});

// Recurring Expenses endpoints
app.get('/api/recurring', auth, async (req, res) => {
  try {
    const recurring = await db.getRecurringExpenses(req.user.id);
    res.json(recurring);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve recurring expenses.' });
  }
});

app.post('/api/recurring', auth, async (req, res) => {
  const { title, amount, category, frequency, next_date, description } = req.body;
  if (!title?.trim() || !amount || !category || !frequency || !next_date) {
    return res.status(400).json({ error: 'Title, amount, category, frequency, and start date are required.' });
  }
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category.' });
  if (Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero.' });
  if (!['Daily', 'Weekly', 'Monthly', 'Yearly'].includes(frequency)) {
    return res.status(400).json({ error: 'Invalid frequency.' });
  }

  try {
    const rec = await db.createRecurringExpense(req.user.id, { title: title.trim(), amount, category, frequency, next_date, description });
    res.status(201).json(rec);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add recurring expense.' });
  }
});

app.delete('/api/recurring/:id', auth, async (req, res) => {
  try {
    const ok = await db.deleteRecurringExpense(Number(req.params.id), req.user.id);
    if (!ok) return res.status(404).json({ error: 'Recurring expense not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete recurring expense.' });
  }
});

// Monthly Reports endpoints
app.get('/api/reports/monthly', auth, async (req, res) => {
  try {
    const report = await db.getMonthlyReport(req.user.id);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve monthly report.' });
  }
});

app.listen(PORT, () => {
  console.log(`Expense Manager running at http://localhost:${PORT}`);
});
