#!/usr/bin/env node
require('dotenv').config({ path: '.env.test' });

const http = require('http');

function post(path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: 'localhost', port: 3001, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  const CORRECT_KEY = process.env.WEBHOOK_SECRET;

  // 1. Yanlış API key → 401
  const r1 = await post('/webhook', { 'x-api-key': 'yanlis' }, {
    eventType: 'workitem.updated', resource: { id: 1, fields: {} }
  });
  console.log('1) Yanlış key:', r1.status, r1.body); // beklenen: 401

  // 2. Doğru key, "ai-agent" tag yok → 200 skipped
  const r2 = await post('/webhook', { 'x-api-key': CORRECT_KEY }, {
    eventType: 'workitem.updated',
    resource: { id: 42, fields: { 'System.Tags': 'other-tag', 'System.AssignedTo': { uniqueName: 'mustafa.tekin@flo.com.tr' } } }
  });
  console.log('2) Tag yok:', r2.status, r2.body); // beklenen: 200 skipped

  // 3. Doğru key, kullanıcı listede değil → 200 skipped
  const r3 = await post('/webhook', { 'x-api-key': CORRECT_KEY }, {
    eventType: 'workitem.updated',
    resource: { id: 43, fields: { 'System.Tags': 'ai-agent', 'System.AssignedTo': { uniqueName: 'biri@baska.com' } } }
  });
  console.log('3) Kullanıcı yok:', r3.status, r3.body); // beklenen: 200 skipped

  // 4. Her iki koşul sağlanıyor ama Redis'e erişilemiyor → duplicate için ilk geçiş
  const r4 = await post('/webhook', { 'x-api-key': CORRECT_KEY }, {
    eventType: 'workitem.updated',
    resource: { id: 100, fields: { 'System.Tags': 'ai-agent', 'System.AssignedTo': { uniqueName: 'mustafa.tekin@flo.com.tr' } } }
  });
  console.log('4) İlk geçiş (pipeline veya hata):', r4.status, r4.body);

  // 5. Aynı workItemId tekrar → 202 duplicate (Redis çalışıyorsa)
  const r5 = await post('/webhook', { 'x-api-key': CORRECT_KEY }, {
    eventType: 'workitem.updated',
    resource: { id: 100, fields: { 'System.Tags': 'ai-agent', 'System.AssignedTo': { uniqueName: 'mustafa.tekin@flo.com.tr' } } }
  });
  console.log('5) Duplicate:', r5.status, r5.body); // beklenen: 202

  // 6. Geçersiz payload → 400
  const r6 = await post('/webhook', { 'x-api-key': CORRECT_KEY }, {
    eventType: 'workitem.created'
  });
  console.log('6) Geçersiz payload:', r6.status, r6.body); // beklenen: 400
}

run().catch(console.error);
