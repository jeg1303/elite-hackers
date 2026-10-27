# Elite Hackers Chat Application

A real-time chat application with a floating chat bubble, admin panel, and WebSocket-based messaging.

## Features

- 🎈 **Floating Chat Bubble**: Animated chat button in the corner
- 💬 **Real-time Messaging**: WebSocket-based real-time communication
- 👤 **User Authentication**: Name-based user identification
- 🎉 **Welcome Message**: Personalized welcome message after name entry
- 🛡️ **Admin Panel**: Password-protected admin dashboard
- 📊 **Live Statistics**: Real-time user and message statistics
- ✉️ **Admin Responses**: Send messages to individual users or broadcast to all

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the WebSocket Server

```bash
npm start
```

The server will run on `ws://localhost:8080`

### 3. Open the Application

- **Main Page**: Open `index.html` in your browser
- **Admin Panel**: Open `admin.html` in your browser

### 4. Admin Login

Default admin password: `elitehackers2024`

**⚠️ Important**: Change the password in `admin.js` and `server.js` for production use!

## File Structure

```
webpage/
├── index.html          # Main webpage with chat bubble
├── admin.html          # Admin panel page
├── styles.css          # Main page styles
├── chat.css           # Chat bubble and window styles
├── chat.js            # Chat functionality
├── admin.css          # Admin panel styles
├── admin.js           # Admin panel functionality
├── server.js          # WebSocket server
├── package.json       # Node.js dependencies
└── README.md          # This file
```

## Usage

### For Users

1. Click the floating chat bubble in the bottom-right corner
2. Enter your name when prompted
3. You'll receive a welcome message: "Welcome to Elite Hackers, [Your Name]!"
4. Start chatting - messages are sent in real-time

### For Admins

1. Open `admin.html`
2. Enter the admin password
3. View all messages and active users in real-time
4. Send responses to individual users or broadcast to all users
5. Monitor statistics (total users, messages, active users)

## Customization

### Change Admin Password

1. Update `adminPassword` in `admin.js` (line 6)
2. Update `ADMIN_PASSWORD` in `server.js` (line 7)

### Change Server Port

Update `PORT` in `server.js` (line 6) and update WebSocket URLs in `chat.js` and `admin.js`

### Styling

- Main page: Edit `styles.css`
- Chat bubble: Edit `chat.css`
- Admin panel: Edit `admin.css`

## Technologies Used

- HTML5
- CSS3 (with animations)
- JavaScript (ES6+)
- Node.js
- WebSocket (ws library)

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

## Security Notes

- Change default admin password before deployment
- Use HTTPS/WSS in production
- Implement proper authentication for production use
- Add rate limiting for production
- Sanitize user inputs

## License

MIT License
