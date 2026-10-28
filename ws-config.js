// =====================================================
// WebSocket Server Configuration
// Vercel hosts static files → Render runs the WS server
// Change RENDER_WS_URL if you deploy to a different host
// =====================================================

(function () {
    // Your Render WebSocket server URL
    // Replace this with your actual Render service URL
    var RENDER_WS_URL = 'wss://elite-hackers-fv41.onrender.com';

    // Auto-detect: use same-origin WS when running on Render itself
    // Use the Render WS URL when running on Vercel or locally with explicit flag
    var host = window.location.hostname;

    var isRender  = host.includes('onrender.com');
    var isVercel  = host.includes('vercel.app');
    var isLocal   = host === 'localhost' || host === '127.0.0.1' || host === '';

    if (isRender) {
        // Running on Render — use same-origin WebSocket
        window.WS_BASE_URL = null; // let chat.js / workspace.js auto-detect
    } else if (isVercel) {
        // Running on Vercel (static) — point to Render WS server
        window.WS_BASE_URL = RENDER_WS_URL;
    } else if (isLocal) {
        // Local dev — use localhost:8080
        window.WS_BASE_URL = null; // auto-detect handles it
    } else {
        // Custom domain — point to Render
        window.WS_BASE_URL = RENDER_WS_URL;
    }

    // Keep-alive ping: reconnects the WS server on Render if it cold-started
    // Fires a fetch every 13 minutes to keep the Render free tier awake
    if (isVercel || (!isRender && !isLocal)) {
        var PING_URL = RENDER_WS_URL.replace('wss://', 'https://').replace('ws://', 'http://') + '/health';
        setInterval(function () {
            fetch(PING_URL, { mode: 'no-cors' }).catch(function () {});
        }, 13 * 60 * 1000);
        // Ping immediately on load too
        fetch(PING_URL, { mode: 'no-cors' }).catch(function () {});
    }

    console.log('[ws-config] WS_BASE_URL =', window.WS_BASE_URL || '(same-origin)');
})();
