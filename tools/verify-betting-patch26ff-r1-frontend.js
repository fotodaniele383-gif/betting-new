'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const root=path.resolve(__dirname,'..');
const read=r=>fs.readFileSync(path.join(root,r),'utf8');const sha=r=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,r))).digest('hex');
const app=read('public/app.js'),index=read('public/index.html');
const checks=[
{name:'app copie byte identiche',ok:sha('public/app.js')===sha('backend/public/app.js')},
{name:'index copie byte identiche',ok:sha('public/index.html')===sha('backend/public/index.html')},
{name:'cache buster revision-aware',ok:/app\.js\?v=[a-z0-9-]+/i.test(index)},
{name:'toggle dettagli',ok:index.includes('runtimeDiagnosticToggle')&&app.includes("toggle.setAttribute('aria-expanded'" )},
{name:'info non espande JSON automaticamente',ok:app.includes("const autoExpand = diagnostic.severity.includes('error') || diagnostic.severity.includes('fatal')")},
{name:'messaggio info sintetico',ok:app.includes('Eventi letti: ${total} · INFO ${infoCount} · WARN ${warnCount}.')}
];const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks:checks.length,results:checks},null,2));process.exit(failed.length?1:0);
