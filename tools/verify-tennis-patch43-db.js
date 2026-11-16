#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.'),dbPath=path.join(root,'backend','database_betting.db');
function open(){try{const B=require(path.join(root,'node_modules','better-sqlite3'));return new B(dbPath,{readonly:true})}catch(_){const{DatabaseSync}=require('node:sqlite');return new DatabaseSync(dbPath,{readOnly:true})}}
const checks=[];const add=(name,ok,details={})=>checks.push({name,ok:Boolean(ok),details});
add('database presente',fs.existsSync(dbPath));
const db=open();try{const integrity=Object.values(db.prepare('PRAGMA integrity_check').get())[0];const fk=db.prepare('PRAGMA foreign_key_check').all();const total=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n);add('integrità SQLite',String(integrity).toLowerCase()==='ok',{integrity});add('foreign key',fk.length===0,{violations:fk.length});add('righe business presenti',total>=1184,{total});add('nessuna tabella Patch43',Number(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'tennis_patch43%' OR name LIKE 'wta_patch43%'").get().n)===0);add('hash database disponibile',/^[a-f0-9]{64}$/.test(crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex')));}finally{db.close()}
const errors=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:errors.length===0,patch:'43',checks,errors:errors.length,noDatabaseMigration:true},null,2));if(errors.length)process.exit(1);
