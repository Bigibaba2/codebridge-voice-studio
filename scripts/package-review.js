/** Create a fresh LOCAL review copy. Never uploads, records, or copies Git history. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.resolve(process.argv[2] || path.join(root,'..','codebridge-voice-studio-review-final'));
if(target===root || target.startsWith(root+path.sep) || existsSync(target))throw Error('Choose a new directory outside the source project; existing destinations are never overwritten.');
const allowlist=[
 'src/server.js','src/catalog.js','src/desk.js','src/interpret.js','src/order-interpret.js',
 'public/index.html','public/styles.css','public/voice-controller.js','public/app.js',
 'scripts/browser-checks.cjs','scripts/check.js','scripts/evidence.js','scripts/live-check.js','scripts/measure-recording.js','scripts/package-review.js',
 'tests/interpret.test.js','tests/desk.test.js','tests/dropped-items.test.js','tests/voice.test.js',
 'tests/live-check.test.js','tests/http.test.js','tests/orders.test.js','tests/live-evidence.test.js',
 'tests/recognition-options.test.js','tests/order-interpret.test.js','tests/scenarios.json','tests/measurement.test.js',
 'package.json','README.md','docs/reviewer-guide.md','docs/recording-run-sheet.md','docs/test-results.md','.gitignore','evidence/.gitkeep'
];
const files=new Map();
for(const name of allowlist){
 const source=path.join(root,name);
 for(let part=source;part!==root;part=path.dirname(part))if(lstatSync(part).isSymbolicLink())throw Error('Refusing symlink: '+name);
 if(!lstatSync(source).isFile())throw Error('Expected regular file: '+name);
 files.set(name,readFileSync(source));
}
const patterns=[
 ['absolute home path',new RegExp('(?:/Us'+'ers/|/ho'+'me/)[A-Za-z0-9._-]+/')],
 ['private key header',new RegExp('-----BEGIN '+'(?:RSA |EC |OPENSSH )?PRIVATE KEY-----')],
 ['credential-shaped token',new RegExp('(?:gh'+'p_[A-Za-z0-9]{25,}|sk'+'-[A-Za-z0-9_-]{30,}|AK'+'IA[A-Z0-9]{16})')],
 ['email address',new RegExp('[A-Za-z0-9._%+-]+@'+'[A-Za-z0-9.-]+\\.[A-Za-z]{2,}')]
];
for(const [name,bytes] of files)for(const [label,pattern] of patterns)if(pattern.test(bytes.toString('utf8')))throw Error('Review required: '+label+' in '+name);
const manifest={formatVersion:1,purpose:'Fresh local review copy; not uploaded or published',files:[...files].map(([file,bytes])=>({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})),exclusions:['All files not on the explicit allowlist','Existing Git history and remotes','Runtime databases and data directory','All existing evidence and live speech transcripts','Recordings and browser traces','Unreviewed documentation outside the allowlist','Environment and credential files','node_modules and archives'],checks:{explicitAllowlist:true,symlinksRejected:true,existingDestinationRefused:true,contentPatternScan:patterns.map(([label])=>label),limitation:'Pattern scans are not a comprehensive secret or personal-data audit. Human review remains required.'}};
mkdirSync(target,{recursive:true});
for(const [name,bytes] of files){const output=path.join(target,name);mkdirSync(path.dirname(output),{recursive:true});writeFileSync(output,bytes,{flag:'wx'});}
mkdirSync(path.join(target,'evidence'),{recursive:true});
writeFileSync(path.join(target,'REVIEW-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({target,fileCount:files.size,manifest:'REVIEW-MANIFEST.json',published:false},null,2));
