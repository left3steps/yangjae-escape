import {readFile,stat,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=path.resolve('dist');
for(const filename of await readdir(root)){
 if(filename.endsWith('.js')){const p=path.join(root,filename),source=await readFile(p,'utf8');const result=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 for(const [,relative] of source.matchAll(/from\s*['"](.\/[^'"]+)['"]/g))await stat(path.resolve(root,relative));}
}
const html=await readFile('dist/index.html','utf8');assert.match(html,/<html lang="ko">/);assert.match(html,/viewport-fit=cover/);
for(const [,asset] of html.matchAll(/(?:src|href)="(\/[^"#]+)"/g))await stat(path.join(root,asset));
const sw=await readFile('dist/sw.js','utf8');const list=sw.match(/const ASSETS=(\[[\s\S]*?\]);/)[1];for(const asset of JSON.parse(list.replaceAll("'",'"')))await stat(path.join(root,asset==='/'?'index.html':asset));
const manifest=JSON.parse(await readFile('dist/manifest.webmanifest','utf8'));for(const icon of manifest.icons)await stat(path.join(root,icon.src));
const {CONFIG}=await import('../dist/config.js');
assert.ok(['','https://joeevpnzcgsghuahsnhs.supabase.co'].includes(CONFIG.supabaseUrl),'Only the separate lockspot project may be connected');
if(CONFIG.supabaseUrl)assert.match(CONFIG.publishableKey,/^sb_publishable_/,'The browser requires a publishable key');
const pubFiles=await readdir(root,{recursive:true});for(const file of pubFiles){if(/\.(js|html|json|css)$/.test(file)){const text=await readFile(path.join(root,file),'utf8');assert.ok(!text.includes('sb_secret_')&&!text.includes('test-secret-key'),`Unexpected secret or SCM project identifier in ${file}`);}}
const css=await readFile('dist/styles.css','utf8');for(const [,asset] of css.matchAll(/url\('(\/[^']+)'\)/g))await stat(path.join(root,asset));assert.ok(!css.includes('@import'));
console.log('Checked JavaScript syntax, module imports, static assets, offline cache, mobile manifest and project separation.');
