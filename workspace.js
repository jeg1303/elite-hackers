/* =====================================================
   ELITE HACKERS — Workspace App
   Real-time multi-user chat via WebSocket
   Auth · Chat · Tasks · Files · Members
   ===================================================== */
'use strict';

// ── Storage Helpers ───────────────────────────
const Store = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del: (k)    => localStorage.removeItem(k)
};

// ── State ─────────────────────────────────────
let currentUser    = null;
let currentChannel = 'general';
let ws             = null;
let wsReady        = false;
let tasks          = Store.get('eh_tasks', []);
let sharedFiles    = Store.get('eh_files', []);
let onlineUsers    = new Map();

// ── Utils ──────────────────────────────────────
function makeInitials(name) {
    return (name || '?').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function esc(s) {
    const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML;
}
function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    return (b/1048576).toFixed(1) + ' MB';
}
function getFileIcon(t='') {
    if (t.startsWith('image/')) return '🖼️';
    if (t.includes('pdf'))       return '📄';
    if (t.includes('zip')||t.includes('rar')) return '🗜️';
    if (t.includes('word')||t.includes('document')) return '📝';
    if (t.includes('sheet')||t.includes('excel'))   return '📊';
    if (t.includes('text')) return '📋';
    if (t.includes('video')) return '🎬';
    if (t.includes('audio')) return '🎵';
    return '📁';
}

// ── Auth ──────────────────────────────────────
function getUsers() { return Store.get('eh_users', []); }
function saveUsers(u) { Store.set('eh_users', u); }

document.getElementById('tab-login').addEventListener('click', () => {
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('tab-register').classList.remove('active');
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
});
document.getElementById('tab-register').addEventListener('click', () => {
    document.getElementById('tab-register').classList.add('active');
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('login-form').classList.add('hidden');
});

document.getElementById('login-form').addEventListener('submit', e => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    const user     = getUsers().find(u => u.username === username && u.password === password);
    if (!user) { errEl.textContent = 'Invalid username or password.'; return; }
    errEl.textContent = '';
    loginSuccess(user);
});

document.getElementById('register-form').addEventListener('submit', e => {
    e.preventDefault();
    const name     = document.getElementById('reg-name').value.trim();
    const username = document.getElementById('reg-username').value.trim().toLowerCase();
    const password = document.getElementById('reg-password').value;
    const errEl    = document.getElementById('reg-error');
    if (name.length < 2)     { errEl.textContent = 'Name too short.'; return; }
    if (username.length < 3) { errEl.textContent = 'Username min 3 chars.'; return; }
    if (password.length < 6) { errEl.textContent = 'Password min 6 chars.'; return; }
    const users = getUsers();
    if (users.find(u => u.username === username)) { errEl.textContent = 'Username taken.'; return; }
    const user = { name, username, password, initials: makeInitials(name), joinedAt: new Date().toISOString() };
    users.push(user); saveUsers(users);
    errEl.textContent = '';
    loginSuccess(user);
});

function loginSuccess(user) {
    currentUser = { username: user.username, name: user.name, initials: user.initials || makeInitials(user.name) };
    Store.set('eh_session', currentUser);
    showWorkspace();
}

document.getElementById('logout-btn').addEventListener('click', () => {
    Store.del('eh_session');
    if (ws) { try { ws.close(); } catch {} ws = null; }
    currentUser = null;
    document.getElementById('workspace-app').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
});

// ── Boot ──────────────────────────────────────
(function boot() {
    const session = Store.get('eh_session', null);
    if (session) { currentUser = session; showWorkspace(); }
    if (window.location.hash === '#tasks') setTimeout(() => switchView('tasks'), 400);
})();

// ── Show Workspace ─────────────────────────────
function showWorkspace() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('workspace-app').classList.remove('hidden');
    document.getElementById('sidebar-username').textContent = currentUser.name;
    document.getElementById('sidebar-avatar').textContent   = currentUser.initials;
    connectWebSocket();
    renderTaskBoard();
    renderFilesView();
    renderMembersView();
}

