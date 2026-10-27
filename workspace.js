/* =====================================================
   ELITE HACKERS — Workspace App JavaScript
   Auth • Chat • Tasks • Files • Members
   Persistence via localStorage + WebSocket (server.js)
   ===================================================== */

'use strict';

// ── Storage Helpers ────────────────────────────
const Store = {
    get: (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del: (k) => localStorage.removeItem(k)
};

// ── State ─────────────────────────────────────
let currentUser = null;     // { username, name, initials }
let currentChannel = 'general';
let ws = null;
let tasks = Store.get('eh_tasks', []);
let sharedFiles = Store.get('eh_files', []);
let channelMessages = Store.get('eh_messages', {});
let onlineUsers = new Map();

// ── Auth ──────────────────────────────────────
function getUsers() { return Store.get('eh_users', []); }
function saveUsers(u) { Store.set('eh_users', u); }

function makeInitials(name) {
    return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

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

document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');

    const users = getUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) { errEl.textContent = 'Invalid username or password.'; return; }
    errEl.textContent = '';
    loginSuccess(user);
});

document.getElementById('register-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name     = document.getElementById('reg-name').value.trim();
    const username = document.getElementById('reg-username').value.trim().toLowerCase();
    const password = document.getElementById('reg-password').value;
    const errEl    = document.getElementById('reg-error');

    if (!name || name.length < 2)     { errEl.textContent = 'Please enter a valid name.'; return; }
    if (!username || username.length < 3) { errEl.textContent = 'Username must be at least 3 characters.'; return; }
    if (password.length < 6)           { errEl.textContent = 'Password must be at least 6 characters.'; return; }

    const users = getUsers();
    if (users.find(u => u.username === username)) { errEl.textContent = 'Username already taken.'; return; }

    const user = { name, username, password, initials: makeInitials(name), joinedAt: new Date().toISOString() };
    users.push(user);
    saveUsers(users);
    errEl.textContent = '';
    loginSuccess(user);
});

function loginSuccess(user) {
    currentUser = { username: user.username, name: user.name, initials: user.initials };
    Store.set('eh_session', currentUser);
    showWorkspace();
}

document.getElementById('logout-btn').addEventListener('click', () => {
    Store.del('eh_session');
    currentUser = null;
    if (ws) { ws.close(); ws = null; }
    document.getElementById('workspace-app').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
});

// ── Boot ──────────────────────────────────────
(function boot() {
    const session = Store.get('eh_session', null);
    if (session) { currentUser = session; showWorkspace(); }

    // Check if deep-linked to #tasks
    if (window.location.hash === '#tasks') {
        setTimeout(() => switchView('tasks'), 300);
    }
})();

// ── Show Workspace ─────────────────────────────
function showWorkspace() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('workspace-app').classList.remove('hidden');

    // Update sidebar user info
    document.getElementById('sidebar-username').textContent = currentUser.name;
    document.getElementById('sidebar-avatar').textContent = currentUser.initials;

    connectWebSocket();
    renderTaskBoard();
    renderFilesView();
    renderMembersView();

    // Load saved messages
    channelMessages = Store.get('eh_messages', {});
    loadChannelMessages('general');
}

// ── Navigation ─────────────────────────────────
document.querySelectorAll('.sb-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        const view    = btn.dataset.view;
        const channel = btn.dataset.channel;

        document.querySelectorAll('.sb-nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (view === 'chat' && channel) {
            currentChannel = channel;
            document.getElementById('active-channel-name').textContent = channel;
            document.getElementById('welcome-channel').textContent = channel;
            document.getElementById('chat-input').placeholder = `Message #${channel}...`;
            loadChannelMessages(channel);
        }
        switchView(view);

        // Close mobile sidebar
        document.getElementById('sidebar').classList.remove('open');
    });
});

// Sidebar toggles (mobile)
['sidebar-toggle', 'sidebar-toggle-tasks', 'sidebar-toggle-files', 'sidebar-toggle-members'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });
});

