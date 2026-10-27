/* =====================================================
   ELITE HACKERS — Main Application JavaScript
   Interactions, Animations, Modals, Filters
   ===================================================== */

// ── Particle Canvas Background ────────────────
(function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, particles = [];
    const COUNT = 60;

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    class Particle {
        constructor() { this.reset(); }
        reset() {
            this.x = Math.random() * W;
            this.y = Math.random() * H;
            this.r = Math.random() * 1.5 + 0.3;
            this.vx = (Math.random() - 0.5) * 0.3;
            this.vy = (Math.random() - 0.5) * 0.3;
            this.alpha = Math.random() * 0.4 + 0.1;
            this.color = Math.random() > 0.5 ? '30,143,255' : '0,212,255';
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
            if (this.x < 0 || this.x > W || this.y < 0 || this.y > H) this.reset();
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${this.color},${this.alpha})`;
            ctx.fill();
        }
    }

    for (let i = 0; i < COUNT; i++) particles.push(new Particle());

    // Draw connecting lines between nearby particles
    function drawLines() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 140) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(30,143,255,${0.04 * (1 - dist / 140)})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
    }

    function loop() {
        ctx.clearRect(0, 0, W, H);
        particles.forEach(p => { p.update(); p.draw(); });
        drawLines();
        requestAnimationFrame(loop);
    }
    loop();
})();


// ── Navigation ────────────────────────────────
(function initNav() {
    const nav = document.getElementById('top-nav');
    const hamburger = document.getElementById('nav-hamburger');
    const navLinks = document.getElementById('nav-links');
    const overlay = document.getElementById('mobile-nav-overlay');
    if (!nav) return;

    // Scroll-based nav style
    window.addEventListener('scroll', () => {
        nav.classList.toggle('scrolled', window.scrollY > 50);
    }, { passive: true });

    // Mobile hamburger
    if (hamburger) {
        hamburger.addEventListener('click', () => {
            const open = hamburger.classList.toggle('open');
            hamburger.setAttribute('aria-expanded', open);
            navLinks?.classList.toggle('mobile-open', open);
            overlay?.classList.toggle('open', open);
        });
    }
    overlay?.addEventListener('click', () => {
        hamburger?.classList.remove('open');
        hamburger?.setAttribute('aria-expanded', 'false');
        navLinks?.classList.remove('mobile-open');
        overlay.classList.remove('open');
    });

    // Active link on scroll
    const sections = document.querySelectorAll('section[id]');
    const links = document.querySelectorAll('.nav-link[data-section]');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                links.forEach(l => l.classList.remove('active'));
                const active = document.querySelector(`.nav-link[data-section="${entry.target.id}"]`);
                if (active) active.classList.add('active');
            }
        });
    }, { rootMargin: '-40% 0px -40% 0px' });
    sections.forEach(s => observer.observe(s));
})();


// ── Counter Animation ─────────────────────────
(function initCounters() {
    const nums = document.querySelectorAll('.stat-number[data-target]');
    if (!nums.length) return;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const el = entry.target;
            const target = parseInt(el.dataset.target);
            let current = 0;
            const step = Math.ceil(target / 30);
            const interval = setInterval(() => {
                current = Math.min(current + step, target);
                el.textContent = current;
                if (current >= target) clearInterval(interval);
            }, 50);
            observer.unobserve(el);
        });
    }, { threshold: 0.5 });
    nums.forEach(n => observer.observe(n));
})();


// ── Scroll Reveal ─────────────────────────────
(function initReveal() {
    const els = document.querySelectorAll('.project-card, .member-card, .section-header, .contact-stat-item, .hero-code-block');
    if (!els.length) return;
    els.forEach((el, i) => {
        el.classList.add('reveal');
        if (i % 3 === 1) el.classList.add('reveal-delay-1');
        if (i % 3 === 2) el.classList.add('reveal-delay-2');
    });
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.08 });
    els.forEach(el => observer.observe(el));
})();


// ── Project Filters ───────────────────────────
(function initProjectFilters() {
    const btns = document.querySelectorAll('.filter-btn');
    const cards = document.querySelectorAll('.project-card');
    if (!btns.length) return;

    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filter = btn.dataset.filter;
            cards.forEach(card => {
                const tags = card.dataset.tags || '';
                if (filter === 'all' || tags.includes(filter)) {
                    card.classList.remove('hidden');
                    card.style.animation = 'fadeInUp 0.4s ease forwards';
                } else {
                    card.classList.add('hidden');
                }
            });
        });
    });
})();


// ── Team Search & Filters ─────────────────────
(function initTeamFilters() {
    const searchInput = document.getElementById('team-search');
    const roleFilters = document.querySelectorAll('.role-filter');
    const cards = document.querySelectorAll('.member-card');

    function filterTeam() {
        const query = (searchInput?.value || '').toLowerCase();
        const activeRole = document.querySelector('.role-filter.active')?.dataset.role || 'all';

        cards.forEach(card => {
            const name = (card.dataset.name || '').toLowerCase();
            const role = (card.dataset.role || '').toLowerCase();
            const matchesSearch = !query || name.includes(query);
            const matchesRole = activeRole === 'all' || role.includes(activeRole);
            card.classList.toggle('hidden', !(matchesSearch && matchesRole));
        });
    }

    searchInput?.addEventListener('input', filterTeam);

    roleFilters.forEach(btn => {
        btn.addEventListener('click', () => {
            roleFilters.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterTeam();
        });
    });
})();


// ── Project Modal Data ────────────────────────
const PROJECT_DATA = [
    {
        id: 0,
        title: 'CertiVaultID',
        subtitle: 'Digital Certificate Verification',
        status: 'Deployed',
        statusClass: 'status-deployed',
        desc: 'A secure platform for storing, managing, and verifying digital certificates. Users can upload certificates, generate unique shareable verification links, and share them with employers or institutions for instant, tamper-proof authenticity checks.',
        features: [
            { icon: '🔐', text: 'Secure certificate uploads with encryption' },
            { icon: '🔗', text: 'Shareable verification links with QR codes' },
            { icon: '✅', text: 'Real-time verification status' },
            { icon: '📂', text: 'Document management dashboard' },
            { icon: '📜', text: 'Verification history and audit trail' },
            { icon: '🌐', text: 'Public verification portal' },
        ],
        tech: ['Node.js', 'MongoDB', 'JWT', 'QR Codes', 'PDF.js', 'Cloudinary', 'Express.js'],
        notice: null,
        links: []
    },
    {
        id: 1,
        title: 'Smart Robot Care Companion',
        subtitle: 'Healthcare Embedded Robotics',
        status: 'Prototype',
        statusClass: 'status-prototype',
        desc: 'An embedded healthcare robotics project designed to support patient care. The system uses sensor-based monitoring to track patient vitals, provides automated assistance, and triggers interactive alerts when anomalies are detected.',
        features: [
            { icon: '🤖', text: 'Raspberry Pi-based autonomous robot' },
            { icon: '💓', text: 'Vital signs monitoring (HR, SpO2, Temp)' },
            { icon: '🚨', text: 'Automated emergency alerts' },
            { icon: '📡', text: 'MQTT-based real-time data streaming' },
            { icon: '🖥️', text: 'Live monitoring dashboard' },
            { icon: '⚙️', text: 'Sensor fusion architecture' },
        ],
        tech: ['Raspberry Pi', 'Python', 'MQTT', 'Arduino', 'Ultrasonic Sensors', 'Heart Rate Sensor', 'OLED Display'],
        notice: 'This is a hardware prototype. The monitoring dashboard shown is a simulation of the actual sensor data pipeline.',
        links: []
    },
    {
        id: 2,
        title: 'Mediflex',
        subtitle: 'Smart Healthcare Management',
        status: 'Active Development',
        statusClass: 'status-active',
        desc: 'An NFC-based healthcare entry and token-management system that modernizes patient flow. Patients tap their NFC card to check in, receive a digital token, and receive paperless prescriptions — all managed through a real-time dashboard.',
        features: [
            { icon: '📱', text: 'NFC card tap-in check-in (PN532)' },
            { icon: '🎫', text: 'Automated digital token allocation' },
            { icon: '💊', text: 'Paperless prescription management' },
            { icon: '📊', text: 'Real-time queue dashboard' },
            { icon: '🔔', text: 'Patient notification system' },
            { icon: '🗂️', text: 'Patient history and records' },
        ],
        tech: ['NFC PN532', 'React', 'Node.js', 'WebSockets', 'SQLite', 'Raspberry Pi', 'Tailwind CSS'],
        notice: null,
        links: []
    },
    {
        id: 3,
        title: 'AI Code Analyzer',
        subtitle: 'Intelligent Code Review',
        status: 'Active Development',
        statusClass: 'status-active',
        desc: 'An AI-assisted code analysis tool that connects to authorized GitHub repositories, retrieves code, identifies bugs and potential vulnerabilities, explains issues in plain language, and suggests corrected code with side-by-side comparisons.',
        features: [
            { icon: '🔗', text: 'GitHub OAuth — authorized repos only' },
            { icon: '🧠', text: 'AI-powered bug & vulnerability detection' },
            { icon: '📊', text: 'Severity levels: Critical, High, Medium, Low' },
            { icon: '💡', text: 'Plain-language issue explanations' },
            { icon: '🔀', text: 'Before/after code diff comparisons' },
            { icon: '🔒', text: 'Read-only — never commits without approval' },
        ],
        tech: ['OpenAI GPT API', 'GitHub API', 'TypeScript', 'AST Parsing', 'OAuth 2.0', 'Node.js', 'Prism.js'],
        notice: '⚠️ Authorization Required: This tool only accesses repositories you explicitly authorize via GitHub OAuth. It never modifies or commits code without your explicit approval.',
        links: [{ label: 'Launch Analyzer', href: 'ai-analyzer.html', primary: true }]
    },
    {
        id: 4,
        title: 'Data Analytics Explorer',
        subtitle: 'Large-Scale CSV Analysis',
        status: 'Active Development',
        statusClass: 'status-active',
        desc: 'A browser-based analytics tool that accepts large CSV datasets (up to 1 million records) and analyzes them efficiently using Web Workers. Provides data cleaning, statistical summaries, interactive charts, and downloadable reports.',
        features: [
            { icon: '📂', text: 'Upload CSVs up to 1M+ rows' },
            { icon: '⚡', text: 'Web Worker processing — no browser freeze' },
            { icon: '🧹', text: 'Data cleaning & missing value detection' },
            { icon: '📈', text: 'Interactive charts: bar, line, scatter, pie' },
            { icon: '🔍', text: 'Column filtering and comparison tools' },
            { icon: '📥', text: 'Download cleaned data & PDF reports' },
        ],
        tech: ['Web Workers', 'Chart.js', 'Papa Parse', 'IndexedDB', 'D3.js', 'jsPDF', 'Vanilla JS'],
        notice: 'All processing happens in your browser — your data never leaves your device.',
        links: [{ label: 'Launch Analytics', href: 'analytics.html', primary: true }]
    },
    {
        id: 5,
        title: 'Team Collaboration Workspace',
        subtitle: 'Real-Time Team Communication',
        status: 'Live',
        statusClass: 'status-deployed',
        desc: 'A full-featured team communication platform inspired by modern workspace apps. Includes user accounts, secure login, direct messaging, group chats, project-specific channels, file sharing, and real-time updates via WebSockets.',
        features: [
            { icon: '💬', text: 'Direct messages & group chats' },
            { icon: '📢', text: 'Project-specific channels' },
            { icon: '📎', text: 'File sharing and media support' },
            { icon: '🔔', text: 'Real-time notifications' },
            { icon: '🟢', text: 'Online/offline presence indicators' },
            { icon: '🔐', text: 'JWT authentication & secure sessions' },
        ],
        tech: ['WebSockets', 'Node.js', 'SQLite', 'JWT', 'Bcrypt', 'Multer', 'Express.js'],
        notice: null,
        links: [{ label: 'Open Workspace', href: 'workspace.html', primary: true }]
    },
    {
        id: 6,
        title: 'Smart Task Analyzer',
        subtitle: 'Team Productivity Intelligence',
        status: 'Active Development',
        statusClass: 'status-active',
        desc: 'An integrated task management module with intelligent analysis. Creates, assigns, and tracks tasks with priorities and deadlines. The AI analyzer identifies overdue work, summarizes progress, highlights workload imbalances, and suggests priority reordering.',
        features: [
            { icon: '✅', text: 'Task creation with priority & deadline' },
            { icon: '👤', text: 'Team member assignment & tracking' },
            { icon: '📊', text: 'Progress dashboards & completion reviews' },
            { icon: '🧠', text: 'AI workload imbalance detection' },
            { icon: '⏰', text: 'Overdue task identification & alerts' },
            { icon: '🎯', text: 'Smart priority suggestions from real data' },
        ],
        tech: ['AI Analysis', 'Drag & Drop API', 'Chart.js', 'WebSockets', 'REST API', 'SQLite', 'Node.js'],
        notice: 'AI suggestions are based on actual task data — no fabricated metrics.',
        links: [{ label: 'Open Task Board', href: 'workspace.html#tasks', primary: true }]
    }
];

// ── Project Modal ─────────────────────────────
window.openProjectModal = function(index) {
    const data = PROJECT_DATA[index];
    if (!data) return;

    const modal = document.getElementById('project-modal');
    const content = document.getElementById('modal-content');

    const featuresHTML = data.features.map(f => `
        <div class="modal-feature-item">
            <span class="modal-feature-icon">${f.icon}</span>
            <span class="modal-feature-text">${f.text}</span>
        </div>
    `).join('');

    const techHTML = data.tech.map(t => `<span class="modal-tag">${t}</span>`).join('');
    const noticeHTML = data.notice ? `<div class="modal-notice">${data.notice}</div>` : '';
    const actionsHTML = data.links.map(l =>
        l.primary
            ? `<a href="${l.href}" class="btn-primary">${l.label} <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg></a>`
            : `<a href="${l.href}" class="btn-secondary">${l.label}</a>`
    ).join('');

    content.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
            <span class="card-status ${data.statusClass}" style="margin:0;">${data.status}</span>
            <span style="font-family:var(--font-mono);font-size:0.75em;color:var(--text-muted);">PROJECT // ${String(index + 1).padStart(2,'0')}</span>
        </div>
        <h2>${data.title}</h2>
        <div class="modal-subtitle">${data.subtitle}</div>
        <p>${data.desc}</p>
        <div style="font-family:var(--font-mono);font-size:0.75em;color:var(--text-muted);letter-spacing:2px;margin:18px 0 10px;">KEY FEATURES</div>
        <div class="modal-feature-grid">${featuresHTML}</div>
        ${noticeHTML}
        <div style="font-family:var(--font-mono);font-size:0.75em;color:var(--text-muted);letter-spacing:2px;margin:18px 0 10px;">TECH STACK</div>
        <div class="modal-tags">${techHTML}</div>
        ${actionsHTML ? `<div class="modal-actions">${actionsHTML}</div>` : ''}
    `;

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    trapFocus(modal);
};

window.closeProjectModal = function() {
    document.getElementById('project-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

// ── Member Data ───────────────────────────────
const MEMBER_DATA = {
    harish: {
        initials: 'HR', name: 'Harish raj.S', role: 'Software Architect',
        roleClass: 'role-software', avatarClass: '',
        bio: 'Designs scalable system architectures and leads technical strategy across all projects. Expert in full-stack development, API design, and cloud deployment.',
        projects: ['CertiVaultID', 'AI Code Analyzer', 'Team Workspace'],
        portfolio: 'https://harishraj2107.netlify.app/',
    },
    varsha: {
        initials: 'VS', name: 'Varsha S', role: 'UI/UX Lead',
        roleClass: 'role-design', avatarClass: 'av-purple',
        bio: 'Crafts user experiences and design systems that balance aesthetics with functionality. Leads visual design, interaction patterns, and accessibility standards.',
        projects: ['Mediflex', 'Team Workspace', 'CertiVaultID'],
        portfolio: 'https://silly-mochi-a1dcef.netlify.app/',
    },
    pramila: {
        initials: 'PJ', name: 'Pramila.J', role: 'Frontend Engineer',
        roleClass: 'role-software', avatarClass: 'av-cyan',
        bio: 'Builds pixel-perfect, performant web interfaces and interactive dashboards. Specializes in React, data visualizations, and responsive design systems.',
        projects: ['Data Analytics Explorer', 'CertiVaultID', 'Mediflex'],
        portfolio: 'https://portfolio-pramilaj.vercel.app/',
    },
    vasundhara: {
        initials: 'VL', name: 'Vasundhara.L', role: 'Security Analyst',
        roleClass: 'role-security', avatarClass: 'av-red',
        bio: 'Ensures application security, conducts vulnerability assessments, and implements secure authentication systems. Reviews code for security flaws and enforces best practices.',
        projects: ['AI Code Analyzer', 'CertiVaultID', 'Team Workspace'],
        portfolio: 'https://vasundhara13.netlify.app/',
    },
    jegan: {
        initials: 'JS', name: 'Jegannaathan.S.J', role: 'Full-Stack Developer',
        roleClass: 'role-software', avatarClass: 'av-gradient',
        bio: 'End-to-end developer building backend APIs, databases, and seamless frontend integrations. Leads the Team Workspace and Task Analyzer platform development.',
        projects: ['Team Workspace', 'Smart Task Analyzer', 'Data Analytics Explorer'],
        portfolio: 'https://jegannaathan.netlify.app/',
    },
    hari: {
        initials: 'HS', name: 'Hari hara sudhan.S', role: 'Systems Engineer',
        roleClass: 'role-hardware', avatarClass: 'av-teal',
        bio: 'Bridges hardware and software — designs embedded systems and IoT architectures. Expert in sensor integration, microcontrollers, and MQTT-based data pipelines.',
        projects: ['Smart Robot Care Companion', 'Mediflex', 'Highway Safety'],
        portfolio: 'https://hariharasudhan1.netlify.app/',
    },
    monisha: {
        initials: 'MS', name: 'Monisha.S', role: 'Hardware Lead',
        roleClass: 'role-hardware', avatarClass: 'av-pink',
        bio: 'Leads hardware prototyping, sensor integration, and physical computing solutions. Manages component selection, circuit design, and hardware-software interfaces.',
        projects: ['Smart Robot Care Companion', 'Mediflex', 'Highway Safety'],
        portfolio: 'https://monisha21.netlify.app/',
    }
};

window.openMemberModal = function(key) {
    const data = MEMBER_DATA[key];
    if (!data) return;

    const modal = document.getElementById('member-modal');
    const content = document.getElementById('member-modal-content');

    const projectsHTML = data.projects.map(p => `<span class="member-modal-project">${p}</span>`).join('');

    content.innerHTML = `
        <div style="text-align:center;">
            <div class="member-modal-avatar ${data.avatarClass}" style="
                width:90px;height:90px;border-radius:50%;
                display:flex;align-items:center;justify-content:center;
                font-family:var(--font-heading);font-size:2em;font-weight:700;
                background:linear-gradient(135deg,var(--accent-blue),var(--accent-cyan));
                color:white;margin:0 auto 16px;
                box-shadow:0 0 30px rgba(30,143,255,0.35);
            ">${data.initials}</div>
            <h2 style="font-family:var(--font-heading);font-size:1.5em;font-weight:800;color:var(--text-bright);margin-bottom:8px;">${data.name}</h2>
            <span class="member-role-badge ${data.roleClass}" style="display:inline-block;margin-bottom:20px;">${data.role}</span>
        </div>
        <p class="member-modal-bio">${data.bio}</p>
        <div class="member-modal-section-title">PROJECTS</div>
        <div class="member-modal-projects">${projectsHTML}</div>
        <div class="modal-actions" style="justify-content:center;">
            <a href="${data.portfolio}" target="_blank" rel="noopener" class="btn-primary">
                View Portfolio
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
            </a>
        </div>
    `;

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
};

window.closeMemberModal = function() {
    document.getElementById('member-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};


// ── Modal Close on overlay click / Escape key ──
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('open');
            document.body.style.overflow = '';
        }
    });
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach(m => {
            m.classList.remove('open');
            document.body.style.overflow = '';
        });
    }
});


