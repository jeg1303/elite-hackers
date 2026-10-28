/* =====================================================
   ELITE HACKERS — Workspace App
   Server-backed auth  ·  Group channels  ·  Private DMs
   Real-time via WebSocket
   ===================================================== */
'use strict';

// ── Storage helpers ───────────────────────────
const Store = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del: (k)    => localStorage.removeItem(k)
};

// ── State ─────────────────────────────────────
let currentUser    = null;   // { username, name, initials }
let currentChannel = 'general';
let currentDmUser  = null;   // { username, name, initials } when in DM mode
let isDmMode       = false;
let ws             = null;
let wsReady        = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let tasks          = Store.get('eh_tasks', []);
let sharedFiles    = Store.get('eh_files', []);
let onlineUsers    = new Map();    // username → { name, initials }
let registeredUsers = [];          // all registered users from server
const sentMsgIds   = new Set();
let lastSender     = null;

// ── Utils ─────────────────────────────────────
function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function makeInitials(n) { return (n||'?').trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function formatBytes(b) { if(b<1024) return b+' B'; if(b<1048576) return (b/1024).toFixed(1)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
function getFileIcon(t='') {
    if(t.startsWith('image/')) return '🖼️';
    if(t.includes('pdf')) return '📄';
    if(t.includes('zip')||t.includes('rar')) return '🗜️';
    if(t.includes('word')||t.includes('document')) return '📝';
    if(t.includes('sheet')||t.includes('excel')) return '📊';
    if(t.includes('text')) return '📋';
    return '📁';
}
function getApiBase() {
    if (window.WS_BASE_URL) return window.WS_BASE_URL.replace('wss://','https://').replace('ws://','http://');
    if (!location.hostname || location.hostname === 'localhost') return 'http://localhost:8080';
    return `${location.protocol}//${location.host}`;
}

// ── Auth (server-backed) ───────────────────────
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

document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    const btn      = e.target.querySelector('button[type=submit]');
    btn.textContent = 'Signing in…'; btn.disabled = true;
    errEl.textContent = '';

    try {
        const r = await fetch(`${getApiBase()}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Login failed');
        loginSuccess(data.user);
    } catch(err) {
        errEl.textContent = err.message;
    } finally {
        btn.textContent = 'Sign In'; btn.disabled = false;
    }
});

document.getElementById('register-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name     = document.getElementById('reg-name').value.trim();
    const username = document.getElementById('reg-username').value.trim().toLowerCase();
    const password = document.getElementById('reg-password').value;
    const errEl    = document.getElementById('reg-error');
    const btn      = e.target.querySelector('button[type=submit]');
    btn.textContent = 'Creating…'; btn.disabled = true;
    errEl.textContent = '';

    if (name.length < 2)     { errEl.textContent = 'Name too short.'; btn.textContent='Create Account'; btn.disabled=false; return; }
    if (username.length < 3) { errEl.textContent = 'Username min 3 chars.'; btn.textContent='Create Account'; btn.disabled=false; return; }
    if (password.length < 6) { errEl.textContent = 'Password min 6 chars.'; btn.textContent='Create Account'; btn.disabled=false; return; }

    try {
        const r = await fetch(`${getApiBase()}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, username, password })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Registration failed');
        loginSuccess(data.user);
    } catch(err) {
        errEl.textContent = err.message;
    } finally {
        btn.textContent = 'Create Account'; btn.disabled = false;
    }
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
    renderDmSidebar();
}

// ── Navigation ─────────────────────────────────
document.querySelectorAll('.sb-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.sb-nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        isDmMode = false;
        currentDmUser = null;
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
    isDmMode = false; currentDmUser = null;
    currentChannel = ch;
    const nameEl    = document.getElementById('active-channel-name');
    const welcomeEl = document.getElementById('welcome-channel');
    const inputEl   = document.getElementById('chat-input');
    if (nameEl)    nameEl.textContent = ch;
    if (welcomeEl) welcomeEl.textContent = ch;
    if (inputEl)   inputEl.placeholder = `Message #${ch}…`;
    // Update topbar to show channel header
    updateChatTopbar({ type: 'channel', name: ch });
    lastSender = null;
    clearMessages();
    if (ws && ws.readyState === WebSocket.OPEN) {
        wsSend({ type: 'get_history', channel: ch });
    }
    // Clear unread badge
    const badge = document.querySelector(`.sb-nav-item[data-channel="${ch}"] .unread-badge`);
    if (badge) { badge.classList.add('hidden'); badge.textContent = '0'; }
}

