const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const app = require('../server');

function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request({
      method,
      host: '127.0.0.1',
      port: server.address().port,
      path,
      headers: payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        : undefined
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function requestWithHeaders(server, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request({
      method,
      host: '127.0.0.1',
      port: server.address().port,
      path,
      headers: {
        ...headers,
        ...(payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          : {})
      }
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: data ? JSON.parse(data) : null
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signWithdrawalAssertion(secret, claims) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iss: 'tegas-license',
    aud: 'tegasfx-license-withdrawal',
    purpose: 'license_withdrawal',
    iat: now,
    exp: now + 120,
    ...claims
  });
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

const validWithdrawalBody = {
  userId: 123,
  sid: 'wallet-sid',
  login: '900001',
  amount: 12.34,
  currency: 'USD',
  psp: 35,
  vendorTransactionId: 'tx_123',
  feeKind: 'license_purchase',
  type: 'withdrawal'
};

function withdrawalClaims(overrides = {}) {
  return {
    sub: '123',
    userId: 123,
    sid: 'wallet-sid',
    login: '900001',
    amount: 12.34,
    currency: 'USD',
    psp: 35,
    vendorTransactionId: 'tx_123',
    feeKind: 'license_purchase',
    feeAmount: 12.34,
    feeCurrency: 'USD',
    ...overrides
  };
}

test('dangerous legacy CRM endpoints are permanently disabled', async () => {
  const server = app.listen(0);
  try {
    for (const [method, path] of [
      ['POST', '/rest/user/set_password?version=1.0.0'],
      ['POST', '/rest/user/direct_login?version=1.0.0'],
      ['POST', '/rest/transactions/withdrawals/new?version=1.0.0'],
      ['POST', '/encrypt-key']
    ]) {
      const response = await request(server, method, path, { any: 'body' });
      assert.equal(response.status, 410);
      assert.equal(response.body.error, 'crm_proxy_disabled');
    }
  } finally {
    server.close();
  }
});

test('health reports CRM proxy disabled', async () => {
  const server = app.listen(0);
  try {
    const response = await request(server, 'GET', '/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.crmProxyEnabled, false);
  } finally {
    server.close();
  }
});

test('license withdrawal endpoint requires the license app key', async () => {
  const server = app.listen(0);
  try {
    const response = await request(server, 'POST', '/api/v1/license/withdrawals/new', {});
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'missing_api_key');
  } finally {
    server.close();
  }
});

test('license withdrawal endpoint forwards only the fixed withdrawal route', async () => {
  const previousKey = process.env.LICENSE_APP_API_KEY;
  const previousBlocked = process.env.BLOCKED_USER_IDS;
  const previousSecret = process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET;
  process.env.LICENSE_APP_API_KEY = 'license-secret';
  process.env.BLOCKED_USER_IDS = '999';
  process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET = 'assertion-secret';
  const calls = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'wd_123', ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const server = app.listen(0);
  try {
    const response = await requestWithHeaders(
      server,
      'POST',
      '/api/v1/license/withdrawals/new',
      validWithdrawalBody,
      {
        Authorization: 'Bearer license-secret',
        'x-tegas-withdrawal-assertion': signWithdrawalAssertion('assertion-secret', withdrawalClaims())
      }
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://secure.tegasfx.com/rest/transactions/withdrawals/new');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      sid: 'wallet-sid',
      login: '900001',
      amount: 12.34,
      currency: 'USD',
      psp: 35,
      vendorTransactionId: 'tx_123',
      type: 'withdrawal'
    });
  } finally {
    server.close();
    global.fetch = previousFetch;
    process.env.LICENSE_APP_API_KEY = previousKey;
    process.env.BLOCKED_USER_IDS = previousBlocked;
    process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET = previousSecret;
  }
});

test('license withdrawal endpoint fails closed when assertion secret is missing', async () => {
  const previousKey = process.env.LICENSE_APP_API_KEY;
  const previousSecret = process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET;
  process.env.LICENSE_APP_API_KEY = 'license-secret';
  delete process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET;
  const calls = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'wd_123', ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const server = app.listen(0);
  try {
    const response = await requestWithHeaders(
      server,
      'POST',
      '/api/v1/license/withdrawals/new',
      validWithdrawalBody,
      { Authorization: 'Bearer license-secret' }
    );
    assert.equal(response.status, 500);
    assert.equal(response.body.error, 'withdrawal_assertion_not_configured');
    assert.equal(calls.length, 0);
  } finally {
    server.close();
    global.fetch = previousFetch;
    process.env.LICENSE_APP_API_KEY = previousKey;
    process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET = previousSecret;
  }
});

test('license withdrawal assertion is required when configured', async () => {
  const previousKey = process.env.LICENSE_APP_API_KEY;
  const previousSecret = process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET;
  process.env.LICENSE_APP_API_KEY = 'license-secret';
  process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET = 'assertion-secret';
  const server = app.listen(0);
  try {
    const response = await requestWithHeaders(
      server,
      'POST',
      '/api/v1/license/withdrawals/new',
      validWithdrawalBody,
      { Authorization: 'Bearer license-secret' }
    );
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'missing_withdrawal_assertion');
  } finally {
    server.close();
    process.env.LICENSE_APP_API_KEY = previousKey;
    process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET = previousSecret;
  }
});

test('license withdrawal assertion must match the request body', async () => {
  const previousKey = process.env.LICENSE_APP_API_KEY;
  const previousSecret = process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET;
  process.env.LICENSE_APP_API_KEY = 'license-secret';
  process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET = 'assertion-secret';
  const server = app.listen(0);
  try {
    const assertion = signWithdrawalAssertion('assertion-secret', withdrawalClaims({ userId: 456, sub: '456' }));
    const response = await requestWithHeaders(
      server,
      'POST',
      '/api/v1/license/withdrawals/new',
      validWithdrawalBody,
      {
        Authorization: 'Bearer license-secret',
        'x-tegas-withdrawal-assertion': assertion
      }
    );
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'withdrawal_assertion_mismatch');

    const genericAssertion = signWithdrawalAssertion('assertion-secret', {
      sub: '123',
      userId: 123,
      sid: 'wallet-sid',
      login: '900001',
      amount: 12.34,
      currency: 'USD',
      psp: 35,
      vendorTransactionId: 'tx_123'
    });
    const genericResponse = await requestWithHeaders(
      server,
      'POST',
      '/api/v1/license/withdrawals/new',
      validWithdrawalBody,
      {
        Authorization: 'Bearer license-secret',
        'x-tegas-withdrawal-assertion': genericAssertion
      }
    );
    assert.equal(genericResponse.status, 401);
    assert.equal(genericResponse.body.error, 'invalid_withdrawal_assertion');
  } finally {
    server.close();
    process.env.LICENSE_APP_API_KEY = previousKey;
    process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET = previousSecret;
  }
});

