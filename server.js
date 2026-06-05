const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const Redis = require('ioredis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const SERVICE_NAME = 'tegasfx-api-gateway';
const usedWithdrawalAssertionIds = new Map();
let redisClient;

app.set('trust proxy', 1);

function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, false);
    callback(null, allowedOrigins().includes(origin));
  },
  credentials: false
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limited',
    message: 'Too many requests, please try again later.'
  }
}));

app.use(express.json({ limit: '64kb' }));
app.use(express.text({ type: 'text/*', limit: '64kb' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    crmProxyEnabled: false
  });
});

app.get('/ip', (req, res) => {
  res.json({ ip: req.ip });
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '='
  );
  return Buffer.from(padded, 'base64').toString('utf8');
}

function withdrawalAssertionSecret() {
  return (
    process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET ||
    process.env.TEGAS_CORE_WITHDRAWAL_ASSERTION_SECRET ||
    ''
  ).trim();
}

function signJwtInput(input, secret) {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function getRedisClient() {
  if (redisClient !== undefined) return redisClient;

  const url = String(process.env.REDIS_URL || '').trim();
  if (!url) {
    redisClient = null;
    return redisClient;
  }

  redisClient = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: false,
    lazyConnect: true
  });
  redisClient.on('error', (error) => {
    console.warn('Redis connection error:', error.message);
  });
  return redisClient;
}

async function assertWithdrawalAssertionNotReplayed(jti, exp) {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(1, exp - now);
  const redis = getRedisClient();

  if (redis) {
    try {
      if (redis.status === 'wait') {
        await redis.connect();
      }

      const result = await redis.set(`license-withdrawal:jti:${jti}`, '1', 'EX', ttlSeconds, 'NX');
      if (result !== 'OK') {
        throw Object.assign(new Error('Withdrawal assertion token id was already used'), {
          status: 401,
          code: 'replayed_withdrawal_assertion'
        });
      }
      return;
    } catch (error) {
      if (error.status) throw error;
      throw Object.assign(new Error('Withdrawal replay guard is unavailable'), {
        status: 503,
        code: 'withdrawal_replay_guard_unavailable'
      });
    }
  }

  for (const [usedJti, expiresAt] of usedWithdrawalAssertionIds.entries()) {
    if (expiresAt < now) {
      usedWithdrawalAssertionIds.delete(usedJti);
    }
  }

  if (usedWithdrawalAssertionIds.has(jti)) {
    throw Object.assign(new Error('Withdrawal assertion token id was already used'), {
      status: 401,
      code: 'replayed_withdrawal_assertion'
    });
  }

  usedWithdrawalAssertionIds.set(jti, exp);
}

function parseWithdrawalAssertion(req) {
  const secret = withdrawalAssertionSecret();
  if (!secret) {
    throw Object.assign(new Error('Withdrawal assertion verification is not configured'), {
      status: 500,
      code: 'withdrawal_assertion_not_configured'
    });
  }

  const token = String(req.get('x-tegas-withdrawal-assertion') || '').trim();
  if (!token) {
    throw Object.assign(new Error('Withdrawal assertion is required'), {
      status: 401,
      code: 'missing_withdrawal_assertion'
    });
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw Object.assign(new Error('Withdrawal assertion is malformed'), {
      status: 401,
      code: 'invalid_withdrawal_assertion'
    });
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = signJwtInput(`${encodedHeader}.${encodedPayload}`, secret);
  if (!timingSafeEqual(signature, expected)) {
    throw Object.assign(new Error('Withdrawal assertion signature is invalid'), {
      status: 401,
      code: 'invalid_withdrawal_assertion'
    });
  }

  let header;
  let claims;
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader));
    claims = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    throw Object.assign(new Error('Withdrawal assertion is invalid JSON'), {
      status: 401,
      code: 'invalid_withdrawal_assertion'
    });
  }

  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw Object.assign(new Error('Withdrawal assertion algorithm is not allowed'), {
      status: 401,
      code: 'invalid_withdrawal_assertion'
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof claims.exp === 'number' ? claims.exp : 0;
  const iat = typeof claims.iat === 'number' ? claims.iat : 0;
  if (exp < now || iat > now + 30 || exp - iat > 180) {
    throw Object.assign(new Error('Withdrawal assertion is expired'), {
      status: 401,
      code: 'expired_withdrawal_assertion'
    });
  }

  if (
    claims.iss !== 'tegas-license' ||
    claims.aud !== 'tegasfx-license-withdrawal' ||
    claims.purpose !== 'license_withdrawal'
  ) {
    throw Object.assign(new Error('Withdrawal assertion purpose is invalid'), {
      status: 401,
      code: 'invalid_withdrawal_assertion'
    });
  }

  const jti = typeof claims.jti === 'string' ? claims.jti.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jti)) {
    throw Object.assign(new Error('Withdrawal assertion token id is invalid'), {
      status: 401,
      code: 'invalid_withdrawal_assertion'
    });
  }

  const feeKind = typeof claims.feeKind === 'string' ? claims.feeKind : '';
  const feeAmount = Number(claims.feeAmount);
  const feeCurrency =
    typeof claims.feeCurrency === 'string' ? claims.feeCurrency.toUpperCase() : '';
  if (
    !allowedWithdrawalFeeKinds().has(feeKind) ||
    !Number.isFinite(feeAmount) ||
    feeAmount <= 0 ||
    !feeCurrency
  ) {
    throw Object.assign(new Error('Withdrawal assertion fee scope is invalid'), {
      status: 401,
      code: 'invalid_withdrawal_assertion'
    });
  }

  return claims;
}