// ── Open a private DM conversation ────────────
function openDm(targetUser) {
    isDmMode    = true;
    currentDmUser = targetUser; // { username, name, initials }

    // Deselect all sidebar items, highlight the DM user
    document.querySelectorAll('.sb-nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.dm-user-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.username === targetUser.username);
    });

    // Switch to chat view
    switchView('chat');
    const inputEl = document.getElementById('chat-input');
    if (inputEl) inputEl.placeholder = `Message ${targetUser.name}…`;

    updateChatTopbar({ type: 'dm', user: targetUser });
    lastSender = null;
    clearMessages();

    // Load DM history from server
    if (ws && ws.readyState === WebSocket.OPEN) {
        wsSend({ type: 'get_dm_history', with: targetUser.username });
    }
    document.getElementById('sidebar').classList.remove('open');
}

function updateChatTopbar(info) {
    const channelEl = document.getElementById('active-channel-name');
    if (!channelEl) return;
    if (info.type === 'dm') {
        channelEl.textContent = `${info.user.name}`;
        channelEl.style.color = 'var(--accent-purple)';
        // Add DM indicator icon
        const topbarChannel = document.querySelector('.topbar-channel');
        if (topbarChannel) {
            let icon = topbarChannel.querySelector('.dm-icon');
            if (!icon) {
                icon = document.createElement('span');
                icon.className = 'dm-icon';
                icon.style.cssText = 'background:#ede9fe;color:#7c3aed;font-family:var(--font-mono);font-size:.7em;padding:2px 8px;border-radius:100px;';
                topbarChannel.insertBefore(icon, channelEl);
            }
            icon.textContent = 'DM';
        }
    } else {
        channelEl.textContent = info.name;
        channelEl.style.color = '';
        const icon = document.querySelector('.dm-icon');
        if (icon) icon.remove();
    }
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

function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
    try {
        updateConnectionStatus('Connecting…', false);
        ws = new WebSocket(getWsUrl());
        ws.onopen = () => {
            wsReady = true;
            reconnectAttempts = 0;
            clearTimeout(reconnectTimer);
            updateConnectionStatus('', true);
            wsSend({ type: 'user_join', userName: currentUser.name, username: currentUser.username, initials: currentUser.initials, channel: currentChannel });
            wsSend({ type: 'get_history', channel: currentChannel });
            wsSend({ type: 'get_users' });
            syncLocalMessages();
        };
        ws.onmessage = e => {
            try { handleWsMessage(JSON.parse(e.data)); } catch(err) { console.error('WS parse:', err); }
        };
        ws.onclose = () => {
            wsReady = false;
            reconnectAttempts++;
            const delay = Math.min(30000, 2000 * reconnectAttempts);
            updateConnectionStatus(`Reconnecting…`, false);
            reconnectTimer = setTimeout(connectWebSocket, delay);
        };
        ws.onerror = () => { wsReady = false; updateConnectionStatus('Error', false); };
    } catch(e) {
        updateConnectionStatus('Failed', false);
        reconnectTimer = setTimeout(connectWebSocket, 5000);
    }
}

function syncLocalMessages() {
    ['general','random','certivaultid','mediflex','ai-analyzer'].forEach(ch => {
        const key = `eh_local_msgs_${ch}`;
        const local = Store.get(key, []);
        if (local.length) { local.forEach(m => wsSend({ ...m, type: 'message' })); Store.del(key); }
    });
}

