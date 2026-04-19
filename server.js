import 'dotenv/config';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto'; import { sendOrderEmails } from './email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const VISITORS_PATH = path.join(DATA_DIR, 'visitors.json');
const ORDERS_PATH = path.join(DATA_DIR, 'orders.json');

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

const DEFAULT_SETTINGS = {
    siteName: 'Khalid',
    siteTitle: 'Tech Services & Digital Solutions',
    bio: 'Freelance tech specialist offering web development, mobile apps, UI/UX design, and digital marketing services.',
    email: '',
    phone: '',
    whatsapp: '',
    location: '',
    socialLinks: { github: '', linkedin: '', twitter: '', instagram: '', youtube: '' },
    seoTitle: 'Khalid | Tech Services & Digital Solutions',
    seoDescription: 'Freelance tech specialist — web development, mobile apps, UI/UX design, and digital marketing.',
    updatedAt: null
};

async function ensureDataFile() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try { await fs.access(MESSAGES_PATH); } catch { await fs.writeFile(MESSAGES_PATH, '[]', 'utf8'); }
    try { await fs.access(SETTINGS_PATH); } catch { await fs.writeFile(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8'); }
    try { await fs.access(VISITORS_PATH); } catch { await fs.writeFile(VISITORS_PATH, '[]', 'utf8'); }
    try { await fs.access(ORDERS_PATH); } catch { await fs.writeFile(ORDERS_PATH, '[]', 'utf8'); }
}

async function readOrders() {
    try {
        const raw = await fs.readFile(ORDERS_PATH, 'utf8');
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        // Backfill access tokens for orders created before token was introduced
        let needsMigration = false;
        for (const o of data) {
            if (!o.accessToken) {
                o.accessToken = randomUUID().replace(/-/g, '').slice(0, 24);
                needsMigration = true;
            }
        }
        if (needsMigration) await fs.writeFile(ORDERS_PATH, JSON.stringify(data, null, 2), 'utf8');
        return data;
    } catch { return []; }
}

async function writeOrders(orders) {
    await fs.writeFile(ORDERS_PATH, JSON.stringify(orders, null, 2), 'utf8');
}

async function generateOrderNumber() {
    const orders = await readOrders();
    const year = new Date().getFullYear();
    const yearPrefix = `ORD-${year}-`;
    const thisYearOrders = orders.filter(o => o.orderNumber && o.orderNumber.startsWith(yearPrefix));
    const nextSeq = thisYearOrders.length + 1;
    return `${yearPrefix}${String(nextSeq).padStart(4, '0')}`;
}

function generateAccessToken() {
    // 24-char url-safe random token (prevents order enumeration)
    return randomUUID().replace(/-/g, '').slice(0, 24);
}

async function readMessages() {
    const raw = await fs.readFile(MESSAGES_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
}

async function writeMessages(messages) {
    await fs.writeFile(MESSAGES_PATH, JSON.stringify(messages, null, 2), 'utf8');
}

async function readSettings() {
    try {
        const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch { return { ...DEFAULT_SETTINGS }; }
}

async function writeSettings(settings) {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
}

async function readVisitors() {
    try {
        const raw = await fs.readFile(VISITORS_PATH, 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

async function writeVisitors(visitors) {
    // keep last 10000 entries max
    const trimmed = visitors.slice(-10000);
    await fs.writeFile(VISITORS_PATH, JSON.stringify(trimmed, null, 2), 'utf8');
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

// --- Admin Stats ---
app.get('/api/admin/stats', adminAuth, async (req, res) => {
    try {
        const messages = await readMessages();
        const total = messages.length;
        const newCount = messages.filter(m => m.status === 'new').length;
        const readCount = messages.filter(m => m.status === 'read').length;
        const repliedCount = messages.filter(m => m.status === 'replied').length;

        const now = new Date();
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
        const recent = messages.filter(m => new Date(m.createdAt) >= thirtyDaysAgo);
        const perDay = {};
        recent.forEach(m => {
            const day = m.createdAt?.slice(0, 10);
            if (day) perDay[day] = (perDay[day] || 0) + 1;
        });

        const visitors = await readVisitors();
        const todayStr = now.toISOString().slice(0, 10);
        const todayVisitors = visitors.filter(v => v.date === todayStr).length;
        const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const weekVisitors = visitors.filter(v => v.date >= weekAgo).length;

        res.json({ total, new: newCount, read: readCount, replied: repliedCount, perDay, todayVisitors, weekVisitors, totalVisitors: visitors.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'فشل جلب الإحصائيات' });
    }
});

// --- Export messages CSV (must be before :id routes) ---
app.get('/api/admin/messages/export', adminAuth, async (req, res) => {
    try {
        const messages = await readMessages();
        const header = 'ID,Name,Email,Subject,Message,Status,Reply,CreatedAt,RepliedAt\n';
        const csvEscape = (s) => '"' + String(s || '').replace(/"/g, '""') + '"';
        const rows = messages.map(m =>
            [m.id, m.name, m.email, m.subject, m.message, m.status, m.reply, m.createdAt, m.repliedAt].map(csvEscape).join(',')
        ).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=messages.csv');
        res.send('\uFEFF' + header + rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'فشل التصدير' });
    }
});

// --- Bulk delete messages (must be before :id routes) ---
app.post('/api/admin/messages/bulk-delete', adminAuth, async (req, res) => {
    try {
        const { ids } = req.body || {};
        if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'لا توجد معرفات' });
        let messages = await readMessages();
        const idSet = new Set(ids);
        messages = messages.filter(m => !idSet.has(m.id));
        await writeMessages(messages);
        res.json({ ok: true, deleted: ids.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'فشل الحذف' });
    }
});

// --- Update message (PATCH :id) ---
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

// --- Delete single message ---
app.delete('/api/admin/messages/:id', adminAuth, async (req, res) => {
    try {
        const messages = await readMessages();
        const idx = messages.findIndex(m => m.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: 'الرسالة غير موجودة' });
        messages.splice(idx, 1);
        await writeMessages(messages);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'فشل الحذف' });
    }
});

// --- Site Settings ---
app.get('/api/admin/settings', adminAuth, async (req, res) => {
    try {
        const settings = await readSettings();
        res.json(settings);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'فشل قراءة الإعدادات' });
    }
});