function switchView(name) {
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.classList.add('hidden'); });
    const target = document.getElementById(`view-${name}`);
    if (target) { target.classList.remove('hidden'); target.classList.add('active'); }
}

// ── WebSocket Connection ───────────────────────
function getWsUrl() {
    if (window.WS_BASE_URL) return window.WS_BASE_URL;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host  = window.location.hostname;
    if (!host || host === 'localhost') return `${proto}//localhost:8080`;
    return `${proto}//${window.location.host}`;
}

function connectWebSocket() {
    try {
        ws = new WebSocket(getWsUrl());
        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'user_join', userName: currentUser.name, timestamp: new Date().toISOString() }));
            updateOnlineCount();
        };
        ws.onmessage = (e) => {
            try { handleWsMessage(JSON.parse(e.data)); } catch {}
        };
        ws.onclose = () => { setTimeout(connectWebSocket, 4000); };
        ws.onerror = () => {};
    } catch {}
}

function handleWsMessage(data) {
    switch (data.type) {
        case 'message':
            if (data.channel === currentChannel || !data.channel) {
                appendMessage(data.userName, data.message, data.timestamp, data.channel || 'general');
            }
            break;
        case 'user_join':
            appendSystemMessage(`${data.userName} joined the workspace`);
            onlineUsers.set(data.userName, true);
            updateOnlineCount();
            renderMembersView();
            break;
        case 'user_left':
            onlineUsers.delete(data.userName);
            updateOnlineCount();
            renderMembersView();
            break;
        case 'user_list':
            onlineUsers.clear();
            (data.users || []).forEach(u => onlineUsers.set(u, true));
            updateOnlineCount();
            break;
        case 'admin_response':
            appendMessage('Admin', data.message, data.timestamp, currentChannel);
            break;
    }
}

function updateOnlineCount() {
    document.getElementById('online-count').textContent = Math.max(1, onlineUsers.size + 1);
}

// ── Chat ──────────────────────────────────────
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text  = input.value.trim();
    if (!text) return;

    const msg = {
        username: currentUser.username,
        name: currentUser.name,
        initials: currentUser.initials,
        text,
        channel: currentChannel,
        ts: new Date().toISOString()
    };

    // Persist locally
    if (!channelMessages[currentChannel]) channelMessages[currentChannel] = [];
    channelMessages[currentChannel].push(msg);
    Store.set('eh_messages', channelMessages);

    // Render locally (instant)
    appendMessage(currentUser.name, text, msg.ts, currentChannel, true);

    // Broadcast via WS
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'message', message: text, channel: currentChannel, timestamp: msg.ts }));
    }
    input.value = '';
}

document.getElementById('send-message-btn').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

// File sharing in chat
document.getElementById('file-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    handleFileShare(file, 'chat');
    e.target.value = '';
});
document.getElementById('file-share-input').addEventListener('change', (e) => {
    Array.from(e.target.files).forEach(f => handleFileShare(f, 'files'));
    e.target.value = '';
});

function handleFileShare(file, context) {
    const reader = new FileReader();
    reader.onload = (ev) => {
        const entry = {
            id: Date.now() + Math.random(),
            name: file.name,
            type: file.type,
            size: file.size,
            data: ev.target.result,
            sharedBy: currentUser.name,
            ts: new Date().toISOString(),
            channel: currentChannel
        };
        sharedFiles.push(entry);
        Store.set('eh_files', sharedFiles);

        if (context === 'chat') {
            const msg = { username: currentUser.username, name: currentUser.name, initials: currentUser.initials, text: `__FILE__:${entry.id}`, channel: currentChannel, ts: entry.ts };
            if (!channelMessages[currentChannel]) channelMessages[currentChannel] = [];
            channelMessages[currentChannel].push(msg);
            Store.set('eh_messages', channelMessages);
            appendFileMessage(currentUser.name, entry, entry.ts);
        }
        renderFilesView();
    };
    if (file.size < 5 * 1024 * 1024) { // 5MB cap for localStorage
        reader.readAsDataURL(file);
    } else {
        alert('File is too large for demo storage (max 5MB). In production, files would upload to cloud storage.');
    }
}

