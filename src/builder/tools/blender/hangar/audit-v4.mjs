// Read-only Git audit; writes its report only inside the authorized hangar refs folder.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dir='src/builder/tools/blender/hangar',target=dir+'/refs/changed-v4.json';
const status=execFileSync('git',['status','--short','--untracked-files=all'],{encoding:'utf8'});
const files=status.trimEnd().split(/\r?\n/).filter(Boolean).map(line=>({status:line.slice(0,2),path:line.slice(3)}));
const allowed=p=>p.startsWith(dir+'/')||p.startsWith('public/assets/models/builder/hangar/')||p.startsWith('sandbox/role1.hangar.')||p==='src/builder/tests/hangar-models.test.mjs';
const outsideAllowed=files.filter(f=>!allowed(f.path));
assert.deepEqual(outsideAllowed,[],'modified paths outside authorized scope');
const hashes=JSON.parse(readFileSync(dir+'/refs/protected-v3.json','utf8'));
for(const [file,hash]of Object.entries(hashes))assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash,file);
const branch=execFileSync('git',['status','--short','--branch'],{encoding:'utf8'}).split(/\r?\n/)[0];assert.equal(branch,'## role1-builder');
execFileSync('git',['diff','--check'],{stdio:'pipe'});
if(!files.some(f=>f.path===target))files.push({status:'??',path:target});
writeFileSync(target,JSON.stringify({date:new Date().toISOString(),branch,protectedFilesVerified:Object.keys(hashes).length,outsideAllowed,files},null,2));
console.log(`PASS: ${files.length} scoped files, ${Object.keys(hashes).length} unchanged saved files; ${branch}; clean diff whitespace.`);
