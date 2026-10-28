/* =====================================================
   ELITE HACKERS — Admin Panel JavaScript
   Full redesign: dashboard, live chat, users, projects,
   settings (password change, server status)
   ===================================================== */
'use strict';

// ── State ─────────────────────────────────────
let ws            = null;
let isAuthed      = false;
let onlineUsers   = new Map();
let allMessages   = [];      // { channel, userName, message, timestamp }
let projects      = [];
let currentAdminPw = sessionStorage.getItem('eh_admin_pw') || '';
let activeTab     = 'dashboard';
let activeChatCh  = 'general';
let editProjectId = null;
let messageCount  = 0;

// ── Utilities ──────────────────────────────────
function esc(s) { const d = document.createElement('div'); d.textContent = String(s??''); return d.innerHTML; }
function makeInitials(name) { return (name||'?').trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function getWsUrl() {
    if (window.WS_BASE_URL) return window.WS_BASE_URL;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (!location.hostname || location.hostname === 'localhost') return `${proto}//localhost:8080`;
    return `${proto}//${location.host}`;
}
function wsSend(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function setWsBadge(connected) {
    document.querySelectorAll('.ws-status-badge').forEach(b => {
        b.className = 'ws-status-badge' + (connected ? '' : ' offline');
        const txt = b.querySelector('.ws-dot') ? b : b;
        b.innerHTML = `<span class="ws-dot"></span> ${connected ? 'Connected' : 'Disconnected'}`;
    });
}

// ── Tab Navigation ─────────────────────────────
document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        activeTab = btn.dataset.tab;
        document.getElementById(`tab-${activeTab}`)?.classList.add('active');
        if (activeTab === 'chat') renderChatTab();
        if (activeTab === 'users') renderUsersTab();
        if (activeTab === 'projects') renderProjectsTab();
        if (activeTab === 'dashboard') renderDashboard();
    });
});

// ── Login ──────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', e => {
    e.preventDefault();
    const pw    = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    currentAdminPw = pw;
    // Connect WS first then authenticate
    connectWS(() => {
        wsSend({ type: 'admin_auth', password: pw });
    });
});

function connectWS(onOpenCb) {
    if (ws && ws.readyState === WebSocket.OPEN) { if (onOpenCb) onOpenCb(); return; }
    try {
        ws = new WebSocket(getWsUrl());
        ws.onopen = () => {
            setWsBadge(true);
            document.getElementById('info-host').textContent = getWsUrl();
            if (onOpenCb) onOpenCb();
        };
        ws.onmessage = e => {
            try { handleWsMsg(JSON.parse(e.data)); } catch {}
        };
        ws.onclose = () => {
            setWsBadge(false);
            setTimeout(() => { if (isAuthed) connectWS(); }, 3500);
        };
        ws.onerror = () => setWsBadge(false);
    } catch {}
}

function handleWsMsg(data) {
    switch (data.type) {

        case 'admin_auth_result':
            if (data.ok) {
                isAuthed = true;
                sessionStorage.setItem('eh_admin_pw', currentAdminPw);
                document.getElementById('login-screen').classList.add('hidden');
                document.getElementById('admin-app').classList.remove('hidden');
                document.getElementById('info-host').textContent = getWsUrl();
                renderDashboard();
            } else {
                document.getElementById('login-error').textContent = data.reason || 'Wrong password.';
            }
            break;

        case 'admin_change_password_result':
            const res = document.getElementById('pw-result');
            if (data.ok) {
                res.className = 'form-feedback success';
                res.textContent = '✓ Password updated successfully.';
                sessionStorage.setItem('eh_admin_pw', document.getElementById('new-password').value);
                document.getElementById('change-password-form').reset();
            } else {
                res.className = 'form-feedback error';
                res.textContent = '✗ ' + (data.reason || 'Failed.');
            }
            break;

        case 'channel_history':
            // Replace messages for that channel in our local store
            allMessages = allMessages.filter(m => m.channel !== data.channel);
            (data.messages || []).forEach(m => allMessages.push(m));
            messageCount = allMessages.length;
            if (activeTab === 'chat' && data.channel === activeChatCh) renderChatTab();
            if (activeTab === 'dashboard') renderDashboard();
            updateStatBadges();
            break;

        case 'message':
            allMessages.push(data);
            messageCount++;
            updateStatBadges();
            if (activeTab === 'chat' && data.channel === activeChatCh) appendChatMsg(data);
            if (activeTab === 'dashboard') prependDashMsg(data);
            // Show badge on chat nav button if not on chat tab
            if (activeTab !== 'chat') {
                const badge = document.getElementById('chat-badge');
                badge.classList.remove('hidden');
                badge.textContent = parseInt(badge.textContent||'0') + 1;
            }
            break;

        case 'user_list':
            onlineUsers.clear();
            (data.users || []).forEach(u => onlineUsers.set(u, { joinedAt: new Date().toISOString(), channel: 'general' }));
            updateStatBadges();
            if (activeTab === 'users') renderUsersTab();
            if (activeTab === 'dashboard') renderDashboard();
            updateMsgTargetDropdown();
            break;

        case 'user_join':
            onlineUsers.set(data.userName, { joinedAt: data.timestamp || new Date().toISOString(), channel: 'general' });
            updateStatBadges();
            if (activeTab === 'users') renderUsersTab();
            updateMsgTargetDropdown();
            break;

        case 'user_left':
            onlineUsers.delete(data.userName);
            updateStatBadges();
            if (activeTab === 'users') renderUsersTab();
            updateMsgTargetDropdown();
            break;

        case 'projects_list':
            projects = data.projects || [];
            updateStatBadges();
            if (activeTab === 'projects') renderProjectsTab();
            break;

        case 'channel_cleared':
            allMessages = allMessages.filter(m => m.channel !== data.channel);
            if (activeTab === 'chat' && data.channel === activeChatCh) renderChatTab();
            break;
    }
}

