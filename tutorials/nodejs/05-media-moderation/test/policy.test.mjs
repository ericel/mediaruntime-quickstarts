import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide,CHECKS} from '../src/policy.mjs';
const fixture=(patch={})=>({ok:true,mode:'report',verdict:'allow',requestedChecks:CHECKS,checks:CHECKS.map(check=>({check,decision:'allow'})),...patch});
test('synthetic allow becomes eligible, never an automatic published decision',()=>{assert.equal(decide(fixture()).state,'eligible');assert.equal(decide(fixture()).publication,undefined);});
test('synthetic review and block have different non-public outcomes',()=>{assert.equal(decide(fixture({verdict:'review'})).state,'held');assert.equal(decide(fixture({verdict:'block'})).state,'rejected');});
test('missing report, errors and unknown verdicts stay held',()=>{for(const report of [null,{},fixture({ok:false}),fixture({error:'unavailable'}),fixture({verdict:'new-value'}),fixture({mode:null})])assert.equal(decide(report).state,'held');});
test('missing checks and contradictory evidence stay held',()=>{for(const patch of [{requestedChecks:['sexual']},{checks:[]},{checks:[{check:'sexual',decision:'allow'}]},{flaggedChecks:['violence']},{judge:{ok:false}},{checks:[...fixture().checks,{check:'violence',decision:'review'}]}])assert.equal(decide(fixture(patch)).state,'held');});

test('advisory checks do not imply a violation when their actual decision is allow',()=>{assert.equal(decide(fixture({reviewOnlyChecks:['violence','dangerous'],checks:CHECKS.map(check=>({check,decision:'allow',reviewOnly:check!=='sexual'}))})).state,'eligible');});
