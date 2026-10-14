'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');
const [java, classpath, variant] = process.argv.slice(2);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const child = spawn(java, ['-XX:ActiveProcessorCount=1', '-cp', classpath, 'com.mct.test.WebSocketRegressionHarness', variant], { stdio: ['pipe', 'pipe', 'pipe'] });
const lines = [];
const peers = [];
let buffer = '', stderr = '', exited = false, peerNumber = 0;
child.on('exit', () => { exited = true; });
child.stdout.on('data', data => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) { lines.push(buffer.slice(0, end).trim()); buffer = buffer.slice(end + 1); }
});
child.stderr.on('data', data => { stderr += data; });
async function until(predicate, description, timeout = 1500) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`${variant}: timed out: ${description}; stdout=${lines.join('|')}; stderr=${stderr}`);
    await sleep(3);
  }
}
async function line(prefix, from = 0, timeout = 1500) {
  await until(() => lines.slice(from).some(value => value.startsWith(prefix)), prefix, timeout);
  return lines.slice(from).find(value => value.startsWith(prefix));
}
function command(value) { child.stdin.write(value + '\n'); }
async function control(value, reply) { const from = lines.length; command(value); return line(reply, from); }
class Peer {
  constructor(ws) {
    this.ws = ws;
    this.id = ++peerNumber;
    this.next = 0;
    this.responses = [];
    this.errors = [];
    ws.on('message', raw => {
      try { this.responses.push(JSON.parse(raw)); }
      catch (error) { this.errors.push(error.message); }
    });
    ws.on('error', error => this.errors.push(error.message));
    peers.push(this);
  }
  send(action, params = {}, timeoutMs = 1500, id = `p${this.id}-${++this.next}`) {
    const request = { id, action, params };
    if (timeoutMs !== undefined) request.timeoutMs = timeoutMs;
    this.ws.send(JSON.stringify(request));
    return id;
  }
  async response(id, timeout = 1500) {
    await until(() => this.responses.some(value => value.id === id), `response ${id}`, timeout);
    const matches = this.responses.filter(value => value.id === id);
    assert.equal(matches.length, 1, `Duplicate reply ${id}`);
    return matches[0];
  }
  async request(action, params = {}, timeoutMs = 1500) { return this.response(this.send(action, params, timeoutMs)); }
  async close(mode = 'graceful') {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    const closed = once(this.ws, 'close');
    mode === 'terminate' ? this.ws.terminate() : this.ws.close();
    await Promise.race([closed, sleep(700).then(() => { throw new Error(`Close hung: ${mode}`); })]);
  }
}
let url;
async function connect() {
  const deadline = Date.now() + 1000;
  for (;;) {
    const ws = new WebSocket(url, { handshakeTimeout: 600 });
    try { await once(ws, 'open'); return new Peer(ws); }
    catch (error) { ws.terminate(); if (Date.now() >= deadline) throw error; await sleep(10); }
  }
}
function checkError(response, error, phase, unknown) {
  assert.equal(response.success, false, JSON.stringify(response));
  assert.equal(response.error, error, JSON.stringify(response));
  assert.equal(response.details.phase, phase);
  assert.equal(response.details.resultUnknown, unknown);
}
function pass(name) { console.log(`PASS ${variant}: ${name}`); }
async function status(peer) { const response = await peer.request('test.status'); assert.equal(response.success, true); return response.data; }
async function pending(label, expected) {
  const deadline = Date.now() + 500;
  let count;
  do {
    const reply = await control(`PENDING ${label}`, `PENDING ${label} `);
    count = Number(reply.split(' ').at(-1));
    if (count === expected) return;
    await sleep(5);
  } while (Date.now() < deadline);
  assert.equal(count, expected, `pending queue ${label}`);
}
async function main() {
  const started = Date.now();
  url = 'ws://127.0.0.1:' + (await line('READY ')).split(' ')[1];
  // Deliberately block the first-ever socket, without warming selector buffers.
  const first = await connect();
  const blocked = first.send('test.block', { token: 'fresh-block' });
  await line('ACTION fresh-block');
  const handshakeAt = Date.now();
  const other = await connect();
  assert.equal((await other.request('test.echo', { token: 'independent' })).success, true);
  assert.ok(Date.now() - handshakeAt < 500, 'Second socket must remain responsive while first handler blocks');
  const fifo = [0, 1, 2].map(i => first.send('test.echo', { token: `fifo-${i}` }));
  await sleep(20);
  assert.equal(first.responses.length, 0);
  command('RELEASE fresh-block');
  await first.response(blocked);
  for (let i = 0; i < fifo.length; i++) assert.equal((await first.response(fifo[i])).data.token, `fifo-${i}`);
  assert.deepEqual(first.responses.map(value => value.id), [blocked, ...fifo]);
  pass('fresh-first socket isolation, FIFO and request IDs');

  const busyBlock = first.send('test.block', { token: 'busy-block' });
  await line('ACTION busy-block');
  const flood = Array.from({ length: 24 }, (_, i) => first.send('test.echo', { token: `flood-${i}` }));
  const admissionAt = Date.now();
  await until(() => first.responses.filter(value => flood.includes(value.id) && value.error === 'CLIENT_BUSY').length >= 8, 'immediate busy responses', 500);
  assert.ok(Date.now() - admissionAt < 500);
  assert.equal((await other.request('test.echo', { token: 'healthy-during-overload' })).success, true);
  const busy = first.responses.filter(value => flood.includes(value.id) && value.error === 'CLIENT_BUSY');
  busy.forEach(value => checkError(value, 'CLIENT_BUSY', 'admission', false));
  assert.equal(busy.length, 8);
  command('RELEASE busy-block');
  await first.response(busyBlock);
  const floodResponses = await Promise.all(flood.map(id => first.response(id)));
  assert.equal(floodResponses.filter(value => value.success).length, 16);
  const floodActions = (await status(other)).actions.filter(value => value.startsWith('flood-'));
  assert.deepEqual(floodActions, Array.from({ length: 16 }, (_, i) => `flood-${i}`));
  pass('bounded per-connection overload rejects immediately without disturbing another socket');

  const execution = first.send('test.block', { token: 'deadline-active' }, 50);
  checkError(await first.response(execution), 'TIMEOUT', 'execution', true);
  await line('INTERRUPTED deadline-active');
  const queueBlock = first.send('test.block', { token: 'queue-block' });
  await line('ACTION queue-block');
  const queued = first.send('test.effect', { token: 'queue-expired' }, 40);
  checkError(await first.response(queued), 'TIMEOUT', 'queue', false);
  command('RELEASE queue-block');
  assert.equal((await first.response(queueBlock)).success, true);
  let current = await status(other);
  assert.ok(!current.actions.includes('queue-expired'));
  assert.ok(!current.effects.includes('queue-expired'));
  pass('explicit queue/execution deadlines and outcome-unknown framing');

  await control('PAUSE', 'PAUSED');
  const waitingMain = first.send('test.effect', { token: 'deadline-awaiting-main' }, 50);
  await line('ACTION deadline-awaiting-main');
  await pending('deadline-awaiting-main', 1);
  checkError(await first.response(waitingMain), 'TIMEOUT', 'execution', true);
  await pending('deadline-main-cancelled', 0);
  await control('RESUME', 'RESUMED');
  current = await status(other);
  assert.ok(!current.effects.includes('deadline-awaiting-main'));
  pass('execution deadline removes a not-yet-started game task before ticks resume');

  const invalidTokens = ['-1', '0', '1.5', 'NaN', '1e309', '1e2147483647', '1e-2147483647', '1' + '0'.repeat(65), '1.' + '0'.repeat(65), '9007199254740993', '86400001', '1.0000000000000001', '86400000.000000001', 'null', '"50"', 'true'];
  for (let i = 0; i < invalidTokens.length; i++) {
    const id = `malformed-${i}`;
    first.ws.send(`{"id":"${id}","action":"test.effect","params":{"token":"${id}"},"timeoutMs":${invalidTokens[i]}}`);
    checkError(await first.response(id), 'INVALID_PARAMS', 'validation', false);
  }
  current = await status(other);
  assert.ok(!current.actions.some(value => value.startsWith('malformed-')));
  assert.equal((await first.request('test.echo', { token: 'maximum-valid' }, 86400000)).success, true);
  pass('negative, zero, fractional, NaN, overflow and wrong-type budgets rejected before actions');

  // The harness changes only the service default budget to 80ms for a fast compatibility test.
  const oldId = 'old-missing-budget';
  first.ws.send(JSON.stringify({ id: oldId, action: 'test.block', params: { token: oldId } }));
  await line('ACTION ' + oldId);
  await sleep(140);
  assert.ok(!first.responses.some(value => value.id === oldId), 'Missing budget must not expire executing old handlers');
  command('RELEASE ' + oldId);
  assert.equal((await first.response(oldId)).success, true);
  pass('missing timeoutMs preserves long-handler compatibility beyond the default queue budget');

  for (const mode of ['graceful', 'terminate']) {
    await control('PAUSE', 'PAUSED');
    const doomed = await connect();
    const token = `close-${mode}`;
    doomed.send('test.effect', { token });
    await line('ACTION ' + token);
    await pending(token, 1);
    // Also cancel another command still waiting in this connection's dispatcher lane.
    doomed.send('test.effect', { token: token + '-lane' });
    await doomed.close(mode);
    await pending(token + '-cancelled', 0);
    await control('RESUME', 'RESUMED');
    await sleep(15);
    current = await status(other);
    assert.ok(!current.effects.includes(token));
    assert.ok(!current.actions.includes(token + '-lane'));
    assert.equal(doomed.responses.length, 0);
  }
  pass('normal close and TCP terminate cancel queued main-thread tasks and queued lane actions');

  const startedToken = 'already-running-effect';
  const active = first.send('test.startedEffect', { token: startedToken }, 50);
  await line('EFFECT_STARTED ' + startedToken);
  checkError(await first.response(active), 'TIMEOUT', 'execution', true);
  command('RELEASE ' + startedToken);
  await line('EFFECT_COMPLETE ' + startedToken);
  current = await status(other);
  assert.ok(current.effects.includes(startedToken));
  assert.equal(current.effectInterrupts, 0);
  for (const mode of ['graceful', 'terminate']) {
    const doomed = await connect();
    const token = `started-close-${mode}`;
    doomed.send('test.startedEffect', { token });
    await line('EFFECT_STARTED ' + token);
    await doomed.close(mode);
    command('RELEASE ' + token);
    await line('EFFECT_COMPLETE ' + token);
    current = await status(other);
    assert.ok(current.effects.includes(token));
    assert.equal(current.effectInterrupts, 0);
    assert.equal(doomed.responses.length, 0);
  }
  pass('started game-thread effects are never interrupted or falsely reported as undone');

  // The legacy 64-bit length header used to shift an int and corrupt this frame.
  const pongs = [];
  first.ws.on('pong', bytes => pongs.push(bytes.toString()));
  const large = first.send('test.large');
  for (let i = 0; i < 8; i++) first.ws.ping(`probe-${i}`);
  const largeReply = await first.response(large);
  assert.equal(largeReply.data.payload.length, 100000);
  assert.equal(largeReply.data.payload, 'x'.repeat(100000));
  await until(() => pongs.length === 8, 'concurrent ping/pong frames');
  assert.deepEqual(pongs, Array.from({ length: 8 }, (_, i) => `probe-${i}`));
  pass('100,000-byte response and concurrent control frames remain intact');

  // Stop while a worker is waiting on a queued fake game task, with both sockets open.
  await control('PAUSE', 'PAUSED');
  first.send('test.effect', { token: 'shutdown-effect' });
  await line('ACTION shutdown-effect');
  await pending('shutdown', 1);
  const exitPromise = once(child, 'exit');
  command('STOP');
  assert.equal(await line('STOPPED '), 'STOPPED []');
  const [code] = await Promise.race([exitPromise, sleep(1500).then(() => { throw new Error('JVM did not exit'); })]);
  assert.equal(code, 0);
  await until(() => peers.every(peer => peer.ws.readyState === WebSocket.CLOSED), 'shutdown closes every socket');
  for (const peer of peers) {
    assert.deepEqual(peer.errors, []);
    assert.equal(new Set(peer.responses.map(value => value.id)).size, peer.responses.length, 'Exactly one response per ID');
  }
  assert.ok(!lines.includes('EFFECT_COMPLETE shutdown-effect'));
  pass(`shutdown closes sockets, cancels pending work and reclaims dispatcher threads (${Date.now() - started}ms)`);
}
main().catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
}).finally(async () => {
  for (const peer of peers) peer.ws.terminate();
  if (!exited) {
    child.stdin.end('STOP\n');
    await sleep(100);
    if (!exited) child.kill('SIGKILL');
  }
});
