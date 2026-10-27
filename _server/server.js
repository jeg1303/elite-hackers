// Elite Hackers — WebSocket + Static File Server
// Serves all HTML/CSS/JS from the project root AND handles real-time chat
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'elitehackers2024';

// Serve static files from the REPO ROOT (one level up from _server/)
const ROOT = path.resolve(__dirname, '..');

const clients = new Map();
const viewers = new Set();
const messages = [];
let adminClient = null;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.txt':  'text/plain; charset=utf-8',
    '.woff2':'font/woff2',
    '.woff': 'font/woff',
};

function safePath(urlPath) {
    const decoded = decodeURIComponent((urlPath || '/').split('?')[0]);
    let rel = decoded;
    if (rel === '/' || rel === '') rel = '/index.html';
    // Redirect clean URLs to .html files
    if (!path.extname(rel)) rel = rel + '.html';
    const resolved = path.resolve(ROOT, '.' + rel);
    // Prevent path traversal attacks
    if (!resolved.startsWith(ROOT)) return null;
    // Block access to _server directory
    if (resolved.includes(path.join(ROOT, '_server'))) return null;
    return resolved;
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // API: last 100 chat messages
    if (req.url === '/api/messages' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages: messages.slice(-100) }));
        return;
    }

    // Health check for Render
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }

    const filePath = safePath(req.url);
    if (!filePath) { res.writeHead(400); res.end('Bad Request'); return; }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            // Fall back to index.html for client-side routing
            const indexPath = path.join(ROOT, 'index.html');
            fs.stat(indexPath, (e2, s2) => {
                if (e2 || !s2.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                fs.createReadStream(indexPath).pipe(res);
            });
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
    });
});

// ── WebSocket Server ───────────────────────────
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    let clientId = null, clientName = null, isAdmin = false;

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());
            switch (data.type) {

                case 'admin_connect':
                    isAdmin = true; adminClient = ws; clientId = 'admin';
                    clients.set('admin', { ws, name: 'Admin', isAdmin: true });
                    viewers.delete(ws);
                    ws.send(JSON.stringify({ type: 'user_list', users: getUserList() }));
                    if (messages.length) ws.send(JSON.stringify({ type: 'message_history', messages: messages.slice(-100) }));
                    break;

                case 'viewer_connect':
                    viewers.add(ws);
                    clientId = `viewer_${Date.now()}`;
                    ws.send(JSON.stringify({ type: 'user_list', users: getUserList() }));
                    if (messages.length) ws.send(JSON.stringify({ type: 'message_history', messages: messages.slice(-100) }));
                    break;

                case 'user_join':
                    clientId   = `user_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
                    clientName = data.userName;
                    clients.set(clientId, { ws, name: clientName, isAdmin: false });
                    broadcast({ type: 'user_join', userName: clientName, timestamp: data.timestamp });
                    broadcastUserList();
                    console.log(`[+] ${clientName}`);
                    break;

                case 'message':
                    if (!clientName) break;
                    const msg = { userName: clientName, message: data.message, timestamp: data.timestamp || new Date().toISOString() };
                    messages.push(msg);
                    broadcast({ type: 'message', ...msg });
                    console.log(`[msg] ${clientName}: ${data.message.slice(0, 60)}`);
                    break;

                case 'admin_response':
                    if (!isAdmin) break;
                    const resp = { type: 'admin_response', message: data.message, timestamp: data.timestamp || new Date().toISOString() };
                    if (data.targetUser && data.targetUser !== 'all') {
                        clients.forEach(c => { if (c.name === data.targetUser && !c.isAdmin && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(resp)); });
                    } else {
                        clients.forEach(c => { if (!c.isAdmin && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(resp)); });
                    }
                    break;
            }
        } catch (e) { console.error('WS parse error:', e.message); }
    });

    ws.on('close', () => {
        viewers.delete(ws);
        if (!clientId) return;
        clients.delete(clientId);
        if (isAdmin) { adminClient = null; return; }
        if (clientName) {
            broadcast({ type: 'user_left', userName: clientName });
            broadcastUserList();
            console.log(`[-] ${clientName}`);
        }
    });

    ws.on('error', (e) => console.error('WS error:', e.message));
});

function getUserList() {
    return Array.from(clients.values()).filter(c => !c.isAdmin).map(c => c.name);
}

function broadcast(payload) {
    const json = JSON.stringify(payload);
    if (adminClient?.readyState === WebSocket.OPEN) adminClient.send(json);
    viewers.forEach(v => { if (v.readyState === WebSocket.OPEN && v !== adminClient) v.send(json); });
}

function broadcastUserList() {
    broadcast({ type: 'user_list', users: getUserList() });
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Elite Hackers server running on port ${PORT}`);
    console.log(`   Serving static files from: ${ROOT}`);
});

process.on('SIGTERM', () => { wss.close(() => server.close(() => process.exit(0))); });
process.on('SIGINT',  () => { wss.close(() => server.close(() => process.exit(0))); });
