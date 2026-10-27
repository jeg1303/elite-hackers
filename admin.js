// Admin Panel JavaScript
class AdminPanel {
    constructor() {
        this.ws = null;
        this.isAuthenticated = false;
        this.users = new Map();
        this.messages = [];
        this.adminPassword = 'elitehackers2024'; // Change this password!
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkAuth();
        // Always connect to WebSocket to receive messages
        this.connectWebSocket();
    }

    checkAuth() {
        const auth = sessionStorage.getItem('adminAuth');
        if (auth === 'true') {
            this.isAuthenticated = true;
            this.showAdminPanel();
            this.enableAdminFeatures();
        } else {
            this.showAdminPanel(); // Show panel but in read-only mode
            this.disableAdminFeatures();
        }
    }

    setupEventListeners() {
        // Login form
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Logout button
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.handleLogout();
        });

        // Send response button
        document.getElementById('send-response-btn').addEventListener('click', () => {
            this.sendResponse();
        });

        // Clear messages button
        document.getElementById('clear-messages-btn').addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all messages?')) {
                this.clearMessages();
            }
        });

        // Enter key for response
        document.getElementById('response-message').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.sendResponse();
            }
        });

        // Show login button
        const showLoginBtn = document.getElementById('show-login-btn');
        if (showLoginBtn) {
            showLoginBtn.addEventListener('click', () => {
                this.showLogin();
            });
        }
    }

    handleLogin() {
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('login-error');

        if (password === this.adminPassword) {
            sessionStorage.setItem('adminAuth', 'true');
            this.isAuthenticated = true;
            errorDiv.textContent = '';
            this.showAdminPanel();
            this.enableAdminFeatures();
            // Reconnect as admin if needed
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.connectWebSocket();
            } else {
                // Send admin connect message
                this.ws.send(JSON.stringify({
                    type: 'admin_connect'
                }));
            }
        } else {
            errorDiv.textContent = 'Invalid password. Please try again.';
            document.getElementById('password').value = '';
        }
    }

    handleLogout() {
        sessionStorage.removeItem('adminAuth');
        this.isAuthenticated = false;
        this.disableAdminFeatures();
        // Keep WebSocket connected for viewing messages
    }

    showLogin() {
        document.getElementById('login-container').style.display = 'flex';
        document.getElementById('admin-panel').style.display = 'none';
    }

    showAdminPanel() {
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('admin-panel').style.display = 'block';
    }

    enableAdminFeatures() {
        document.getElementById('response-section').style.display = 'block';
        document.getElementById('login-prompt').style.display = 'none';
        document.getElementById('clear-messages-btn').style.display = 'block';
    }

    disableAdminFeatures() {
        document.getElementById('response-section').style.display = 'none';
        document.getElementById('login-prompt').style.display = 'block';
        document.getElementById('clear-messages-btn').style.display = 'none';
    }

    getWebSocketUrl() {
        // Allow overriding via global variable in production (e.g., Netlify / DigitalOcean)
        if (window.WS_BASE_URL) {
            return window.WS_BASE_URL;
        }
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const hostname = window.location.hostname;
        // Local development: separate WebSocket server on 8080
        if (!hostname || hostname === 'localhost') {
            return `${protocol}//localhost:8080`;
        }
        // Production: use same host as the page (same origin)
        return `${protocol}//${window.location.host}`;
    }

    connectWebSocket() {
        try {
            const wsUrl = this.getWebSocketUrl();
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('Connected to WebSocket server');
                // Only send admin_connect if authenticated
                if (this.isAuthenticated) {
                    this.ws.send(JSON.stringify({
                        type: 'admin_connect'
                    }));
                } else {
                    // Request message history as viewer
                    this.ws.send(JSON.stringify({
                        type: 'viewer_connect'
                    }));
                }
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleServerMessage(data);
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

            this.ws.onclose = () => {
                console.log('Disconnected from WebSocket server');
                // Always reconnect to keep viewing messages
                setTimeout(() => {
                    this.connectWebSocket();
                }, 3000);
            };
        } catch (error) {
            console.error('Failed to connect to WebSocket:', error);
        }
    }

    handleServerMessage(data) {
        switch (data.type) {
            case 'user_join':
                this.addUser(data.userName, data.timestamp);
                break;
            case 'user_left':
                this.removeUser(data.userName);
                break;
            case 'message':
                this.addMessage(data.userName, data.message, data.timestamp);
                break;
            case 'user_list':
                this.updateUserList(data.users);
                break;
            case 'message_history':
                if (data.messages) {
                    data.messages.forEach(msg => {
                        this.addMessage(msg.userName, msg.message, msg.timestamp, false);
                    });
                }
                break;
        }
    }

    addUser(userName, timestamp) {
        if (!this.users.has(userName)) {
            this.users.set(userName, {
                name: userName,
                joinedAt: timestamp,
                lastSeen: new Date().toISOString()
            });
            this.updateUsersDisplay();
            this.updateStats();
        }
    }

    removeUser(userName) {
        if (this.users.has(userName)) {
            this.users.delete(userName);
            this.updateUsersDisplay();
            this.updateStats();
        }
    }

    addMessage(userName, message, timestamp, animate = true) {
        const messageData = {
            userName,
            message,
            timestamp: timestamp || new Date().toISOString()
        };
        this.messages.push(messageData);
        this.updateMessagesDisplay(animate);
        this.updateStats();
    }

    updateMessagesDisplay(animate = true) {
        const container = document.getElementById('messages-container');
        
        if (this.messages.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No messages yet. Waiting for user messages...</p></div>';
            return;
        }

        container.innerHTML = '';
        this.messages.forEach((msg, index) => {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message-item';
            if (animate && index === this.messages.length - 1) {
                messageDiv.style.animation = 'slideIn 0.3s ease-out';
            }

            const time = new Date(msg.timestamp).toLocaleString();
            const replyButton = this.isAuthenticated 
                ? `<button class="reply-btn" onclick="adminPanel.quickReply('${this.escapeHtml(msg.userName)}')">Reply</button>`
                : '';
            messageDiv.innerHTML = `
                <div class="message-header">
                    <span class="message-user">${this.escapeHtml(msg.userName)}</span>
                    <span class="message-time">${time}</span>
                </div>
                <div class="message-content">${this.escapeHtml(msg.message)}</div>
                ${replyButton ? `<div class="message-actions">${replyButton}</div>` : ''}
            `;
            container.appendChild(messageDiv);
        });

        container.scrollTop = container.scrollHeight;
    }

    updateUsersDisplay() {
        const container = document.getElementById('users-container');
        const userSelect = document.getElementById('target-user');

        if (this.users.size === 0) {
            container.innerHTML = '<div class="empty-state"><p>No active users</p></div>';
            return;
        }

        // Update users list
        container.innerHTML = '';
        this.users.forEach((user, userName) => {
            const userDiv = document.createElement('div');
            userDiv.className = 'user-item';
            userDiv.innerHTML = `
                <div class="user-status"></div>
                <span class="user-name">${this.escapeHtml(userName)}</span>
            `;
            container.appendChild(userDiv);
        });

        // Update user select dropdown
        const currentValue = userSelect.value;
        userSelect.innerHTML = '<option value="all">All Users</option>';
        this.users.forEach((user, userName) => {
            const option = document.createElement('option');
            option.value = userName;
            option.textContent = userName;
            userSelect.appendChild(option);
        });
        userSelect.value = currentValue;
    }

    updateStats() {
        document.getElementById('total-users').textContent = this.users.size;
        document.getElementById('total-messages').textContent = this.messages.length;
        document.getElementById('active-users').textContent = this.users.size;
    }

    quickReply(userName) {
        document.getElementById('target-user').value = userName;
        document.getElementById('response-message').focus();
    }

    sendResponse() {
        if (!this.isAuthenticated) {
            alert('Please login to send responses');
            this.showLogin();
            return;
        }

        const targetUser = document.getElementById('target-user').value;
        const message = document.getElementById('response-message').value.trim();

        if (!message) {
            alert('Please enter a message');
            return;
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'admin_response',
                targetUser: targetUser === 'all' ? null : targetUser,
                message: message,
                timestamp: new Date().toISOString()
            }));

            document.getElementById('response-message').value = '';
        } else {
            alert('Not connected to server. Please refresh the page.');
        }
    }

    clearMessages() {
        if (!this.isAuthenticated) {
            alert('Please login to clear messages');
            this.showLogin();
            return;
        }
        
        if (confirm('Are you sure you want to clear all messages?')) {
            this.messages = [];
            this.updateMessagesDisplay(false);
            this.updateStats();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize admin panel
let adminPanel;
document.addEventListener('DOMContentLoaded', () => {
    adminPanel = new AdminPanel();
});
