const CACHE='yangjae-v1.0.1';
const ASSETS=['/','/index.html','/styles.css','/app.js','/story.js','/engine.js','/team.js','/config.js','/icon.svg','/manifest.webmanifest','/credits.html','/assets/yangjaecheon.jpg','/assets/puzzle-photo.jpg','/assets/icon-192.png','/assets/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('yangjae-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||!ASSETS.includes(u.pathname))return;
 e.respondWith(fetch(e.request).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);cache.put(e.request,response.clone());}return response;}).catch(async()=>{const cached=await caches.match(e.request);if(cached)return cached;return new Response('인터넷에 연결한 후 다시 열어주세요.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}));
});