// ── Navigation ─────────────────────────────────
document.querySelectorAll('.sb-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.sb-nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const view    = btn.dataset.view;
        const channel = btn.dataset.channel;
        if (view === 'chat' && channel) switchChannel(channel);
        switchView(view);
        document.getElementById('sidebar').classList.remove('open');
    });
});
['sidebar-toggle','sidebar-toggle-tasks','sidebar-toggle-files','sidebar-toggle-members'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
});
function switchView(name) {
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.classList.add('hidden'); });
    const t = document.getElementById(`view-${name}`);
    if (t) { t.classList.remove('hidden'); t.classList.add('active'); }
}
function switchChannel(ch) {
    currentChannel = ch;
    document.getElementById('active-channel-name').textContent = ch;
    document.getElementById('welcome-channel').textContent     = ch;
    document.getElementById('chat-input').placeholder = `Message #${ch}...`;
    clearMessages();
    // Request history from server
    wsSend({ type: 'get_history', channel: ch });
}

// ── WebSocket ─────────────────────────────────
function getWsUrl() {
    if (window.WS_BASE_URL) return window.WS_BASE_URL;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (!location.hostname || location.hostname === 'localhost') return `${proto}//localhost:8080`;
    return `${proto}//${location.host}`;
}

function wsSend(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

let reconnectTimer = null;
function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.CONNECTING) return;
    try {
        ws = new WebSocket(getWsUrl());
        ws.onopen = () => {
            wsReady = true;
            clearTimeout(reconnectTimer);
            // Announce ourselves and request current channel history
            wsSend({ type: 'user_join', userName: currentUser.name, initials: currentUser.initials, channel: currentChannel });
            wsSend({ type: 'get_history', channel: currentChannel });
            updateConnectionBadge(true);
        };
        ws.onmessage = e => {
            try { handleWsMessage(JSON.parse(e.data)); } catch {}
        };
        ws.onclose = () => {
            wsReady = false;
            updateConnectionBadge(false);
            reconnectTimer = setTimeout(connectWebSocket, 3500);
        };
        ws.onerror = () => { wsReady = false; };
    } catch {}
}

// Track IDs of messages we sent ourselves to skip echoes from server
const sentMsgIds = new Set();

function handleWsMessage(data) {
    if (data.type === 'channel_history') {
        if (data.channel === currentChannel) {
            lastSender = null;
            clearMessages();
            (data.messages || []).forEach(m => {
                const isSelf = m.userName === currentUser.name;
                renderMessage(m, isSelf);
            });
            scrollToBottom();
        }

    } else if (data.type === 'message') {
        // Skip echo of our own optimistically-rendered message
        if (data.msgId && sentMsgIds.has(data.msgId)) {
            sentMsgIds.delete(data.msgId);
            return;
        }
        if (data.channel === currentChannel) {
            const isSelf = data.userName === currentUser.name;
            // Only render from server for OTHER users' messages
            // (our own messages were already rendered optimistically)
            if (!isSelf) {
                renderMessage(data, false);
                scrollToBottom();
            }
        } else {
            showUnread(data.channel);
        }

    } else if (data.type === 'user_join') {
        onlineUsers.set(data.userName, true);
        updateOnlineCount();
        renderMembersView();
        if (data.userName !== currentUser.name) {
            appendSystemMsg(`${esc(data.userName)} joined`);
        }

    } else if (data.type === 'user_left') {
        onlineUsers.delete(data.userName);
        updateOnlineCount();
        renderMembersView();
        appendSystemMsg(`${esc(data.userName)} left`);

    } else if (data.type === 'user_list') {
        onlineUsers.clear();
        (data.users || []).forEach(u => onlineUsers.set(u, true));
        updateOnlineCount();
        renderMembersView();

    } else if (data.type === 'kicked') {
        alert(`You were removed: ${data.reason || 'Kicked by admin'}`);
        Store.del('eh_session');
        location.reload();

    } else if (data.type === 'channel_cleared') {
        if (data.channel === currentChannel) {
            lastSender = null;
            clearMessages();
        }
    }
}

// ── Chat UI ───────────────────────────────────
function clearMessages() {
    const area = document.getElementById('messages-area');
    area.innerHTML = `
        <div class="messages-welcome">
            <div class="welcome-icon">#</div>
            <h3>Welcome to #${esc(currentChannel)}</h3>
            <p>This is the beginning of the conversation. Say hello!</p>
        </div>`;
}

