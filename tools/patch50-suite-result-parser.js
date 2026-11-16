#!/usr/bin/env node
'use strict';
const fs=require('fs');
const file=process.argv[2];
try{
  const raw=fs.readFileSync(file,'utf8').trim();
  let parsed=null;
  try{parsed=JSON.parse(raw)}catch(_){const start=raw.lastIndexOf('\n{');if(start>=0)parsed=JSON.parse(raw.slice(start+1));else throw _;}
  let checks=Array.isArray(parsed?.details)?parsed.details.length:(Array.isArray(parsed?.checks)?parsed.checks.length:Number(parsed?.checksCount??parsed?.checks??0));
  if(!Number.isFinite(checks))checks=0;
  console.log(JSON.stringify({parsed:true,success:parsed?.success!==false,healthy:parsed?.healthy,checks,error:parsed?.error||null,status:parsed?.status||null,warnings:parsed?.warnings??null,errors:parsed?.errors??null}));
}catch(error){console.log(JSON.stringify({parsed:false,success:false,checks:0,error:error.message}));process.exit(1)}
