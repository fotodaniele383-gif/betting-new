#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(process.argv[process.argv.indexOf('--root')+1]||path.join(__dirname,'..'));
function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){return null;}}
function sha(file){return fs.existsSync(file)?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;}
const configPath=path.join(ROOT,'backend','calcio_cron_config.json');
const statePath=path.join(ROOT,'backend','.scheduler_patch58_runtime','calcio_scheduler_state.json');
const config=read(configPath),state=read(statePath);
const coherent=Boolean(config&&state&&state.configEnabled===(config.enabled===true));
const out={success:coherent,patch:'AUDIT16A',readOnly:true,configPath,statePath,configEnabled:config?.enabled===true,stateConfigEnabled:state?.configEnabled===true,state:state?.state||null,reasonCode:state?.reasonCode||null,coherent,hashes:{config:sha(configPath),state:sha(statePath)}};
console.log(JSON.stringify(out,null,2));process.exit(out.success?0:1);
