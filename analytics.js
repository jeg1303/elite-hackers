/* =====================================================
   ELITE HACKERS — Data Analytics Explorer
   CSV parsing (PapaParse) + Chart.js + Web Worker
   All processing is client-side — data never leaves.
   ===================================================== */
'use strict';

let parsedData   = null;
let columns      = [];
let chartInstance = null;
let tablePage    = 1;
let tableSearch  = '';

// ── File Upload / Drag-Drop ───────────────────
const uploadBox   = document.getElementById('upload-box');
const fileInput   = document.getElementById('csv-file-input');

uploadBox.addEventListener('dragover',  (e) => { e.preventDefault(); uploadBox.classList.add('drag-over'); });
uploadBox.addEventListener('dragleave', ()  => uploadBox.classList.remove('drag-over'));
uploadBox.addEventListener('drop', (e) => {
    e.preventDefault(); uploadBox.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) processFile(e.target.files[0]);
    e.target.value = '';
});

document.getElementById('load-sample-csv').addEventListener('click', loadSampleCSV);
document.getElementById('new-file-btn').addEventListener('click', resetToUpload);

// ── Parse File ────────────────────────────────
function processFile(file) {
    showState('progress');
    document.getElementById('progress-title').textContent = `Parsing: ${file.name}`;
    document.getElementById('dash-filename').textContent  = `📄 ${file.name}`;

    let rowsParsed = 0;
    const results = { data:[], fields:[] };

    Papa.parse(file, {
        header:      true,
        skipEmptyLines: true,
        dynamicTyping: true,
        worker:      true,  // Uses PapaParse's built-in Web Worker for large files
        step: (row, parser) => {
            results.data.push(row.data);
            if (results.fields.length === 0 && row.meta?.fields) results.fields = row.meta.fields;
            rowsParsed++;
            if (rowsParsed % 50000 === 0) updateProgress(rowsParsed, file.size);
        },
        complete: () => {
            updateProgress(rowsParsed, file.size, true);
            setTimeout(() => {
                buildAnalytics(results.data, results.fields, file.name);
            }, 300);
        },
        error: (err) => {
            alert('Error parsing CSV: ' + err.message);
            resetToUpload();
        }
    });
}

function updateProgress(rows, size, done = false) {
    const pct = done ? 100 : Math.min(95, Math.round((rows / Math.max(rows + 10000, 100000)) * 100));
    document.getElementById('progress-bar').style.width = pct + '%';
    document.getElementById('progress-pct').textContent = pct + '%';
    document.getElementById('progress-desc').textContent = `${rows.toLocaleString()} rows parsed...`;
}

// ── Build Analytics ───────────────────────────
function buildAnalytics(data, fields, filename) {
    if (!data.length) { alert('No data found in file.'); resetToUpload(); return; }

    // Use all fields or auto-detect from first row
    if (!fields.length) fields = Object.keys(data[0]);

    parsedData = data;
    columns = analyzeColumns(data, fields);

    renderDashboard(data, fields, filename);
    showState('dashboard');
}

function analyzeColumns(data, fields) {
    return fields.map(field => {
        const values    = data.map(r => r[field]);
        const nonNull   = values.filter(v => v !== null && v !== undefined && v !== '');
        const missing   = values.length - nonNull.length;
        const unique    = new Set(nonNull.map(String)).size;

        let type = 'text';
        let numVals = nonNull.map(Number).filter(v => !isNaN(v));
        if (numVals.length / nonNull.length > 0.8) type = 'numeric';
        else if (nonNull.some(v => !isNaN(Date.parse(String(v))))) type = 'date';

        const stats = {};
        if (type === 'numeric' && numVals.length) {
            numVals.sort((a, b) => a - b);
            stats.min  = numVals[0];
            stats.max  = numVals[numVals.length - 1];
            stats.mean = numVals.reduce((s, v) => s + v, 0) / numVals.length;
            stats.median = numVals[Math.floor(numVals.length / 2)];
            const mean = stats.mean;
            stats.std  = Math.sqrt(numVals.reduce((s, v) => s + (v - mean) ** 2, 0) / numVals.length);
        }

        // Top categories for text cols
        const freq = {};
        nonNull.forEach(v => { const k = String(v); freq[k] = (freq[k] || 0) + 1; });
        const topCats = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);

        return { field, type, missing, unique, total: values.length, nonNull: nonNull.length, stats, topCats, numVals };
    });
}