let lastSender = null;
function renderMessage(msg, isSelf) {
    const area      = document.getElementById('messages-area');
    const name      = msg.userName || msg.name || 'Unknown';
    const text      = msg.message  || msg.text  || '';
    const initials  = msg.initials || makeInitials(name);
    const time      = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';
    const sameAsPrev = lastSender === name;
    lastSender = name;

    // Remove welcome banner on first message
    const welcome = area.querySelector('.messages-welcome');
    if (welcome) welcome.remove();

    if (sameAsPrev) {
        // Append text-only to last group
        const lastGroup = area.querySelector('.msg-group:last-child .msg-body');
        if (lastGroup) {
            const line = document.createElement('div');
            line.className = 'msg-text';
            line.textContent = text;
            lastGroup.appendChild(line);
            return;
        }
    }

    const div = document.createElement('div');
    div.className = 'msg-group';
    const avatarColor = isSelf
        ? 'background:linear-gradient(135deg,#7c3aed,#a855f7);'
        : msg.isAdmin
            ? 'background:linear-gradient(135deg,#ef4444,#f97316);'
            : '';
    div.innerHTML = `
        <div style="display:flex;gap:10px;align-items:flex-start;">
            <div class="msg-avatar" style="${avatarColor}">${esc(initials)}</div>
            <div style="flex:1;min-width:0;">
                <div class="msg-header">
                    <span class="msg-username" style="${isSelf?'color:var(--accent-purple);':''}${msg.isAdmin?'color:#f97316;':''}">${esc(name)}</span>
                    <span class="msg-timestamp">${time}</span>
                </div>
                <div class="msg-body"><div class="msg-text">${esc(text)}</div></div>
            </div>
        </div>`;
    area.appendChild(div);
}

function appendSystemMsg(html) {
    const area = document.getElementById('messages-area');
    const d = document.createElement('div');
    d.className = 'msg-group';
    d.innerHTML = `<div class="msg-body"><span class="msg-text system-msg">${html}</span></div>`;
    area.appendChild(d);
    scrollToBottom();
}

function scrollToBottom() {
    const area = document.getElementById('messages-area');
    area.scrollTop = area.scrollHeight;
}

function showUnread(channel) {
    const btn = document.querySelector(`.sb-nav-item[data-channel="${channel}"]`);
    if (!btn) return;
    let badge = btn.querySelector('.unread-badge');
    if (!badge) return;
    badge.classList.remove('hidden');
    badge.textContent = parseInt(badge.textContent || '0') + 1;
}

function updateConnectionBadge(connected) {
    const dot  = document.querySelector('.cta-dot, .online-dot');
    const span = document.getElementById('online-count');
    if (span) span.style.color = connected ? 'var(--accent-green)' : 'var(--accent-red)';
}

function updateOnlineCount() {
    const el = document.getElementById('online-count');
    if (el) el.textContent = Math.max(1, onlineUsers.size);
}

// ── Send Message ──────────────────────────────
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text  = input.value.trim();
    if (!text) return;

    const msgId = `${currentUser.username}_${Date.now()}`;
    sentMsgIds.add(msgId);

    const payload = {
        type:      'message',
        msgId,
        message:   text,
        text:      text,
        channel:   currentChannel,
        userName:  currentUser.name,
        name:      currentUser.name,
        initials:  currentUser.initials,
        timestamp: new Date().toISOString()
    };

    // Render our own message immediately (optimistic)
    renderMessage({ ...payload, isSelf: true }, true);
    lastSender = currentUser.name;
    scrollToBottom();

    // Clear unread badge for this channel
    const badge = document.querySelector(`.sb-nav-item[data-channel="${currentChannel}"] .unread-badge`);
    if (badge) { badge.classList.add('hidden'); badge.textContent = '0'; }

    wsSend(payload);
    input.value = '';
}

document.getElementById('send-message-btn').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

// Typing indicator
let typingTimer = null;
document.getElementById('chat-input').addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {}, 2000);
});

// ── File Upload in Chat ───────────────────────
document.getElementById('file-upload').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    handleFileShare(file, 'chat'); e.target.value = '';
});
document.getElementById('file-share-input').addEventListener('change', e => {
    Array.from(e.target.files).forEach(f => handleFileShare(f, 'files')); e.target.value = '';
});

