// =====================================================
// Elite Hackers — WebSocket + Static File Server
// Features: group channels, private DMs, user registry,
//           admin dashboard, projects management
// =====================================================
'use strict';

const WebSocket = require('ws');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');

const PORT           = process.env.PORT ? Number(process.env.PORT) : 8080;
let   ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'elitehackers2024';

const ROOT = path.resolve(__dirname, '..');

// ── Persistence helpers ───────────────────────
const DATA_DIR        = __dirname;
const PROJECTS_FILE   = path.join(DATA_DIR, 'projects.json');
const USERS_FILE      = path.join(DATA_DIR, 'users.json');
const CHANNELS_FILE   = path.join(DATA_DIR, 'channels.json');
const DMS_FILE        = path.join(DATA_DIR, 'dms.json');

function readJSON(file, def) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return def; }
}
function writeJSON(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
    catch (e) { console.error('Write error', file, e.message); }
}

// ── Persisted data ────────────────────────────
let projects      = readJSON(PROJECTS_FILE, []);
let registeredUsers = readJSON(USERS_FILE, []);   // [{ name, username, password, initials, joinedAt }]
let channelHistory  = readJSON(CHANNELS_FILE, {}); // { channel: [msg,...] }
let dmHistory       = readJSON(DMS_FILE, {});       // { "userA|userB": [msg,...] }

function saveProjects()  { writeJSON(PROJECTS_FILE, projects); }
function saveUsers()     { writeJSON(USERS_FILE, registeredUsers); }
function saveChannels()  { writeJSON(CHANNELS_FILE, channelHistory); }
function saveDMs()       { writeJSON(DMS_FILE, dmHistory); }

function dmKey(a, b) {
    return [a, b].sort().join('|');
}
function pushChannel(channel, msg) {
    if (!channelHistory[channel]) channelHistory[channel] = [];
    channelHistory[channel].push(msg);
    if (channelHistory[channel].length > 300) channelHistory[channel].shift();
}
function pushDM(userA, userB, msg) {
    const key = dmKey(userA, userB);
    if (!dmHistory[key]) dmHistory[key] = [];
    dmHistory[key].push(msg);
    if (dmHistory[key].length > 300) dmHistory[key].shift();
}

// ── Runtime state ─────────────────────────────
// clients: Map<clientId, { ws, name, username, initials, isAdmin }>
const clients = new Map();

// ── MIME map ──────────────────────────────────
const MIME_MAP = {
    '.html':'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js':  'application/javascript; charset=utf-8',
    '.json':'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
    '.gif': 'image/gif', '.svg':'image/svg+xml', '.ico':'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2':'font/woff2', '.woff':'font/woff',
};

function safePath(urlPath) {
    const decoded = decodeURIComponent((urlPath || '/').split('?')[0]);
    let rel = decoded;
    if (rel === '/' || rel === '') rel = '/index.html';
    if (!path.extname(rel) && !rel.endsWith('/')) rel += '.html';
    const resolved = path.resolve(ROOT, '.' + rel);
    if (!resolved.startsWith(ROOT)) return null;
    if (resolved.includes(path.sep + '_server' + path.sep)) return null;
    return resolved;
}

// ── HTTP Server ───────────────────────────────
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // Health check (keeps Render free tier alive)
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK'); return;
    }

    // ── REST API ──────────────────────────────
    // GET /api/projects
    if (req.url === '/api/projects' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(projects)); return;
    }

    // GET /api/users  (admin-only via query param for simplicity)
    if (req.url.startsWith('/api/users') && req.method === 'GET') {
        const url    = new URL(req.url, `http://localhost`);
        const pw     = url.searchParams.get('pw');
        if (pw !== ADMIN_PASSWORD) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' })); return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(registeredUsers)); return;
    }

    // POST /api/register
    if (req.url === '/api/register' && req.method === 'POST') {
        let body = '';
        req.on('data', d => body += d);
        req.on('end', () => {
            try {
                const { name, username, password } = JSON.parse(body);
                if (!name || !username || !password) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing fields' })); return;
                }
                if (password.length < 6) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Password too short' })); return;
                }
                const uname = username.trim().toLowerCase();
                if (registeredUsers.find(u => u.username === uname)) {
                    res.writeHead(409, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Username taken' })); return;
                }
                const user = {
                    name: name.trim(),
                    username: uname,
                    password,          // plain for demo; hash in production
                    initials: makeInitials(name.trim()),
                    joinedAt: new Date().toISOString()
                };
                registeredUsers.push(user);
                saveUsers();
                // Notify admin panels about new user
                broadcastAdmins({ type: 'registered_users', users: registeredUsers });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, user: { name: user.name, username: user.username, initials: user.initials } }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Bad JSON' }));
            }
        });
        return;
    }

    // POST /api/login
    if (req.url === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', d => body += d);
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                const uname = (username || '').trim().toLowerCase();
                const user  = registeredUsers.find(u => u.username === uname && u.password === password);
                if (!user) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid credentials' })); return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, user: { name: user.name, username: user.username, initials: user.initials } }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Bad JSON' }));
            }
        });
        return;
    }

    // Static files
    const filePath = safePath(req.url);
    if (!filePath) { res.writeHead(400); res.end('Bad Request'); return; }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            const idx = path.join(ROOT, 'index.html');
            fs.stat(idx, (e2) => {
                if (e2) { res.writeHead(404); res.end('Not Found'); return; }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                fs.createReadStream(idx).pipe(res);
            });
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_MAP[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
    });
});