// ── Render Dashboard ──────────────────────────
function renderDashboard(data, fields, filename) {
    // Stats row
    const numCols  = columns.filter(c => c.type === 'numeric').length;
    const txtCols  = columns.filter(c => c.type === 'text').length;
    const totalMissing = columns.reduce((s, c) => s + c.missing, 0);
    document.getElementById('dash-stats-row').innerHTML = `
        <span class="dash-stat">Rows: <span>${data.length.toLocaleString()}</span></span>
        <span class="dash-stat">Columns: <span>${fields.length}</span></span>
        <span class="dash-stat">Numeric: <span>${numCols}</span></span>
        <span class="dash-stat">Text: <span>${txtCols}</span></span>
        <span class="dash-stat">Missing Cells: <span>${totalMissing.toLocaleString()}</span></span>`;

    renderOverview(data, fields);
    renderColumnsTab();
    renderChartsTab(fields);
    renderTableTab(data, fields);
    renderQualityTab();

    // Tab switching
    document.querySelectorAll('.dash-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.dash-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        });
    });
}

function renderOverview(data, fields) {
    // Overview cards
    const numCols = columns.filter(c => c.type === 'numeric');
    const totalMissing = columns.reduce((s, c) => s + c.missing, 0);
    const completeness = Math.round(((data.length * fields.length - totalMissing) / (data.length * fields.length)) * 100);

    document.getElementById('overview-cards').innerHTML = `
        <div class="ov-card"><div class="ov-card-value">${data.length.toLocaleString()}</div><div class="ov-card-label">TOTAL ROWS</div></div>
        <div class="ov-card"><div class="ov-card-value">${fields.length}</div><div class="ov-card-label">COLUMNS</div></div>
        <div class="ov-card"><div class="ov-card-value">${numCols.length}</div><div class="ov-card-label">NUMERIC COLS</div></div>
        <div class="ov-card"><div class="ov-card-value">${completeness}%</div><div class="ov-card-label">COMPLETENESS</div></div>
        <div class="ov-card"><div class="ov-card-value">${totalMissing.toLocaleString()}</div><div class="ov-card-label">MISSING CELLS</div></div>
        <div class="ov-card"><div class="ov-card-value">${columns.reduce((s,c)=>s+c.unique,0).toLocaleString()}</div><div class="ov-card-label">UNIQUE VALUES</div></div>`;

    // Numeric stats table
    if (numCols.length) {
        let html = `<table class="stats-table"><thead><tr><th>Column</th><th>Min</th><th>Max</th><th>Mean</th><th>Median</th><th>Std Dev</th><th>Missing</th></tr></thead><tbody>`;
        numCols.forEach(c => {
            const s = c.stats;
            html += `<tr><td>${esc(c.field)}</td><td>${fmt(s.min)}</td><td>${fmt(s.max)}</td><td>${fmt(s.mean)}</td><td>${fmt(s.median)}</td><td>${fmt(s.std)}</td><td>${c.missing > 0 ? `<span style="color:var(--accent-orange)">${c.missing}</span>` : '0'}</td></tr>`;
        });
        html += '</tbody></table>';
        document.getElementById('numeric-stats-table').innerHTML = html;
    } else {
        document.getElementById('numeric-stats-table').innerHTML = '<p style="color:var(--text-muted);font-size:0.85em;">No numeric columns detected.</p>';
    }

    // Category summary (first text col)
    const txtCol = columns.find(c => c.type === 'text' && c.topCats.length > 0);
    if (txtCol) {
        const max = txtCol.topCats[0][1];
        let html = `<div style="font-size:0.78em;color:var(--text-muted);margin-bottom:10px;">${esc(txtCol.field)} — top ${txtCol.topCats.length} values</div>`;
        txtCol.topCats.forEach(([val, cnt]) => {
            const pct = Math.round((cnt / max) * 100);
            html += `<div class="cat-item"><span class="cat-label" title="${esc(val)}">${esc(val.slice(0,20))}</span><div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%"></div></div><span class="cat-count">${cnt.toLocaleString()}</span></div>`;
        });
        document.getElementById('category-summary').innerHTML = html;
    } else {
        document.getElementById('category-summary').innerHTML = '<p style="color:var(--text-muted);font-size:0.85em;">No categorical columns found.</p>';
    }
}

