const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && location.port && location.port !== '3000'
  ? 'http://localhost:3000/api'
  : '/api';
const TOKEN_KEY = 'expense_token';

const state = {
  user: null,
  categories: [],
  expenses: [],
  incomes: [],
  budgets: [],
  recurring: [],
  reports: [],
  currentView: 'dashboard'
};

let chartPieInstance = null;
let chartLineInstance = null;
let chartBarInstance = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function formatCurrency(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getInitials(name) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function getFilterParams() {
  const params = new URLSearchParams();
  const month = $('#filter-month').value;
  const year = $('#filter-year').value;
  if (month) params.set('month', month);
  if (year) params.set('year', year);
  return params;
}

function getAdvancedFilterParams() {
  const params = getFilterParams();
  
  const searchVal = $('#expense-search').value.trim();
  const categoryVal = $('#filter-category').value;
  const minAmt = $('#filter-min-amount').value.trim();
  const maxAmt = $('#filter-max-amount').value.trim();
  const startDate = $('#filter-start-date').value;
  const endDate = $('#filter-end-date').value;
  const tagVal = $('#filter-tag').value.trim();

  if (searchVal) params.set('search', searchVal);
  if (categoryVal) params.set('category', categoryVal);
  if (minAmt) params.set('min_amount', minAmt);
  if (maxAmt) params.set('max_amount', maxAmt);
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  if (tagVal) params.set('tag', tagVal);

  return params;
}

async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(API + url, { ...options, headers });
  } catch {
    throw new Error('Cannot reach the server. Run "npm start" and open http://localhost:3000');
  }

  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Server returned an invalid response. Open http://localhost:3000 in your browser.');
    }
  } else if (!res.ok) {
    throw new Error('Server error. Make sure you opened http://localhost:3000 (not the HTML file directly).');
  }

  if (res.status === 401 && !url.startsWith('/auth/')) {
    logout();
    throw new Error('Session expired. Please log in again.');
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function showToast(message, type = 'success') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function showAuthError(msg) {
  const el = $('#auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideAuthError() {
  $('#auth-error').classList.add('hidden');
}

function openModal(id) { $(`#${id}`).classList.remove('hidden'); }
function closeModal(id) { $(`#${id}`).classList.add('hidden'); }

function showAuthScreen() {
  $('#auth-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  updateSidebar();
}

function updateSidebar() {
  if (!state.user) return;
  $('#sidebar-name').textContent = state.user.name;
  $('#sidebar-email').textContent = state.user.email;
  $('#sidebar-avatar').textContent = getInitials(state.user.name);
}

function logout() {
  const token = getToken();
  if (token) {
    fetch(API + '/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});
  }
  setToken(null);
  state.user = null;
  showAuthScreen();
}

function switchAuthTab(tab) {
  $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $('#login-form').classList.toggle('hidden', tab !== 'login');
  $('#register-form').classList.toggle('hidden', tab !== 'register');
  hideAuthError();
}

function initDateFilters() {
  const monthSel = $('#filter-month');
  const yearSel = $('#filter-year');
  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  monthSel.innerHTML = '<option value="">All Months</option>' +
    months.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  monthSel.value = now.getMonth() + 1;

  yearSel.innerHTML = '';
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) {
    yearSel.innerHTML += `<option value="${y}">${y}</option>`;
  }

  monthSel.addEventListener('change', refreshCurrentView);
  yearSel.addEventListener('change', refreshCurrentView);
}

function refreshCurrentView() {
  switchView(state.currentView);
}

async function loadCategories() {
  state.categories = await api('/categories');
  ['#expense-category', '#filter-category', '#budget-category', '#recurring-category'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    const placeholder = sel === '#filter-category'
      ? '<option value="">All Categories</option>' : '';
    el.innerHTML = placeholder + state.categories.map(c => `<option value="${c}">${c}</option>`).join('');
  });
}

// 1. Dashboard View
async function loadDashboard() {
  const params = getFilterParams();
  const [stats, expenses, incomes, budgets] = await Promise.all([
    api('/stats?' + params),
    api('/expenses?' + params),
    api('/incomes?' + params),
    api('/budgets')
  ]);

  state.expenses = expenses;
  state.incomes = incomes;
  state.budgets = budgets;

  const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
  const totalSpent = stats.total;
  const savings = totalIncome - totalSpent;
  const savingsRate = totalIncome > 0 ? (savings / totalIncome) * 100 : 0;

  $('#stat-income').textContent = formatCurrency(totalIncome);
  $('#stat-total').textContent = formatCurrency(totalSpent);
  $('#stat-savings').textContent = formatCurrency(savings);
  $('#stat-savings-rate').textContent = (savingsRate >= 0 ? savingsRate.toFixed(1) : '0') + '%';

  // Calculate budget remaining
  let totalRemainingBudget = 0;
  let hasBudgets = budgets.length > 0;
  
  budgets.forEach(b => {
    const spentInCategory = expenses
      .filter(e => e.category === b.category)
      .reduce((sum, e) => sum + e.amount, 0);
    const rem = b.amount - spentInCategory;
    if (rem > 0) totalRemainingBudget += rem;
  });
  
  $('#stat-budget-remaining').textContent = hasBudgets ? formatCurrency(totalRemainingBudget) : 'No Budgets';

  // Render Visual Charts
  renderCharts(stats.byCategory, expenses, budgets);

  // Render Breakdown Lists
  renderCategoryBreakdownList(stats.byCategory);
  renderRecentExpenses(expenses.slice(0, 6));
}

function renderCharts(byCategory, expenses, budgets) {
  // Pie Chart - Expenses by Category
  const pieCtx = document.getElementById('chart-pie').getContext('2d');
  if (chartPieInstance) chartPieInstance.destroy();
  
  const pieLabels = byCategory.map(c => c.category);
  const pieData = byCategory.map(c => c.total);
  
  chartPieInstance = new Chart(pieCtx, {
    type: 'pie',
    data: {
      labels: pieLabels.length ? pieLabels : ['No Expenses'],
      datasets: [{
        data: pieData.length ? pieData : [1],
        backgroundColor: pieData.length ? [
          '#6366f1', '#10b981', '#f59e0b', '#ef4444', 
          '#8b5cf6', '#ec4899', '#06b6d4', '#6b7280'
        ] : ['#2e3348'],
        borderWidth: 1,
        borderColor: '#1a1d27'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#e8eaf0', font: { family: 'Inter', size: 11 } }
        }
      }
    }
  });

  // Line Chart - Spending Trend (Last 6 Months)
  const lineCtx = document.getElementById('chart-line').getContext('2d');
  if (chartLineInstance) chartLineInstance.destroy();

  const months = [];
  const monthlyTotals = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const mLabel = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key: mKey, label: mLabel });
    monthlyTotals[mKey] = 0;
  }

  api('/reports/monthly').then(reportData => {
    const reportMap = {};
    reportData.forEach(r => {
      reportMap[r.monthKey] = r.expense;
    });

    const lineLabels = months.map(m => m.label);
    const lineData = months.map(m => reportMap[m.key] || 0);

    chartLineInstance = new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: lineLabels,
        datasets: [{
          label: 'Spending',
          data: lineData,
          borderColor: '#818cf8',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { grid: { color: '#2e3348' }, ticks: { color: '#8b90a5' } },
          x: { grid: { display: false }, ticks: { color: '#8b90a5' } }
        }
      }
    });
  }).catch(() => {});

  // Bar Chart - Budget vs Actual
  const barCtx = document.getElementById('chart-bar').getContext('2d');
  if (chartBarInstance) chartBarInstance.destroy();

  const barCategories = state.categories;
  const budgetAmounts = barCategories.map(cat => {
    const b = budgets.find(x => x.category === cat);
    return b ? b.amount : 0;
  });
  const actualAmounts = barCategories.map(cat => {
    return expenses.filter(e => e.category === cat).reduce((sum, e) => sum + e.amount, 0);
  });

  chartBarInstance = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: barCategories,
      datasets: [
        {
          label: 'Budget Limit',
          data: budgetAmounts,
          backgroundColor: 'rgba(141, 144, 165, 0.2)',
          borderColor: '#8b90a5',
          borderWidth: 1
        },
        {
          label: 'Actual Spent',
          data: actualAmounts,
          backgroundColor: '#6366f1',
          borderColor: '#818cf8',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { grid: { color: '#2e3348' }, ticks: { color: '#8b90a5' } },
        x: { grid: { display: false }, ticks: { color: '#8b90a5' } }
      },
      plugins: {
        legend: { labels: { color: '#e8eaf0' } }
      }
    }
  });
}