function handleFileShare(file, ctx) {
    if (file.size > 5 * 1024 * 1024) { alert('Max 5MB for demo storage.'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
        const entry = {
            id: Date.now() + Math.random(), name: file.name, type: file.type,
            size: file.size, data: ev.target.result,
            sharedBy: currentUser.name, ts: new Date().toISOString(), channel: currentChannel
        };
        sharedFiles.push(entry);
        Store.set('eh_files', sharedFiles);
        if (ctx === 'chat') appendFileMsg(currentUser.name, entry, entry.ts);
        renderFilesView();
    };
    reader.readAsDataURL(file);
}

function appendFileMsg(name, file, ts) {
    const area = document.getElementById('messages-area');
    const time = ts ? new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';
    const div  = document.createElement('div');
    div.className = 'msg-group';
    div.innerHTML = `
        <div style="display:flex;gap:10px;align-items:flex-start;">
            <div class="msg-avatar">${esc(makeInitials(name))}</div>
            <div style="flex:1;">
                <div class="msg-header"><span class="msg-username">${esc(name)}</span><span class="msg-timestamp">${time}</span></div>
                <div class="msg-body">
                    <a class="msg-file" href="${file.data}" download="${esc(file.name)}">
                        ${getFileIcon(file.type)} ${esc(file.name)}
                        <span style="color:var(--text-muted);font-size:0.85em;">(${formatBytes(file.size)})</span>
                    </a>
                </div>
            </div>
        </div>`;
    area.appendChild(div);
    scrollToBottom();
}

// ── Task Board ────────────────────────────────
let editingTaskId = null;

function renderTaskBoard() {
    ['todo','inprogress','review','done'].forEach(status => {
        const list = document.getElementById(`list-${status}`);
        if (!list) return;
        list.innerHTML = '';
        const filtered = tasks.filter(t => t.status === status);
        const cnt = document.getElementById(`count-${status}`);
        if (cnt) cnt.textContent = filtered.length;
        filtered.forEach(t => list.appendChild(createTaskCard(t)));
    });
    setupDnD();
}

function createTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'task-card'; card.draggable = true; card.dataset.id = task.id;
    const dlClass = getDeadlineClass(task.deadline);
    const dlLabel = task.deadline ? formatDeadline(task.deadline) : '';
    card.innerHTML = `
        <div class="task-card-title">${esc(task.title)}</div>
        <div class="task-card-meta">
            <span class="task-priority p-${task.priority}">${task.priority}</span>
            ${task.assignedTo ? `<span class="task-assignee">→ ${esc(task.assignedTo)}</span>` : ''}
            ${task.deadline   ? `<span class="task-deadline ${dlClass}">${dlLabel}</span>` : ''}
        </div>
        ${task.description ? `<div style="font-size:.78em;color:var(--text-muted);margin-top:6px;line-height:1.4;">${esc(task.description.slice(0,80))}${task.description.length>80?'…':''}</div>` : ''}
        <div class="task-card-actions">
            <button class="tc-action tc-edit" onclick="openTaskModal('',${task.id})">Edit</button>
            <button class="tc-action tc-delete" onclick="deleteTask(${task.id})">Delete</button>
        </div>`;
    return card;
}

