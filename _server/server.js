// WebSocket Server for Real-time Chat
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const ADMIN_PASSWORD = 'elitehackers2024'; // Change this!
const ROOT = __dirname;

// Store connected clients
const clients = new Map();
const viewers = new Set(); // Store viewer WebSocket connections
const messages = [];
let adminClient = null;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
};

function safePath(urlPath) {
    const decoded = decodeURIComponent((urlPath || '/').split('?')[0]);
    let rel = decoded;
    if (rel === '/' || rel === '') {
        rel = '/index.html';
    }
    const resolved = path.resolve(ROOT, '.' + rel);
    if (!resolved.startsWith(ROOT)) return null; // prevent path traversal
    return resolved;
}

// Create HTTP server
const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Simple API endpoints
    if (req.url === '/api/messages' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages: messages.slice(-100) })); // Last 100 messages
        return;
    }

    // Static file serving
    const filePath = safePath(req.url);
    if (!filePath) {
        res.writeHead(400);
        res.end('Bad Request');
        return;
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
    });
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    console.log('New client connected');
    
    let clientId = null;
    let clientName = null;
    let isAdmin = false;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            switch (data.type) {
                case 'admin_connect':
                    // Verify admin (in production, use proper authentication)
                    isAdmin = true;
                    adminClient = ws;
                    clientId = 'admin';
                    clients.set('admin', { ws, name: 'Admin', isAdmin: true });
                    viewers.delete(ws); // Remove from viewers if was viewing
                    
                    // Send current state to admin
                    ws.send(JSON.stringify({
                        type: 'user_list',
                        users: Array.from(clients.values())
                            .filter(c => !c.isAdmin)
                            .map(c => c.name)
                    }));
                    
                    if (messages.length > 0) {
                        ws.send(JSON.stringify({
                            type: 'message_history',
                            messages: messages.slice(-100)
                        }));
                    }
                    
                    console.log('Admin connected');
                    break;

                case 'viewer_connect':
                    // Add viewer connection
                    viewers.add(ws);
                    clientId = `viewer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    
                    // Send current state to viewer
                    ws.send(JSON.stringify({
                        type: 'user_list',
                        users: Array.from(clients.values())
                            .filter(c => !c.isAdmin)
                            .map(c => c.name)
                    }));
                    
                    // Send message history to viewer
                    if (messages.length > 0) {
                        ws.send(JSON.stringify({
                            type: 'message_history',
                            messages: messages.slice(-100)
                        }));
                    }
                    
                    console.log('Viewer connected');
                    break;

                case 'user_join':
                    clientId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    clientName = data.userName;
                    clients.set(clientId, { ws, name: clientName, isAdmin: false });
                    
                    const userJoinNotification = {
                        type: 'user_join',
                        userName: clientName,
                        timestamp: data.timestamp
                    };
                    
                    // Notify admin
                    if (adminClient && adminClient.readyState === WebSocket.OPEN) {
                        adminClient.send(JSON.stringify(userJoinNotification));
                    }
                    
                    // Notify all viewers
                    viewers.forEach(viewerWs => {
                        if (viewerWs.readyState === WebSocket.OPEN && viewerWs !== adminClient) {
                            viewerWs.send(JSON.stringify(userJoinNotification));
                        }
                    });
                    
                    // Broadcast user list update to admin and viewers
                    broadcastUserList();
                    console.log(`User joined: ${clientName}`);
                    break;

                case 'message':
                    if (!clientName) break;
                    
                    const messageData = {
                        userName: clientName,
                        message: data.message,
                        timestamp: data.timestamp || new Date().toISOString()
                    };
                    
                    messages.push(messageData);
                    
                    const messageNotification = {
                        type: 'message',
                        userName: clientName,
                        message: data.message,
                        timestamp: messageData.timestamp
                    };
                    
                    // Notify admin
                    if (adminClient && adminClient.readyState === WebSocket.OPEN) {
                        adminClient.send(JSON.stringify(messageNotification));
                    }
                    
                    // Notify all viewers
                    viewers.forEach(viewerWs => {
                        if (viewerWs.readyState === WebSocket.OPEN && viewerWs !== adminClient) {
                            viewerWs.send(JSON.stringify(messageNotification));
                        }
                    });
                    
                    console.log(`Message from ${clientName}: ${data.message}`);
                    break;

                case 'admin_response':
                    if (!isAdmin) break;
                    
                    const responseData = {
                        type: 'admin_response',
                        message: data.message,
                        timestamp: data.timestamp || new Date().toISOString()
                    };
                    
                    if (data.targetUser && data.targetUser !== 'all') {
                        // Send to specific user
                        clients.forEach((client, id) => {
                            if (client.name === data.targetUser && !client.isAdmin) {
                                if (client.ws.readyState === WebSocket.OPEN) {
                                    client.ws.send(JSON.stringify(responseData));
                                }
                            }
                        });
                    } else {
                        // Broadcast to all users
                        clients.forEach((client, id) => {
                            if (!client.isAdmin && client.ws.readyState === WebSocket.OPEN) {
                                client.ws.send(JSON.stringify(responseData));
                            }
                        });
                    }
                    
                    console.log(`Admin response sent to ${data.targetUser || 'all users'}`);
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        // Remove from viewers if it was a viewer
        viewers.delete(ws);
        
        if (clientId) {
            clients.delete(clientId);
            
            if (isAdmin) {
                adminClient = null;
                console.log('Admin disconnected');
            } else if (clientId && clientId.startsWith('viewer_')) {
                console.log('Viewer disconnected');
            } else {
                console.log(`User disconnected: ${clientName}`);
                // Notify admin
                if (adminClient && adminClient.readyState === WebSocket.OPEN) {
                    adminClient.send(JSON.stringify({
                        type: 'user_left',
                        userName: clientName
                    }));
                }
                // Notify viewers
                const userLeftNotification = {
                    type: 'user_left',
                    userName: clientName
                };
                viewers.forEach(viewerWs => {
                    if (viewerWs.readyState === WebSocket.OPEN) {
                        viewerWs.send(JSON.stringify(userLeftNotification));
                    }
                });
                broadcastUserList();
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function broadcastUserList() {
    const userList = {
        type: 'user_list',
        users: Array.from(clients.values())
            .filter(c => !c.isAdmin)
            .map(c => c.name)
    };
    
    // Send to admin
    if (adminClient && adminClient.readyState === WebSocket.OPEN) {
        adminClient.send(JSON.stringify(userList));
    }
    
    // Send to all viewers
    viewers.forEach(viewerWs => {
        if (viewerWs.readyState === WebSocket.OPEN && viewerWs !== adminClient) {
            viewerWs.send(JSON.stringify(userList));
        }
    });
}

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Admin password: ${ADMIN_PASSWORD}`);
    console.log('Server is ready to accept connections...');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    wss.close(() => {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });
});