function renderCategoryBreakdownList(categories) {
  const container = $('#category-chart');
  if (!categories.length) {
    container.innerHTML = '<p class="empty-msg">No data for this period.</p>';
    return;
  }
  const max = Math.max(...categories.map(c => c.total));
  container.innerHTML = categories.map(c => `
    <div class="bar-row">
      <span class="bar-label" title="${c.category}">${c.category}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(c.total / max * 100).toFixed(1)}%"></div></div>
      <span class="bar-amount">${formatCurrency(c.total)}</span>
    </div>
  `).join('');
}

function renderRecentExpenses(expenses) {
  const container = $('#recent-expenses');
  if (!expenses.length) {
    container.innerHTML = '<p class="empty-msg">No recent transactions.</p>';
    return;
  }
  container.innerHTML = expenses.map(e => `
    <div class="recent-item">
      <div class="recent-item-info">
        <span class="recent-item-title">${escapeHtml(e.title)}</span>
        <span class="recent-item-meta">${e.category} · ${formatDate(e.expense_date)}</span>
      </div>
      <span class="recent-item-amount">${formatCurrency(e.amount)}</span>
    </div>
  `).join('');
}

// 2. Expenses View
async function loadExpenses() {
  const params = getAdvancedFilterParams();
  state.expenses = await api('/expenses?' + params);
  renderExpensesTable();
  
  $('#expenses-count-desc').textContent = `Showing ${state.expenses.length} transaction${state.expenses.length === 1 ? '' : 's'}`;
}