function getDeadlineClass(dl) {
    if (!dl) return '';
    const now = new Date(); now.setHours(0,0,0,0);
    const d = new Date(dl);
    const diff = (d - now) / 86400000;
    return diff < 0 ? 'overdue' : diff <= 2 ? 'soon' : 'ok';
}
function formatDeadline(dl) {
    return new Date(dl).toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

function setupDnD() {
    document.querySelectorAll('.task-card').forEach(c => {
        c.addEventListener('dragstart', () => c.classList.add('dragging'));
        c.addEventListener('dragend',   () => c.classList.remove('dragging'));
    });
    document.querySelectorAll('.task-list').forEach(list => {
        list.addEventListener('dragover', e => {
            e.preventDefault(); list.classList.add('drag-over');
            const after = getDragAfter(list, e.clientY);
            const d = document.querySelector('.task-card.dragging');
            if (d) { after ? list.insertBefore(d, after) : list.appendChild(d); }
        });
        list.addEventListener('dragleave', () => list.classList.remove('drag-over'));
        list.addEventListener('drop', e => {
            e.preventDefault(); list.classList.remove('drag-over');
            const d = document.querySelector('.task-card.dragging');
            if (!d) return;
            const s  = list.closest('.task-column').dataset.status;
            const t  = tasks.find(t => t.id === parseInt(d.dataset.id));
            if (t) { t.status = s; saveTasks(); renderTaskBoard(); }
        });
    });
}
function getDragAfter(container, y) {
    return [...container.querySelectorAll('.task-card:not(.dragging)')].reduce((cl, ch) => {
        const box = ch.getBoundingClientRect();
        const off = y - box.top - box.height/2;
        return off < 0 && off > cl.offset ? { offset:off, element:ch } : cl;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

window.openTaskModal = function(defaultStatus='', editId='') {
    editingTaskId = editId || null;
    document.getElementById('task-form').reset();
    if (editId) {
        const t = tasks.find(t => t.id === parseInt(editId));
        if (!t) return;
        document.getElementById('task-modal-title').textContent = 'Edit Task';
        document.getElementById('task-title-input').value  = t.title;
        document.getElementById('task-desc-input').value   = t.description || '';
        document.getElementById('task-priority').value     = t.priority;
        document.getElementById('task-assign').value       = t.assignedTo || '';
        document.getElementById('task-status').value       = t.status;
        document.getElementById('task-deadline').value     = t.deadline || '';
    } else {
        document.getElementById('task-modal-title').textContent = 'Create Task';
        if (defaultStatus) document.getElementById('task-status').value = defaultStatus;
    }
    populateAssignSelect();
    document.getElementById('task-modal-overlay').classList.remove('hidden');
};
window.closeTaskModal = function() {
    document.getElementById('task-modal-overlay').classList.add('hidden');
    editingTaskId = null;
};
function populateAssignSelect() {
    const sel = document.getElementById('task-assign');
    sel.innerHTML = '<option value="">Unassigned</option>';
    const names = [...new Set([
        ...getUsers().map(u => u.name),
        'Harish raj.S','Varsha S','Pramila.J','Vasundhara.L','Jegannaathan.S.J','Hari hara sudhan.S','Monisha.S'
    ])];
    names.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
}

document.getElementById('task-form').addEventListener('submit', e => {
    e.preventDefault();
    const title    = document.getElementById('task-title-input').value.trim();
    const desc     = document.getElementById('task-desc-input').value.trim();
    const priority = document.getElementById('task-priority').value;
    const assigned = document.getElementById('task-assign').value;
    const status   = document.getElementById('task-status').value;
    const deadline = document.getElementById('task-deadline').value;
    if (!title) return;
    if (editingTaskId) {
        const t = tasks.find(t => t.id === parseInt(editingTaskId));
        if (t) Object.assign(t, { title, description:desc, priority, assignedTo:assigned, status, deadline, updatedAt:new Date().toISOString() });
    } else {
        tasks.push({ id:Date.now(), title, description:desc, priority, assignedTo:assigned, status, deadline, createdAt:new Date().toISOString(), createdBy:currentUser.name });
    }
    saveTasks(); renderTaskBoard(); closeTaskModal();
});
window.deleteTask = function(id) {
    if (!confirm('Delete this task?')) return;
    tasks = tasks.filter(t => t.id !== id); saveTasks(); renderTaskBoard();
};
function saveTasks() { Store.set('eh_tasks', tasks); }
document.getElementById('btn-create-task').addEventListener('click', () => openTaskModal());

// Smart Analyzer
document.getElementById('analyze-btn').addEventListener('click', () => {
    const res = document.getElementById('analyzer-results');
    res.innerHTML = '';
    analyzeTasksSmartly().forEach(ins => {
        const d = document.createElement('div');
        d.className = `analyzer-insight ${ins.type}`;
        d.innerHTML = `<span class="insight-icon">${ins.icon}</span><span class="insight-text">${ins.message}</span>`;
        res.appendChild(d);
    });
    res.classList.remove('hidden');
});
function analyzeTasksSmartly() {
    const insights = [];
    if (!tasks.length) return [{ type:'', icon:'📋', message:'<strong>No tasks yet.</strong> Create some tasks to begin analysis.' }];
    const done = tasks.filter(t=>t.status==='done').length;
    const rate = Math.round((done/tasks.length)*100);
    insights.push({ type:rate>=60?'success':'', icon:'📊', message:`<strong>Progress:</strong> ${done}/${tasks.length} tasks complete (${rate}%).` });
    const now = new Date(); now.setHours(0,0,0,0);
    const overdue = tasks.filter(t=>t.deadline&&new Date(t.deadline)<now&&t.status!=='done');
    if (overdue.length) insights.push({ type:'danger', icon:'🚨', message:`<strong>Overdue:</strong> ${overdue.map(t=>t.title).slice(0,3).join(', ')}` });
    else insights.push({ type:'success', icon:'✅', message:'<strong>No overdue tasks!</strong>' });
    const critical = tasks.filter(t=>t.priority==='critical'&&t.status!=='done');
    if (critical.length) insights.push({ type:'danger', icon:'🔥', message:`<strong>${critical.length} critical task${critical.length>1?'s':''}</strong> need urgent attention.` });
    const wl = {}; tasks.filter(t=>t.assignedTo&&t.status!=='done').forEach(t=>{ wl[t.assignedTo]=(wl[t.assignedTo]||0)+1; });
    const we = Object.entries(wl);
    if (we.length>1) { const max=Math.max(...we.map(e=>e[1])); const min=Math.min(...we.map(e=>e[1])); if(max-min>=3) insights.push({ type:'warning', icon:'⚖️', message:`<strong>Workload imbalance:</strong> ${we.find(e=>e[1]===max)[0]} has ${max} open tasks.` }); }
    return insights;
}

// ── Files ──────────────────────────────────────
function renderFilesView() {
    const list = document.getElementById('files-list');
    if (!list) return;
    if (!sharedFiles.length) { list.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>No files shared yet.</p></div>'; return; }
    list.innerHTML = '';
    [...sharedFiles].reverse().forEach(file => {
        const item = document.createElement('div'); item.className = 'file-item';
        item.innerHTML = `<div class="file-icon">${getFileIcon(file.type)}</div><div class="file-info"><div class="file-name">${esc(file.name)}</div><div class="file-meta">By ${esc(file.sharedBy)} · ${formatBytes(file.size)} · ${new Date(file.ts).toLocaleDateString()}</div></div><a class="file-download" href="${file.data}" download="${esc(file.name)}">Download</a>`;
        list.appendChild(item);
    });
}

// ── Members ────────────────────────────────────
const TEAM = [
    { name:'Harish raj.S',      initials:'HR', portfolio:'https://harishraj2107.netlify.app/' },
    { name:'Varsha S',          initials:'VS', portfolio:'https://silly-mochi-a1dcef.netlify.app/' },
    { name:'Pramila.J',         initials:'PJ', portfolio:'https://portfolio-pramilaj.vercel.app/' },
    { name:'Vasundhara.L',      initials:'VL', portfolio:'https://vasundhara13.netlify.app/' },
    { name:'Jegannaathan.S.J',  initials:'JS', portfolio:'https://jegannaathan.netlify.app/' },
    { name:'Hari hara sudhan.S',initials:'HS', portfolio:'https://hariharasudhan1.netlify.app/' },
    { name:'Monisha.S',         initials:'MS', portfolio:'https://monisha21.netlify.app/' },
];
function renderMembersView() {
    const grid = document.getElementById('members-grid');
    if (!grid) return;
    grid.innerHTML = '';
    // Show team + any registered users
    const all = [...TEAM];
    getUsers().forEach(u => { if (!all.find(m => m.name === u.name)) all.push({ name:u.name, initials:u.initials||makeInitials(u.name) }); });
    all.forEach(m => {
        const online = onlineUsers.has(m.name) || m.name === currentUser?.name;
        const div = document.createElement('div'); div.className = 'member-item';
        div.innerHTML = `<div class="member-item-avatar">${esc(m.initials||makeInitials(m.name))}</div><div class="member-item-name">${esc(m.name)}</div><div class="member-item-status ${online?'online':'offline'}">${online?'<span style="width:7px;height:7px;border-radius:50%;background:var(--accent-green);box-shadow:0 0 6px var(--accent-green);"></span>Online':'<span style="width:7px;height:7px;border-radius:50%;background:var(--text-muted);"></span>Offline'}</div>${m.portfolio?`<a href="${m.portfolio}" target="_blank" rel="noopener" style="display:block;margin-top:10px;font-size:.75em;color:var(--accent-blue);text-decoration:none;">Portfolio ↗</a>`:''}`;
        grid.appendChild(div);
    });
}
