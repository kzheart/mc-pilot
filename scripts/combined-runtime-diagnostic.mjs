import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const scripts=fileURLToPath(new URL('./', import.meta.url));
for(const name of ['websocket-dispatch-diagnostic.mjs','websocket-reconnect-diagnostic.mjs','websocket-input-effects-diagnostic.mjs']) {
 const result=spawnSync(process.execPath,[path.join(scripts,name),...process.argv.slice(2)],{stdio:'inherit',env:process.env});
 if(result.status!==0) process.exit(result.status||1);
}
