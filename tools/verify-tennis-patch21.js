'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function check(name,ok,details=null){return{name,success:Boolean(ok),details};}
const registry=require(path.join(root,'backend/tennisPatchRegistry'));
const multi=require(path.join(root,'backend/tennisMultiProviderData'));
const progression=require(path.join(root,'backend/tennisProgramProgressionAudit'));
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const inventory=JSON.parse(fs.readFileSync(path.join(root,'backend/tennis_patch_inventory.json'),'utf8'));
const providers=multi.providerRegistry({apiEnabled:false,apiKey:''});
const checks=[
  check('Registry Patch 21',Number(registry.TENNIS_CURRENT_PATCH_VERSION)>=21&&registry.TENNIS_PATCH_REGISTRY_VERSION===`TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}`&&registry.PATCHES.some(x=>x.version==='21'&&String(x.status).startsWith('ACTIVE'))),
  check('Patch 20 preservata',registry.PATCHES.some(x=>x.version==='20'&&String(x.status).startsWith('ACTIVE'))),
  check('Modulo multi-provider',multi.TENNIS_MULTI_PROVIDER_VERSION==='TENNIS_MULTI_PROVIDER_DATA_V1_PATCH21'),
  check('Registry provider zero-key-first',providers[0].id==='LOCAL_CANONICAL_IMPORT'&&providers[1].id==='TENNISMYLIFE_BULK'&&providers.at(-1).id==='LAST_KNOWN_GOOD'),
  check('API opzionale disabilitata senza chiave',providers.find(x=>x.id==='API_TENNIS_OPTIONAL').enabled===false),
  check('Provider GitHub legacy disabilitato senza retry',multi.providerPlan({apiEnabled:false,apiKey:''}).retiredProviders.some(x=>x.id==='JEFF_SACKMANN_GITHUB'&&x.enabled===false&&x.retry===false)),
  check('Cache prima della rete API',fs.readFileSync(path.join(root,'backend/tennisMultiProviderData.js'),'utf8').includes('API_CACHE_BEFORE')||fs.readFileSync(path.join(root,'backend/tennisMultiProviderData.js'),'utf8').includes('apiCacheHours??DEFAULT_API_CACHE_HOURS')),
  check('Chiavi non persistite',multi.providerPlan({apiEnabled:false,apiKey:''}).apiPolicy.keyPersisted===false&&multi.providerPlan({apiEnabled:false,apiKey:''}).apiPolicy.keyExposed===false),
  check('Endpoint health provider',server.includes("router.get('/player-data-provider-health'")),
  check('Endpoint probe provider',server.includes("router.post('/player-data-provider-probe'")),
  check('Refresh multi-provider collegato',server.includes('tennisMultiProviderData.refreshMultiProvider')),
  check('UI Patch 21',app.includes('PATCH21_TENNIS_MULTI_PROVIDER_ZERO_KEY_FIRST_UI')&&html.includes(`Patch 1–${registry.TENNIS_CURRENT_PATCH_VERSION}`)&&html.includes('Multi-Provider Zero-Key-First')),
  check('Frontend app byte-identici',sha(path.join(root,'public/app.js'))===sha(path.join(root,'backend/public/app.js'))),
  check('Frontend index byte-identici',sha(path.join(root,'public/index.html'))===sha(path.join(root,'backend/public/index.html'))),
  check('Progression Guard V9',Number(String(progression.TENNIS_PROGRAM_PROGRESSION_AUDIT_VERSION).match(/PATCH(\d+)/)?.[1]||0)>=21),
  check('Script Patch 21',Boolean(pkg.scripts['test:tennis:patch21']&&pkg.scripts['test:tennis:patch21:fixtures']&&pkg.scripts['verify:tennis:patch21']&&pkg.scripts['audit:tennis:multi-provider'])),
  check('Inventario Patch 21',Number(inventory.registry.currentPatchVersion)>=21&&inventory.registry.registryVersion===`TENNIS_PATCH_REGISTRY_V${inventory.registry.currentPatchVersion}`&&inventory.summary.uniqueLegacySteps===56&&inventory.summary.unregisteredCount===0),
  check('Nessuna autorità produzione',multi.providerPlan().productionAuthority===false&&multi.providerPlan().qualityGateAuthority===false&&multi.providerPlan().stakeAuthority===false),
  check('Nessun hard veto',multi.providerPlan().hardExclusion===false),
  check('Nessun codice Soccer Patch 21',!server.includes('PATCH21_SOCCER')&&!app.includes('PATCH21_SOCCER'))
];
const report={success:checks.every(x=>x.success),patch:'21',checks,generatedAt:new Date().toISOString()};
console.log(JSON.stringify(report,null,2));
if(!report.success)process.exit(2);
