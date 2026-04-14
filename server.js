import 'dotenv/config';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.json');

const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'changeme').trim();
const PORT = Number(process.env.PORT) || 3000;

if (!process.env.ADMIN_PASSWORD) {
    console.warn('[admin] ADMIN_PASSWORD غير مضبوط — استخدام الافتراضي "changeme". عيّن ADMIN_PASSWORD في ملف .env للإنتاج.');
}

const validTokens = new Set();

// Simple rate limiter (per IP, 10 requests per minute for contact form)
const rateLimitMap = new Map();
function rateLimit(maxReqs, windowMs) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + windowMs };
        if (now > record.resetAt) {
            record.count = 0;
            record.resetAt = now + windowMs;
        }
        record.count++;
        rateLimitMap.set(ip, record);
        if (record.count > maxReqs) {
            return res.status(429).json({ error: 'طلبات كثيرة، حاول لاحقاً' });
        }
        next();
    };
}

const app = express();
app.use(express.json({ limit: '128kb' }));

async function ensureDataFile() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
        await fs.access(MESSAGES_PATH);
    } catch {
        await fs.writeFile(MESSAGES_PATH, '[]', 'utf8');
    }
}

async function readMessages() {
    const raw = await fs.readFile(MESSAGES_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
}

async function writeMessages(messages) {
    await fs.writeFile(MESSAGES_PATH, JSON.stringify(messages, null, 2), 'utf8');
}

function clip(str, max) {
    if (typeof str !== 'string') return '';
    return str.trim().slice(0, max);
}

function adminAuth(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || !validTokens.has(token)) {
        return res.status(401).json({ error: 'غير مصرح' });
    }
    next();
}

app.post('/api/admin/login', rateLimit(5, 60000), (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
    }
    const token = randomUUID();
    validTokens.add(token);
    res.json({ token });
});

app.post('/api/admin/logout', adminAuth, (req, res) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    validTokens.delete(token);
    res.json({ ok: true });
});

app.get('/api/admin/messages', adminAuth, async (req, res) => {
    try {
        const messages = await readMessages();
        messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(messages);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'فشل قراءة الرسائل' });
    }
});

app.patch('/api/admin/messages/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { reply, status } = req.body || {};
    try {
        const messages = await readMessages();
        const idx = messages.findIndex((m) => m.id === id);
        if (idx === -1) return res.status(404).json({ error: 'الرسالة غير موجودة' });

        const allowed = ['new', 'read', 'replied'];
        if (typeof reply === 'string') {
            messages[idx].reply = clip(reply, 20000);
            if (messages[idx].reply.length > 0) {
                messages[idx].repliedAt = new Date().toISOString();
                messages[idx].status = 'replied';
            } else {
                messages[idx].repliedAt = null;
            }
        }
        if (typeof status === 'string') {
            if (!allowed.includes(status)) {
                return res.status(400).json({ error: 'حالة غير صالحة' });
            }
            messages[idx].status = status;
        }

        await writeMessages(messages);
        res.json(messages[idx]);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'فشل الحفظ' });
    }
});

app.post('/api/contact', rateLimit(5, 60000), async (req, res) => {
    const name = clip(req.body?.name, 200);
    const email = clip(req.body?.email, 200);
    const subject = clip(req.body?.subject, 500);
    const message = clip(req.body?.message, 10000);

    if (!name || !email || !subject || !message) {
        return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'بريد غير صالح' });
    }

    try {
        const messages = await readMessages();
        const entry = {
            id: randomUUID(),
            name,
            email,
            subject,
            message,
            status: 'new',
            reply: '',
            createdAt: new Date().toISOString(),
            repliedAt: null
        };
        messages.push(entry);
        await writeMessages(messages);
        res.status(201).json({ ok: true, id: entry.id });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'تعذر حفظ الرسالة' });
    }
});

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Block access to sensitive files
app.use((req, res, next) => {
    const blocked = ['.env', '.git', 'generate-icons'];
    if (blocked.some(f => req.path.toLowerCase().includes(f))) {
        return res.status(403).send('Forbidden');
    }
    next();
});

app.use(express.static(__dirname, { index: ['index.html'] }));

// 404 handler
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, '404.html'));
});

await ensureDataFile();

const server = app.listen(PORT, () => {
    console.log(`الموقع يعمل على http://localhost:${PORT}`);
    console.log(`لوحة الإدارة: http://localhost:${PORT}/admin.html`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(
            `\nالمنفذ ${PORT} مستخدم مسبقاً (برنامج آخر أو نسخة قديمة من الخادم).\n` +
                `• أوقف العملية: في PowerShell نفّذ:  Get-NetTCPConnection -LocalPort ${PORT} | Select-Object OwningProcess\n` +
                `  ثم:  Stop-Process -Id <رقم_العملية> -Force\n` +
                `• أو شغّل على منفذ آخر:  $env:PORT=3001; npm start\n`
        );
    } else {
        console.error(err);
    }
    process.exit(1);
});
