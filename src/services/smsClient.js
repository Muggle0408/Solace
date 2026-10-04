// 短信验证码下发：腾讯云 SMS（TC3-HMAC-SHA256 签名直连，无 SDK 依赖）
// 未配置 TENCENT_SMS_* 密钥时走开发模拟：验证码打印到服务端日志并回显给前端
const crypto = require('crypto');
const axios = require('axios');

const ENDPOINT = 'sms.tencentcloudapi.com';
const SERVICE = 'sms';
const VERSION = '2021-01-11';
const REGION = 'ap-guangzhou';

function isConfigured() {
  return Boolean(
    process.env.TENCENT_SMS_SECRET_ID &&
    process.env.TENCENT_SMS_SECRET_KEY &&
    process.env.TENCENT_SMS_SDK_APP_ID &&
    process.env.TENCENT_SMS_SIGN_NAME &&
    process.env.TENCENT_SMS_TEMPLATE_ID
  );
}

const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s, 'utf8').digest();
const hmacHex = (key, s) => crypto.createHmac('sha256', key).update(s, 'utf8').digest('hex');

async function sendViaTencent(phone, code) {
  const secretId = process.env.TENCENT_SMS_SECRET_ID;
  const secretKey = process.env.TENCENT_SMS_SECRET_KEY;
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10); // TC3 签名用 UTC 日期

  const payload = JSON.stringify({
    PhoneNumberSet: [`+86${phone}`],
    SignName: process.env.TENCENT_SMS_SIGN_NAME,
    TemplateId: process.env.TENCENT_SMS_TEMPLATE_ID,
    TemplateParamSet: [code],
    SmsSdkAppId: process.env.TENCENT_SMS_SDK_APP_ID
  });

  const canonicalHeaders = `content-type:application/json\nhost:${ENDPOINT}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256hex(payload)].join('\n');
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac(`TC3${secretKey}`, date);
  const kService = hmac(kDate, SERVICE);
  const kSigning = hmac(kService, 'tc3_request');
  const signature = hmacHex(kSigning, stringToSign);
  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await axios.post(`https://${ENDPOINT}/`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Host: ENDPOINT,
      'X-TC-Action': 'SendSms',
      'X-TC-Version': VERSION,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': REGION,
      Authorization: authorization
    },
    timeout: 10000
  });

  const status = res.data && res.data.Response && res.data.Response.SendStatusSet
    && res.data.Response.SendStatusSet[0];
  if (!status || status.Code !== 'Ok') {
    throw new Error(`SMS_SEND_FAILED: ${status ? `${status.Code} ${status.Message}` : 'unknown response'}`);
  }
}

// 返回 { mock: boolean, devCode?: string }；真实发送失败时抛错
async function sendVerificationCode(phone, code) {
  if (!isConfigured()) {
    console.log(`[SMS 模拟] ${phone} 的登录验证码：${code}` +
      '（未配置 TENCENT_SMS_*，生产环境请设置密钥后自动切换真实发送）');
    return { mock: true, devCode: code };
  }
  await sendViaTencent(phone, code);
  return { mock: false };
}

module.exports = { sendVerificationCode, isConfigured };