// ── Dashboard ──────────────────────────────────
function updateStatBadges() {
    document.getElementById('stat-online').textContent   = onlineUsers.size;
    document.getElementById('stat-messages').textContent = messageCount;
    document.getElementById('stat-projects').textContent = projects.length;
    document.getElementById('user-count-badge').textContent = onlineUsers.size;
    document.getElementById('user-count-label').textContent = `${onlineUsers.size} user${onlineUsers.size!==1?'s':''} online`;
    document.getElementById('info-online').textContent   = onlineUsers.size;
}

function renderDashboard() {
    // Recent messages
    const msgList = document.getElementById('dash-recent-msgs');
    const recent  = allMessages.slice(-10).reverse();
    if (!recent.length) { msgList.innerHTML = '<div class="empty-hint">No messages yet</div>'; }
    else {
        msgList.innerHTML = recent.map(m => `
            <div class="dash-msg-item">
                <div class="dash-msg-user">${esc(m.userName||m.name||'?')} <span style="color:var(--accent-cyan);font-family:var(--font-mono);font-size:.7em;">#${esc(m.channel||'general')}</span></div>
                <div class="dash-msg-text">${esc((m.message||m.text||'').slice(0,80))}</div>
                <div class="dash-msg-time">${m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ''}</div>
            </div>`).join('');
    }
    // Online users
    const userList = document.getElementById('dash-online-users');
    if (!onlineUsers.size) { userList.innerHTML = '<div class="empty-hint">No users online</div>'; }
    else {
        userList.innerHTML = [...onlineUsers.keys()].map(u => `
            <div class="dash-user-item">
                <div class="dash-user-avatar">${esc(makeInitials(u))}</div>
                <span class="dash-user-name">${esc(u)}</span>
                <span class="status-online" style="margin-left:auto;font-size:.72em;">Online</span>
            </div>`).join('');
    }
    updateStatBadges();
}

function prependDashMsg(msg) {
    const list = document.getElementById('dash-recent-msgs');
    const empty = list.querySelector('.empty-hint');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = 'dash-msg-item';
    div.style.animation = 'fadeUp .3s ease';
    div.innerHTML = `
        <div class="dash-msg-user">${esc(msg.userName||msg.name||'?')} <span style="color:var(--accent-cyan);font-family:var(--font-mono);font-size:.7em;">#${esc(msg.channel||'general')}</span></div>
        <div class="dash-msg-text">${esc((msg.message||msg.text||'').slice(0,80))}</div>
        <div class="dash-msg-time">${new Date(msg.timestamp||Date.now()).toLocaleTimeString()}</div>`;
    list.prepend(div);
    // Cap to 10
    while (list.children.length > 10) list.lastChild.remove();
}

// ── Chat Tab ───────────────────────────────────
function renderChatTab() {
    const badge = document.getElementById('chat-badge');
    badge.classList.add('hidden'); badge.textContent = '0';

    const panel = document.getElementById('admin-chat-messages');
    const msgs  = allMessages.filter(m => m.channel === activeChatCh);
    if (!msgs.length) { panel.innerHTML = '<div class="empty-hint">No messages in this channel</div>'; return; }
    panel.innerHTML = '';
    msgs.forEach(m => appendChatMsg(m));
    panel.scrollTop = panel.scrollHeight;
}