function loadChannelMessages(channel) {
    const area = document.getElementById('messages-area');
    // Reset to welcome state
    area.innerHTML = `
        <div class="messages-welcome">
            <div class="welcome-icon">#</div>
            <h3>Welcome to #${channel}</h3>
            <p>This is the beginning of the conversation. Say hello!</p>
        </div>`;
    const msgs = channelMessages[channel] || [];
    msgs.forEach(msg => {
        if (msg.text.startsWith('__FILE__:')) {
            const fileId = msg.text.split(':')[1];
            const file = sharedFiles.find(f => String(f.id) === String(fileId));
            if (file) appendFileMessage(msg.name, file, msg.ts);
        } else {
            appendMessage(msg.name, msg.text, msg.ts, channel, msg.username === currentUser.username, true);
        }
    });
    area.scrollTop = area.scrollHeight;
}

function appendMessage(name, text, ts, channel, isSelf = false, noScroll = false) {
    const area = document.getElementById('messages-area');
    const time = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const initials = makeInitials(name);

    const div = document.createElement('div');
    div.className = 'msg-group';
    div.innerHTML = `
        <div style="display:flex;gap:10px;align-items:flex-start;">
            <div class="msg-avatar" style="${isSelf ? 'background:linear-gradient(135deg,#7c3aed,#a855f7);' : ''}">${initials}</div>
            <div style="flex:1;min-width:0;">
                <div class="msg-header">
                    <span class="msg-username" style="${isSelf ? 'color:var(--accent-purple);' : ''}">${escHtml(name)}</span>
                    <span class="msg-timestamp">${time}</span>
                </div>
                <div class="msg-body"><span class="msg-text">${escHtml(text)}</span></div>
            </div>
        </div>`;
    area.appendChild(div);
    if (!noScroll) area.scrollTop = area.scrollHeight;
}

function appendFileMessage(name, file, ts) {
    const area = document.getElementById('messages-area');
    const time = ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const initials = makeInitials(name);
    const icon = getFileIcon(file.type);
    const div = document.createElement('div');
    div.className = 'msg-group';
    div.innerHTML = `
        <div style="display:flex;gap:10px;align-items:flex-start;">
            <div class="msg-avatar">${initials}</div>
            <div style="flex:1;">
                <div class="msg-header">
                    <span class="msg-username">${escHtml(name)}</span>
                    <span class="msg-timestamp">${time}</span>
                </div>
                <div class="msg-body">
                    <a class="msg-file" href="${file.data}" download="${escHtml(file.name)}">
                        ${icon} ${escHtml(file.name)} <span style="color:var(--text-muted);font-size:0.85em;">(${formatBytes(file.size)})</span>
                    </a>
                </div>
            </div>
        </div>`;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
}

function appendSystemMessage(text) {
    const area = document.getElementById('messages-area');
    const div = document.createElement('div');
    div.className = 'msg-group';
    div.innerHTML = `<div class="msg-body"><span class="msg-text system-msg">${escHtml(text)}</span></div>`;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
}


// ── Task Board ────────────────────────────────
let editingTaskId = null;

function renderTaskBoard() {
    const columns = ['todo', 'inprogress', 'review', 'done'];
    columns.forEach(status => {
        const list = document.getElementById(`list-${status}`);
        if (!list) return;
        list.innerHTML = '';
        const filtered = tasks.filter(t => t.status === status);
        document.getElementById(`count-${status}`).textContent = filtered.length;
        filtered.forEach(t => { list.appendChild(createTaskCard(t)); });
    });
    setupDragAndDrop();
}

function createTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.draggable = true;
    card.dataset.id = task.id;

    const deadlineClass = getDeadlineClass(task.deadline);
    const deadlineLabel = task.deadline ? formatDeadline(task.deadline) : '';
    const assignee = task.assignedTo ? `<span class="task-assignee">→ ${escHtml(task.assignedTo)}</span>` : '';

    card.innerHTML = `
        <div class="task-card-title">${escHtml(task.title)}</div>
        <div class="task-card-meta">
            <span class="task-priority p-${task.priority}">${task.priority}</span>
            ${assignee}
            ${task.deadline ? `<span class="task-deadline ${deadlineClass}">${deadlineLabel}</span>` : ''}
        </div>
        ${task.description ? `<div style="font-size:0.78em;color:var(--text-muted);margin-top:6px;line-height:1.4;">${escHtml(task.description.slice(0,80))}${task.description.length>80?'…':''}</div>` : ''}
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
    const diff = (d - now) / (1000*60*60*24);
    if (diff < 0) return 'overdue';
    if (diff <= 2) return 'soon';
    return 'ok';
}
function formatDeadline(dl) {
    const d = new Date(dl);
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

// Drag & Drop
function setupDragAndDrop() {
    const cards = document.querySelectorAll('.task-card');
    const lists = document.querySelectorAll('.task-list');
    cards.forEach(card => {
        card.addEventListener('dragstart', () => card.classList.add('dragging'));
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    lists.forEach(list => {
        list.addEventListener('dragover', (e) => {
            e.preventDefault(); list.classList.add('drag-over');
            const dragging = document.querySelector('.task-card.dragging');
            const afterEl = getDragAfterEl(list, e.clientY);
            if (dragging) {
                if (afterEl) list.insertBefore(dragging, afterEl);
                else list.appendChild(dragging);
            }
        });
        list.addEventListener('dragleave', () => list.classList.remove('drag-over'));
        list.addEventListener('drop', (e) => {
            e.preventDefault(); list.classList.remove('drag-over');
            const dragging = document.querySelector('.task-card.dragging');
            if (!dragging) return;
            const newStatus = list.closest('.task-column').dataset.status;
            const taskId = parseInt(dragging.dataset.id);
            const task = tasks.find(t => t.id === taskId);
            if (task) { task.status = newStatus; saveTasks(); renderTaskBoard(); }
        });
    });
}

function getDragAfterEl(container, y) {
    const draggables = [...container.querySelectorAll('.task-card:not(.dragging)')];
    return draggables.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset, element: child };
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

window.openTaskModal = function(defaultStatus = '', editId = '') {
    editingTaskId = editId || null;
    const modal = document.getElementById('task-modal-overlay');
    const form  = document.getElementById('task-form');
    form.reset();

    if (editId) {
        const task = tasks.find(t => t.id === parseInt(editId));
        if (!task) return;
        document.getElementById('task-modal-title').textContent = 'Edit Task';
        document.getElementById('task-title-input').value = task.title;
        document.getElementById('task-desc-input').value = task.description || '';
        document.getElementById('task-priority').value = task.priority;
        document.getElementById('task-assign').value = task.assignedTo || '';
        document.getElementById('task-status').value = task.status;
        document.getElementById('task-deadline').value = task.deadline || '';
    } else {
        document.getElementById('task-modal-title').textContent = 'Create Task';
        if (defaultStatus) document.getElementById('task-status').value = defaultStatus;
    }

    // Populate assignees from registered users
    const assignSel = document.getElementById('task-assign');
    assignSel.innerHTML = '<option value="">Unassigned</option>';
    getUsers().forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.name; opt.textContent = u.name;
        assignSel.appendChild(opt);
    });
    // Always add team members
    ['Harish raj.S','Varsha S','Pramila.J','Vasundhara.L','Jegannaathan.S.J','Hari hara sudhan.S','Monisha.S'].forEach(name => {
        if (!getUsers().find(u => u.name === name)) {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            assignSel.appendChild(opt);
        }
    });

    modal.classList.remove('hidden');
};

window.closeTaskModal = function() {
    document.getElementById('task-modal-overlay').classList.add('hidden');
    editingTaskId = null;
};

document.getElementById('task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title    = document.getElementById('task-title-input').value.trim();
    const desc     = document.getElementById('task-desc-input').value.trim();
    const priority = document.getElementById('task-priority').value;
    const assigned = document.getElementById('task-assign').value;
    const status   = document.getElementById('task-status').value;
    const deadline = document.getElementById('task-deadline').value;

    if (!title) return;

    if (editingTaskId) {
        const task = tasks.find(t => t.id === parseInt(editingTaskId));
        if (task) { Object.assign(task, { title, description: desc, priority, assignedTo: assigned, status, deadline, updatedAt: new Date().toISOString() }); }
    } else {
        tasks.push({ id: Date.now(), title, description: desc, priority, assignedTo: assigned, status, deadline, createdAt: new Date().toISOString(), createdBy: currentUser.name });
    }
    saveTasks();
    renderTaskBoard();
    closeTaskModal();
});

window.deleteTask = function(id) {
    if (!confirm('Delete this task?')) return;
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    renderTaskBoard();
};

function saveTasks() { Store.set('eh_tasks', tasks); }

document.getElementById('btn-create-task').addEventListener('click', () => openTaskModal());

// ── Smart Task Analyzer ───────────────────────
document.getElementById('analyze-btn').addEventListener('click', () => {
    const resultsEl = document.getElementById('analyzer-results');
    resultsEl.innerHTML = '';
    const insights = analyzeTasksSmartly();
    insights.forEach(ins => {
        const div = document.createElement('div');
        div.className = `analyzer-insight ${ins.type}`;
        div.innerHTML = `<span class="insight-icon">${ins.icon}</span><span class="insight-text">${ins.message}</span>`;
        resultsEl.appendChild(div);
    });
    resultsEl.classList.remove('hidden');
});

function analyzeTasksSmartly() {
    const insights = [];
    const total = tasks.length;
    if (total === 0) { return [{ type:'', icon:'📋', message:'<strong>No tasks yet.</strong> Create some tasks to start analysis.' }]; }

    const todo       = tasks.filter(t => t.status === 'todo').length;
    const inprogress = tasks.filter(t => t.status === 'inprogress').length;
    const done       = tasks.filter(t => t.status === 'done').length;
    const review     = tasks.filter(t => t.status === 'review').length;

    const now = new Date(); now.setHours(0,0,0,0);
    const overdue = tasks.filter(t => t.deadline && new Date(t.deadline) < now && t.status !== 'done');
    const soon    = tasks.filter(t => t.deadline && t.status !== 'done' && (() => { const d = new Date(t.deadline); return (d - now) / 86400000 <= 2 && (d - now) >= 0; })());

    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;
    insights.push({ type: completionRate >= 60 ? 'success' : '', icon: '📊', message: `<strong>Progress:</strong> ${done}/${total} tasks complete (${completionRate}%). ${inprogress} in progress, ${review} in review, ${todo} to do.` });

    if (overdue.length > 0) {
        insights.push({ type: 'danger', icon: '🚨', message: `<strong>Overdue Alert:</strong> ${overdue.length} task${overdue.length>1?'s are':' is'} past deadline: <em>${overdue.slice(0,3).map(t=>t.title).join(', ')}${overdue.length>3?'…':''}</em>. Immediate attention needed.` });
    } else {
        insights.push({ type: 'success', icon: '✅', message: '<strong>No overdue tasks.</strong> Great job keeping deadlines on track!' });
    }

    if (soon.length > 0) {
        insights.push({ type: 'warning', icon: '⚠️', message: `<strong>Due Soon:</strong> ${soon.length} task${soon.length>1?'s':''} due within 2 days. Prioritize these to avoid delays.` });
    }

    // Workload imbalance
    const workloads = {};
    tasks.filter(t => t.assignedTo && t.status !== 'done').forEach(t => {
        workloads[t.assignedTo] = (workloads[t.assignedTo] || 0) + 1;
    });
    const wEntries = Object.entries(workloads);
    if (wEntries.length > 1) {
        const max = Math.max(...wEntries.map(e=>e[1]));
        const min = Math.min(...wEntries.map(e=>e[1]));
        if (max - min >= 3) {
            const busiest = wEntries.find(e=>e[1]===max);
            insights.push({ type: 'warning', icon: '⚖️', message: `<strong>Workload Imbalance:</strong> <em>${busiest[0]}</em> has ${busiest[1]} open tasks. Consider redistributing for balanced productivity.` });
        }
    }

    // Critical tasks
    const critical = tasks.filter(t => t.priority === 'critical' && t.status !== 'done');
    if (critical.length > 0) {
        insights.push({ type: 'danger', icon: '🔥', message: `<strong>${critical.length} Critical task${critical.length>1?'s':''}</strong> need urgent attention: <em>${critical.slice(0,2).map(t=>t.title).join(', ')}</em>.` });
    }

    // Suggestion
    const highTodo = tasks.filter(t => t.priority === 'high' && t.status === 'todo');
    if (highTodo.length > 0) {
        insights.push({ type: '', icon: '🎯', message: `<strong>Suggested Priority:</strong> Move "${highTodo[0].title}" to In Progress — it's high priority and still in backlog.` });
    }

    if (inprogress > 5) {
        insights.push({ type: 'warning', icon: '🔀', message: `<strong>High WIP (${inprogress} in progress).</strong> Consider finishing existing tasks before starting new ones to reduce context switching.` });
    }

    return insights;
}