function renderColumnsTab() {
    const grid = document.getElementById('columns-grid');
    function render() {
        const q = document.getElementById('col-search').value.toLowerCase();
        const tf = document.getElementById('col-type-filter').value;
        const filtered = columns.filter(c => c.field.toLowerCase().includes(q) && (tf === 'all' || c.type === tf));
        grid.innerHTML = filtered.map(c => {
            const s = c.stats;
            const completeness = Math.round((c.nonNull / c.total) * 100);
            let stats = '';
            if (c.type === 'numeric' && s.mean !== undefined) {
                stats = `<div class="col-stat-row"><span>Min</span><span class="col-stat-val">${fmt(s.min)}</span></div><div class="col-stat-row"><span>Max</span><span class="col-stat-val">${fmt(s.max)}</span></div><div class="col-stat-row"><span>Mean</span><span class="col-stat-val">${fmt(s.mean)}</span></div>`;
            } else {
                stats = `<div class="col-stat-row"><span>Unique</span><span class="col-stat-val">${c.unique.toLocaleString()}</span></div>` +
                    (c.topCats[0] ? `<div class="col-stat-row"><span>Top Value</span><span class="col-stat-val">${esc(String(c.topCats[0][0]).slice(0,20))}</span></div>` : '');
            }
            return `<div class="col-card"><div class="col-name">${esc(c.field)}</div><span class="col-type-badge col-type-${c.type}">${c.type}</span>${stats}<div class="col-stat-row"><span>Completeness</span><span class="col-stat-val" style="color:${completeness===100?'var(--accent-green)':completeness>80?'var(--accent-orange)':'var(--accent-red)'}">${completeness}%</span></div></div>`;
        }).join('');
    }
    render();
    document.getElementById('col-search').addEventListener('input', render);
    document.getElementById('col-type-filter').addEventListener('change', render);
}

function renderChartsTab(fields) {
    const xSel = document.getElementById('chart-x');
    const ySel = document.getElementById('chart-y');
    xSel.innerHTML = fields.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
    ySel.innerHTML = columns.filter(c => c.type === 'numeric').map(c => `<option value="${esc(c.field)}">${esc(c.field)}</option>`).join('');
    if (!ySel.options.length) ySel.innerHTML = fields.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');

    document.getElementById('render-chart-btn').addEventListener('click', renderChart);
}

