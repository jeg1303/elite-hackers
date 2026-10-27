// Chat bubble functionality
class ChatBubble {
    constructor() {
        this.isOpen = false;
        this.userName = '';
        this.ws = null;
        this.init();
    }

    init() {
        this.createChatBubble();
        this.createChatWindow();
        this.setupEventListeners();
        this.connectWebSocket();
    }

    createChatBubble() {
        const bubble = document.createElement('div');
        bubble.id = 'chat-bubble';
        bubble.innerHTML = `
            <div class="bubble-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
            </div>
            <span class="notification-badge">1</span>
        `;
        document.body.appendChild(bubble);
    }

    createChatWindow() {
        const chatWindow = document.createElement('div');
        chatWindow.id = 'chat-window';
        chatWindow.innerHTML = `
            <div class="chat-header">
                <h3>Elite Hackers Support</h3>
                <button class="close-btn" onclick="chatBubble.toggleChat()">×</button>
            </div>
            <div class="chat-body">
                <div id="name-input-container" class="name-input-container">
                    <p>Welcome! Please enter your name to start chatting:</p>
                    <input type="text" id="name-input" placeholder="Enter your name..." maxlength="50">
                    <button id="name-submit-btn">Start Chat</button>
                </div>
                <div id="chat-messages" class="chat-messages" style="display: none;">
                </div>
                <div id="chat-input-container" class="chat-input-container" style="display: none;">
                    <input type="text" id="message-input" placeholder="Type your message..." maxlength="500">
                    <button id="send-btn">Send</button>
                </div>
            </div>
        `;
        document.body.appendChild(chatWindow);
    }

    setupEventListeners() {
        // Chat bubble click
        document.getElementById('chat-bubble').addEventListener('click', () => {
            this.toggleChat();
        });

        // Name submission
        document.getElementById('name-submit-btn').addEventListener('click', () => {
            this.submitName();
        });

        document.getElementById('name-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.submitName();
            }
        });

        // Message sending
        document.getElementById('send-btn').addEventListener('click', () => {
            this.sendMessage();
        });

        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
    }

    toggleChat() {
        const chatWindow = document.getElementById('chat-window');
        const bubble = document.getElementById('chat-bubble');
        
        this.isOpen = !this.isOpen;
        
        if (this.isOpen) {
            chatWindow.classList.add('open');
            bubble.classList.add('hidden');
            document.getElementById('name-input').focus();
        } else {
            chatWindow.classList.remove('open');
            bubble.classList.remove('hidden');
        }
    }

    submitName() {
        const nameInput = document.getElementById('name-input');
        const name = nameInput.value.trim();
        
        if (name.length < 2) {
            alert('Please enter a valid name (at least 2 characters)');
            return;
        }
        
        this.userName = name;
        
        // Ensure WebSocket is connected
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.connectWebSocket();
        }
        
        // Hide name input and show chat
        document.getElementById('name-input-container').style.display = 'none';
        document.getElementById('chat-messages').style.display = 'block';
        document.getElementById('chat-input-container').style.display = 'flex';
        
        // Show welcome message
        setTimeout(() => {
            if (this.wsOffline) {
                this.addMessage(`Welcome, ${this.userName}! 👋 The live chat server is offline in this deployment. To enable real-time chat, run the Node.js server locally (npm start) or deploy server.js to Railway/Render.`, 'bot');
            } else {
                this.addMessage(`Welcome to Elite Hackers, ${this.userName}! How can we help you today?`, 'bot');
            }
        }, 300);
        
        // Send user info to server (with retry if needed)
        const sendUserJoin = () => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'user_join',
                    userName: this.userName,
                    timestamp: new Date().toISOString()
                }));
            } else {
                // Retry after a short delay if not connected
                setTimeout(sendUserJoin, 500);
            }
        };
        sendUserJoin();
        
        document.getElementById('message-input').focus();
    }

    sendMessage() {
        const messageInput = document.getElementById('message-input');
        const message = messageInput.value.trim();
        
        if (message.length === 0) return;
        
        // Add message to chat
        this.addMessage(message, 'user');
        
        // Send to server if connected
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'message',
                userName: this.userName,
                message: message,
                timestamp: new Date().toISOString()
            }));
        } else if (this.wsOffline) {
            setTimeout(() => {
                this.addMessage('📡 Live server is offline. Your message was recorded locally only.', 'bot');
            }, 400);
        }
        
        messageInput.value = '';
    }

    addMessage(message, sender = 'user') {
        const messagesContainer = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;
        
        const messageText = document.createElement('span');
        messageText.className = 'message-text';
        messageText.textContent = message;
        
        const timestamp = document.createElement('span');
        timestamp.className = 'message-time';
        timestamp.textContent = new Date().toLocaleTimeString();
        
        messageDiv.appendChild(messageText);
        messageDiv.appendChild(timestamp);
        messagesContainer.appendChild(messageDiv);
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
        // Skip WebSocket on Vercel/static deployments — only attempt on
        // localhost or when WS_BASE_URL is explicitly configured.
        const hostname = window.location.hostname;
        const isLocal  = !hostname || hostname === 'localhost' || hostname === '127.0.0.1';
        const hasOverride = !!window.WS_BASE_URL;

        if (!isLocal && !hasOverride) {
            // Static deployment — chat works in offline/local mode only
            console.info('Chat: WebSocket skipped on static host. Set window.WS_BASE_URL to enable.');
            this.wsOffline = true;
            return;
        }

        try {
            const wsUrl = this.getWebSocketUrl();
            this.ws = new WebSocket(wsUrl);
            this.wsOffline = false;

            this.ws.onopen = () => {
                console.log('Connected to chat server');
                this.wsOffline = false;
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleServerMessage(data);
                } catch {}
            };

            this.ws.onerror = () => {
                this.wsOffline = true;
            };

            this.ws.onclose = () => {
                console.log('Disconnected from chat server');
                this.wsOffline = true;
                // Only reconnect if user has already joined and we're on localhost
                if (this.userName && isLocal) {
                    setTimeout(() => this.connectWebSocket(), 3000);
                }
            };
        } catch (error) {
            console.error('Failed to connect to WebSocket:', error);
            this.wsOffline = true;
        }
    }

    handleServerMessage(data) {
        switch (data.type) {
            case 'message':
                if (data.sender !== this.userName) {
                    this.addMessage(`${data.sender}: ${data.message}`, 'bot');
                }
                break;
            case 'admin_response':
                this.addMessage(`Admin: ${data.message}`, 'bot');
                break;
            case 'user_joined':
                this.addMessage(`${data.userName} joined the chat`, 'system');
                break;
        }
    }
}

// Initialize chat when page loads
let chatBubble;
document.addEventListener('DOMContentLoaded', () => {
    chatBubble = new ChatBubble();
});
