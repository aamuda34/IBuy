const CACHE='ibuy-v2.13';
const CORE=['/','/index.html','/app.js?v=2.13','/styles.css?v=2.13','/manifest.json','/icons/icon-192.png','/icons/icon-512.png'];

self.addEventListener('install', event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(CORE))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin) return;

  // Always fetch the application shell/assets from the network first so a new
  // deployment cannot be hidden indefinitely behind an older service-worker cache.
  if(url.pathname==='/' || url.pathname==='/index.html' ||
     url.pathname==='/app.js' || url.pathname==='/styles.css' ||
     url.pathname==='/sw.js'){
    event.respondWith(
      fetch(event.request, {cache:'no-store'})
        .then(response=>{
          if(response.ok && url.pathname!=='/sw.js'){
            const copy=response.clone();
            caches.open(CACHE).then(c=>c.put(event.request, copy));
          }
          return response;
        })
        .catch(()=>caches.match(event.request).then(r=>r||caches.match('/')))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response=>{
        if(response.ok){
          const copy=response.clone();
          caches.open(CACHE).then(c=>c.put(event.request,copy));
        }
        return response;
      })
      .catch(()=>caches.match(event.request).then(r=>r||caches.match('/')))
  );
});