function renderExpensesTable() {
  const tbody = $('#expenses-table');
  const empty = $('#expenses-empty');

  if (!state.expenses.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = state.expenses.map(e => {
    const tagBadges = (e.tags || [])
      .filter(t => t.trim() !== '')
      .map(t => `<span class="tag-pill">#${escapeHtml(t)}</span>`)
      .join('');

    return `
      <tr>
        <td>${formatDate(e.expense_date)}</td>
        <td>${escapeHtml(e.title)}</td>
        <td>${escapeHtml(e.category)}</td>
        <td><strong>${formatCurrency(e.amount)}</strong></td>
        <td>${tagBadges}</td>
        <td>
          <div class="action-btns">
            <button class="btn btn-edit" onclick="editExpense(${e.id})">Edit</button>
            <button class="btn btn-danger" onclick="deleteExpense(${e.id})">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openExpenseModal(expense = null) {
  $('#expense-form').reset();
  $('#expense-id').value = '';
  $('#expense-date').value = new Date().toISOString().split('T')[0];
  $('#expense-modal-title').textContent = expense ? 'Edit Expense' : 'Add Expense';

  if (expense) {
    $('#expense-id').value = expense.id;
    $('#expense-title').value = expense.title;
    $('#expense-amount').value = expense.amount;
    $('#expense-category').value = expense.category;
    $('#expense-tags').value = (expense.tags || []).join(', ');
    $('#expense-description').value = expense.description || '';
    $('#expense-date').value = expense.expense_date;
  } else {
    $('#expense-tags').value = '';
  }

  openModal('expense-modal');
}

async function editExpense(id) {
  const expense = state.expenses.find(e => e.id === id);
  if (expense) openExpenseModal(expense);
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  try {
    await api(`/expenses/${id}`, { method: 'DELETE' });
    showToast('Expense deleted.');
    loadExpenses();
    if (state.currentView === 'dashboard') loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 3. Income View
async function loadIncome() {
  const params = getFilterParams();
  state.incomes = await api('/incomes?' + params);
  renderIncomeTable();
}

function renderIncomeTable() {
  const tbody = $('#income-table');
  const empty = $('#income-empty');

  if (!state.incomes.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = state.incomes.map(i => `
    <tr>
      <td>${formatDate(i.income_date)}</td>
      <td><strong>${escapeHtml(i.source)}</strong></td>
      <td><span class="text-success">${formatCurrency(i.amount)}</span></td>
      <td>${escapeHtml(i.description || '—')}</td>
      <td>
        <div class="action-btns">
          <button class="btn btn-edit" onclick="editIncome(${i.id})">Edit</button>
          <button class="btn btn-danger" onclick="deleteIncome(${i.id})">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function openIncomeModal(income = null) {
  $('#income-form').reset();
  $('#income-id').value = '';
  $('#income-date').value = new Date().toISOString().split('T')[0];
  $('#income-modal-title').textContent = income ? 'Edit Income' : 'Add Income';

  if (income) {
    $('#income-id').value = income.id;
    $('#income-source').value = income.source;
    $('#income-amount').value = income.amount;
    $('#income-date').value = income.income_date;
    $('#income-description').value = income.description || '';
  }

  openModal('income-modal');
}

async function editIncome(id) {
  const income = state.incomes.find(i => i.id === id);
  if (income) openIncomeModal(income);
}

async function deleteIncome(id) {
  if (!confirm('Delete this income record?')) return;
  try {
    await api(`/incomes/${id}`, { method: 'DELETE' });
    showToast('Income deleted.');
    loadIncome();
    if (state.currentView === 'dashboard') loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 4. Budgets View
async function loadBudgets() {
  state.budgets = await api('/budgets');
  
  const params = getFilterParams();
  const expenses = await api('/expenses?' + params);
  
  const container = $('#budgets-progress');
  container.innerHTML = '';
  
  state.categories.forEach(cat => {
    const budget = state.budgets.find(b => b.category === cat);
    const spent = expenses.filter(e => e.category === cat).reduce((sum, e) => sum + e.amount, 0);
    const limit = budget ? budget.amount : 0;
    
    if (limit === 0 && spent === 0) return;
    
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    const remaining = limit - spent;
    
    let barColorClass = 'bg-safe';
    let warningMsg = '';
    if (limit > 0) {
      if (pct >= 100) {
        barColorClass = 'bg-danger';
        warningMsg = `<span class="text-danger" style="font-size:11px; font-weight:bold; margin-left:8px;">⚠️ Crossed 100%!</span>`;
      } else if (pct >= 80) {
        barColorClass = 'bg-warning';
        warningMsg = `<span class="text-warning" style="font-size:11px; font-weight:bold; margin-left:8px;">⚠️ Crossed 80%!</span>`;
      }
    }

    container.innerHTML += `
      <div class="budget-progress-row">
        <div class="budget-progress-info">
          <span><strong>${cat}</strong>${warningMsg}</span>
          <span>${formatCurrency(spent)} / ${limit > 0 ? formatCurrency(limit) : 'No Limit'}</span>
        </div>
        <div class="budget-progress-bar-track">
          <div class="budget-progress-bar-fill ${barColorClass}" style="width: ${Math.min(100, pct).toFixed(1)}%"></div>
        </div>
        <div class="budget-progress-info" style="font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center;">
          <span>Remaining: ${remaining >= 0 ? formatCurrency(remaining) : '-' + formatCurrency(Math.abs(remaining))}</span>
          <div style="display:flex; align-items:center; gap:8px;">
            <span>${limit > 0 ? pct.toFixed(0) + '%' : '—'}</span>
            ${limit > 0 ? `<button class="btn btn-danger" style="padding: 2px 6px; font-size: 10px;" onclick="deleteBudget('${cat}')">Delete</button>` : ''}
          </div>
        </div>
      </div>
    `;
  });
  
  if (container.innerHTML === '') {
    container.innerHTML = '<p class="empty-msg">No budgets configured yet. Setup a monthly category limit on the left.</p>';
  }
}

// 5. Recurring View
async function loadRecurring() {
  state.recurring = await api('/recurring');
  renderRecurringTable();
}

function renderRecurringTable() {
  const tbody = $('#recurring-table');
  const empty = $('#recurring-empty');

  if (!state.recurring.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = state.recurring.map(r => `
    <tr>
      <td><strong>${escapeHtml(r.title)}</strong></td>
      <td>${escapeHtml(r.category)}</td>
      <td><strong>${formatCurrency(r.amount)}</strong></td>
      <td><span class="badge" style="background:var(--surface-2); border:1px solid var(--border);">${r.frequency}</span></td>
      <td>${formatDate(r.next_date)}</td>
      <td>
        <button class="btn btn-danger" onclick="deleteRecurring(${r.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

async function deleteRecurring(id) {
  if (!confirm('Delete this scheduled recurring expense?')) return;
  try {
    await api(`/recurring/${id}`, { method: 'DELETE' });
    showToast('Recurring expense deleted.');
    loadRecurring();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 6. Reports View
async function loadReports() {
  state.reports = await api('/reports/monthly');
  renderReportsTable();
}

function renderReportsTable() {
  const tbody = $('#reports-table');
  const empty = $('#reports-empty');

  if (!state.reports.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = state.reports.map(r => {
    const [year, month] = r.monthKey.split('-');
    const date = new Date(year, month - 1);
    const monthLabel = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    return `
      <tr>
        <td><strong>${monthLabel}</strong></td>
        <td><span class="text-success">${formatCurrency(r.income)}</span></td>
        <td><span class="text-danger">${formatCurrency(r.expense)}</span></td>
        <td><span class="${r.savings >= 0 ? 'text-info' : 'text-danger'}">${formatCurrency(r.savings)}</span></td>
        <td><strong>${r.savingsRate.toFixed(1)}%</strong></td>
      </tr>
    `;
  }).join('');
}

function downloadPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Expense Manager - Monthly Financial Report", 14, 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 28);

  const headers = [["Month", "Income", "Expense", "Savings", "Savings Rate %"]];
  const rows = state.reports.map(r => {
    const [year, month] = r.monthKey.split('-');
    const date = new Date(year, month - 1);
    const monthLabel = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    return [
      monthLabel,
      `INR ${r.income.toLocaleString()}`,
      `INR ${r.expense.toLocaleString()}`,
      `INR ${r.savings.toLocaleString()}`,
      `${r.savingsRate.toFixed(1)}%`
    ];
  });

  doc.autoTable({
    head: headers,
    body: rows,
    startY: 35,
    theme: 'grid',
    headStyles: { fillColor: [99, 102, 241] },
    styles: { font: 'helvetica', fontSize: 10 }
  });

  doc.save("monthly_financial_report.pdf");
  showToast('PDF downloaded successfully.');
}

function downloadExcel() {
  const headers = ["Month", "Income (INR)", "Expense (INR)", "Savings (INR)", "Savings Rate %"];
  const rows = state.reports.map(r => {
    const [year, month] = r.monthKey.split('-');
    const date = new Date(year, month - 1);
    const monthLabel = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    return [
      monthLabel,
      r.income,
      r.expense,
      r.savings,
      Number(r.savingsRate.toFixed(1))
    ];
  });

  const wsData = [headers, ...rows];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, "Monthly Summary");
  XLSX.writeFile(wb, "monthly_financial_report.xlsx");
  showToast('Excel file downloaded successfully.');
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function switchView(view) {
  state.currentView = view;
  $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  $$('.view').forEach(v => v.classList.remove('active'));
  
  const targetView = $(`#view-${view}`);
  if (targetView) targetView.classList.add('active');

  const titles = { 
    dashboard: 'Dashboard', 
    expenses: 'My Expenses',
    income: 'Income Tracking',
    budgets: 'Category Budgets',
    recurring: 'Recurring Expenses',
    reports: 'Monthly Reports'
  };
  $('#page-title').textContent = titles[view] || 'Expense Manager';

  if (view === 'dashboard') loadDashboard();
  else if (view === 'expenses') loadExpenses();
  else if (view === 'income') loadIncome();
  else if (view === 'budgets') loadBudgets();
  else if (view === 'recurring') loadRecurring();
  else if (view === 'reports') loadReports();
}

function setupEventListeners() {
  $$('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    try {
      const { user, token } = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: $('#login-email').value,
          password: $('#login-password').value
        })
      });
      setToken(token);
      state.user = user;
      showApp();
      await loadCategories();
      switchView('dashboard');
      showToast(`Welcome back, ${user.name}!`);
    } catch (err) {
      showAuthError(err.message);
    }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();

    const password = $('#register-password').value;
    const confirm = $('#register-confirm').value;
    if (password !== confirm) {
      showAuthError('Passwords do not match.');
      return;
    }

    try {
      const { user, token } = await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: $('#register-name').value,
          email: $('#register-email').value,
          password
        })
      });
      setToken(token);
      state.user = user;
      showApp();
      await loadCategories();
      switchView('dashboard');
      showToast('Account created successfully!');
    } catch (err) {
      showAuthError(err.message);
    }
  });

  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  $('#btn-logout').addEventListener('click', logout);
  $('#btn-add-expense').addEventListener('click', () => openExpenseModal());
  $('#btn-add-income').addEventListener('click', () => openIncomeModal());

  $$('[data-close]').forEach(el => {
    el.addEventListener('click', () => closeModal(el.dataset.close));
  });

  $$('.modal-backdrop').forEach(el => {
    el.addEventListener('click', () => el.parentElement.classList.add('hidden'));
  });

  // Expense form submit
  $('#expense-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#expense-id').value;
    const body = {
      title: $('#expense-title').value,
      amount: Number($('#expense-amount').value),
      category: $('#expense-category').value,
      tags: $('#expense-tags').value,
      description: $('#expense-description').value,
      expense_date: $('#expense-date').value
    };

    try {
      if (id) {
        await api(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        showToast('Expense updated.');
      } else {
        await api('/expenses', { method: 'POST', body: JSON.stringify(body) });
        showToast('Expense added.');
      }
      closeModal('expense-modal');
      loadExpenses();
      if (state.currentView === 'dashboard') loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Income form submit
  $('#income-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#income-id').value;
    const body = {
      source: $('#income-source').value,
      amount: Number($('#income-amount').value),
      income_date: $('#income-date').value,
      description: $('#income-description').value
    };

    try {
      if (id) {
        await api(`/incomes/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        showToast('Income updated.');
      } else {
        await api('/incomes', { method: 'POST', body: JSON.stringify(body) });
        showToast('Income added.');
      }
      closeModal('income-modal');
      loadIncome();
      if (state.currentView === 'dashboard') loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Budget form submit
  $('#budget-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      category: $('#budget-category').value,
      amount: Number($('#budget-amount').value)
    };

    try {
      await api('/budgets', { method: 'POST', body: JSON.stringify(body) });
      showToast('Budget limit configured.');
      $('#budget-amount').value = '';
      loadBudgets();
      if (state.currentView === 'dashboard') loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Recurring form submit
  $('#recurring-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      title: $('#recurring-title').value,
      amount: Number($('#recurring-amount').value),
      category: $('#recurring-category').value,
      frequency: $('#recurring-frequency').value,
      next_date: $('#recurring-date').value,
      description: $('#recurring-description').value
    };

    try {
      await api('/recurring', { method: 'POST', body: JSON.stringify(body) });
      showToast('Recurring expense scheduled.');
      $('#recurring-form').reset();
      $('#recurring-date').value = new Date().toISOString().split('T')[0];
      loadRecurring();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Advanced filters listeners
  const filterInputs = [
    '#expense-search', '#filter-category', 
    '#filter-min-amount', '#filter-max-amount', 
    '#filter-start-date', '#filter-end-date', 
    '#filter-tag'
  ];
  filterInputs.forEach(sel => {
    const el = $(sel);
    if (el) {
      el.addEventListener('input', () => loadExpenses());
      el.addEventListener('change', () => loadExpenses());
    }
  });

  $('#btn-clear-filters').addEventListener('click', () => {
    $('#expense-search').value = '';
    $('#filter-category').value = '';
    $('#filter-min-amount').value = '';
    $('#filter-max-amount').value = '';
    $('#filter-start-date').value = '';
    $('#filter-end-date').value = '';
    $('#filter-tag').value = '';
    loadExpenses();
  });

  // Report exports
  $('#btn-export-pdf').addEventListener('click', downloadPDF);
  $('#btn-export-excel').addEventListener('click', downloadExcel);
}

async function deleteBudget(category) {
  if (!confirm(`Delete budget limit for ${category}?`)) return;
  try {
    await api(`/budgets/${encodeURIComponent(category)}`, { method: 'DELETE' });
    showToast('Budget deleted.');
    loadBudgets();
    if (state.currentView === 'dashboard') loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Global functions exports for HTML inline onclick event handlers
window.editExpense = editExpense;
window.deleteExpense = deleteExpense;
window.editIncome = editIncome;
window.deleteIncome = deleteIncome;
window.deleteRecurring = deleteRecurring;
window.deleteBudget = deleteBudget;

async function init() {
  setupEventListeners();
  initDateFilters();

  // Set default recurring trigger date in forms to today
  const recurringDateInput = $('#recurring-date');
  if (recurringDateInput) {
    recurringDateInput.value = new Date().toISOString().split('T')[0];
  }

  const token = getToken();
  if (!token) {
    showAuthScreen();
    return;
  }

  try {
    state.user = await api('/auth/me');
    showApp();
    await loadCategories();
    switchView('dashboard');
  } catch {
    setToken(null);
    showAuthScreen();
  }
}

init();
