#!/usr/bin/env node
// Real remapped client + isolated local server regression. Never substitutes a mock.
// Prepare a client with `mct client create`, build/install its mod, and provide a
// graphical DISPLAY on Linux. Each run owns only its temporary server directory.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { PNG } from 'pngjs';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), options = {}, selected = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--accept-minecraft-eula') options.eula = true;
  else if (args[i] === '--case') selected.push(args[++i]);
  else options[args[i].replace(/^--/, '')] = args[++i];
}
assert(options.eula, 'Pass --accept-minecraft-eula only after accepting https://aka.ms/MinecraftEULA');
assert(options['server-jar'], '--server-jar is required');
assert(options['mct-home'], '--mct-home is required; use an isolated test home');
const version = options['mc-version'] || '1.20.4', client = options.client || 'real';
const output = path.resolve(options['output-dir'] || path.join(root, 'tmp/resourcepack-smoke', version));
const home = path.resolve(options['mct-home']), serverJar = path.resolve(options['server-jar']);
const cliPath = path.resolve(options.cli || path.join(root, 'cli/dist/index.js'));
const env = { ...process.env, MCT_HOME: home, MCT_CLIENT_LANGUAGE: 'zh_cn' };
// The default case must exercise absence of a launch-wide policy.
delete env.MCT_CLIENT_RESOURCE_PACK_POLICY;
const cases = [
  { id: 'default-optional', marker: true },
  { id: 'default-required', required: true, marker: true },
  { id: 'prompt-accept', policy: 'prompt', action: 'accept', marker: true },
  { id: 'prompt-reject', policy: 'prompt', action: 'reject' },
  { id: 'saved-refusal', policy: 'prompt', action: 'reject', savedRefusal: true },
  { id: 'reject-optional', policy: 'reject' },
  { id: 'reject-required', policy: 'reject', required: true },
  { id: 'http-failure', response: '404' },
  { id: 'invalid-pack', response: 'invalid' },
  { id: 'download-timeout', response: 'slow', marker: true },
  { id: 'download-disconnect', response: 'slow', disconnectDuringDownload: true },
].filter(test => selected.length === 0 || selected.includes(test.id));
assert(cases.length, 'No matching cases');
await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), version, client, serverJar, cliPath, cases: [] };
report.cliEntrySha256 = createHash('sha256').update(await readFile(cliPath)).digest('hex');
const managerPath = path.join(path.dirname(cliPath), 'instance', 'ClientInstanceManager.js');
report.cliClientManagerSha256 = createHash('sha256').update(await readFile(managerPath)).digest('hex');
report.cliWebSocketClientSha256 = createHash('sha256').update(await readFile(path.join(path.dirname(cliPath), 'client', 'WebSocketClient.js'))).digest('hex');
const meta = JSON.parse(await readFile(path.join(home, 'clients', client, 'instance.json'), 'utf8'));
assert.equal(meta.mcVersion, version);
const modPath = meta.env?.MCT_CLIENT_MOD_JAR;
if (modPath) report.mod = { path: modPath, sha256: createHash('sha256').update(await readFile(modPath)).digest('hex') };
report.serverSha256 = createHash('sha256').update(await readFile(serverJar)).digest('hex');

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const locals = [], central = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const key = Buffer.from(name), bytes = Buffer.isBuffer(value) ? value : Buffer.from(value), crc = crc32(bytes);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(key.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(key.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(local, key, bytes); central.push(entry, key); offset += local.length + key.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const marker = new PNG({ width: 16, height: 16 });
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const magenta = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0; marker.data.set(magenta ? [255, 0, 255, 255] : [0, 255, 0, 255], (y * 16 + x) * 4); }
const png = PNG.sync.write(marker);
// Version-specific resource formats; --pack-format allows an explicit value for new releases.
const packFormats = { '1.12.2': 3, '1.18.2': 8, '1.20.1': 15, '1.20.2': 18, '1.20.4': 22, '1.21.1': 34, '1.21.4': 46, '1.21.11': 75, '26.1': 84, '26.2': 88 };
const format = Number(options['pack-format'] || packFormats[version]);
assert(Number.isInteger(format), `Supply --pack-format for ${version}`);
report.packFormat = format;
report.loader = meta.loader;
report.javaCommand = meta.javaCommand;
report.javaVersion = meta.javaVersion;
const blockTexture = version === '1.12.2' ? 'blocks' : 'block';
const itemTexture = version === '1.12.2' ? 'items' : 'item';
const pack = zip({ 'pack.mcmeta': JSON.stringify({ pack: { pack_format: format, description: 'MCT magenta/lime visible marker', min_format: format, max_format: format } }), [`assets/minecraft/textures/${blockTexture}/stone.png`]: png, [`assets/minecraft/textures/${itemTexture}/diamond.png`]: png });
await writeFile(path.join(output, 'visible-marker.zip'), pack);
report.packSha1 = createHash('sha1').update(pack).digest('hex');

async function exec(command, argv, extra = {}) {
  const process = spawn(command, argv, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], ...extra });
  let stdout = '', stderr = ''; process.stdout?.on('data', bytes => stdout += bytes); process.stderr?.on('data', bytes => stderr += bytes);
  const timer = setTimeout(() => process.kill('SIGTERM'), 180000);
  const code = await new Promise((resolve, reject) => { process.on('exit', resolve); process.on('error', reject); }); clearTimeout(timer);
  let json; try { json = JSON.parse(stdout || stderr); } catch {}
  return { code, stdout, stderr, ...(json ? { json } : {}) };
}
const data = result => result.json?.data?.data ?? result.json?.data;
const error = result => result.json?.error?.code ?? result.json?.data?.error?.code;
function successful(result) { assert.equal(result.code, 0, JSON.stringify(result)); assert.equal(result.json?.success, true, JSON.stringify(result)); return data(result); }
async function save() { report.finishedAt = new Date().toISOString(); await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
async function availablePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

for (const test of cases) {
  const directory = path.join(output, test.id); await mkdir(directory, { recursive: true });
  const record = { ...test, directory, steps: [], requests: [], passed: false }; report.cases.push(record);
  let server, http, releaseSlow; const slow = new Promise(resolve => releaseSlow = resolve);
  async function cli(argv) { const result = await exec(process.execPath, [cliPath, ...argv]); record.steps.push({ argv, ...result }); await save(); return result; }
  async function status() { return data(await cli(['--client', client, 'resourcepack', 'status'])); }
  try {
    // Isolated test-owned files only. Prevent previous test refusal/acceptance leaking.
    await rm(path.join(home, 'clients', client, 'minecraft', 'servers.dat'), { force: true });
    const optionsFile = path.join(home, 'clients', client, 'minecraft', 'options.txt');
    const settings = new Map((await readFile(optionsFile, 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean).map(line => { const split = line.indexOf(':'); return [line.slice(0, split), line.slice(split + 1)]; }));
    for (const [key, value] of Object.entries({ maxFps: '20', renderDistance: '3', simulationDistance: '5', graphicsMode: '0', clouds: 'false', mipmapLevels: '0' })) settings.set(key, value);
    await writeFile(optionsFile, [...settings].map(([key, value]) => `${key}:${value}`).join('\n') + '\n');
    // A unique archive comment prevents a previous case's SHA cache from
    // satisfying the request without exercising the HTTP download again.
    const comment = Buffer.from(`${test.id}:${randomUUID()}`);
    const uniquePack = Buffer.concat([pack, comment]);
    uniquePack.writeUInt16LE(comment.length, pack.length - 2);
    const body = test.response === 'invalid' ? Buffer.from('This is deliberately not a ZIP resource pack') : uniquePack;
    record.packSha1 = createHash('sha1').update(body).digest('hex');
    http = createServer(async (request, response) => {
      record.requests.push({ at: new Date().toISOString(), path: request.url });
      if (test.response === 'slow') await slow;
      if (response.destroyed) return;
      response.writeHead(test.response === '404' ? 404 : 200, { 'Content-Type': 'application/zip', 'Content-Length': body.length }); response.end(body);
    });
    await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
    // Use a reserved ephemeral port, then hand it to the actual vanilla/Paper server.
    const port = await availablePort();
    const wsPort = await availablePort();
    record.wsPort = wsPort;
    const httpPort = http.address().port, uuid = randomUUID();
    await writeFile(path.join(directory, 'eula.txt'), 'eula=true\n');
    if (options['vanilla-server-jar']) {
      await mkdir(path.join(directory, 'cache'), { recursive: true });
      await copyFile(path.resolve(options['vanilla-server-jar']), path.join(directory, 'cache', `mojang_${version}.jar`));
    }
    await writeFile(path.join(directory, 'server.properties'), `server-ip=127.0.0.1\nserver-port=${port}\nonline-mode=false\nlevel-type=${version === '1.12.2' ? 'FLAT' : 'minecraft:flat'}\ngenerate-structures=false\nview-distance=3\nsimulation-distance=3\nspawn-protection=0\nmax-players=2\ngamemode=${version === '1.12.2' ? '1' : 'creative'}\ndifficulty=${version === '1.12.2' ? '0' : 'peaceful'}\nresource-pack=http://127.0.0.1:${httpPort}/${uuid}.zip\nresource-pack-id=${uuid}\nresource-pack-sha1=${createHash('sha1').update(body).digest('hex')}\nrequire-resource-pack=${test.required === true}\n`);
    let serverLog = ''; server = spawn(options.java || 'java', ['-Xms512M', '-Xmx1200M', '-jar', serverJar, 'nogui'], { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] });
    for (const stream of [server.stdout, server.stderr]) stream.on('data', bytes => { serverLog += bytes; appendFile(path.join(directory, 'server.log'), bytes); });
    const deadline = Date.now() + Number(options['server-startup-timeout'] || 150) * 1000; while (!serverLog.includes('Done (') && Date.now() < deadline && server.exitCode === null) await sleep(250);
    if (!serverLog.includes('Done (') && server.exitCode === null) {
      // The exact child was spawned above for this isolated fixture; capture its
      // own Java threads before cleanup, without cross-namespace PID guesses.
      record.serverStartupThreadDump = { pid: server.pid, at: new Date().toISOString() };
      server.kill('SIGQUIT');
      await sleep(1500);
    }
    assert(serverLog.includes('Done ('), `Server startup failed: ${serverLog.slice(-6000)}`);
    successful(await cli(['client', 'launch', client, '--server', `127.0.0.1:${port}`, '--ws-port', String(wsPort), '--account', 'PackTester', ...(test.policy ? ['--resource-pack', test.policy] : [])]));
    successful(await cli(['client', 'wait-ready', client, '--no-world-check', '--timeout', '120']));
    if (test.policy === 'prompt') {
      const waiting = await cli(['client', 'wait-ready', client, '--timeout', '60']); assert.equal(error(waiting), 'RESOURCE_PACK_PROMPT', JSON.stringify(waiting));
      const prompt = successful(await cli(['--client', client, 'gui', 'info'])); assert.equal(prompt.open, true); record.prompt = prompt;
      await cli(['--client', client, 'screenshot', '--output', path.join(directory, 'prompt.png'), '--gui']);
      successful(await cli(['--client', client, 'resourcepack', test.action]));
      // A repeated accept must not enqueue another copy or reopen the prompt.
      if (test.action === 'accept') successful(await cli(['--client', client, 'resourcepack', 'accept']));
    }
    if (test.response === 'slow') {
      const until = Date.now() + 60000; while (record.requests.length === 0 && Date.now() < until) await sleep(200); assert(record.requests.length > 0, 'Download never started');
      const timeout = await cli(['client', 'wait-ready', client, '--timeout', '2']); assert.equal(error(timeout), 'TIMEOUT', JSON.stringify(timeout));
      assert.equal(timeout.json.error.details.reconnectAttempts, 0); record.timeout = timeout.json.error;
      if (test.disconnectDuringDownload) {
        server.stdin.write('kick PackTester isolated-download-disconnect-test\n');
        const disconnectDeadline = Date.now() + 15000;
        let terminal;
        do { await sleep(250); terminal = await status(); } while (terminal?.pending && Date.now() < disconnectDeadline);
        record.downloadDisconnectStatus = terminal;
        assert.equal(terminal.pending, false);
        assert.equal(terminal.state, 'failed');
        assert.equal(terminal.loaded, false);
      } else releaseSlow();
    }
    if (test.response === '404' && version === '1.12.2') {
      // Deliberately strict negative probe: legacy HttpUtil can swallow HTTP
      // failures. Keep the failure assertion below; never relabel this as passed.
      record.capabilityLimitation = {
        code: 'LEGACY_HTTP_FAILURE_UNOBSERVABLE',
        expectedProbeOutcome: 'FAIL_TO_DETECT',
        description: 'The native download future may finish normally after HTTP 404; unverified is not download success.',
      };
    }
    const ready = await cli(['client', 'wait-ready', client, '--timeout', '75']);
    const invalidUnverified = test.response === 'invalid' && version === '1.12.2';
    if (test.disconnectDuringDownload) {
      assert.equal(error(ready), 'RESOURCE_PACK_FAILED', JSON.stringify(ready));
      assert.equal(ready.json.error.details.reconnectAttempts, 0);
    }
    else if (test.required && test.policy === 'reject') assert.equal(error(ready), 'RESOURCE_PACK_REQUIRED_REJECTED', JSON.stringify(ready));
    else if (invalidUnverified) {
      successful(ready);
      assert.equal(data(ready).resourcePackReadinessVerified, false);
      record.invalidPackReloadUnobservable = true;
    }
    else if (['404', 'invalid'].includes(test.response)) assert.equal(error(ready), 'RESOURCE_PACK_FAILED', JSON.stringify(ready));
    else successful(ready);
    record.finalStatus = await status(); record.finalGui = data(await cli(['--client', client, 'gui', 'info']));
    assert.equal(record.finalStatus.pendingPrompt, false);
    if (test.marker || invalidUnverified) {
      record.lifecycleVerified = record.finalStatus.lifecycleSupported !== false;
      if (invalidUnverified) { assert.equal(record.finalStatus.loaded, false); assert.equal(record.finalStatus.lifecycleSupported, false); }
      if (record.lifecycleVerified) {
        assert.equal(record.finalStatus.state, 'loaded'); assert.equal(record.finalStatus.loaded, true);
        assert.equal(data(ready).resourcePackReadinessVerified, true);
      } else {
        assert.equal(data(ready).resourcePackReadinessVerified, false);
      }
      const downloadDeadline = Date.now() + 60000;
      while (!record.requests.length && Date.now() < downloadDeadline) await sleep(250);
      assert(record.requests.length > 0, 'No HTTP resource-pack download');
      // Visible asset oracle: an untextured vanilla stone wall cannot contain
      // large alternating saturated magenta/green areas.
      for (const line of [version === '1.12.2' ? 'gamemode 1 PackTester' : 'gamemode creative PackTester', 'gamerule doDaylightCycle false', 'time set 6000', 'tp PackTester 0.5 79 0.5 0 0']) server.stdin.write(line + '\n');
      // Older servers reject fills in unloaded chunks; teleport first and let chunks load.
      await sleep(2000);
      for (const line of ['fill -4 79 -4 4 255 4 minecraft:air', 'fill -4 78 -4 4 78 7 minecraft:stone', 'fill -4 79 5 4 85 5 minecraft:stone', 'tp PackTester 0.5 79 0.5 0 0', 'give PackTester minecraft:diamond']) server.stdin.write(line + '\n');
      // The server's teleport command also sets yaw/pitch. Allow its block and
      // lighting updates to render before capturing on software-only machines.
      await sleep(4000);
      const initialVisualDeadline = Date.now() + 20000;
      let magenta = 0, green = 0;
      record.initialVisualAttempts = [];
      do {
        const screenshot = path.join(directory, 'visible-marker.png');
        successful(await cli(['--client', client, 'screenshot', '--output', screenshot, '--timeout', '60']));
        const decoded = PNG.sync.read(await readFile(screenshot)); magenta = 0; green = 0;
        for (let i = 0; i < decoded.data.length; i += 4) { const [r, g, b] = decoded.data.subarray(i, i + 3); if (r > 90 && b > 90 && g < Math.min(r, b) * .25) magenta++; if (g > 90 && r < g * .25 && b < g * .25) green++; }
        record.visual = { screenshot, width: decoded.width, height: decoded.height, magentaPixels: magenta, greenPixels: green };
        record.initialVisualAttempts.push({ at: new Date().toISOString(), magentaPixels: magenta, greenPixels: green });
        if (invalidUnverified || (magenta > 10000 && green > 10000)) break;
        await sleep(1000);
      } while (Date.now() < initialVisualDeadline);
      if (invalidUnverified) assert(magenta < 1000 || green < 1000, 'Malformed pack unexpectedly produced marker texture');
      else assert(magenta > 10000 && green > 10000, `Texture marker absent: ${JSON.stringify(record.visual)}`);
      if (test.id === 'default-optional') {
        successful(await cli(['--client', client, 'client', 'reconnect', '--address', `127.0.0.1:${port}`]));
        await sleep(1000);
        record.defaultReconnect = successful(await cli(['client', 'wait-ready', client, '--timeout', '75']));
        if (record.lifecycleVerified) assert.equal(record.defaultReconnect.resourcePack.state, 'loaded');
        successful(await cli(['--client', client, 'client', 'reconnect', '--address', `127.0.0.1:${port}`, '--resource-pack', 'prompt']));
        await sleep(1000);
        const promptAgain = await cli(['client', 'wait-ready', client, '--timeout', '60']);
        assert.equal(error(promptAgain), 'RESOURCE_PACK_PROMPT', JSON.stringify(promptAgain));
        successful(await cli(['--client', client, 'resourcepack', 'accept']));
        record.promptReconnect = successful(await cli(['client', 'wait-ready', client, '--timeout', '75']));
        if (record.lifecycleVerified) assert.equal(record.promptReconnect.resourcePack.state, 'loaded');
        // Readiness cannot prove application on older APIs. Re-check actual
        // rendered assets after the final reconnect/accept, with a bounded wait.
        const reconnectVisualDeadline = Date.now() + 20000;
        do {
          await sleep(1000);
          const screenshot = path.join(directory, 'post-prompt-reconnect-visible.png');
          successful(await cli(['--client', client, 'screenshot', '--output', screenshot, '--timeout', '60']));
          const decoded = PNG.sync.read(await readFile(screenshot));
          let magenta = 0, green = 0;
          for (let i = 0; i < decoded.data.length; i += 4) {
            const [r, g, b] = decoded.data.subarray(i, i + 3);
            if (r > 90 && b > 90 && g < Math.min(r, b) * .25) magenta++;
            if (g > 90 && r < g * .25 && b < g * .25) green++;
          }
          record.promptReconnectVisual = { screenshot, magentaPixels: magenta, greenPixels: green };
          if (magenta > 10000 && green > 10000) break;
        } while (Date.now() < reconnectVisualDeadline);
        assert(record.promptReconnectVisual.magentaPixels > 10000 && record.promptReconnectVisual.greenPixels > 10000,
          'Marker texture absent after prompt reconnect acceptance');
        if (options['repeat-reconnect'] === 'true') {
          const double = await new Promise((resolve, reject) => {
            const socket = new WebSocket(`ws://127.0.0.1:${wsPort}`);
            const ids = [randomUUID(), randomUUID()], responses = new Map();
            record.repeatedReconnectRequests = [];
            record.repeatedReconnectResponseTimes = [];
            record.repeatedReconnectTimeoutMs = 30000;
            const timer = setTimeout(() => { socket.terminate(); reject(new Error('Repeated reconnect responses timed out on one WebSocket')); }, 30000);
            socket.on('error', exception => { clearTimeout(timer); reject(exception); });
            socket.on('message', bytes => {
              const response = JSON.parse(bytes.toString());
              if (!ids.includes(response.id)) return;
              responses.set(response.id, response);
              record.repeatedReconnectResponseTimes.push({ id: response.id, at: new Date().toISOString() });
              if (responses.size === 2) { clearTimeout(timer); socket.close(); resolve(ids.map(id => responses.get(id))); }
            });
            socket.on('open', () => {
              for (const id of ids) {
                record.repeatedReconnectRequests.push({ id, at: new Date().toISOString() });
                socket.send(JSON.stringify({ id, action: 'client.reconnect', params: { address: `127.0.0.1:${port}`, resourcePackPolicy: 'accept' } }));
              }
            });
          });
          record.repeatedReconnectResponses = double;
          double.forEach(response => assert.equal(response.success, true, JSON.stringify(response)));
          await sleep(1000);
          record.repeatedReconnect = successful(await cli(['client', 'wait-ready', client, '--timeout', '75']));
          if (record.lifecycleVerified) assert.equal(record.repeatedReconnect.resourcePack.state, 'loaded');
          const log = await readFile(path.join(home, 'logs', `client-${client}.log`), 'utf8');
          record.repeatedReconnectGuardObserved = /Already connecting/i.test(log);
          await sleep(3000);
          const repeatedShot = path.join(directory, 'repeated-reconnect-visible.png');
          successful(await cli(['--client', client, 'screenshot', '--output', repeatedShot, '--timeout', '60']));
          const repeatedImage = PNG.sync.read(await readFile(repeatedShot));
          let magenta = 0, green = 0;
          for (let i = 0; i < repeatedImage.data.length; i += 4) {
            const [r, g, b] = repeatedImage.data.subarray(i, i + 3);
            if (r > 90 && b > 90 && g < Math.min(r, b) * .25) magenta++;
            if (g > 90 && r < g * .25 && b < g * .25) green++;
          }
          record.repeatedReconnectVisual = { screenshot: repeatedShot, magentaPixels: magenta, greenPixels: green };
          assert(magenta > 10000 && green > 10000, 'Texture marker absent after repeated reconnect');
        }
      }
    } else if (test.policy === 'reject' || test.action === 'reject') { assert.equal(record.requests.length, 0, 'Refused pack was downloaded'); assert.equal(record.finalStatus.state, 'rejected'); }
    else assert.equal(record.finalStatus.state, 'failed');
    if (test.savedRefusal) {
      successful(await cli(['client', 'stop', client]));
      successful(await cli(['client', 'launch', client, '--server', `127.0.0.1:${port}`, '--ws-port', String(await availablePort()), '--account', 'PackTester']));
      successful(await cli(['client', 'wait-ready', client, '--timeout', '120']));
      record.savedRefusal = await status();
      assert.equal(record.savedRefusal.policy, 'reject');
      assert.equal(record.savedRefusal.state, 'rejected');
      assert.equal(record.requests.length, 0, 'Saved refusal was ignored');
    }
    if (options['diagnostic-script']) {
      const diagnosticProcesses = await exec('ps', ['-eo', 'pid=,args=']);
      const diagnosticGameDir = path.join(home, 'clients', client, 'minecraft');
      const diagnosticJvm = diagnosticProcesses.stdout.split('\n').map(line => line.trim().match(/^(\d+)\s+(.*)$/)).filter(match => match && match[2].startsWith(`${meta.javaCommand} `) && match[2].includes(diagnosticGameDir));
      const diagnosticPidArgs = diagnosticJvm.length === 1 ? ['--thread-dump-pid', diagnosticJvm[0][1]] : [];
      record.diagnosticVerifiedJvmPid = diagnosticJvm.length === 1 ? Number(diagnosticJvm[0][1]) : null;
      record.diagnostic = await exec(process.execPath, [
        path.resolve(options['diagnostic-script']), '--ws-url', `ws://127.0.0.1:${wsPort}`,
        '--cli-path', cliPath, '--client', client, '--server-address', `127.0.0.1:${port}`,
        '--output-dir', directory, '--game-dir', path.join(home, 'clients', client, 'minecraft'),
        '--java-command', meta.javaCommand, ...diagnosticPidArgs,
      ]);
      await save();
      assert.equal(record.diagnostic.code, 0, JSON.stringify(record.diagnostic));
      record.postDiagnosticReady = successful(await cli(['client', 'wait-ready', client, '--timeout', '75']));
      record.postDiagnosticPack = await status();
      if (record.lifecycleVerified) assert.equal(record.postDiagnosticPack.state, 'loaded');
      if (test.marker) {
        await sleep(2000);
        const screenshot = path.join(directory, 'post-diagnostic-visible.png');
        successful(await cli(['--client', client, 'screenshot', '--output', screenshot, '--timeout', '60']));
        const decoded = PNG.sync.read(await readFile(screenshot));
        let magenta = 0, green = 0;
        for (let i = 0; i < decoded.data.length; i += 4) {
          const [r, g, b] = decoded.data.subarray(i, i + 3);
          if (r > 90 && b > 90 && g < Math.min(r, b) * .25) magenta++;
          if (g > 90 && r < g * .25 && b < g * .25) green++;
        }
        record.postDiagnosticVisual = { screenshot, magentaPixels: magenta, greenPixels: green };
        assert(magenta > 10000 && green > 10000, 'Marker texture absent after WebSocket stress');
      }
    }
    record.passed = true;
  } catch (exception) {
    record.error = exception.stack || String(exception);
    if (record.error.toUpperCase().includes('TIMEOUT')) {
      const gameDirectory = path.join(home, 'clients', client, 'minecraft');
      const processes = await exec('ps', ['-eo', 'pid=,args=']);
      record.timeoutThreadDumpSignals = [];
      for (const line of processes.stdout.split('\n')) {
        const match = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!match || !match[2].startsWith(`${meta.javaCommand} `) || !match[2].includes(gameDirectory)) continue;
        const pid = Number(match[1]);
        try { process.kill(pid, 'SIGQUIT'); record.timeoutThreadDumpSignals.push({ pid, javaCommand: meta.javaCommand, at: new Date().toISOString() }); } catch {}
      }
      if (record.timeoutThreadDumpSignals.length) await sleep(1500);
    }
  }
  finally {
    releaseSlow(); await cli(['client', 'stop', client]).catch(() => {});
    const gameDirectory = path.join(home, 'clients', client, 'minecraft');
    async function remainingClients() {
      const processes = await exec('ps', ['-eo', 'pid=,ppid=,pgid=,args=']);
      return processes.stdout.split('\n').filter(line => line.includes(gameDirectory)).map(line => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
        return match && { pid: Number(match[1]), parentPid: Number(match[2]), processGroup: Number(match[3]), command: match[4] };
      }).filter(entry => entry && entry.pid !== process.pid);
    }
    record.clientProcessesAfterStop = await remainingClients();
    // Only the exact isolated test game directory is eligible for cleanup.
    for (const entry of record.clientProcessesAfterStop) { try { process.kill(entry.pid, 'SIGTERM'); } catch {} }
    if (record.clientProcessesAfterStop.length) await sleep(2000);
    for (const entry of await remainingClients()) { try { process.kill(entry.pid, 'SIGKILL'); } catch {} }
    record.clientProcessesAfterCleanup = await remainingClients();
    const socketLines = (await readFile('/proc/net/tcp', 'utf8').catch(() => '')).split('\n');
    record.wsSocketStatesAfterStop = socketLines.filter(line => line.trim().split(/\s+/)[1]?.endsWith(`:${Number(record.wsPort).toString(16).toUpperCase().padStart(4, '0')}`));
    if (server && server.exitCode === null) { server.stdin.write('stop\n'); await Promise.race([new Promise(resolve => server.on('exit', resolve)), sleep(10000)]); if (server.exitCode === null) server.kill('SIGTERM'); }
    http?.closeAllConnections(); if (http) await new Promise(resolve => http.close(resolve));
    await copyFile(path.join(home, 'logs', `client-${client}.log`), path.join(directory, 'client.log')).catch(() => {}); await save();
  }
  console.log(JSON.stringify({ case: test.id, passed: record.passed, error: record.error, visual: record.visual }));
}
report.passed = report.cases.every(test => test.passed); await save(); console.log(JSON.stringify({ passed: report.passed, report: path.join(output, 'report.json') })); process.exitCode = report.passed ? 0 : 1;
