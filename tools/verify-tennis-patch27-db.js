#!/usr/bin/env node
'use strict';
const assert=require('assert');const path=require('path');const {DatabaseSync}=require('node:sqlite');const cohorts=require('../backend/tennisForwardCohorts');
const db=new DatabaseSync(path.join(__dirname,'..','backend','database_betting.db'),{readOnly:true});
try{
 const total=Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0);const members=Number(db.prepare(`SELECT COUNT(*) n FROM ${cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE}`).get().n||0);
 const report=cohorts.scanForwardCohorts(db,{limit:200});
 assert.ok(total>0);assert.ok(members>=0);assert.equal(report.leakageBlocked,0);assert.equal(report.unhealthyMembers,0);
 const bad=db.prepare(`SELECT COUNT(*) n FROM ${cohorts.TENNIS_FORWARD_COHORT_MEMBER_TABLE} WHERE seal_hash IS NULL OR state_hash IS NULL`).get();assert.equal(Number(bad.n||0),0);
 console.log(JSON.stringify({success:true,checks:5,total,members,cohorts:{healthy:report.healthy,unhealthyMembers:report.unhealthyMembers,counts:report.counts}},null,2));
}finally{db.close();}