// ── Handle incoming WS messages ────────────────
function handleWsMessage(data) {

    if (data.type === 'channel_history') {
        if (!isDmMode && data.channel === currentChannel) {
            lastSender = null; clearMessages();
            (data.messages || []).forEach(m => renderMessage(m, m.userName === currentUser.name || m.username === currentUser.username));
            scrollToBottom();
        }

    } else if (data.type === 'dm_history') {
        if (isDmMode && currentDmUser && data.with === currentDmUser.username) {
            lastSender = null; clearMessages();
            (data.messages || []).forEach(m => renderDmMessage(m));
            scrollToBottom();
        }

    } else if (data.type === 'message') {
        const msgId = data.msgId;
        if (msgId && sentMsgIds.has(msgId)) { sentMsgIds.delete(msgId); return; }
        if (!isDmMode && data.channel === currentChannel) {
            const isSelf = data.userName === currentUser.name || data.username === currentUser.username;
            if (!isSelf) { renderMessage(data, false); scrollToBottom(); }
        } else if (!isDmMode && data.channel !== currentChannel) {
            showUnread(data.channel);
        }

    } else if (data.type === 'dm') {
        const isMine = data.from === currentUser.username;
        // If already in this DM conversation, render immediately
        if (isDmMode && currentDmUser && (data.from === currentDmUser.username || data.to === currentDmUser.username)) {
            if (!isMine) { renderDmMessage(data); scrollToBottom(); }
        } else if (!isMine) {
            // Show notification badge on the sender's DM button
            showDmUnread(data.from, data.fromName);
        }

    } else if (data.type === 'user_join') {
        onlineUsers.set(data.username || data.userName, { name: data.userName, initials: makeInitials(data.userName) });
        updateOnlineCount();
        renderMembersView();
        renderDmSidebar();
        if (data.userName !== currentUser.name) appendSystemMsg(`${esc(data.userName)} joined`);

    } else if (data.type === 'user_left') {
        onlineUsers.delete(data.username || data.userName);
        updateOnlineCount();
        renderMembersView();
        renderDmSidebar();
        appendSystemMsg(`${esc(data.userName)} left`);

    } else if (data.type === 'user_list') {
        onlineUsers.clear();
        (data.users || []).forEach(u => {
            const uname = (typeof u === 'string') ? u : u.username;
            const udata = (typeof u === 'object') ? u : { name: u, initials: makeInitials(u) };
            onlineUsers.set(uname, udata);
        });
        updateOnlineCount();
        renderMembersView();
        renderDmSidebar();

    } else if (data.type === 'registered_users') {
        registeredUsers = data.users || [];
        renderDmSidebar();
        renderMembersView();

    } else if (data.type === 'kicked') {
        alert(`You were removed: ${data.reason || 'Kicked by admin'}`);
        Store.del('eh_session'); location.reload();

    } else if (data.type === 'channel_cleared') {
        if (!isDmMode && data.channel === currentChannel) { lastSender = null; clearMessages(); }
    }
}

// ── DM Sidebar ─────────────────────────────────
function renderDmSidebar() {
    const container = document.getElementById('dm-users-list');
    if (!container) return;

    // Merge registeredUsers + onlineUsers, exclude self
    const allUsers = new Map();
    registeredUsers.forEach(u => {
        if (u.username !== currentUser.username) allUsers.set(u.username, { username: u.username, name: u.name, initials: u.initials || makeInitials(u.name), online: false });
    });
    onlineUsers.forEach((udata, uname) => {
        if (uname !== currentUser.username) {
            const existing = allUsers.get(uname) || { username: uname, name: udata.name || uname, initials: udata.initials || makeInitials(udata.name || uname) };
            allUsers.set(uname, { ...existing, online: true });
        }
    });

    if (!allUsers.size) {
        container.innerHTML = '<div style="font-size:.75em;color:var(--text-muted);padding:8px 10px;">No users yet</div>';
        return;
    }

    // Sort: online first, then alphabetical
    const sorted = [...allUsers.values()].sort((a,b) => (b.online - a.online) || a.name.localeCompare(b.name));

    container.innerHTML = sorted.map(u => `
        <button class="dm-user-btn sb-nav-item" data-username="${esc(u.username)}" onclick="openDm(${JSON.stringify(u).replace(/"/g,'&quot;')})">
            <span class="dm-avatar">${esc(u.initials)}</span>
            <span class="dm-name">${esc(u.name)}</span>
            <span class="dm-status-dot ${u.online ? 'dm-online' : 'dm-offline'}"></span>
            <span class="unread-badge hidden dm-unread-${esc(u.username)}">0</span>
        </button>`).join('');
}

function showDmUnread(username, fromName) {
    // Re-render with badge
    const badge = document.querySelector(`.dm-unread-${username.replace(/[^a-z0-9]/gi,'_')}`);
    if (badge) {
        badge.classList.remove('hidden');
        badge.textContent = String(parseInt(badge.textContent || '0') + 1);
    } else {
        // User might not be in sidebar yet — add them
        if (!registeredUsers.find(u => u.username === username)) {
            registeredUsers.push({ username, name: fromName || username, initials: makeInitials(fromName || username) });
        }
        renderDmSidebar();
    }
}