// ── Files View ────────────────────────────────
function renderFilesView() {
    const list = document.getElementById('files-list');
    if (!list) return;
    if (sharedFiles.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><p>No files shared yet. Upload a file to get started.</p></div>';
        return;
    }
    list.innerHTML = '';
    [...sharedFiles].reverse().forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <div class="file-icon">${getFileIcon(file.type)}</div>
            <div class="file-info">
                <div class="file-name">${escHtml(file.name)}</div>
                <div class="file-meta">Shared by ${escHtml(file.sharedBy)} · ${formatBytes(file.size)} · ${new Date(file.ts).toLocaleDateString()}</div>
            </div>
            <a class="file-download" href="${file.data}" download="${escHtml(file.name)}">Download</a>`;
        list.appendChild(item);
    });
}

function getFileIcon(type = '') {
    if (type.startsWith('image/')) return '🖼️';
    if (type.includes('pdf'))  return '📄';
    if (type.includes('zip') || type.includes('rar')) return '🗜️';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('sheet') || type.includes('excel')) return '📊';
    if (type.includes('text')) return '📋';
    if (type.includes('video')) return '🎬';
    if (type.includes('audio')) return '🎵';
    return '📁';
}

// ── Members View ───────────────────────────────
const TEAM_MEMBERS = [
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
    TEAM_MEMBERS.forEach(m => {
        const isOnline = onlineUsers.has(m.name) || m.name === currentUser?.name;
        const div = document.createElement('div');
        div.className = 'member-item';
        div.innerHTML = `
            <div class="member-item-avatar">${m.initials}</div>
            <div class="member-item-name">${escHtml(m.name)}</div>
            <div class="member-item-status ${isOnline ? 'online' : 'offline'}">
                ${isOnline ? '<span style="width:7px;height:7px;border-radius:50%;background:var(--accent-green);box-shadow:0 0 6px var(--accent-green);"></span>Online' : '<span style="width:7px;height:7px;border-radius:50%;background:var(--text-muted);"></span>Offline'}
            </div>
            ${m.portfolio ? `<a href="${m.portfolio}" target="_blank" rel="noopener" style="display:block;margin-top:10px;font-size:0.75em;color:var(--accent-blue);text-decoration:none;">Portfolio ↗</a>` : ''}`;
        grid.appendChild(div);
    });
}

// ── Utilities ─────────────────────────────────
function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML;
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
