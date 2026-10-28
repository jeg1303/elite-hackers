// =====================================================
// Elite Hackers — WebSocket + Static File Server
// Serves static files from repo root + real-time chat
// =====================================================
'use strict';

const WebSocket = require('ws');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');

const PORT           = process.env.PORT ? Number(process.env.PORT) : 8080;
let   ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'elitehackers2024';

// Serve static files from the REPO ROOT (one level up from _server/)
const ROOT = path.resolve(__dirname, '..');

// ── In-Memory State ──────────────────────────
// clients: Map<clientId, { ws, name, isAdmin }>
const clients  = new Map();
// channelHistory: Map<channel, Array<msg>>  — last 200 per channel
const history  = new Map();
// projects: Array  — admin-managed, persisted to disk
let   projects = loadProjects();

// ── Disk persistence for projects ────────────
const PROJECTS_FILE = path.join(__dirname, 'projects.json');
function loadProjects() {
    try { return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')); }
    catch { return []; }
}
function saveProjects() {
    try { fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2)); }
    catch (e) { console.error('Failed to save projects:', e.message); }
}
function pushHistory(channel, msg) {
    if (!history.has(channel)) history.set(channel, []);
    const arr = history.get(channel);
    arr.push(msg);
    if (arr.length > 200) arr.shift();
}

// ── MIME Types ────────────────────────────────
const MIME = {
    '.html':'.html', '.css':'text/css; charset=utf-8',
    '.js':'application/javascript; charset=utf-8',
    '.json':'application/json; charset=utf-8',
    '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
    '.gif':'image/gif', '.svg':'image/svg+xml', '.ico':'image/x-icon',
    '.txt':'text/plain; charset=utf-8', '.woff2':'font/woff2', '.woff':'font/woff',
};
const MIME_MAP = {
    '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
    '.js':'application/javascript; charset=utf-8', '.json':'application/json; charset=utf-8',
    '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
    '.svg':'image/svg+xml', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8',
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

    // Health check
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK'); return;
    }

    // API: get projects
    if (req.url === '/api/projects' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(projects)); return;
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
    let isAdmin    = false;

    function send(payload) {
        if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify(payload));
    }

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());

            switch (data.type) {

                // ── Admin login ────────────────────────────
                case 'admin_auth': {
                    if (data.password !== ADMIN_PASSWORD) {
                        send({ type: 'admin_auth_result', ok: false, reason: 'Wrong password' });
                        break;
                    }
                    isAdmin    = true;
                    clientId   = 'admin_' + Date.now();
                    clientName = 'Admin';
                    clients.set(clientId, { ws, name: 'Admin', isAdmin: true });
                    send({ type: 'admin_auth_result', ok: true });
                    // Send full state
                    send({ type: 'user_list',   users:    getUserList() });
                    send({ type: 'projects_list', projects });
                    // Send all channel histories
                    history.forEach((msgs, ch) => {
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
                        send({ type: 'admin_change_password_result', ok: false, reason: 'Min 6 chars' });
                        break;
                    }
                    ADMIN_PASSWORD = data.newPassword;
                    send({ type: 'admin_change_password_result', ok: true });
                    console.log('[admin] password changed');
                    break;
                }

                // ── Admin: broadcast message ───────────────
                case 'admin_broadcast': {
                    if (!isAdmin) break;
                    const msg = {
                        type: 'message', channel: data.channel || 'general',
                        userName: 'Admin', name: 'Admin', initials: 'AD',
                        message: data.message, text: data.message,
                        timestamp: new Date().toISOString(), isAdmin: true
                    };
                    pushHistory(msg.channel, msg);
                    broadcastAll(msg);
                    break;
                }

                // ── Admin: manage projects ─────────────────
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

                // ── Admin: kick user ───────────────────────
                case 'admin_kick_user': {
                    if (!isAdmin) break;
                    clients.forEach((c, id) => {
                        if (c.name === data.userName && !c.isAdmin) {
                            c.ws.send(JSON.stringify({ type: 'kicked', reason: data.reason || 'Kicked by admin' }));
                            c.ws.close();
                        }
                    });
                    break;
                }

                // ── Admin: clear channel history ───────────
                case 'admin_clear_channel': {
                    if (!isAdmin) break;
                    history.set(data.channel, []);
                    broadcastAll({ type: 'channel_cleared', channel: data.channel });
                    break;
                }

                // ── User join ──────────────────────────────
                case 'user_join': {
                    clientId   = `user_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                    clientName = data.userName;
                    clients.set(clientId, { ws, name: clientName, isAdmin: false });
                    // Send channel history to the joining user
                    const ch = data.channel || 'general';
                    const hist = history.get(ch) || [];
                    send({ type: 'channel_history', channel: ch, messages: hist.slice(-100) });
                    // Notify everyone
                    broadcastAll({ type: 'user_join', userName: clientName, timestamp: new Date().toISOString() });
                    broadcastAll({ type: 'user_list', users: getUserList() });
                    console.log(`[+] ${clientName}`);
                    break;
                }

                // ── User message ───────────────────────────
                case 'message': {
                    if (!clientName) break;
                    const msg = {
                        type: 'message',
                        channel:   data.channel || 'general',
                        userName:  clientName,
                        name:      clientName,
                        initials:  data.initials || makeInitials(clientName),
                        message:   data.message,
                        text:      data.message,
                        timestamp: data.timestamp || new Date().toISOString()
                    };
                    pushHistory(msg.channel, msg);
                    broadcastAll(msg);
                    console.log(`[${msg.channel}] ${clientName}: ${msg.message.slice(0,60)}`);
                    break;
                }

                // ── Request channel history ────────────────
                case 'get_history': {
                    const ch   = data.channel || 'general';
                    const hist = history.get(ch) || [];
                    send({ type: 'channel_history', channel: ch, messages: hist.slice(-100) });
                    break;
                }

                // ── Request projects ───────────────────────
                case 'get_projects': {
                    send({ type: 'projects_list', projects });
                    break;
                }
            }
        } catch (e) { console.error('WS error:', e.message); }
    });

    ws.on('close', () => {
        if (!clientId) return;
        clients.delete(clientId);
        if (clientName && !isAdmin) {
            broadcastAll({ type: 'user_left', userName: clientName });
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
        .map(c => c.name);
}

// Broadcast to ALL connected clients (users + admin)
function broadcastAll(payload) {
    const json = JSON.stringify(payload);
    clients.forEach(c => {
        if (c.ws.readyState === WebSocket.OPEN) c.ws.send(json);
    });
}

function makeInitials(name) {
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Elite Hackers running on port ${PORT}`);
    console.log(`   Static root: ${ROOT}`);
});
process.on('SIGTERM', () => { wss.close(() => server.close(() => process.exit(0))); });
process.on('SIGINT',  () => { wss.close(() => server.close(() => process.exit(0))); });