// ── Focus Trap for Accessibility ─────────────
function trapFocus(modal) {
    const focusable = modal.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    focusable[0].focus();
}


// ── Chat Button → Open Chat Widget ───────────
document.getElementById('open-chat-btn')?.addEventListener('click', () => {
    if (typeof chatBubble !== 'undefined') chatBubble.toggleChat();
});


// ── WebSocket Status Indicator in Contact ─────
(function initWSStatus() {
    const statusText = document.getElementById('ws-status-text');
    const dot = document.querySelector('.ws-dot');
    if (!statusText) return;

    function setStatus(connected) {
        statusText.textContent = connected ? 'Connected' : 'Offline';
        if (dot) {
            dot.classList.toggle('disconnected', !connected);
        }
    }

    // Poll via chat's websocket state if available
    setInterval(() => {
        if (typeof chatBubble !== 'undefined' && chatBubble.ws) {
            setStatus(chatBubble.ws.readyState === WebSocket.OPEN);
        } else {
            setStatus(false);
        }
    }, 2000);
})();


// ── Smooth anchor scroll with offset ─────────
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        const target = document.querySelector(this.getAttribute('href'));
        if (!target) return;
        e.preventDefault();
        const offset = 80;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });

        // Close mobile nav if open
        document.getElementById('nav-hamburger')?.classList.remove('open');
        document.getElementById('nav-links')?.classList.remove('mobile-open');
        document.getElementById('mobile-nav-overlay')?.classList.remove('open');
    });
});


// ── Reduced motion: disable particles ─────────
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const canvas = document.getElementById('particle-canvas');
    if (canvas) canvas.style.display = 'none';
}