// ── WebSocket Server ──────────────────────────
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    let clientId   = null;
    let clientName = null;
    let clientUsername = null;
    let isAdmin    = false;

    function send(payload) {
        if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify(payload));
    }

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());

            switch (data.type) {

                // ── Admin auth ─────────────────────────────
                case 'admin_auth': {
                    if (data.password !== ADMIN_PASSWORD) {
                        send({ type: 'admin_auth_result', ok: false, reason: 'Wrong password' }); break;
                    }
                    isAdmin = true;
                    clientId = 'admin_' + Date.now();
                    clientName = 'Admin';
                    clients.set(clientId, { ws, name: 'Admin', username: 'admin', isAdmin: true });
                    send({ type: 'admin_auth_result', ok: true });
                    send({ type: 'user_list', users: getUserList() });
                    send({ type: 'registered_users', users: registeredUsers });
                    send({ type: 'projects_list', projects });
                    // Send all channel histories to admin
                    Object.entries(channelHistory).forEach(([ch, msgs]) => {
                        send({ type: 'channel_history', channel: ch, messages: msgs.slice(-100) });
                    });
                    broadcastAll({ type: 'user_list', users: getUserList() });
                    console.log('[admin] connected');
                    break;
                }

                // ── Admin: change password ─────────────────
                case 'admin_change_password': {
                    if (!isAdmin) break;
                    if (!data.newPassword || data.newPassword.length < 6) {
                        send({ type: 'admin_change_password_result', ok: false, reason: 'Min 6 chars' }); break;
                    }
                    ADMIN_PASSWORD = data.newPassword;
                    send({ type: 'admin_change_password_result', ok: true });
                    break;
                }

                // ── Admin: broadcast to channel ────────────
                case 'admin_broadcast': {
                    if (!isAdmin) break;
                    const msg = {
                        type: 'message', channel: data.channel || 'general',
                        userName: 'Admin', name: 'Admin', initials: 'AD',
                        message: data.message, text: data.message,
                        timestamp: new Date().toISOString(), isAdmin: true
                    };
                    pushChannel(msg.channel, msg);
                    saveChannels();
                    broadcastAll(msg);
                    break;
                }

                // ── Admin: kick ────────────────────────────
                case 'admin_kick_user': {
                    if (!isAdmin) break;
                    clients.forEach((c, id) => {
                        if ((c.name === data.userName || c.username === data.userName) && !c.isAdmin) {
                            c.ws.send(JSON.stringify({ type: 'kicked', reason: data.reason || 'Kicked by admin' }));
                            c.ws.close();
                        }
                    });
                    break;
                }

                // ── Admin: clear channel ───────────────────
                case 'admin_clear_channel': {
                    if (!isAdmin) break;
                    channelHistory[data.channel] = [];
                    saveChannels();
                    broadcastAll({ type: 'channel_cleared', channel: data.channel });
                    break;
                }

                // ── Admin: projects ────────────────────────
                case 'admin_add_project': {
                    if (!isAdmin) break;
                    const proj = { ...data.project, id: Date.now(), createdAt: new Date().toISOString() };
                    projects.push(proj);
                    saveProjects();
                    broadcastAll({ type: 'projects_list', projects });
                    break;
                }
                case 'admin_update_project': {
                    if (!isAdmin) break;
                    const idx = projects.findIndex(p => p.id === data.project.id);
                    if (idx >= 0) { projects[idx] = { ...projects[idx], ...data.project }; saveProjects(); }
                    broadcastAll({ type: 'projects_list', projects });
                    break;
                }
                case 'admin_delete_project': {
                    if (!isAdmin) break;
                    projects = projects.filter(p => p.id !== data.id);
                    saveProjects();
                    broadcastAll({ type: 'projects_list', projects });
                    break;
                }

                // ── Admin: delete registered user ──────────
                case 'admin_delete_user': {
                    if (!isAdmin) break;
                    registeredUsers = registeredUsers.filter(u => u.username !== data.username);
                    saveUsers();
                    broadcastAdmins({ type: 'registered_users', users: registeredUsers });
                    break;
                }

                // ── User join (workspace) ──────────────────
                case 'user_join': {
                    clientId       = `user_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                    clientName     = data.userName;
                    clientUsername = data.username || data.userName.toLowerCase().replace(/\s+/g,'');
                    const initials = data.initials || makeInitials(clientName);
                    clients.set(clientId, { ws, name: clientName, username: clientUsername, initials, isAdmin: false });
                    // Send this channel's history
                    const ch = data.channel || 'general';
                    send({ type: 'channel_history', channel: ch, messages: (channelHistory[ch] || []).slice(-100) });
                    // Send full registered user list so sidebar DM list populates
                    send({ type: 'registered_users', users: registeredUsers.map(u => ({ name: u.name, username: u.username, initials: u.initials })) });
                    // Notify everyone
                    broadcastAll({ type: 'user_join', userName: clientName, username: clientUsername });
                    broadcastAll({ type: 'user_list', users: getUserList() });
                    console.log(`[+] ${clientName} (${clientUsername})`);
                    break;
                }

                // ── Group channel message ──────────────────
                case 'message': {
                    if (!clientName) break;
                    const msg = {
                        type:      'message',
                        msgId:     data.msgId || null,
                        channel:   data.channel || 'general',
                        userName:  clientName,
                        name:      clientName,
                        username:  clientUsername,
                        initials:  data.initials || makeInitials(clientName),
                        message:   data.message,
                        text:      data.message,
                        timestamp: data.timestamp || new Date().toISOString()
                    };
                    pushChannel(msg.channel, msg);
                    saveChannels();
                    broadcastAll(msg);
                    console.log(`[${msg.channel}] ${clientName}: ${msg.message.slice(0,60)}`);
                    break;
                }

                // ── Private Direct Message ─────────────────
                case 'dm': {
                    if (!clientName) break;
                    const toUsername = data.to;   // target username
                    const msg = {
                        type:       'dm',
                        from:        clientUsername,
                        fromName:    clientName,
                        fromInitials: data.initials || makeInitials(clientName),
                        to:          toUsername,
                        message:     data.message,
                        text:        data.message,
                        msgId:       data.msgId || null,
                        timestamp:   data.timestamp || new Date().toISOString()
                    };
                    pushDM(clientUsername, toUsername, msg);
                    saveDMs();
                    // Send to recipient if online
                    clients.forEach(c => {
                        if (c.username === toUsername && c.ws.readyState === WebSocket.OPEN) {
                            c.ws.send(JSON.stringify(msg));
                        }
                    });
                    // Echo back to sender (confirmation)
                    send(msg);
                    // Send to admins for monitoring
                    broadcastAdmins({ ...msg, type: 'dm_monitor' });
                    console.log(`[DM] ${clientUsername} → ${toUsername}: ${msg.message.slice(0,60)}`);
                    break;
                }

                // ── Request DM history ─────────────────────
                case 'get_dm_history': {
                    if (!clientUsername) break;
                    const withUser = data.with;
                    const key = dmKey(clientUsername, withUser);
                    send({ type: 'dm_history', with: withUser, messages: (dmHistory[key] || []).slice(-100) });
                    break;
                }

                // ── Request channel history ────────────────
                case 'get_history': {
                    const ch = data.channel || 'general';
                    send({ type: 'channel_history', channel: ch, messages: (channelHistory[ch] || []).slice(-100) });
                    break;
                }

                // ── Request projects ───────────────────────
                case 'get_projects': {
                    send({ type: 'projects_list', projects });
                    break;
                }

                // ── Request registered user list ───────────
                case 'get_users': {
                    send({ type: 'registered_users', users: registeredUsers.map(u => ({ name: u.name, username: u.username, initials: u.initials })) });
                    break;
                }
            }
        } catch (e) { console.error('WS error:', e.message); }
    });

    ws.on('close', () => {
        if (!clientId) return;
        clients.delete(clientId);
        if (clientName && !isAdmin) {
            broadcastAll({ type: 'user_left', userName: clientName, username: clientUsername });
            broadcastAll({ type: 'user_list', users: getUserList() });
            console.log(`[-] ${clientName}`);
        }
    });

    ws.on('error', (e) => console.error('WS err:', e.message));
});

// ── Helpers ───────────────────────────────────
function getUserList() {
    return Array.from(clients.values())
        .filter(c => !c.isAdmin)
        .map(c => ({ name: c.name, username: c.username, initials: c.initials || makeInitials(c.name) }));
}

function broadcastAll(payload) {
    const json = JSON.stringify(payload);
    clients.forEach(c => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(json); });
}

function broadcastAdmins(payload) {
    const json = JSON.stringify(payload);
    clients.forEach(c => { if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) c.ws.send(json); });
}

function makeInitials(name) {
    return (name||'?').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0,2);
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Elite Hackers running on port ${PORT}`);
    console.log(`   Users registered: ${registeredUsers.length}`);
});
process.on('SIGTERM', () => { wss.close(() => server.close(() => process.exit(0))); });
process.on('SIGINT',  () => { wss.close(() => server.close(() => process.exit(0))); });

// ── Keep-alive heartbeat ──────────────────────
setInterval(() => {
    let dead = 0;
    clients.forEach((c, id) => {
        if (c.ws.readyState !== WebSocket.OPEN) { clients.delete(id); dead++; return; }
        try { c.ws.ping(); } catch {}
    });
    if (dead > 0) broadcastAll({ type: 'user_list', users: getUserList() });
    console.log(`[heartbeat] ${clients.size} live clients`);
}, 14 * 60 * 1000);