function appendChatMsg(msg) {
    const panel = document.getElementById('admin-chat-messages');
    if (!panel) return;
    const empty = panel.querySelector('.empty-hint');
    if (empty) empty.remove();
    const isAdminMsg = (msg.userName === 'Admin' || msg.isAdmin);
    const div = document.createElement('div');
    div.className = 'admin-chat-msg' + (isAdminMsg ? ' admin-sent' : '');
    div.innerHTML = `
        <div class="acm-header">
            <span class="acm-user" style="${isAdminMsg?'color:var(--accent-orange);':''}">${esc(msg.userName||msg.name||'?')}</span>
            <span class="acm-channel">#${esc(msg.channel||'general')}</span>
            <span class="acm-time">${msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}</span>
        </div>
        <div class="acm-text">${esc(msg.message||msg.text||'')}</div>`;
    panel.appendChild(div);
    panel.scrollTop = panel.scrollHeight;
}

// Channel selector in chat tab
document.getElementById('chat-channel-select').addEventListener('change', e => {
    activeChatCh = e.target.value;
    renderChatTab();
    wsSend({ type: 'get_history', channel: activeChatCh });
});

// Admin send message
document.getElementById('admin-send-btn').addEventListener('click', sendAdminMsg);
document.getElementById('admin-msg-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); sendAdminMsg(); }
});
function sendAdminMsg() {
    const text = document.getElementById('admin-msg-input').value.trim();
    if (!text) return;
    wsSend({ type: 'admin_broadcast', message: text, channel: activeChatCh });
    document.getElementById('admin-msg-input').value = '';
}

// Clear channel
document.getElementById('clear-channel-btn').addEventListener('click', () => {
    if (!confirm(`Clear all messages in #${activeChatCh}?`)) return;
    wsSend({ type: 'admin_clear_channel', channel: activeChatCh });
});