function renderChart() {
    const type  = document.getElementById('chart-type').value;
    const xField = document.getElementById('chart-x').value;
    const yField = document.getElementById('chart-y').value;
    const limit  = parseInt(document.getElementById('chart-limit').value);

    if (!parsedData || !xField || !yField) return;

    // Build frequency / aggregated data
    const map = {};
    parsedData.forEach(row => {
        const xVal = String(row[xField] ?? 'null').slice(0, 40);
        const yVal = parseFloat(row[yField]);
        if (!map[xVal]) map[xVal] = { sum: 0, count: 0 };
        if (!isNaN(yVal)) { map[xVal].sum += yVal; map[xVal].count++; }
        else map[xVal].count++;
    });
    const entries = Object.entries(map).sort((a, b) => b[1].count - a[1].count).slice(0, limit);
    const labels  = entries.map(e => e[0]);
    const values  = entries.map(e => e[1].count > 0 && e[1].sum !== 0 ? +(e[1].sum / e[1].count).toFixed(2) : e[1].count);

    const colors = labels.map((_, i) => `hsl(${(i * 37) % 360}, 70%, 60%)`);

    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    const ctx = document.getElementById('main-chart').getContext('2d');
    chartInstance = new Chart(ctx, {
        type: type === 'scatter' ? 'scatter' : type,
        data: type === 'scatter'
            ? { datasets: [{ label: yField, data: values.map((v, i) => ({ x: i, y: v })), backgroundColor: 'rgba(30,143,255,0.6)', borderColor: 'var(--accent-blue)' }] }
            : { labels, datasets: [{ label: yField, data: values, backgroundColor: colors, borderColor: colors.map(c => c.replace('0.7','1')), borderWidth: 1 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#8ba3c7' } } },
            scales: type === 'pie' || type === 'doughnut' ? {} : {
                x: { ticks: { color: '#8ba3c7', maxRotation: 45 }, grid: { color: 'rgba(30,143,255,0.06)' } },
                y: { ticks: { color: '#8ba3c7' }, grid: { color: 'rgba(30,143,255,0.06)' } }
            }
        }
    });
}

function renderTableTab(data, fields) {
    function render() {
        const ps = parseInt(document.getElementById('table-page-size').value);
        const q  = tableSearch.toLowerCase();
        const filtered = q ? data.filter(row => fields.some(f => String(row[f] ?? '').toLowerCase().includes(q))) : data;
        const totalPages = Math.ceil(filtered.length / ps);
        tablePage = Math.min(tablePage, totalPages || 1);
        const pageData = filtered.slice((tablePage - 1) * ps, tablePage * ps);

        // Table header
        let thead = '<thead><tr>' + fields.map(f => `<th>${esc(f)}</th>`).join('') + '</tr></thead>';
        let tbody = '<tbody>' + pageData.map(row =>
            '<tr>' + fields.map(f => {
                const v = row[f];
                const missing = v === null || v === undefined || v === '';
                return `<td${missing ? ' style="color:var(--accent-red);opacity:0.7;"' : ''}>${missing ? 'N/A' : esc(String(v).slice(0, 100))}</td>`;
            }).join('') + '</tr>'
        ).join('') + '</tbody>';

        document.getElementById('data-table').innerHTML = thead + tbody;

        // Pagination
        const pagDiv = document.getElementById('table-pagination');
        let pagHtml = `<span style="font-family:var(--font-mono);font-size:0.75em;color:var(--text-muted);">${filtered.length.toLocaleString()} rows</span> `;
        const startPage = Math.max(1, tablePage - 2);
        const endPage   = Math.min(totalPages, startPage + 4);
        if (tablePage > 1) pagHtml += `<button class="page-btn" onclick="changePage(${tablePage-1})">←</button>`;
        for (let p = startPage; p <= endPage; p++) pagHtml += `<button class="page-btn ${p===tablePage?'active':''}" onclick="changePage(${p})">${p}</button>`;
        if (tablePage < totalPages) pagHtml += `<button class="page-btn" onclick="changePage(${tablePage+1})">→</button>`;
        pagDiv.innerHTML = pagHtml;
    }
    window.changePage = (p) => { tablePage = p; render(); };
    document.getElementById('table-search').addEventListener('input', (e) => { tableSearch = e.target.value; tablePage = 1; render(); });
    document.getElementById('table-page-size').addEventListener('change', () => { tablePage = 1; render(); });
    render();

    // Download cleaned CSV
    document.getElementById('download-csv-btn').addEventListener('click', () => {
        const clean = parsedData.map(row => {
            const r = {};
            fields.forEach(f => { r[f] = row[f] ?? ''; });
            return r;
        });
        const csv = Papa.unparse(clean);
        const blob = new Blob([csv], { type:'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'cleaned_data.csv';
        a.click();
    });
}

function renderQualityTab() {
    const grid = document.getElementById('quality-grid');
    grid.innerHTML = columns.map(c => {
        const completeness = Math.round((c.nonNull / c.total) * 100);
        const uniqueness   = Math.round((c.unique / c.total) * 100);
        const cClass = completeness >= 90 ? 'q-good' : completeness >= 70 ? 'q-warn' : 'q-bad';
        const uClass = uniqueness  > 80   ? 'q-warn' : 'q-good';
        return `<div class="quality-card">
            <div class="quality-col-name">${esc(c.field)} <span class="col-type-badge col-type-${c.type}" style="margin-left:4px;">${c.type}</span></div>
            <div class="quality-bar-row"><span class="quality-label">Complete</span><div class="quality-bar-bg"><div class="quality-bar-fill ${cClass}" style="width:${completeness}%"></div></div><span class="quality-pct" style="${cClass==='q-bad'?'color:var(--accent-red)':cClass==='q-warn'?'color:var(--accent-orange)':'color:var(--accent-green)'}">${completeness}%</span></div>
            <div class="quality-bar-row"><span class="quality-label">Unique</span><div class="quality-bar-bg"><div class="quality-bar-fill ${uClass}" style="width:${Math.min(uniqueness,100)}%"></div></div><span class="quality-pct">${c.unique.toLocaleString()}</span></div>
            ${c.missing > 0 ? `<div style="font-size:0.78em;color:var(--accent-orange);margin-top:8px;">⚠ ${c.missing.toLocaleString()} missing values</div>` : ''}
        </div>`;
    }).join('');
}

// ── Download Report ───────────────────────────
document.getElementById('download-report-btn').addEventListener('click', () => {
    const totalMissing = columns.reduce((s, c) => s + c.missing, 0);
    const report = {
        generatedAt: new Date().toISOString(),
        summary: { rows: parsedData.length, columns: columns.length, missingCells: totalMissing },
        columns: columns.map(c => ({ name: c.field, type: c.type, missing: c.missing, unique: c.unique, stats: c.stats }))
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `analytics-report-${Date.now()}.json`;
    a.click();
});

// ── Sample CSV ────────────────────────────────
function loadSampleCSV() {
    const headers = ['Name','Department','Salary','Age','JoinDate','Performance'];
    const depts   = ['Engineering','Design','Marketing','Sales','HR'];
    const perfs   = ['Excellent','Good','Average','Below Average'];
    const names   = ['Alice','Bob','Carol','Dave','Eva','Frank','Grace','Hank','Iris','Jack'];
    let csv = headers.join(',') + '\n';
    for (let i = 0; i < 200; i++) {
        const name  = names[i % names.length] + ' ' + String.fromCharCode(65 + (i % 26));
        const dept  = depts[i % depts.length];
        const sal   = Math.round(40000 + Math.random() * 80000);
        const age   = Math.round(22 + Math.random() * 38);
        const date  = `202${Math.floor(i/50)}-${String(1+i%12).padStart(2,'0')}-${String(1+i%28).padStart(2,'0')}`;
        const perf  = i % 15 === 0 ? '' : perfs[Math.floor(Math.random() * perfs.length)];
        csv += [name, dept, sal, age, date, perf].join(',') + '\n';
    }
    const file = new File([csv], 'sample_employees.csv', { type:'text/csv' });
    document.getElementById('dash-filename').textContent = '📄 sample_employees.csv';
    showState('progress');
    document.getElementById('progress-title').textContent = 'Processing: sample_employees.csv';
    setTimeout(() => buildAnalytics(Papa.parse(csv, { header:true, skipEmptyLines:true, dynamicTyping:true }).data, headers, 'sample_employees.csv'), 200);
}

// ── State Manager ─────────────────────────────
function showState(state) {
    document.getElementById('upload-state').classList.add('hidden');
    document.getElementById('progress-state').classList.add('hidden');
    document.getElementById('dashboard-state').classList.add('hidden');
    document.getElementById(`${state}-state`).classList.remove('hidden');
}

function resetToUpload() {
    parsedData = null; columns = [];
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    showState('upload');
}

// ── Helpers ────────────────────────────────────
function fmt(n) {
    if (n === undefined || n === null) return '—';
    if (Math.abs(n) >= 1000) return n.toLocaleString('en', { maximumFractionDigits: 1 });
    return n.toFixed(2);
}
function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
}
