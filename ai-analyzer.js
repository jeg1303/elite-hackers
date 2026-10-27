/* =====================================================
   ELITE HACKERS — AI Code Analyzer JavaScript
   Pattern-based analysis engine (Demo Mode)
   Full GPT analysis available with OPENAI_API_KEY
   ===================================================== */
'use strict';

const editor     = document.getElementById('code-editor');
const lineNums   = document.getElementById('line-numbers');
const analyzeBtn = document.getElementById('analyze-btn');
const ghBtn      = document.getElementById('github-analyze-btn');

// ── Tab Switching ─────────────────────────────
document.querySelectorAll('.inp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.inp-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
    });
});

// ── Line Numbers ──────────────────────────────
function updateLineNumbers() {
    const lines = editor.value.split('\n').length;
    lineNums.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join('<br>');
    lineNums.scrollTop = editor.scrollTop;
}
editor.addEventListener('input', updateLineNumbers);
editor.addEventListener('scroll', () => { lineNums.scrollTop = editor.scrollTop; });
editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        editor.value = editor.value.slice(0, start) + '  ' + editor.value.slice(editor.selectionEnd);
        editor.selectionStart = editor.selectionEnd = start + 2;
        updateLineNumbers();
    }
});
updateLineNumbers();

// ── Load Sample ───────────────────────────────
document.getElementById('load-sample-btn').addEventListener('click', () => {
    editor.value = SAMPLE_CODE;
    updateLineNumbers();
});

document.getElementById('clear-code-btn').addEventListener('click', () => {
    editor.value = '';
    updateLineNumbers();
    resetResults();
});

const SAMPLE_CODE = `// Sample code with intentional issues for demo
function processUserData(req, res) {
    const userId = req.params.id;
    const query = "SELECT * FROM users WHERE id = " + userId;  // SQL injection risk!
    
    db.execute(query, function(err, results) {
        if (err) console.log(err);  // Poor error handling
        
        var password = results[0].password;  // Exposing password
        res.send(JSON.stringify({ user: results[0], pass: password }));
    });
}

function calculateTotal(items) {
    let total = 0;
    for (var i = 0; i <= items.length; i++) {  // Off-by-one error (should be <)
        total += items[i].price;
    }
    return total;
}

function hashPassword(pwd) {
    return btoa(pwd);  // Base64 is NOT encryption!
}

function innerHTML_xss(userInput) {
    document.getElementById("output").innerHTML = userInput;  // XSS vulnerability
}

async function fetchData(url) {
    const res = await fetch(url);
    const data = res.json();  // Missing await
    return data;
}`;

// ── Analyze ───────────────────────────────────
analyzeBtn.addEventListener('click', runAnalysis);
ghBtn.addEventListener('click', () => {
    const url = document.getElementById('github-url').value.trim();
    if (!url) { alert('Please enter a GitHub URL.'); return; }
    alert('GitHub OAuth integration requires a backend server with your GitHub credentials.\n\nThis demo analyzes the sample code — paste your code in the "Paste Code" tab to analyze it directly.');
});

function runAnalysis() {
    const code = editor.value.trim();
    if (!code) { alert('Please paste some code first.'); return; }

    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Analyzing...`;

    setTimeout(() => {
        const lang    = document.getElementById('language-select').value;
        const checks  = {
            bugs:     document.getElementById('chk-bugs').checked,
            security: document.getElementById('chk-security').checked,
            perf:     document.getElementById('chk-perf').checked,
            style:    document.getElementById('chk-style').checked,
        };
        const issues = detectIssues(code, lang, checks);
        renderResults(issues);

        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Analyze Code`;
    }, 900);
}