// ── Users Tab ──────────────────────────────────
function renderUsersTab() {
    const tbody = document.getElementById('users-table-body');
    if (!onlineUsers.size) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-hint">No users online</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    onlineUsers.forEach((info, name) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div class="user-cell"><div class="user-av-sm">${esc(makeInitials(name))}</div><span>${esc(name)}</span></div></td>
            <td><span class="status-online">Online</span></td>
            <td><span style="font-family:var(--font-mono);font-size:.75em;color:var(--accent-cyan);">#${esc(info.channel||'general')}</span></td>
            <td style="font-family:var(--font-mono);font-size:.75em;color:var(--text-muted);">${info.joinedAt ? new Date(info.joinedAt).toLocaleTimeString() : '—'}</td>
            <td><button class="btn-kick" onclick="openKickModal('${esc(name)}')">Remove</button></td>`;
        tbody.appendChild(tr);
    });
    updateStatBadges();
}

function updateMsgTargetDropdown() {
    const sel = document.getElementById('msg-target');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="all">Broadcast to All</option>';
    onlineUsers.forEach((_, name) => {
        const o = document.createElement('option');
        o.value = name; o.textContent = name;
        sel.appendChild(o);
    });
    if (current) sel.value = current;
}

// Kick modal
window.openKickModal = function(name) {
    document.getElementById('kick-username').value = name;
    document.getElementById('kick-reason').value = '';
    document.getElementById('kick-modal').classList.remove('hidden');
};
document.getElementById('confirm-kick-btn').addEventListener('click', () => {
    const name   = document.getElementById('kick-username').value;
    const reason = document.getElementById('kick-reason').value.trim();
    wsSend({ type: 'admin_kick_user', userName: name, reason: reason || 'Removed by admin' });
    document.getElementById('kick-modal').classList.add('hidden');
});

// ── Projects Tab ───────────────────────────────
function renderProjectsTab() {
    const grid = document.getElementById('projects-list-admin');
    if (!projects.length) { grid.innerHTML = '<div class="empty-hint">No projects yet. Add one above.</div>'; return; }
    grid.innerHTML = '';
    projects.forEach(p => {
        const statusLower = (p.status||'active').toLowerCase().replace(/\s+/g,'');
        const statusKey   = statusLower === 'activedev' ? 'active' : statusLower;
        const techTags    = (p.tech || '').split(',').filter(Boolean).map(t => `<span class="pac-tag">${esc(t.trim())}</span>`).join('');
        const card = document.createElement('div');
        card.className = 'proj-admin-card';
        card.innerHTML = `
            <div class="pac-header">
                <span class="pac-title">${esc(p.title)}</span>
                <span class="pac-status ${statusKey}">${esc(p.status||'')}</span>
            </div>
            <div class="pac-subtitle">${esc(p.subtitle||'')}</div>
            <p class="pac-desc">${esc((p.description||'').slice(0,120))}${(p.description||'').length>120?'…':''}</p>
            ${techTags ? `<div class="pac-tags">${techTags}</div>` : ''}
            <div class="pac-actions">
                <button class="pac-edit" onclick="openEditProject(${p.id})">Edit</button>
                <button class="pac-delete" onclick="deleteProject(${p.id})">Delete</button>
                <div class="pac-links">
                    ${p.github ? `<a class="pac-link" href="${esc(p.github)}" target="_blank" rel="noopener">GitHub</a>` : ''}
                    ${p.demo   ? `<a class="pac-link" href="${esc(p.demo)}"   target="_blank" rel="noopener">Demo</a>` : ''}
                </div>
            </div>`;
        grid.appendChild(card);
    });
}

document.getElementById('add-project-btn').addEventListener('click', () => {
    editProjectId = null;
    document.getElementById('project-modal-title').textContent = 'Add Project';
    document.getElementById('project-form').reset();
    document.getElementById('proj-edit-id').value = '';
    document.getElementById('project-modal-overlay').classList.remove('hidden');
});
document.getElementById('close-project-modal').addEventListener('click', closeProjectModal);
document.getElementById('cancel-project-modal').addEventListener('click', closeProjectModal);
function closeProjectModal() { document.getElementById('project-modal-overlay').classList.add('hidden'); editProjectId = null; }

window.openEditProject = function(id) {
    const p = projects.find(p => p.id === id);
    if (!p) return;
    editProjectId = id;
    document.getElementById('project-modal-title').textContent = 'Edit Project';
    document.getElementById('proj-title').value    = p.title       || '';
    document.getElementById('proj-subtitle').value = p.subtitle    || '';
    document.getElementById('proj-desc').value     = p.description || '';
    document.getElementById('proj-status').value   = p.status      || 'Active Dev';
    document.getElementById('proj-category').value = p.category    || 'fullstack';
    document.getElementById('proj-tech').value     = p.tech        || '';
    document.getElementById('proj-github').value   = p.github      || '';
    document.getElementById('proj-demo').value     = p.demo        || '';
    document.getElementById('proj-edit-id').value  = id;
    document.getElementById('project-modal-overlay').classList.remove('hidden');
};

window.deleteProject = function(id) {
    if (!confirm('Delete this project?')) return;
    wsSend({ type: 'admin_delete_project', id });
};

document.getElementById('project-form').addEventListener('submit', e => {
    e.preventDefault();
    const proj = {
        title:       document.getElementById('proj-title').value.trim(),
        subtitle:    document.getElementById('proj-subtitle').value.trim(),
        description: document.getElementById('proj-desc').value.trim(),
        status:      document.getElementById('proj-status').value,
        category:    document.getElementById('proj-category').value,
        tech:        document.getElementById('proj-tech').value.trim(),
        github:      document.getElementById('proj-github').value.trim(),
        demo:        document.getElementById('proj-demo').value.trim(),
    };
    if (editProjectId) {
        proj.id = editProjectId;
        wsSend({ type: 'admin_update_project', project: proj });
    } else {
        wsSend({ type: 'admin_add_project', project: proj });
    }
    closeProjectModal();
});

// ── Settings Tab ───────────────────────────────
document.getElementById('change-password-form').addEventListener('submit', e => {
    e.preventDefault();
    const curr    = document.getElementById('curr-password').value;
    const newPw   = document.getElementById('new-password').value;
    const confirm = document.getElementById('confirm-password').value;
    const res     = document.getElementById('pw-result');

    if (curr !== (sessionStorage.getItem('eh_admin_pw') || currentAdminPw)) {
        res.className = 'form-feedback error';
        res.textContent = '✗ Current password is incorrect.';
        return;
    }
    if (newPw.length < 6) {
        res.className = 'form-feedback error';
        res.textContent = '✗ New password must be at least 6 characters.';
        return;
    }
    if (newPw !== confirm) {
        res.className = 'form-feedback error';
        res.textContent = '✗ Passwords do not match.';
        return;
    }
    wsSend({ type: 'admin_change_password', newPassword: newPw });
});

document.getElementById('clear-all-channels-btn').addEventListener('click', () => {
    if (!confirm('Clear ALL channel histories? This cannot be undone.')) return;
    ['general','random','certivaultid','mediflex','ai-analyzer'].forEach(ch => {
        wsSend({ type: 'admin_clear_channel', channel: ch });
    });
});

// ── Logout ──────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem('eh_admin_pw');
    isAuthed = false;
    if (ws) { try { ws.close(); } catch {} ws = null; }
    document.getElementById('admin-app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
});

// ── Modal close on overlay click / Escape ──────
document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) o.classList.add('hidden'); });
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay').forEach(o => o.classList.add('hidden'));
});

// ── Boot: auto-reconnect if session saved ──────
(function boot() {
    const savedPw = sessionStorage.getItem('eh_admin_pw');
    if (savedPw) {
        currentAdminPw = savedPw;
        connectWS(() => { wsSend({ type: 'admin_auth', password: savedPw }); });
    } else {
        // Still connect to receive WS events
        connectWS();
    }
})();