test('license withdrawal endpoint requires an allowed fee kind bound to the assertion', async () => {
  const previousKey = process.env.LICENSE_APP_API_KEY;
  const previousSecret = process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET;
  process.env.LICENSE_APP_API_KEY = 'license-secret';
  process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET = 'assertion-secret';
  const server = app.listen(0);
  try {
    const missingFeeKind = await requestWithHeaders(
      server,
      'POST',
      '/api/v1/license/withdrawals/new',
      { ...validWithdrawalBody, feeKind: undefined },
      {
        Authorization: 'Bearer license-secret',
        'x-tegas-withdrawal-assertion': signWithdrawalAssertion('assertion-secret', withdrawalClaims())
      }
    );
    assert.equal(missingFeeKind.status, 400);
    assert.equal(missingFeeKind.body.error, 'invalid_withdrawal_request');

    const mismatchedFeeKind = await requestWithHeaders(
      server,
      'POST',
      '/api/v1/license/withdrawals/new',
      validWithdrawalBody,
      {
        Authorization: 'Bearer license-secret',
        'x-tegas-withdrawal-assertion': signWithdrawalAssertion(
          'assertion-secret',
          withdrawalClaims({ feeKind: 'sales_booster_purchase' })
        )
      }
    );
    assert.equal(mismatchedFeeKind.status, 401);
    assert.equal(mismatchedFeeKind.body.error, 'withdrawal_assertion_mismatch');
  } finally {
    server.close();
    process.env.LICENSE_APP_API_KEY = previousKey;
    process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET = previousSecret;
  }
});

test('license withdrawal endpoint accepts a matching short-lived assertion', async () => {
  const previousKey = process.env.LICENSE_APP_API_KEY;
  const previousSecret = process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET;
  process.env.LICENSE_APP_API_KEY = 'license-secret';
  process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET = 'assertion-secret';
  const calls = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: 'wd_123', ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const server = app.listen(0);
  try {
    const assertion = signWithdrawalAssertion('assertion-secret', withdrawalClaims());
    const response = await requestWithHeaders(
      server,
      'POST',
      '/api/v1/license/withdrawals/new',
      validWithdrawalBody,
      {
        Authorization: 'Bearer license-secret',
        'x-tegas-withdrawal-assertion': assertion
      }
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
  } finally {
    server.close();
    global.fetch = previousFetch;
    process.env.LICENSE_APP_API_KEY = previousKey;
    process.env.LICENSE_APP_WITHDRAWAL_ASSERTION_SECRET = previousSecret;
  }
});

test('license withdrawal endpoint blocks configured users', async () => {
  const previousKey = process.env.LICENSE_APP_API_KEY;
  const previousBlocked = process.env.BLOCKED_USER_IDS;
  process.env.LICENSE_APP_API_KEY = 'license-secret';
  process.env.BLOCKED_USER_IDS = '999';
  const server = app.listen(0);
  try {
    const response = await requestWithHeaders(
      server,
      'POST',
      '/api/v1/license/withdrawals/new',
      {
        userId: 999,
        sid: 'wallet-sid',
        login: '900001',
        amount: 12.34,
        currency: 'USD',
        psp: 35,
        vendorTransactionId: 'tx_123',
        type: 'withdrawal'
      },
      { Authorization: 'Bearer license-secret' }
    );
    assert.equal(response.status, 403);
    assert.equal(response.body.error, 'user_blocked');
  } finally {
    server.close();
    process.env.LICENSE_APP_API_KEY = previousKey;
    process.env.BLOCKED_USER_IDS = previousBlocked;
  }
});