function getBearerToken(req) {
  const authorization = req.get('authorization');
  if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = authorization.slice('bearer '.length).trim();
  return token || null;
}

function assertLicenseKey(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({
      error: 'missing_api_key',
      message: 'Authorization: Bearer API key is required'
    });
    return null;
  }

  const expectedHash =
    process.env.LICENSE_APP_API_KEY_HASH ||
    (process.env.LICENSE_APP_API_KEY ? sha256(process.env.LICENSE_APP_API_KEY) : '');

  if (!expectedHash) {
    res.status(500).json({
      error: 'license_app_key_not_configured',
      message: 'License app API key is not configured.'
    });
    return null;
  }

  if (!timingSafeEqual(sha256(token), expectedHash)) {
    res.status(401).json({
      error: 'invalid_api_key',
      message: 'API key is invalid'
    });
    return null;
  }

  return token;
}

function getPositiveNumber(body, key) {
  const value = body[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getRequiredString(body, key) {
  const value = body[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function blockedUserIds() {
  return (process.env.BLOCKED_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function allowedWithdrawalCurrencies() {
  return new Set(
    (process.env.LICENSE_APP_WITHDRAWAL_CURRENCIES || 'USD,EUR')
      .split(',')
      .map((currency) => currency.trim().toUpperCase())
      .filter(Boolean)
  );
}

function allowedWithdrawalPsps() {
  return new Set(
    (process.env.LICENSE_APP_WITHDRAWAL_PSPS || '35')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0)
  );
}

function allowedWithdrawalFeeKinds() {
  return new Set(
    (process.env.LICENSE_APP_WITHDRAWAL_FEE_KINDS || 'license_purchase,sales_booster_purchase')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function buildWithdrawalPayload(body) {
  const userId = String(body.userId ?? body.user_id ?? '').trim();
  const sid = getRequiredString(body, 'sid');
  const login = getRequiredString(body, 'login');
  const currency = getRequiredString(body, 'currency')?.toUpperCase();
  const vendorTransactionId = getRequiredString(body, 'vendorTransactionId');
  const type = getRequiredString(body, 'type');
  const feeKind = getRequiredString(body, 'feeKind');
  const amount = getPositiveNumber(body, 'amount');
  const psp = getPositiveNumber(body, 'psp');
  const pspDetail = getPositiveNumber(body, 'pspDetail');
  const comment = getRequiredString(body, 'comment');
  const mt4Comment = getRequiredString(body, 'mt4Comment');
  const maxAmount = process.env.LICENSE_APP_MAX_WITHDRAWAL_AMOUNT
    ? Number(process.env.LICENSE_APP_MAX_WITHDRAWAL_AMOUNT)
    : null;

  if (!/^\d+$/.test(userId)) {
    throw Object.assign(new Error('A positive userId is required'), { status: 400 });
  }
  if (blockedUserIds().includes(userId)) {
    throw Object.assign(new Error('Access denied for this user'), { status: 403 });
  }
  if (!sid || !login || !currency || !vendorTransactionId) {
    throw Object.assign(new Error('sid, login, currency, and vendorTransactionId are required'), { status: 400 });
  }
  if (!amount) {
    throw Object.assign(new Error('amount must be positive'), { status: 400 });
  }
  if (maxAmount && Number.isFinite(maxAmount) && amount > maxAmount) {
    throw Object.assign(new Error('amount exceeds the configured license withdrawal limit'), { status: 400 });
  }
  if (!psp || !Number.isInteger(psp)) {
    throw Object.assign(new Error('psp must be a positive integer'), { status: 400 });
  }
  if (!allowedWithdrawalPsps().has(psp)) {
    throw Object.assign(new Error('psp is not allowed for license withdrawals'), { status: 400 });
  }
  if (!allowedWithdrawalCurrencies().has(currency)) {
    throw Object.assign(new Error('currency is not allowed for license withdrawals'), { status: 400 });
  }
  if (pspDetail !== null && !Number.isInteger(pspDetail)) {
    throw Object.assign(new Error('pspDetail must be a positive integer when provided'), { status: 400 });
  }
  if (type && type !== 'withdrawal') {
    throw Object.assign(new Error('type must be withdrawal'), { status: 400 });
  }
  if (!feeKind || !allowedWithdrawalFeeKinds().has(feeKind)) {
    throw Object.assign(new Error('feeKind is not allowed for license withdrawals'), { status: 400 });
  }

  const payload = {
    sid,
    login,
    amount,
    currency,
    psp,
    vendorTransactionId,
    type: 'withdrawal'
  };
  if (pspDetail !== null) payload.pspDetail = pspDetail;
  if (comment) payload.comment = comment;
  if (mt4Comment) payload.mt4Comment = mt4Comment;
  return { userId, payload, feeKind };
}

async function assertWithdrawalAssertionMatches(req, userId, payload, feeKind) {
  const claims = parseWithdrawalAssertion(req);

  const expected = {
    sub: userId,
    userId: Number(userId),
    sid: payload.sid,
    login: payload.login,
    amount: payload.amount,
    currency: payload.currency,
    psp: payload.psp,
    vendorTransactionId: payload.vendorTransactionId,
    feeKind,
    feeAmount: payload.amount,
    feeCurrency: payload.currency
  };
  if (payload.pspDetail !== undefined) expected.pspDetail = payload.pspDetail;

  const mismatched = Object.entries(expected).some(([key, value]) => {
    if (typeof value === 'number') return Number(claims[key]) !== value;
    return String(claims[key] ?? '') !== String(value);
  });

  if (mismatched) {
    throw Object.assign(new Error('Withdrawal assertion does not match the request'), {
      status: 401,
      code: 'withdrawal_assertion_mismatch'
    });
  }

  await assertWithdrawalAssertionNotReplayed(claims.jti.trim(), claims.exp);
}

app.post('/api/v1/license/withdrawals/new', async (req, res, next) => {
  try {
    const token = assertLicenseKey(req, res);
    if (!token) return;

    const { userId, payload, feeKind } = buildWithdrawalPayload(req.body || {});
    await assertWithdrawalAssertionMatches(req, userId, payload, feeKind);
    const upstreamBaseUrl = (process.env.TEGASFX_API_BASE_URL || 'https://secure.tegasfx.com').replace(/\/+$/, '');
    const headers = {
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    };
    if (req.get('x-api-key')) headers['x-api-key'] = req.get('x-api-key');
    if (req.get('x-tegas-env')) headers['x-tegas-env'] = req.get('x-tegas-env');
    if (req.get('x-tegas-app')) headers['x-tegas-app'] = req.get('x-tegas-app');

    const response = await fetch(`${upstreamBaseUrl}/rest/transactions/withdrawals/new`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      redirect: 'manual'
    });

    const text = await response.text();
    res.status(response.status);
    res.type(response.headers.get('content-type') || 'application/json');
    res.set('Cache-Control', 'no-store');
    res.send(text);
  } catch (error) {
    if (error.status) {
      res.status(error.status).json({
        error: error.code || (error.status === 403 ? 'user_blocked' : 'invalid_withdrawal_request'),
        message: error.message
      });
      return;
    }
    next(error);
  }
});

app.get('/', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: 'online',
    crmProxyEnabled: false
  });
});

function crmProxyDisabled(req, res) {
  console.warn('Blocked disabled CRM proxy request', {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  res.status(410).json({
    error: 'crm_proxy_disabled',
    message: 'The TegasFX CRM REST proxy has been permanently disabled.'
  });
}

app.all('/rest', crmProxyDisabled);
app.all('/rest/*', crmProxyDisabled);
app.all('/encrypt-key', crmProxyDisabled);

app.all('*', (req, res) => {
  res.status(404).json({
    error: 'endpoint_not_found',
    message: 'This service no longer exposes TegasFX CRM REST proxy endpoints.',
    supportedPaths: ['/health', '/ip', '/api/v1/license/withdrawals/new']
  });
});

app.use((error, req, res, next) => {
  console.error('Unhandled error:', {
    message: error.message,
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  res.status(500).json({
    error: 'internal_server_error',
    message: 'An unexpected error occurred.'
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`${SERVICE_NAME} running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log('CRM REST proxy endpoints are disabled.');
  });
}

module.exports = app;
module.exports.setRedisClientForTests = (client) => {
  redisClient = client;
};
module.exports.resetReplayGuardsForTests = () => {
  usedWithdrawalAssertionIds.clear();
  redisClient = undefined;
};