// ── Pattern-Based Issue Detection ─────────────
function detectIssues(code, lang, checks) {
    const issues = [];
    const lines   = code.split('\n');

    const RULES = [];

    if (checks.security) {
        RULES.push(
            { pattern: /SELECT.*\+\s*(req|params|query|body|input|user)/gi, sev:'critical', title:'SQL Injection Vulnerability', desc:'String concatenation in SQL queries allows attackers to manipulate the query and access/destroy data.', fix:'Use parameterized queries or prepared statements.', before:'db.execute("SELECT * FROM users WHERE id = " + userId)', after:'db.execute("SELECT * FROM users WHERE id = ?", [userId])' },
            { pattern: /\.innerHTML\s*=\s*(?!`|'|")/gi, sev:'critical', title:'XSS Vulnerability (innerHTML)', desc:'Assigning unsanitized user input to innerHTML allows Cross-Site Scripting attacks.', fix:'Use textContent or sanitize the input before inserting.', before:'element.innerHTML = userInput', after:'element.textContent = userInput // or use DOMPurify.sanitize()' },
            { pattern: /btoa\(.*pass|password.*btoa|md5\(/gi, sev:'critical', title:'Insecure Password Handling', desc:'btoa() is Base64 encoding, not encryption. md5() is a broken hash algorithm. Neither is secure for passwords.', fix:'Use bcrypt, scrypt, or Argon2 for password hashing.', before:'return btoa(pwd)', after:'return await bcrypt.hash(pwd, 12)' },
            { pattern: /console\.log\(.*pass|console\.log\(.*secret|console\.log\(.*token|console\.log\(.*key/gi, sev:'high', title:'Sensitive Data Logged', desc:'Logging passwords, tokens, or secret keys exposes them in log files and monitoring tools.', fix:'Remove logging of sensitive data, or use a log sanitizer.', before:'console.log("token:", token)', after:'// Never log secrets. Use a structured logger with field redaction.' },
            { pattern: /Math\.random\(\)/g, sev:'medium', title:'Weak Randomness (Math.random)', desc:'Math.random() is not cryptographically secure. Using it for tokens, IDs, or session keys is a security risk.', fix:'Use crypto.getRandomValues() or the Node.js crypto module.', before:'const id = Math.random().toString(36)', after:'const id = crypto.randomUUID()' },
        );
    }

    if (checks.bugs) {
        RULES.push(
            { pattern: /for\s*\(.*;\s*\w+\s*<=\s*\w+\.length\s*;/g, sev:'high', title:'Off-by-One Error (Array Loop)', desc:'Using <= with array.length will access an out-of-bounds index, resulting in undefined or a runtime error.', fix:'Use < instead of <= in the loop condition.', before:'for (let i = 0; i <= arr.length; i++)', after:'for (let i = 0; i < arr.length; i++)' },
            { pattern: /await\s+fetch\([^)]+\)\s*;\s*\n\s*.*\.json\(\)/gm, sev:'high', title:'Missing await on .json()', desc:'fetch().json() returns a Promise. Without await, you\'re assigning the Promise object, not the resolved data.', fix:'Add await before the .json() call.', before:'const data = res.json()', after:'const data = await res.json()' },
            { pattern: /==\s*null|null\s*==/g, sev:'medium', title:'Loose Null Comparison (== null)', desc:'Using == null matches both null and undefined. This may cause unintended matches. Prefer strict equality.', fix:'Use === null for explicit null checks, or handle both cases intentionally.', before:'if (value == null)', after:'if (value === null || value === undefined)' },
            { pattern: /catch\s*\(.*\)\s*\{?\s*\}/g, sev:'medium', title:'Empty catch Block', desc:'Swallowing exceptions silently makes debugging very difficult and hides errors from users.', fix:'Log the error or handle it appropriately in the catch block.', before:'catch (e) {}', after:'catch (e) { console.error("Error:", e); throw e; }' },
            { pattern: /\bvar\b/g, sev:'low', title:'var Usage (Prefer let/const)', desc:'var has function scope and hoisting which can lead to unexpected behavior. let and const have block scope.', fix:'Replace var with let (mutable) or const (immutable).', before:'var count = 0', after:'let count = 0' },
        );
    }

    if (checks.perf) {
        RULES.push(
            { pattern: /document\.getElementById|document\.querySelector/g, sev:'low', title:'DOM Query in Loop', desc:'Calling document.getElementById inside a loop forces the browser to traverse the DOM repeatedly.', fix:'Cache the DOM reference outside the loop.', before:'for(let i=0;i<n;i++) { document.getElementById("el").style... }', after:'const el = document.getElementById("el");\nfor(let i=0;i<n;i++) { el.style... }' },
            { pattern: /JSON\.parse\(JSON\.stringify/g, sev:'medium', title:'Inefficient Deep Clone', desc:'JSON.parse(JSON.stringify(...)) is slow for large objects and doesn\'t handle Dates, Functions, or circular references.', fix:'Use structuredClone() (modern browsers) or a library like lodash.cloneDeep.', before:'const copy = JSON.parse(JSON.stringify(obj))', after:'const copy = structuredClone(obj)' },
        );
    }

    if (checks.style) {
        RULES.push(
            { pattern: /function\s+\w+\s*\([^)]*\)\s*\{[^}]{200,}/g, sev:'low', title:'Function Too Long', desc:'Long functions are harder to test, understand, and maintain. Consider extracting logical blocks into smaller functions.', fix:'Break the function into smaller, single-purpose functions.', before:'function doEverything() { /* 200+ lines */ }', after:'function step1() {...}\nfunction step2() {...}\nfunction orchestrate() { step1(); step2(); }' },
            { pattern: /console\.log\(/g, sev:'low', title:'console.log Left in Code', desc:'Debug console.log statements should be removed or replaced with a proper logging library before production.', fix:'Remove debug logs or use a configurable logger (e.g., winston, pino).', before:'console.log("debug:", value)', after:'logger.debug("value processed", { value })' },
        );
    }

    RULES.forEach(rule => {
        let match;
        const re = new RegExp(rule.pattern.source, rule.pattern.flags);
        while ((match = re.exec(code)) !== null) {
            const lineNo = code.slice(0, match.index).split('\n').length;
            // Deduplicate by title + line
            const key = `${rule.title}:${lineNo}`;
            if (!issues.find(i => `${i.title}:${i.line}` === key)) {
                issues.push({ ...rule, line: lineNo, matchedText: match[0].slice(0, 60) });
            }
        }
    });

    // Sort by severity
    const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
    issues.sort((a, b) => ORDER[a.sev] - ORDER[b.sev]);
    return issues;
}

// ── Render Results ────────────────────────────
let allIssues = [];

function renderResults(issues) {
    allIssues = issues;
    document.getElementById('results-placeholder').classList.add('hidden');
    document.getElementById('results-content').classList.remove('hidden');
    document.getElementById('export-results-btn').classList.remove('hidden');

    updateSummary(issues);
    renderIssuesList(issues);
    document.getElementById('issues-summary').classList.remove('hidden');
}

function updateSummary(issues) {
    const counts = { critical:0, high:0, medium:0, low:0 };
    issues.forEach(i => counts[i.sev]++);
    document.getElementById('cnt-critical').textContent = counts.critical;
    document.getElementById('cnt-high').textContent     = counts.high;
    document.getElementById('cnt-medium').textContent   = counts.medium;
    document.getElementById('cnt-low').textContent      = counts.low;
    document.getElementById('results-count').textContent = `${issues.length} issue${issues.length !== 1 ? 's' : ''} found`;

    const score = Math.max(0, 100 - counts.critical * 25 - counts.high * 10 - counts.medium * 4 - counts.low * 1);
    const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
    document.getElementById('summary-score').innerHTML = `<span style="color:${scoreColor};font-size:1.3em;font-weight:800;">${score}/100</span> Code Health Score`;
}

function renderIssuesList(issues) {
    const list = document.getElementById('issues-list');
    list.innerHTML = '';
    if (!issues.length) {
        list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--accent-green);"><div style="font-size:2.5em;margin-bottom:12px;">✅</div><strong>No issues detected</strong><p style="color:var(--text-muted);margin-top:8px;font-size:0.9em;">Your code passed all selected checks.</p></div>';
        return;
    }
    issues.forEach((issue, idx) => {
        const card = document.createElement('div');
        card.className = `issue-card sev-${issue.sev}`;
        card.dataset.sev = issue.sev;
        card.innerHTML = `
            <div class="issue-header" onclick="toggleIssue(this)">
                <span class="issue-sev-badge">${issue.sev.toUpperCase()}</span>
                <span class="issue-title">${escHtml(issue.title)}</span>
                <span class="issue-line">Line ${issue.line}</span>
                <svg class="issue-expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
            </div>
            <div class="issue-body">
                <p class="issue-desc">${escHtml(issue.desc)}</p>
                <div class="issue-diff-label">BEFORE (problematic)</div>
                <div class="issue-diff">
                    <div class="diff-before"><span class="diff-marker-before">−</span><code>${escHtml(issue.before)}</code></div>
                    <div class="diff-after"><span class="diff-marker-after">+</span><code>${escHtml(issue.after)}</code></div>
                </div>
                <div class="issue-suggestion"><strong>Fix:</strong> ${escHtml(issue.fix)}</div>
            </div>`;
        list.appendChild(card);
    });
}

window.toggleIssue = function(header) {
    const card = header.closest('.issue-card');
    card.classList.toggle('expanded');
};

// Filter buttons
document.querySelectorAll('.rf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.rf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const sev = btn.dataset.sev;
        const filtered = sev === 'all' ? allIssues : allIssues.filter(i => i.sev === sev);
        renderIssuesList(filtered);
        document.getElementById('results-count').textContent = `${filtered.length} issue${filtered.length !== 1 ? 's' : ''} shown`;
    });
});

// Export
document.getElementById('export-results-btn').addEventListener('click', () => {
    const report = {
        analyzedAt: new Date().toISOString(),
        language: document.getElementById('language-select').value,
        totalIssues: allIssues.length,
        issues: allIssues.map(i => ({ severity: i.sev, title: i.title, line: i.line, description: i.desc, fix: i.fix }))
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `code-analysis-${Date.now()}.json`;
    a.click();
});

function resetResults() {
    document.getElementById('results-placeholder').classList.remove('hidden');
    document.getElementById('results-content').classList.add('hidden');
    document.getElementById('issues-summary').classList.add('hidden');
    document.getElementById('export-results-btn').classList.add('hidden');
    allIssues = [];
    lineNums.innerHTML = '1';
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = String(s || '');
    return d.innerHTML;
}

// CSS spin animation injection
const style = document.createElement('style');
style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(style);