// ── Chat UI helpers ────────────────────────────
function clearMessages() {
    const area = document.getElementById('messages-area');
    const label = isDmMode && currentDmUser ? `Direct Message with ${esc(currentDmUser.name)}` : `#${esc(currentChannel)}`;
    const sublabel = isDmMode ? 'This is the beginning of your private conversation.' : 'This is the beginning of the conversation. Say hello!';
    area.innerHTML = `
        <div class="messages-welcome">
            <div class="welcome-icon">${isDmMode ? '💬' : '#'}</div>
            <h3>${isDmMode ? '' : 'Welcome to '}${label}</h3>
            <p>${sublabel}</p>
        </div>`;
}

function renderMessage(msg, isSelf) {
    const area     = document.getElementById('messages-area');
    const name     = msg.userName || msg.name || 'Unknown';
    const text     = msg.message  || msg.text  || '';
    const initials = msg.initials || makeInitials(name);
    const time     = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
    const sameAsPrev = lastSender === name;
    lastSender = name;
    const welcome = area.querySelector('.messages-welcome');
    if (welcome) welcome.remove();
    if (sameAsPrev) {
        const lastBody = area.querySelector('.msg-group:last-child .msg-body');
        if (lastBody) { const l = document.createElement('div'); l.className='msg-text'; l.textContent=text; lastBody.appendChild(l); return; }
    }
    const div = document.createElement('div');
    div.className = 'msg-group';
    const avatarStyle = isSelf ? 'background:linear-gradient(135deg,#7c3aed,#a855f7);' : msg.isAdmin ? 'background:linear-gradient(135deg,#dc2626,#f97316);' : '';
    div.innerHTML = `
        <div style="display:flex;gap:10px;align-items:flex-start;">
            <div class="msg-avatar" style="${avatarStyle}">${esc(initials)}</div>
            <div style="flex:1;min-width:0;">
                <div class="msg-header">
                    <span class="msg-username" style="${isSelf?'color:#7c3aed;':msg.isAdmin?'color:#f97316;':''}">${esc(name)}</span>
                    <span class="msg-timestamp">${time}</span>
                </div>
                <div class="msg-body"><div class="msg-text">${esc(text)}</div></div>
            </div>
        </div>`;
    area.appendChild(div);
}