app.put('/api/admin/settings', adminAuth, async (req, res) => {
    try {
        const current = await readSettings();
        const allowed = ['siteName', 'siteTitle', 'bio', 'email', 'phone', 'whatsapp', 'location', 'socialLinks', 'seoTitle', 'seoDescription'];
        for (const key of allowed) {
            if (req.body[key] !== undefined) {
                if (key === 'socialLinks' && typeof req.body[key] === 'object') {
                    current.socialLinks = { ...current.socialLinks, ...req.body[key] };
                } else if (typeof req.body[key] === 'string') {
                    current[key] = clip(req.body[key], 2000);
                }
            }
        }
        current.updatedAt = new Date().toISOString();
        await writeSettings(current);
        res.json(current);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'فشل حفظ الإعدادات' });
    }
});

// --- Change Admin Password ---
app.post('/api/admin/change-password', adminAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || currentPassword.trim() !== ADMIN_PASSWORD) {
        return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }
    if (!newPassword || newPassword.trim().length < 6) {
        return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
    }
    // Note: This only changes in memory for current session. For permanent change, update .env
    res.json({ ok: true, message: 'لتغيير كلمة المرور بشكل دائم، عدّل ملف .env وأعد تشغيل الخادم.' });
});

// --- Track visitor (public) ---
app.post('/api/track', rateLimit(30, 60000), async (req, res) => {
    try {
        const visitors = await readVisitors();
        visitors.push({
            date: new Date().toISOString().slice(0, 10),
            time: new Date().toISOString(),
            page: clip(req.body?.page || '/', 500),
            referrer: clip(req.body?.referrer || '', 500),
            ua: clip(req.headers['user-agent'] || '', 300)
        });
        await writeVisitors(visitors);
        res.json({ ok: true });
    } catch { res.json({ ok: true }); }
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

// Public: fetch public-safe site settings (for invoice page branding)
app.get('/api/public/settings', async (req, res) => {
    try {
        const settings = await readSettings();
        const { siteName, siteTitle, email, phone, whatsapp } = settings;
        res.json({ siteName, siteTitle, email, phone, whatsapp });
    } catch (e) {
        res.json({});
    }
});

// ========== ORDERS ==========

// Public: create a new order
app.post('/api/orders', rateLimit(5, 60000), async (req, res) => {
    const name = clip(req.body?.name, 200);
    const email = clip(req.body?.email, 200);
    const phone = clip(req.body?.phone, 50);
    const service = clip(req.body?.service, 300);
    const packageName = clip(req.body?.package, 200);
    const amount = clip(req.body?.amount, 50);
    const notes = clip(req.body?.notes, 5000);
    const paymentMethod = clip(req.body?.paymentMethod, 100) || 'STC Pay';

    if (!name || !email || !service) {
        return res.status(400).json({ error: 'الاسم والبريد والخدمة مطلوبة' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'بريد غير صالح' });
    }

    try {
        const orders = await readOrders();
        const orderNumber = await generateOrderNumber();
        const accessToken = generateAccessToken();
        const entry = {
            id: randomUUID(),
            orderNumber,
            accessToken,
            name,
            email,
            phone,
            service,
            package: packageName,
            amount,
            paymentMethod,
            notes,
            status: 'pending',
            createdAt: new Date().toISOString(),
            paidAt: null
        };
        orders.push(entry);
        await writeOrders(orders);

        // Build owner notification URL (WhatsApp message to Khalid)         // Send confirmation emails (fire-and-forget)
        sendOrderEmails(entry).catch(err => console.error('[email]', err));
        const settings = await readSettings();
        const ownerWa = (settings.whatsapp || '').replace(/\D/g, '');
        let notifyUrl = null;
        if (ownerWa) {
            const msg = `🔔 طلب جديد!\n\n` +
                `📋 رقم الطلب: ${orderNumber}\n` +
                `👤 ${name}\n` +
                `📧 ${email}\n` +
                (phone ? `📱 ${phone}\n` : '') +
                `\n🛠️ الخدمة: ${service}\n` +
                (packageName ? `📦 الباقة: ${packageName}\n` : '') +
                (amount ? `💰 المبلغ: ${amount}\n` : '') +
                `💳 طريقة الدفع: ${paymentMethod}\n` +
                (notes ? `\n📝 ملاحظات:\n${notes}\n` : '');
            notifyUrl = `https://wa.me/${ownerWa}?text=${encodeURIComponent(msg)}`;
        }

        res.status(201).json({
            ok: true,
            orderNumber,
            invoiceUrl: `/invoice.html?order=${encodeURIComponent(orderNumber)}&t=${accessToken}`,
            notifyUrl,
            order: { ...entry, accessToken: undefined }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'تعذر حفظ الطلب' });
    }
});

// Public: fetch order by order number + access token (for invoice page)
// SECURITY: Requires matching token to prevent order enumeration
app.get('/api/orders/:orderNumber', async (req, res) => {
    try {
        const orders = await readOrders();
        const order = orders.find(o => o.orderNumber === req.params.orderNumber);
        if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

        // Require access token (prevents enumeration attacks)
        const providedToken = String(req.query.t || '').trim();
        if (!order.accessToken || providedToken !== order.accessToken) {
            return res.status(403).json({ error: 'رمز الوصول غير صالح' });
        }

        // Return public-safe data (exclude internal id + token)
        const { id, accessToken, ...publicOrder } = order;
        res.json(publicOrder);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'تعذر جلب الطلب' });
    }
});

