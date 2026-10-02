import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'http://127.0.0.1:8790';
const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK/11.0';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}
function getJSON(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          assert.equal(response.statusCode, 200);
          resolve(JSON.parse(body));
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error('HTTP timeout')));
    request.on('error', reject);
  });
}

// Minimal RFC 6455 transport: masked client frames, fragmentation, ping and CDP IDs.
export async function connect(address) {
  const url = new URL(address);
  const socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
  const key = randomBytes(16).toString('base64');
  const expected = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const pending = new Map();
  const events = [];
  let onEvent=()=>{};
  let sequence = 0;
  let buffer = Buffer.alloc(0);
  let fragments = [];
  let upgraded = false;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const timer = setTimeout(() => socket.destroy(new Error('WebSocket upgrade timeout')), 5000);
  function fail(error) {
    clearTimeout(timer);
    readyReject(error);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
  function sendFrame(payload, opcode = 1) {
    const mask = randomBytes(4);
    const size = payload.length;
    const header = Buffer.alloc(size < 126 ? 2 : size < 65536 ? 4 : 10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | (size < 126 ? size : size < 65536 ? 126 : 127);
    if (size >= 126 && size < 65536) header.writeUInt16BE(size, 2);
    else if (size >= 65536) header.writeBigUInt64BE(BigInt(size), 2);
    const encoded = Buffer.from(payload);
    for (let i = 0; i < size; i++) encoded[i] ^= mask[i % 4];
    socket.write(Buffer.concat([header, mask, encoded]));
  }
  socket.on('connect', () => socket.write([
    `GET ${url.pathname}${url.search} HTTP/1.1`, `Host: ${url.host}`,
    'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13', '', ''
  ].join('\r\n')));
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('CDP socket closed')));
  socket.on('data', chunk => {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const header = buffer.subarray(0, end).toString();
        assert.match(header, /^HTTP\/1\.1 101/);
        assert.ok(header.toLowerCase().includes(`sec-websocket-accept: ${expected}`.toLowerCase()));
        buffer = buffer.subarray(end + 4);
        upgraded = true;
        clearTimeout(timer);
        readyResolve();
      }
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15;
        const final = Boolean(buffer[0] & 128);
        assert.equal(buffer[1] & 128, 0, 'Server frames must be unmasked');
        let length = buffer[1] & 127;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2); offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2)); offset = 10;
        }
        if (buffer.length < offset + length) return;
        const payload = buffer.subarray(offset, offset + length);
        buffer = buffer.subarray(offset + length);
        if (opcode === 8) { socket.end(); return; }
        if (opcode === 9) { sendFrame(payload, 10); continue; }
        if (opcode === 10) continue;
        assert.ok(opcode === 0 || opcode === 1);
        fragments.push(payload);
        if (!final) continue;
        const message = JSON.parse(Buffer.concat(fragments).toString());
        fragments = [];
        if (message.id) {
          const item = pending.get(message.id);
          if (!item) continue;
          clearTimeout(item.timer);
          pending.delete(message.id);
          if (message.error) item.reject(new Error(JSON.stringify(message.error)));
          else item.resolve(message.result);
        } else {events.push(message); onEvent(message);}
      }
    } catch (error) { fail(error); socket.destroy(); }
  });
  await ready;
  return {
    events,
    setHandler(fn){onEvent=fn;},
    close: () => socket.destroy(),
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timer });
        sendFrame(Buffer.from(JSON.stringify({ id, method, params })));
      });
    }
  };
}


export {until, getJSON, delay};
