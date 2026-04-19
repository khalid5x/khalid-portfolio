// ============================================
// Email notification module (Gmail SMTP via nodemailer)
// Used for: new order confirmation to client + alert to owner
// ============================================

import nodemailer from 'nodemailer';

const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
const OWNER_EMAIL = process.env.OWNER_EMAIL || GMAIL_USER;
const SITE_URL = process.env.SITE_URL || 'https://khalidtech.onrender.com';

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
        console.warn('[email] GMAIL_USER or GMAIL_APP_PASSWORD not set — emails disabled');
        return null;
    }
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    });
    return transporter;
}

export async function verifyEmailConfig() {
    const t = getTransporter();
    if (!t) return { ok: false, error: 'Email credentials missing' };
    try {
        await t.verify();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function clientOrderEmailHtml(order) {
    const invoiceLink = `${SITE_URL}/invoice.html?order=${encodeURIComponent(order.orderNumber)}&t=${order.accessToken}`;
    const e = escapeHtml;
    return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Tahoma,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border-radius:12px;overflow:hidden;max-width:600px;">
      <tr><td style="padding:32px 32px 16px;text-align:center;border-bottom:2px solid #d4af37;">
        <h1 style="margin:0;color:#d4af37;font-size:28px;letter-spacing:2px;">KHALID</h1>
        <p style="margin:8px 0 0;color:#a0a0a0;font-size:14px;">Tech Services &amp; Digital Solutions</p>
      </td></tr>
      <tr><td style="padding:32px;color:#e8e8e8;line-height:1.8;">
        <h2 style="color:#d4af37;margin:0 0 16px;font-size:22px;">شكراً لطلبك، ${e(order.name)} 🎉</h2>
        <p style="margin:0 0 20px;">تم استلام طلبك بنجاح. فيما يلي التفاصيل:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.3);border-radius:8px;padding:20px;margin:16px 0;">
          <tr><td style="padding:8px 0;"><strong style="color:#d4af37;">رقم الطلب:</strong></td><td style="padding:8px 0;font-family:Courier,monospace;font-size:16px;">${e(order.orderNumber)}</td></tr>
          <tr><td style="padding:8px 0;"><strong style="color:#d4af37;">الخدمة:</strong></td><td style="padding:8px 0;">${e(order.service)}</td></tr>
          ${order.package ? `<tr><td style="padding:8px 0;"><strong style="color:#d4af37;">الباقة:</strong></td><td style="padding:8px 0;">${e(order.package)}</td></tr>` : ''}
          ${order.amount ? `<tr><td style="padding:8px 0;"><strong style="color:#d4af37;">المبلغ:</strong></td><td style="padding:8px 0;">${e(order.amount)}</td></tr>` : ''}
          <tr><td style="padding:8px 0;"><strong style="color:#d4af37;">طريقة الدفع:</strong></td><td style="padding:8px 0;">${e(order.paymentMethod)}</td></tr>
        </table>
        <div style="text-align:center;margin:28px 0;">
          <a href="${invoiceLink}" style="background:#d4af37;color:#0a0a0a;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:bold;display:inline-block;">📄 عرض الفاتورة</a>
        </div>
        <p style="margin:24px 0 0;font-size:14px;color:#a0a0a0;">سنتواصل معك قريباً لإكمال التفاصيل. للاستفسار: <a href="https://wa.me/966509182112" style="color:#d4af37;">واتساب</a></p>
      </td></tr>
      <tr><td style="padding:16px 32px;text-align:center;background:rgba(255,255,255,0.02);border-top:1px solid rgba(212,175,55,0.2);">
        <p style="margin:0;font-size:12px;color:#a0a0a0;">© 2026 Khalid · <a href="${SITE_URL}" style="color:#d4af37;text-decoration:none;">${SITE_URL.replace(/^https?:\/\//, '')}</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function ownerOrderEmailHtml(order) {
    const invoiceLink = `${SITE_URL}/invoice.html?order=${encodeURIComponent(order.orderNumber)}&t=${order.accessToken}`;
    const adminLink = `${SITE_URL}/admin.html`;
    const e = escapeHtml;
    return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Tahoma,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;">
      <tr><td style="padding:24px 32px;background:#d4af37;color:#0a0a0a;">
        <h1 style="margin:0;font-size:22px;">🔔 طلب جديد!</h1>
        <p style="margin:4px 0 0;font-size:14px;">${e(order.orderNumber)}</p>
      </td></tr>
      <tr><td style="padding:24px 32px;color:#222;line-height:1.8;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:6px 0;color:#666;">👤 الاسم:</td><td style="padding:6px 0;"><strong>${e(order.name)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#666;">📧 البريد:</td><td style="padding:6px 0;"><a href="mailto:${e(order.email)}" style="color:#1a73e8;">${e(order.email)}</a></td></tr>
          ${order.phone ? `<tr><td style="padding:6px 0;color:#666;">📱 الجوال:</td><td style="padding:6px 0;">${e(order.phone)}</td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#666;">🛠️ الخدمة:</td><td style="padding:6px 0;">${e(order.service)}</td></tr>
          ${order.package ? `<tr><td style="padding:6px 0;color:#666;">📦 الباقة:</td><td style="padding:6px 0;">${e(order.package)}</td></tr>` : ''}
          ${order.amount ? `<tr><td style="padding:6px 0;color:#666;">💰 المبلغ:</td><td style="padding:6px 0;"><strong>${e(order.amount)}</strong></td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#666;">💳 الدفع:</td><td style="padding:6px 0;">${e(order.paymentMethod)}</td></tr>
        </table>
        ${order.notes ? `<div style="margin-top:16px;padding:12px;background:#f9f9f9;border-right:3px solid #d4af37;"><strong>📝 ملاحظات:</strong><br>${e(order.notes).replace(/\n/g, '<br>')}</div>` : ''}
        <div style="text-align:center;margin:24px 0 8px;">
          <a href="${adminLink}" style="background:#0a0a0a;color:#d4af37;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;display:inline-block;margin:4px;">لوحة الإدارة</a>
          <a href="${invoiceLink}" style="background:#d4af37;color:#0a0a0a;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;display:inline-block;margin:4px;">الفاتورة</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export async function sendOrderEmails(order) {
    const t = getTransporter();
    if (!t) return { clientSent: false, ownerSent: false, error: 'transporter not configured' };

    const results = { clientSent: false, ownerSent: false };

    // Email to client
    try {
        await t.sendMail({
            from: `"Khalid" <${GMAIL_USER}>`,
            to: order.email,
            subject: `تأكيد طلبك ${order.orderNumber} | Khalid`,
            html: clientOrderEmailHtml(order),
            text: `شكراً لطلبك يا ${order.name}!\nرقم الطلب: ${order.orderNumber}\nالخدمة: ${order.service}\nالفاتورة: ${SITE_URL}/invoice.html?order=${order.orderNumber}&t=${order.accessToken}`
        });
        results.clientSent = true;
    } catch (e) {
        console.error('[email] client send failed:', e.message);
        results.clientError = e.message;
    }

    // Email to owner
    try {
        await t.sendMail({
            from: `"Khalid Portfolio" <${GMAIL_USER}>`,
            to: OWNER_EMAIL,
            replyTo: order.email,
            subject: `🔔 طلب جديد ${order.orderNumber} — ${order.service}`,
            html: ownerOrderEmailHtml(order),
            text: `طلب جديد: ${order.orderNumber}\nمن: ${order.name} <${order.email}>\nالخدمة: ${order.service}\nالدفع: ${order.paymentMethod}`
        });
        results.ownerSent = true;
    } catch (e) {
        console.error('[email] owner send failed:', e.message);
        results.ownerError = e.message;
    }

    return results;
}

export async function sendContactMessageEmail(msg) {
    const t = getTransporter();
    if (!t) return { ok: false };
    try {
        const e = escapeHtml;
        await t.sendMail({
            from: `"Khalid Portfolio" <${GMAIL_USER}>`,
            to: OWNER_EMAIL,
            replyTo: msg.email,
            subject: `💬 رسالة جديدة: ${msg.subject}`,
            html: `<div style="font-family:Tahoma,Arial,sans-serif;direction:rtl;background:#fff;padding:24px;border-radius:8px;max-width:600px;">
                <h2 style="color:#d4af37;margin:0 0 16px;">💬 رسالة جديدة</h2>
                <p><strong>الاسم:</strong> ${e(msg.name)}</p>
                <p><strong>البريد:</strong> <a href="mailto:${e(msg.email)}">${e(msg.email)}</a></p>
                <p><strong>الموضوع:</strong> ${e(msg.subject)}</p>
                <div style="margin-top:16px;padding:12px;background:#f9f9f9;border-right:3px solid #d4af37;white-space:pre-wrap;">${e(msg.message)}</div>
            </div>`,
            text: `رسالة من ${msg.name} <${msg.email}>\nالموضوع: ${msg.subject}\n\n${msg.message}`
        });
        return { ok: true };
    } catch (e) {
        console.error('[email] contact send failed:', e.message);
        return { ok: false, error: e.message };
    }
}