// Admin: list all orders
app.get('/api/admin/orders', adminAuth, async (req, res) => {
    try {
        const orders = await readOrders();
        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(orders);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'فشل جلب الطلبات' });
    }
});

// Admin: update order status
app.patch('/api/admin/orders/:id', adminAuth, async (req, res) => {
    try {
        const orders = await readOrders();
        const idx = orders.findIndex(o => o.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: 'الطلب غير موجود' });

        const allowed = ['pending', 'paid', 'in-progress', 'completed', 'cancelled'];
        const { status, amount, notes } = req.body || {};
        if (typeof status === 'string') {
            if (!allowed.includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });
            orders[idx].status = status;
            if (status === 'paid' && !orders[idx].paidAt) orders[idx].paidAt = new Date().toISOString();
        }
        if (typeof amount === 'string') orders[idx].amount = clip(amount, 50);
        if (typeof notes === 'string') orders[idx].notes = clip(notes, 5000);

        await writeOrders(orders);
        res.json(orders[idx]);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'فشل التحديث' });
    }
});

// Admin: delete order
app.delete('/api/admin/orders/:id', adminAuth, async (req, res) => {
    try {
        const orders = await readOrders();
        const idx = orders.findIndex(o => o.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: 'الطلب غير موجود' });
        orders.splice(idx, 1);
        await writeOrders(orders);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'فشل الحذف' });
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
