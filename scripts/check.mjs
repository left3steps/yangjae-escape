import {readFile,stat,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
const root=path.resolve('dist');
async function checkAsset(asset){
 if(/^https?:/.test(asset))return;
 assert.ok(!asset.startsWith('/'),'Assets must work below the GitHub Pages project path: '+asset);
 const file=path.resolve(root,asset==='./'?'index.html':asset);
 assert.ok(file.startsWith(root+path.sep));
 await stat(file);
}
for(const filename of await readdir(root)){
 if(filename.endsWith('.js')){const p=path.join(root,filename),source=await readFile(p,'utf8');const result=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 for(const [,relative] of source.matchAll(/from\s*['"](.\/[^'"]+)['"]/g))await stat(path.resolve(root,relative));}
}
const html=await readFile('dist/index.html','utf8');assert.match(html,/<html lang="ko">/);assert.match(html,/viewport-fit=cover/);
for(const file of ['index.html','credits.html','app.js'])for(const [,asset] of (await readFile(path.join(root,file),'utf8')).matchAll(/(?:src|href)="([^"#]+)"/g))await checkAsset(asset);
const sw=await readFile('dist/sw.js','utf8');const list=sw.match(/const ASSETS=(\[[\s\S]*?\]);/)[1];for(const asset of JSON.parse(list.replaceAll("'",'"')))await checkAsset(asset);
for(const scope of ['http://localhost:4173/','https://left3steps.github.io/yangjae-escape/']){
 const urls=vm.runInNewContext(sw+'; URLS',{URL,self:{registration:{scope},addEventListener(){}}});
 assert.equal(urls.length,15);
 assert.ok(urls.every(url=>url.startsWith(scope)),'Offline cache must stay within its own app path');
}
const manifest=JSON.parse(await readFile('dist/manifest.webmanifest','utf8'));for(const icon of manifest.icons)await checkAsset(icon.src);
assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
const {CONFIG}=await import('../dist/config.js');
assert.ok(['','https://joeevpnzcgsghuahsnhs.supabase.co'].includes(CONFIG.supabaseUrl),'Only the separate lockspot project may be connected');
if(CONFIG.supabaseUrl)assert.match(CONFIG.publishableKey,/^sb_publishable_/,'The browser requires a publishable key');
const pubFiles=await readdir(root,{recursive:true});for(const file of pubFiles){if(/\.(js|html|json|css)$/.test(file)){const text=await readFile(path.join(root,file),'utf8');assert.ok(!text.includes('sb_secret_')&&!text.includes('test-secret-key'),`Unexpected secret or SCM project identifier in ${file}`);}}
const css=await readFile('dist/styles.css','utf8');for(const [,asset] of css.matchAll(/url\('([^']+)'\)/g))await checkAsset(asset);assert.ok(!css.includes('@import'));
console.log('Checked JavaScript syntax, module imports, static assets, GitHub Pages paths, scoped offline cache, mobile manifest and project separation.');