function renderDmMessage(msg) {
    const area = document.getElementById('messages-area');
    const isSelf = msg.from === currentUser.username;
    const name  = isSelf ? currentUser.name : (msg.fromName || msg.from || 'Unknown');
    const initials = isSelf ? currentUser.initials : (msg.fromInitials || makeInitials(name));
    const text  = msg.message || msg.text || '';
    const time  = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
    const welcome = area.querySelector('.messages-welcome');
    if (welcome) welcome.remove();
    const div = document.createElement('div');
    div.className = 'msg-group';
    div.innerHTML = `
        <div style="display:flex;gap:10px;align-items:flex-start;${isSelf?'flex-direction:row-reverse;':''}">
            <div class="msg-avatar" style="${isSelf?'background:linear-gradient(135deg,#7c3aed,#a855f7);':''}">${esc(initials)}</div>
            <div style="flex:1;min-width:0;${isSelf?'text-align:right;':''}">
                <div class="msg-header" style="${isSelf?'justify-content:flex-end;':''}">
                    <span class="msg-username" style="${isSelf?'color:#7c3aed;':''}">${esc(name)}</span>
                    <span class="msg-timestamp">${time}</span>
                </div>
                <div class="msg-body">
                    <div class="msg-text" style="${isSelf?'display:inline-block;background:linear-gradient(135deg,#7c3aed,#a855f7);color:white;border:none;':''}">${esc(text)}</div>
                </div>
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
    const badge = btn.querySelector('.unread-badge');
    if (!badge) return;
    badge.classList.remove('hidden');
    badge.textContent = String(parseInt(badge.textContent || '0') + 1);
}

function updateConnectionStatus(msg, connected) {
    let el = document.getElementById('ws-conn-status');
    if (!el) {
        el = document.createElement('span');
        el.id = 'ws-conn-status';
        el.style.cssText = 'font-family:var(--font-mono);font-size:.7em;';
        document.querySelector('.topbar-right')?.appendChild(el);
    }
    el.textContent = msg;
    el.style.color = connected ? '#059669' : '#d97706';
}

function updateOnlineCount() {
    const el = document.getElementById('online-count');
    if (el) el.textContent = Math.max(1, onlineUsers.size);
}

// ── Send message ───────────────────────────────
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text  = input.value.trim();
    if (!text) return;
    input.value = '';

    if (isDmMode && currentDmUser) {
        // Send private DM
        const msgId = `${currentUser.username}_dm_${Date.now()}`;
        const payload = {
            type:        'dm',
            to:          currentDmUser.username,
            message:     text,
            initials:    currentUser.initials,
            msgId,
            timestamp:   new Date().toISOString()
        };
        // Render immediately on our side
        renderDmMessage({ ...payload, from: currentUser.username, fromName: currentUser.name, fromInitials: currentUser.initials });
        scrollToBottom();
        wsSend(payload);
    } else {
        // Send group channel message
        const msgId = `${currentUser.username}_${Date.now()}`;
        sentMsgIds.add(msgId);
        const payload = {
            type:      'message',
            msgId,
            message:   text,
            text,
            channel:   currentChannel,
            userName:  currentUser.name,
            name:      currentUser.name,
            username:  currentUser.username,
            initials:  currentUser.initials,
            timestamp: new Date().toISOString()
        };
        renderMessage({ ...payload, isSelf: true }, true);
        lastSender = currentUser.name;
        scrollToBottom();
        if (ws && ws.readyState === WebSocket.OPEN) {
            wsSend(payload);
        } else {
            const k = `eh_local_msgs_${currentChannel}`;
            const l = Store.get(k, []);
            l.push(payload); Store.set(k, l);
            appendSystemMsg('⚡ Saved locally — will sync when reconnected');
            if (!ws || ws.readyState === WebSocket.CLOSED) connectWebSocket();
        }
    }
}

document.getElementById('send-message-btn').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

// ── File uploads ───────────────────────────────
document.getElementById('file-upload').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    handleFileShare(file, 'chat'); e.target.value = '';
});
document.getElementById('file-share-input').addEventListener('change', e => {
    Array.from(e.target.files).forEach(f => handleFileShare(f, 'files')); e.target.value = '';
});

function handleFileShare(file, ctx) {
    if (file.size > 5*1024*1024) { alert('Max 5MB for demo.'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
        const entry = { id: Date.now()+Math.random(), name: file.name, type: file.type, size: file.size, data: ev.target.result, sharedBy: currentUser.name, ts: new Date().toISOString(), channel: currentChannel };
        sharedFiles.push(entry);
        Store.set('eh_files', sharedFiles);
        if (ctx === 'chat') appendFileMsg(currentUser.name, entry, entry.ts);
        renderFilesView();
    };
    reader.readAsDataURL(file);
}

function appendFileMsg(name, file, ts) {
    const area = document.getElementById('messages-area');
    const time = ts ? new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
    const div  = document.createElement('div');
    div.className = 'msg-group';
    div.innerHTML = `
        <div style="display:flex;gap:10px;align-items:flex-start;">
            <div class="msg-avatar">${esc(makeInitials(name))}</div>
            <div style="flex:1;">
                <div class="msg-header"><span class="msg-username">${esc(name)}</span><span class="msg-timestamp">${time}</span></div>
                <div class="msg-body"><a class="msg-file" href="${file.data}" download="${esc(file.name)}">${getFileIcon(file.type)} ${esc(file.name)} <span style="color:var(--text-muted);font-size:.85em;">(${formatBytes(file.size)})</span></a></div>
            </div>
        </div>`;
    area.appendChild(div);
    scrollToBottom();
}

// ── Task Board ─────────────────────────────────
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
    const dlClass = (() => { if (!task.deadline) return ''; const now=new Date(); now.setHours(0,0,0,0); const diff=(new Date(task.deadline)-now)/86400000; return diff<0?'overdue':diff<=2?'soon':'ok'; })();
    const dlLabel = task.deadline ? new Date(task.deadline).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
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
            const s = list.closest('.task-column').dataset.status;
            const t = tasks.find(t => t.id === parseInt(d.dataset.id));
            if (t) { t.status = s; saveTasks(); renderTaskBoard(); }
        });
    });
}
function getDragAfter(container, y) {
    return [...container.querySelectorAll('.task-card:not(.dragging)')].reduce((cl,ch) => {
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
        document.getElementById('task-title-input').value = t.title;
        document.getElementById('task-desc-input').value  = t.description || '';
        document.getElementById('task-priority').value    = t.priority;
        document.getElementById('task-assign').value      = t.assignedTo || '';
        document.getElementById('task-status').value      = t.status;
        document.getElementById('task-deadline').value    = t.deadline || '';
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
    const allNames = new Set([
        ...registeredUsers.map(u => u.name),
        'Harish raj.S','Varsha S','Pramila.J','Vasundhara.L','Jegannaathan.S.J','Hari hara sudhan.S','Monisha.S'
    ]);
    allNames.forEach(n => { const o=document.createElement('option'); o.value=n; o.textContent=n; sel.appendChild(o); });
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
    return insights;
}

// ── Files ──────────────────────────────────────
function renderFilesView() {
    const list = document.getElementById('files-list');
    if (!list) return;
    if (!sharedFiles.length) { list.innerHTML='<div class="empty-state"><div class="empty-icon">📂</div><p>No files shared yet.</p></div>'; return; }
    list.innerHTML = '';
    [...sharedFiles].reverse().forEach(file => {
        const item = document.createElement('div'); item.className = 'file-item';
        item.innerHTML = `<div class="file-icon">${getFileIcon(file.type)}</div><div class="file-info"><div class="file-name">${esc(file.name)}</div><div class="file-meta">By ${esc(file.sharedBy)} · ${formatBytes(file.size)} · ${new Date(file.ts).toLocaleDateString()}</div></div><a class="file-download" href="${file.data}" download="${esc(file.name)}">Download</a>`;
        list.appendChild(item);
    });
}

// ── Members ────────────────────────────────────
const TEAM = [
    { name:'Harish raj.S',      username:'harishraj',    initials:'HR', portfolio:'https://harishraj2107.netlify.app/' },
    { name:'Varsha S',          username:'varshas',      initials:'VS', portfolio:'https://silly-mochi-a1dcef.netlify.app/' },
    { name:'Pramila.J',         username:'pramilaj',     initials:'PJ', portfolio:'https://portfolio-pramilaj.vercel.app/' },
    { name:'Vasundhara.L',      username:'vasundharal',  initials:'VL', portfolio:'https://vasundhara13.netlify.app/' },
    { name:'Jegannaathan.S.J',  username:'jegannaathan', initials:'JS', portfolio:'https://jegannaathan.netlify.app/' },
    { name:'Hari hara sudhan.S',username:'hariharasudhan',initials:'HS', portfolio:'https://hariharasudhan1.netlify.app/' },
    { name:'Monisha.S',         username:'monishas',     initials:'MS', portfolio:'https://monisha21.netlify.app/' },
];

function renderMembersView() {
    const grid = document.getElementById('members-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const all = new Map();
    TEAM.forEach(m => all.set(m.username, { ...m, online: onlineUsers.has(m.username) || onlineUsers.has(m.name) }));
    registeredUsers.forEach(u => {
        if (!all.has(u.username)) all.set(u.username, { name:u.name, username:u.username, initials:u.initials||makeInitials(u.name), online: onlineUsers.has(u.username) });
    });
    all.forEach(m => {
        const online = m.online || m.name === currentUser?.name;
        const div = document.createElement('div'); div.className = 'member-item';
        div.innerHTML = `<div class="member-item-avatar">${esc(m.initials||makeInitials(m.name))}</div><div class="member-item-name">${esc(m.name)}</div><div class="member-item-status ${online?'online':'offline'}">${online?'<span style="width:7px;height:7px;border-radius:50%;background:#059669;"></span>Online':'<span style="width:7px;height:7px;border-radius:50%;background:#94a3b8;"></span>Offline'}</div>${m.portfolio?`<a href="${m.portfolio}" target="_blank" rel="noopener" style="display:block;margin-top:8px;font-size:.75em;color:#2563eb;text-decoration:none;">Portfolio ↗</a>`:''}
        <button onclick='openDm(${JSON.stringify({ username: m.username, name: m.name, initials: m.initials||makeInitials(m.name) }).replace(/'/g,"&#39;")})' style="margin-top:8px;width:100%;padding:5px;border-radius:6px;background:#eff6ff;border:1px solid #bfdbfe;color:#2563eb;font-size:.75em;cursor:pointer;">💬 Message</button>`;
        grid.appendChild(div);
    });
}
