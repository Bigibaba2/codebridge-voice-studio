import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
for(const directory of ['src','public','scripts'])for(const file of readdirSync(directory).filter(f=>/\.(m?js|cjs)$/.test(f))){const r=spawnSync(process.execPath,['--check',`${directory}/${file}`],{stdio:'inherit'});if(r.status)process.exit(r.status);}
const r=spawnSync(process.execPath,['--test',...readdirSync('tests').filter(f=>f.endsWith('.test.js')).map(f=>'tests/'+f)],{stdio:'inherit'});process.exit(r.status||0);
