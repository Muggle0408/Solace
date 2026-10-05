// 邮箱验证码下发：SMTP 直连（nodemailer，纯 JS 无原生依赖）
// 未配置 SMTP_* 时走开发模拟：验证码打印到服务端日志并回显给前端
// QQ 邮箱：SMTP_HOST=smtp.qq.com PORT=465，SMTP_PASS 填「授权码」（设置→账号→开启 SMTP 后生成）
// 163 邮箱：SMTP_HOST=smtp.163.com PORT=465，同样用授权码
const nodemailer = require('nodemailer');

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function buildTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE === 'false' ? false : true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000
  });
}

// 返回 { mock: boolean, devCode?: string }；真实发送失败时抛错
async function sendCodeEmail(to, code) {
  if (!isConfigured()) {
    console.log(`[邮件模拟] ${to} 的登录验证码：${code}` +
      '（未配置 SMTP_*，生产环境请设置后自动切换真实发送）');
    return { mock: true, devCode: code };
  }
  await buildTransporter().sendMail({
    from: process.env.MAIL_FROM || `"情绪空间" <${process.env.SMTP_USER}>`,
    to,
    subject: '情绪空间登录验证码',
    text: `你的登录验证码是 ${code}，10 分钟内有效。为了账号安全，请勿泄露给他人。`,
    html:
      `<div style="font-family:sans-serif;padding:24px;background:#f0f7ff;border-radius:12px">` +
      `<p>你的登录验证码是：</p>` +
      `<p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#4a678f">${code}</p>` +
      `<p style="color:#8496ad">10 分钟内有效，请勿泄露给他人。</p></div>`
  });
  return { mock: false };
}

module.exports = { sendCodeEmail, isConfigured };
