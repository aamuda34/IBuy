
/* IBuy V2.4: WhatsApp + horizontal discovery */
function normalizeWhatsApp(raw){
  let s=String(raw||'').trim().replace(/[^\d+]/g,'');
  if(s.startsWith('+')) s=s.slice(1);
  if(s.startsWith('00')) s=s.slice(2);
  if(s.startsWith('0') && !s.startsWith('234')) s='234'+s.slice(1);
  return s;
}
function whatsappUrl(number,message){
  const n=normalizeWhatsApp(number);
  return n ? 'https://wa.me/'+encodeURIComponent(n)+(message?'?text='+encodeURIComponent(message):'') : null;
}
function openWhatsApp(number,message){
  const u=whatsappUrl(number,message);
  if(!u){ if(typeof toast==='function') toast('WhatsApp number is not available'); return; }
  window.open(u,'_blank','noopener,noreferrer');
}
function ibuyHaversineKm(lat1,lon1,lat2,lon2){
  const R=6371,p=Math.PI/180, dLat=(lat2-lat1)*p,dLon=(lon2-lon1)*p;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*p)*Math.cos(lat2*p)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
let ibuyDiscoverySeed=Number(localStorage.getItem('ibuy_discovery_seed')||Date.now());
localStorage.setItem('ibuy_discovery_seed',String(ibuyDiscoverySeed));
function ibuySeededScore(id){
  let x=(Number(id||0)*1103515245+ibuyDiscoverySeed*12345)>>>0;
  x^=x>>>16; x=Math.imul(x,2246822519)>>>0; x^=x>>>13;
  return (x>>>0)/4294967296;
}
function ibuyRenderHorizontalFeed(items,title,subtitle,kind){
  const cards=items.map(p=>{
    const img=p.image_b64
      ? `<img loading="lazy" alt="${esc(p.name||'Product')} photo" src="data:image/jpeg;base64,${p.image_b64}">`
      : `<div class="feed-placeholder" aria-hidden="true">IBuy</div>`;
    return `<article class="feed-card" onclick="go('product/${encodeURIComponent(p.id)}')" ">
      ${img}<div class="feed-body"><strong>${esc(p.name||'Product')}</strong>
      <div class="feed-price">${esc(p.currency||'₦')}${Number(p.price||0).toLocaleString()}</div>
      <div class="feed-store">${esc(p.store_name||'Local store')}</div></div></article>`;
  }).join('');
  return `<section class="discovery-section"><div class="section-head"><div>
    <h2>${title}</h2><p>${subtitle||''}</p></div></div>
    <div class="horizontal-feed" tabindex="0" aria-label="${esc(title)}">${cards||'<div class="empty">Nothing here yet.</div>'}</div>
  </section>`;
}
function ibuyTrending(items){
  return [...items].sort((a,b)=>{
    const as=Number(a.trending_score||a.reservation_count||a.view_count||0);
    const bs=Number(b.trending_score||b.reservation_count||b.view_count||0);
    return (bs-as)||((Date.parse(b.updated_at||'')||0)-(Date.parse(a.updated_at||'')||0));
  });
}
function ibuyRandomDiscovery(items){
  const recent=new Set(JSON.parse(localStorage.getItem('ibuy_recent_products')||'[]').map(String));
  const pool=items.filter(p=>!recent.has(String(p.id)));
  return [...(pool.length?pool:items)].sort((a,b)=>ibuySeededScore(a.id)-ibuySeededScore(b.id));
}
function ibuyDiscoveryHtml(trendingItems,randomItems){
  return ibuyRenderHorizontalFeed(ibuyTrending(trendingItems),'🔥 Trending near you','What people are discovering now.','trending')+
         ibuyRenderHorizontalFeed(ibuyRandomDiscovery(randomItems),'✨ Discover something new','A changing mix of products and stores.','random');
}

let me=null, cart=JSON.parse(localStorage.getItem('ibuy_cart')||'[]'), productsCache=[], userLocation=null, leafletMap=null, imageData=null, modalReturnHash='', sellerSignupLocation=null, storeLocationCapture=null;
const $=id=>document.getElementById(id); const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'₦'+Number(n||0).toLocaleString(); const fresh=t=>t?`Updated ${new Date(t*1000).toLocaleString()}`:'';
function saveCart(){localStorage.setItem('ibuy_cart',JSON.stringify(cart));}
function toast(msg){let t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),3000)}
function loading(v){document.body.classList.toggle('loading',v)}
async function api(path,opt={}){loading(true);try{let r=await fetch(path,{credentials:'same-origin',...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});let d=await r.json().catch(()=>({error:'Invalid server response'}));if(!r.ok)throw Error(d.error||`Request failed (${r.status})`);return d}finally{loading(false)}}
/* Mobile navigation: keep real browser history so Android Back walks through IBuy screens. */
const IBUY_NAV_KEY='ibuy_nav_scroll_v1';
function currentRouteHash(){
  return location.hash || '#/shop';
}
function saveRouteScroll(){
  try{
    const key=currentRouteHash();
    const data=JSON.parse(sessionStorage.getItem(IBUY_NAV_KEY)||'{}');
    data[key]=window.scrollY||0;
    sessionStorage.setItem(IBUY_NAV_KEY,JSON.stringify(data));
  }catch{}
}
function restoreRouteScroll(){
  try{
    const data=JSON.parse(sessionStorage.getItem(IBUY_NAV_KEY)||'{}');
    const y=Number(data[currentRouteHash()]||0);
    requestAnimationFrame(()=>window.scrollTo(0,y));
  }catch{}
}
async function go(routeName){
  const target='#/'+String(routeName||'shop').replace(/^#\//,'');
  try{
    if(target===currentRouteHash()){
      await route();
      return;
    }
    saveRouteScroll();
    history.pushState({ibuy:true,route:target},'',target);
    await route();
  }catch(e){
    try{toast(e?.message||'Could not open this page.');}catch(_){}
  }
}
window.addEventListener('popstate',()=>{
  route();
  restoreRouteScroll();
});
window.addEventListener('hashchange',()=>{
  /* Compatibility for any legacy anchors that still assign location.hash. */
  route();
});

function statusClass(s){s=String(s||'').toLowerCase();return ['ready','completed','verified'].includes(s)?'success':(['low','pending','reserved','arrived'].includes(s)?'warning':'neutral')}
function badge(s){return `<span class="badge ${statusClass(s)}">${esc(String(s).replaceAll('_',' '))}</span>`}
function hav(a,b,c,d){const R=6371,rad=x=>x*Math.PI/180;let dLat=rad(c-a),dLon=rad(d-b),x=Math.sin(dLat/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function distance(lat,lon){return userLocation&&lat&&lon?hav(userLocation.lat,userLocation.lon,lat,lon):null}
function distanceText(lat,lon){let d=distance(lat,lon);return d==null?'':`${d<1?(d*1000).toFixed(0)+' m':d.toFixed(1)+' km'} away`}
function renderShell(){ $('app').innerHTML=`<a class="skip" href="#app">Skip to content</a><header><strong class="brand" onclick="go('shop')"><span class="brandmark">⌖</span> IBuy</strong><div id="session">${me?`<span>${esc(me.name)}</span> ${me.role==='buyer'?`<button onclick="accountForm()">WhatsApp</button>`:''} <button onclick="logout()">Sign out</button>`:`<button onclick="showAuth()">Sign in</button>`}</div></header><nav class="tabs"><button onclick="go('shop')">Shop</button><button onclick="go('basket')">Basket (${cart.length})</button><button onclick="go('stores')">Stores</button>${me?`<button onclick="go('orders')">Orders</button>`:''}${me&&['seller','staff'].includes(me.role)?`<button onclick="go('seller')">Seller</button>`:''}${me?.role==='admin'?`<button onclick="go('admin')">Admin</button>`:''}</nav><main id="view"></main><footer><a href="#/terms">Terms</a><a href="#/privacy">Privacy</a><a href="#/help">Help</a><span>IBuy discovery & reservation</span></footer>`; }
async function __ibuyRoute(){let h=location.hash.replace(/^#\//,'')||'shop',parts=h.split('/'),r=parts[0],id=parts[1]; if(r==='shop')return catalog(1);if(r==='basket')return basket();if(r==='stores')return stores();if(r==='orders')return orders();if(r==='seller')return seller();if(r==='admin')return admin();if(r==='product')return product(id);if(r==='store')return store(id);if(r==='terms'||r==='privacy'||r==='help')return legal(r);return catalog(1)}
/* Establish a browser-history entry for the initial IBuy route. */
if(!history.state || !history.state.ibuy){
  history.replaceState({ibuy:true,route:currentRouteHash()},'',currentRouteHash());
}
function filterBar(cats,sort='newest'){return `<div class="filters"><select id="fCat"><option value="">All categories</option>${cats.map(c=>`<option>${esc(c)}</option>`).join('')}</select><input id="fMin" type="number" min="0" placeholder="Min ₦"><input id="fMax" type="number" min="0" placeholder="Max ₦"><select id="fSort"><option value="newest" ${sort==='newest'?'selected':''}>Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="nearest">Nearest first</option></select><button onclick="applyFilters()">Apply</button><button type="button" onclick="requestLocation()">Use my location</button></div>`}
async function catalog(page=1){
  try{
    let q=new URLSearchParams(location.hash.includes('?')?location.hash.split('?')[1]:'');
    let search=q.get('q')||'',sort=q.get('sort')||'newest',cat=q.get('category')||'',min=q.get('min')||'',max=q.get('max')||'';
    let url=`/api/catalog?page=${page}&page_size=20&sort=${encodeURIComponent(sort)}&q=${encodeURIComponent(search)}&category=${encodeURIComponent(cat)}&min_price=${encodeURIComponent(min)}&max_price=${encodeURIComponent(max)}`;
    let d=await api(url); productsCache=page===1?d.products:[...productsCache,...d.products];
    let list=[...d.products]; if(sort==='nearest')list.sort((a,b)=>(distance(a.lat,a.lon)??1e9)-(distance(b.lat,b.lon)??1e9));
    let discovery='';
    if(page===1&&!search&&!cat&&!min&&!max){try{let x=await api('/api/discovery');discovery=ibuyDiscoveryHtml(x.trending||[],x.random||[])}catch(e){console.warn('discovery unavailable',e)}}
    $('view').innerHTML=`<section class="hero"><span class="eyebrow">LOCAL COMMERCE</span><h1>Find what you need nearby.</h1><p>Compare products, freshness, store trust and practical distance, then reserve and pick up in person.</p><div class="search"><input id="search" value="${esc(search)}" placeholder="Search products, categories"><button onclick="searchGo()">Search</button></div></section>${discovery}${filterBar(d.categories,sort)}<div class="grid">${list.map(card).join('')||`<div class="empty">No products matched your search.</div>`}</div>${page*d.page_size<d.total?`<button class="loadmore" onclick="catalog(${page+1})">Load more</button>`:''}`;
    if(sort==='nearest'&&!userLocation)toast('Tap Use my location to enable nearest-first sorting.')
  }catch(e){toast(e.message);$('view').innerHTML=`<div class="empty"><h2>Shop unavailable</h2><p>${esc(e.message)}</p><button onclick="catalog(1)">Try again</button></div>`}
}
function card(p){return `<article class="card" data-id="${esc(p.id)}" onclick="go('product/${encodeURIComponent(p.id)}')"><div class="pic">${p.image_b64?`<img src="${p.image_b64}" alt="${esc(p.name)} photo">`:'IBuy'}</div><h3>${esc(p.name)}</h3><p>${money(p.price)} · ${esc(p.unit)}</p><p>${esc(p.store_name)} · ${esc(p.category)}</p><p>${badge(p.stock_status)} ${distanceText(p.lat,p.lon)}</p><small>${fresh(p.price_updated_at)}</small></article>`}
function searchGo(){go('shop?'+new URLSearchParams({q:$('search').value}).toString())}
function applyFilters(){let p=new URLSearchParams({q:$('search')?.value||'',category:$('fCat').value,min:$('fMin').value,max:$('fMax').value,sort:$('fSort').value});go('shop?'+p.toString())}
async function product(id){try{let d=await api('/api/products/'+encodeURIComponent(id)),p=d.product;let recent=JSON.parse(localStorage.getItem('ibuy_recent_products')||'[]').map(String).filter(x=>x!==String(p.id));recent.unshift(String(p.id));localStorage.setItem('ibuy_recent_products',JSON.stringify(recent.slice(0,50)));$('view').innerHTML=`<div class="detail"><button onclick="go('shop')">← Shop</button><div class="detail-grid"><div class="pic large">${p.image_b64?`<img src="${p.image_b64}" alt="${esc(p.name)} photo">`:'IBuy'}</div><div><h2>${esc(p.name)}</h2><p>${esc(p.description||'No description yet.')}</p><h2>${money(p.price)} <small>/ ${esc(p.unit)}</small></h2><p>${fresh(p.price_updated_at)} · ${badge(p.stock_status)}</p><p><b>${esc(p.store_name)}</b><br>${esc(p.address)} · ${esc(p.landmark||'')}<br>${badge(p.verification_tier)} ${p.verified_at?`<small>Verified since ${new Date(p.verified_at*1000).toLocaleDateString(undefined,{month:'long',year:'numeric'})}</small>`:''}</p><button onclick="addById('${esc(p.id)}')">Add to basket</button><button onclick="go('store/${encodeURIComponent(p.store_id)}')">View store</button>${p.store_phone?`<button onclick="openWhatsApp('${esc(p.store_phone)}','Hello, I found ${esc(p.name)} on IBuy. Is it available?')">WhatsApp Seller</button>`:''}<a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}">Directions</a></div></div></div>`}catch(e){toast(e.message);$('view').innerHTML=`<div class="empty"><h2>Product not found</h2><p>We could not load that product.</p><button onclick="go('shop')">Back to Shop</button></div>`}}
async function stores(){try{let d=await api('/api/stores');$('view').innerHTML=`<div class="panel"><h2>Stores</h2><button onclick="requestLocation()">Use my location</button><div id="map" class="map"></div><div class="grid">${d.stores.map(s=>`<article class="card" onclick="go('store/${encodeURIComponent(s.id)}')"><div class="pic smallpic">${s.image_b64?`<img src="${s.image_b64}" alt="${esc(s.name)} photo">`:'IBuy'}</div><h3>${esc(s.name)}</h3><p>${esc(s.address)}<br>${esc(s.landmark||'')}<br>${esc(s.hours||'')}</p><p>${badge(s.verification_tier)} ${s.verified_at?`<small>Verified since ${new Date(s.verified_at*1000).toLocaleDateString(undefined,{month:'short',year:'numeric'})}</small>`:''}<br>${distanceText(s.lat,s.lon)}</p></article>`).join('')}</div></div>`;await loadLeaflet();initMap(d.stores)}catch(e){toast(e.message);$('view').innerHTML=`<div class="empty"><h2>Stores unavailable</h2><button onclick="go('shop')">Back to Shop</button></div>`}}
async function loadLeaflet(){if(window.L)return;await new Promise((res,rej)=>{let l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(l);let s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)})}
function initMap(storesList){if(!window.L)return;leafletMap=L.map('map').setView([7.635,4.18],14);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors'}).addTo(leafletMap);storesList.forEach(s=>L.marker([s.lat,s.lon]).addTo(leafletMap).bindPopup(`<b>${esc(s.name)}</b><br>${esc(s.verification_tier)}<br><a href="#/store/${encodeURIComponent(s.id)}">View store</a>`));if(userLocation)L.marker([userLocation.lat,userLocation.lon]).addTo(leafletMap).bindPopup('Your approximate position').openPopup()}
async function store(id){try{let d=await api('/api/stores/'+encodeURIComponent(id)),s=d.store;$('view').innerHTML=`<div class="panel"><button onclick="go('stores')">← Stores</button><div class="store-hero">${s.image_b64?`<img src="${s.image_b64}" alt="${esc(s.name)} photo">`:'<div class="store-logo">IBuy</div>'}<div><h2>${esc(s.name)} ${badge(s.verification_tier)}</h2><p>${esc(s.description||'')}<br>${esc(s.address)} · ${esc(s.landmark||'')}<br>${esc(s.hours||'')}</p>${s.verified_at?`<p><b>Verified since ${new Date(s.verified_at*1000).toLocaleDateString(undefined,{month:'long',year:'numeric'})}</b></p>`:''}${s.phone?`<button onclick="openWhatsApp('${esc(s.phone)}','Hello, I found your store on IBuy. I would like to ask about your products.')">WhatsApp Seller</button>`:''}<a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}">Directions</a></div></div><h3>Products</h3><div class="grid">${d.products.map(card).join('')||'<p>No active products.</p>'}</div><h3>Reviews</h3>${d.reviews.length?d.reviews.map(r=>`<div class="row"><span>${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)} — ${esc(r.comment||'')}</span><small>${esc(r.buyer_name)}</small></div>`).join(''):'<p>No reviews yet.</p>'}</div>`}catch(e){toast(e.message);$('view').innerHTML=`<div class="empty"><h2>Store not found</h2><button onclick="go('stores')">Back to Stores</button></div>`}}
function basket(){if(!cart.length)return $('view').innerHTML=`<div class="empty"><h2>Your basket is empty</h2><button onclick="go('shop')">Find products</button></div>`;let groups={};cart.forEach(x=>(groups[x.store_id]??=[]).push(x));$('view').innerHTML=`<div class="panel"><h2>Basket</h2>${Object.entries(groups).map(([sid,items])=>`<section><h3>${esc(items[0].store_name)}</h3>${items.map(i=>`<div class="row"><span>${esc(i.name)} × ${i.qty}</span><span>${money(i.price*i.qty)} <button onclick="changeQty('${i.id}',${i.qty-1})">−</button><button onclick="changeQty('${i.id}',${i.qty+1})">+</button></span></div>`).join('')}<button onclick="reserve('${sid}')">Reserve at this store</button></section>`).join('')}</div>`}
function addById(id){let p=productsCache.find(x=>x.id===id);if(!p){api('/api/products/'+encodeURIComponent(id)).then(d=>addProduct(d.product)).catch(e=>toast(e.message));return}addProduct(p)}
function addProduct(p){let x=cart.find(i=>i.id===p.id);if(x)x.qty+=1;else cart.push({id:p.id,store_id:p.store_id,store_name:p.store_name,name:p.name,price:p.price,qty:1});saveCart();toast('Added to basket');renderShell();go('basket')}
function changeQty(id,qty){let x=cart.find(i=>i.id===id);if(!x)return;if(qty<=0)cart=cart.filter(i=>i.id!==id);else x.qty=qty;saveCart();renderShell();go('basket')}
async function reserve(sid){if(!me)return showAuth();if(me.role!=='buyer')return toast('Buyer account required');if(!me.email_verified)return toast('Please verify your email first');let items=cart.filter(x=>x.store_id===sid).map(x=>({product_id:x.id,qty:x.qty}));try{let d=await api('/api/reservations',{method:'POST',body:JSON.stringify({store_id:sid,items})});cart=cart.filter(x=>x.store_id!==sid);saveCart();renderShell();toast(`Reserved ${d.reservation_id}`);go('orders')}catch(e){toast(e.message)}}
async function orders(){if(!me)return showAuth();try{let [d,rv]=await Promise.all([api('/api/reservations'),api('/api/reviews')]);$('view').innerHTML=`<div class="panel"><h2>${me.role==='buyer'?'My reservations':'Store reservations'}</h2>${d.reservations.map(r=>`<div class="order"><b>${esc(r.store_name)}</b> · ${badge(r.status)} · ${new Date(r.created_at*1000).toLocaleString()}${r.expires_at&&r.status==='reserved'?`<small> Expires ${new Date(r.expires_at*1000).toLocaleString()}</small>`:''}<ul>${r.items.map(i=>`<li>${esc(i.name)} × ${i.qty} · ${money(i.unit_price)}</li>`).join('')}</ul>${me.role==='buyer'&&r.status==='reserved'?`<button onclick="onway('${r.store_id}')">I'm On My Way</button> <button onclick="arrived('${r.id}')">I've Arrived</button> <button class="danger" onclick="cancelReservation('${r.id}')">Cancel reservation</button>`:''}${me.role==='buyer'&&r.status==='ready'?`<button onclick="onway('${r.store_id}')">I'm On My Way</button> <button onclick="arrived('${r.id}')">I've Arrived</button> <button class="danger" onclick="cancelReservation('${r.id}')">Cancel reservation</button>`:''}${['seller','staff','admin'].includes(me.role)&&r.status==='reserved'?`<button onclick="statusUpdate('${r.id}','ready')">Mark ready</button>`:''}${me.role==='buyer'&&r.status==='completed'?`<button onclick="review('${r.id}')">Review</button><button onclick="dispute('${r.id}')">Report a problem</button>`:''}${rv.reviews.filter(x=>x.order_id===r.id).map(x=>`<div class="row"><span>${'★'.repeat(x.rating)}${'☆'.repeat(5-x.rating)} ${esc(x.comment||'')}</span></div>`).join('')}</div>`).join('')||'<div class="empty">No reservations yet.</div>'}</div>`}catch(e){toast(e.message)}}
async function statusUpdate(id,status){try{await api('/api/reservations/status',{method:'POST',body:JSON.stringify({id,status})});toast('Updated');orders()}catch(e){toast(e.message)}}
async function cancelReservation(id){await statusUpdate(id,'cancelled')}
async function onway(sid){if(!me)return showAuth();showModal(`<h3>On My Way</h3><p>Share your location only with this selected store during a limited session.</p><label>Location mode<select id="locMode"><option value="approximate">Approximate</option><option value="precise">Precise</option></select></label><label>Duration<select id="locMin"><option>15</option><option>30</option><option>60</option><option>120</option></select></label><button onclick="startLocation('${esc(sid)}')">Start sharing</button><button onclick="closeModal()">Cancel</button>`)}
async function startLocation(sid){try{let d=await api('/api/location/start',{method:'POST',body:JSON.stringify({store_id:sid,mode:$('locMode').value,minutes:Number($('locMin').value)})});closeModal();if(!navigator.geolocation)return toast('Geolocation is not available');navigator.geolocation.getCurrentPosition(async pos=>{try{await api('/api/location/update',{method:'POST',body:JSON.stringify({id:d.id,lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy})});toast('Location sharing started')}catch(e){toast(e.message)}},()=>toast('Location permission was not granted'),{enableHighAccuracy:$('locMode')?.value==='precise',maximumAge:30000,timeout:10000})}catch(e){toast(e.message)}}
async function arrived(id){await statusUpdate(id,'arrived');await statusUpdate(id,'completed')}
async function review(id){showModal(`<h3>Review</h3><label>Rating<select id="rr"><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option></select></label><label>Comment<textarea id="rc"></textarea></label><button onclick="submitReview('${esc(id)}')">Submit</button><button onclick="closeModal()">Cancel</button>`)}
async function submitReview(id){try{await api('/api/reviews',{method:'POST',body:JSON.stringify({order_id:id,rating:Number($('rr').value),comment:$('rc').value})});closeModal();toast('Review submitted');orders()}catch(e){toast(e.message)}}
async function dispute(id){showModal(`<h3>Report a problem</h3><label>Problem<select id="dk"><option value="wrong_item">Wrong item</option><option value="no_show">No-show</option><option value="price_mismatch">Price mismatch</option><option value="other">Other</option></select></label><label>Description<textarea id="dd"></textarea></label><button onclick="submitDispute('${esc(id)}')">Submit</button><button onclick="closeModal()">Cancel</button>`)}
async function submitDispute(id){if(!$('dd').value.trim())return toast('Description is required');try{await api('/api/disputes',{method:'POST',body:JSON.stringify({reservation_id:id,kind:$('dk').value,description:$('dd').value})});closeModal();toast('Problem reported')}catch(e){toast(e.message)}}
async function seller(){try{let st=await api('/api/stores'),s=st.stores.find(x=>x.owner_id===me.id)||st.stores[0],a=await api('/api/arrivals'),r=await api('/api/reservations'),an=await api('/api/analytics?store_id='+encodeURIComponent(s.id)),staff=me.role==='seller'&&s.owner_id===me.id?await api('/api/staff?store_id='+encodeURIComponent(s.id)):null,cat=await api('/api/catalog?page=1&page_size=50');let ps=cat.products.filter(p=>p.store_id===s.id);$('view').innerHTML=`<div class="panel"><h2>Seller console</h2><div class="store-hero compact">${s.image_b64?`<img src="${s.image_b64}" alt="${esc(s.name)} photo">`:'<div class="store-logo">IBuy</div>'}<div><h3>${esc(s.name)} ${badge(s.verification_tier)}</h3><p>${esc(s.address)}</p><p class="muted">${s.location_captured_at?`Exact shop location captured · ±${s.location_accuracy?Math.round(s.location_accuracy):"?"} m`:`Exact shop location not captured yet`}</p><button onclick="storeForm('${esc(s.id)}')">Edit store</button></div></div><div class="stats">${Object.entries(an.metrics).map(([k,v])=>`<div><b>${v}</b><small>${esc(k)}</small></div>`).join('')}</div><h3>7-day reservations</h3><canvas id="trend" width="700" height="220" class="chart"></canvas><h3>Products</h3><button onclick="productForm('${esc(s.id)}')">Add product</button><div id="seller-products" class="grid">${ps.map(p=>`<article class="card"><div class="pic">${p.image_b64?`<img src="${p.image_b64}" alt="${esc(p.name)} photo">`:'IBuy'}</div><h3>${esc(p.name)}</h3><p>${money(p.price)} · stock ${p.stock_qty} ${badge(p.stock_status)}</p><button class="edit-product" data-product-id="${esc(p.id)}" data-store-id="${esc(s.id)}">Edit</button><button class="danger deactivate-product" data-product-id="${esc(p.id)}">Remove from catalog</button></article>`).join('')}</div><h3>Store photo & verification document</h3><button onclick="storeForm('${esc(s.id)}')">Manage store profile</button><button onclick="documentForm('${esc(s.id)}')">Upload business document</button><h3>Opted-in arrivals</h3>${a.arrivals.map(x=>`<div class="row">${esc(x.buyer_name)} · ${esc(x.mode)} · ${x.lat?esc(x.lat+', '+x.lon):'waiting for location'}</div>`).join('')||'<p>No active arrivals.</p>'}<h3>Reservations</h3>${r.reservations.map(x=>`<div class="row">${esc(x.buyer_name)} · ${badge(x.status)} ${x.status==='reserved'?`<button onclick="statusUpdate('${esc(x.id)}','ready')">Mark ready</button>`:''}</div>`).join('')}${staff?`<h3>Staff</h3><div class="row"><form onsubmit="event.preventDefault();inviteStaff('${esc(s.id)}')" class="inline-form"><input id="staffEmail" type="email" placeholder="Existing IBuy email" required><label><input id="spPricing" type="checkbox"> pricing</label><label><input id="spInventory" type="checkbox"> inventory</label><label><input id="spOrders" type="checkbox" checked> orders</label><label><input id="spLocation" type="checkbox"> location</label><button>Invite</button></form></div>${staff.staff.map(x=>`<div class="row"><span>${esc(x.name)} · ${esc(x.email)} · ${esc(JSON.parse(x.permissions||'[]').join(', '))}</span>${x.active?`<button onclick="removeStaff('${esc(s.id)}','${esc(x.user_id)}')">Remove</button>`:badge('inactive')}</div>`).join('')}`:''}</div>`;drawTrend(an.trend);attachSellerHandlers(ps)}catch(e){toast(e.message);$('view').innerHTML=`<div class="empty"><h2>Seller console unavailable</h2><p>${esc(e.message)}</p></div>`}}
function attachSellerHandlers(){document.querySelectorAll('.edit-product').forEach(b=>b.addEventListener('click',async()=>{let p=await api('/api/products/'+encodeURIComponent(b.dataset.productId));productForm(b.dataset.storeId,p.product)}));document.querySelectorAll('.deactivate-product').forEach(b=>b.addEventListener('click',()=>confirmModal('Remove this product from the catalog?',async()=>{try{await api('/api/products/deactivate',{method:'POST',body:JSON.stringify({id:b.dataset.productId})});toast('Product removed');seller()}catch(e){toast(e.message)}})))}
function drawTrend(rows){let c=$('trend');if(!c)return;let x=c.getContext('2d'),w=c.width,h=c.height;x.clearRect(0,0,w,h);let max=Math.max(1,...rows.map(r=>r.reservations)),step=w/Math.max(1,rows.length-1);x.strokeStyle='#0f766e';x.lineWidth=3;x.beginPath();rows.forEach((r,i)=>{let px=i*step,py=h-30-(r.reservations/max)*(h-60);i?x.lineTo(px,py):x.moveTo(px,py);x.fillText(String(r.reservations),px,py-8)});x.stroke();x.fillStyle='#475467';rows.forEach((r,i)=>x.fillText(r.day.slice(5),i*step-12,h-8))}
function productForm(sid,p={}){imageData=null;showModal(`<h3>${p.id?'Edit':'Add'} product</h3><div class="form-grid">${input('pn','Name','text',p.name||'')}${input('pc','Category','text',p.category||'Other')}${input('pu','Unit','text',p.unit||'unit')}${input('pp','Price ₦','number',p.price||'','min=0')}${input('pq','Stock','number',p.stock_qty||0,'min=0 step=0.01')}${input('plt','Low-stock threshold','number',p.low_stock_threshold??2,'min=0 step=0.1')}</div><label>Description<textarea id="pd">${esc(p.description||'')}</textarea></label><label>Product image<input id="pi" type="file" accept="image/*"></label><div id="prev">${p.image_b64?`<img class="preview" src="${p.image_b64}" alt="${esc(p.name||'Product')} preview">`:''}</div><button onclick="saveProduct('${esc(sid)}','${esc(p.id||'')}')">Save</button><button onclick="closeModal()">Cancel</button>`);$('pi').addEventListener('change',previewImage)}
function previewImage(e){let f=e.target.files[0];if(!f)return;if(!f.type.startsWith('image/'))return toast('Choose an image');let img=new Image();img.onload=()=>{let scale=Math.min(1,800/img.width),c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);let out=c.toDataURL('image/jpeg',.76);if(out.length>400000)return toast('Image is still too large; choose a smaller photo');imageData=out;$('prev').innerHTML=`<img class="preview" src="${out}" alt="Selected preview">`;};img.src=URL.createObjectURL(f)}
async function saveProduct(sid,id){let data={store_id:sid,name:$('pn').value,category:$('pc').value,unit:$('pu').value,price:Number($('pp').value),stock_qty:Number($('pq').value),low_stock_threshold:Number($('plt').value),description:$('pd').value};if(imageData)data.image_b64=imageData;try{await api(id?'/api/products/update':'/api/products',{method:'POST',body:JSON.stringify(id?{...data,id}:data)});closeModal();toast('Product saved');seller()}catch(e){toast(e.message)}}
function storeForm(sid){api('/api/stores/'+encodeURIComponent(sid)).then(d=>{let s=d.store;showModal(`<h3>Store profile</h3>${input('sn','Name','text',s.name)}${input('sa','Address','text',s.address)}${input('sl','Landmark','text',s.landmark||'')}${input('sh','Hours','text',s.hours||'')}${input('swa','WhatsApp number','tel',s.phone||'')}${input('sdesc','Description','text',s.description||'')}<label>Store photo<input id="si" type="file" accept="image/*"></label><div id="sprev">${s.image_b64?`<img class="preview" src="${s.image_b64}" alt="${esc(s.name)} preview">`:''}</div><button onclick="saveStore('${esc(sid)}')">Save</button><button onclick="closeModal()">Cancel</button>`);$('si').addEventListener('change',previewStoreImage)}).catch(e=>toast(e.message))}
function documentForm(sid){showModal(`<h3>Business verification document</h3><p>Upload a business registration or supporting document. It is visible only to administrators.</p><label>Document<input id="docf" type="file" accept="image/*,.pdf"></label><button onclick="uploadDocument('${esc(sid)}')">Upload</button><button onclick="closeModal()">Cancel</button>`)}
async function uploadDocument(sid){let f=$('docf').files[0];if(!f)return toast('Choose a document');let r=new FileReader();r.onload=async()=>{if(String(r.result).length>700000)return toast('Document is too large');try{await api('/api/store-documents',{method:'POST',body:JSON.stringify({store_id:sid,kind:f.type,file_b64:r.result})});closeModal();toast('Document uploaded')}catch(e){toast(e.message)}};r.readAsDataURL(f)}
async function inviteStaff(sid){let permissions=['pricing','inventory','orders','location'].filter(x=>$('sp'+x[0].toUpperCase()+x.slice(1)).checked);try{await api('/api/staff/invite',{method:'POST',body:JSON.stringify({store_id:sid,email:$('staffEmail').value,permissions})});toast('Staff invited');seller()}catch(e){toast(e.message)}}
async function removeStaff(sid,uid){try{await api('/api/staff/remove',{method:'POST',body:JSON.stringify({store_id:sid,user_id:uid})});toast('Staff removed');seller()}catch(e){toast(e.message)}}
async function admin(){if(me?.role!=='admin')return toast('Admin only');try{let [ds,st,us]=await Promise.all([api('/api/disputes'),api('/api/admin/stores'),api('/api/admin/users')]);$('view').innerHTML=`<div class="panel"><h2>Admin</h2><h3>Open disputes</h3>${ds.disputes.filter(d=>d.status==='open').map(d=>`<div class="row"><span>${esc(d.kind)} · ${esc(d.description)} · ${esc(d.reporter_name)}</span><button onclick="resolveDispute('${esc(d.id)}')">Resolve</button></div>`).join('')||'<p>None.</p>'}<h3>Stores</h3>${st.stores.map(s=>`<div class="row"><span>${esc(s.name)} · ${esc(s.owner_name)} ${badge(s.verification_tier)} ${s.verified_at?`Verified since ${new Date(s.verified_at*1000).toLocaleDateString(undefined,{month:'short',year:'numeric'})}`:''}</span><button onclick="verifyStore('${esc(s.id)}','${s.verification_tier==='verified'?'pending':'verified'}')">${s.verification_tier==='verified'?'Set pending':'Verify'}</button></div>`).join('')}<h3>Users</h3>${us.users.map(x=>`<div class="row"><span>${esc(x.name)} · ${esc(x.email)} · ${esc(x.role)} ${x.email_verified?badge('verified'):badge('pending')}</span>${x.active?`<button onclick="deactivate('${esc(x.id)}')">Deactivate</button>`:badge('inactive')}</div>`).join('')}</div>`}catch(e){toast(e.message)}}
async function resolveDispute(id){try{await api('/api/admin/disputes/resolve',{method:'POST',body:JSON.stringify({id})});admin()}catch(e){toast(e.message)}}async function verifyStore(id,tier){try{await api('/api/admin/stores/verify',{method:'POST',body:JSON.stringify({id,verification_tier:tier})});admin()}catch(e){toast(e.message)}}async function deactivate(id){try{await api('/api/admin/users/deactivate',{method:'POST',body:JSON.stringify({id})});admin()}catch(e){toast(e.message)}}
function input(id,label,type='text',value='',extra=''){return `<label>${esc(label)}<input id="${id}" type="${type}" value="${esc(value)}" ${extra}></label>`}
function showModal(html){closeModal();let b=document.createElement('div');b.id='modal';b.className='modal-backdrop';b.innerHTML=`<div class="modal" role="dialog" aria-modal="true">${html}</div>`;document.body.appendChild(b)}
function confirmModal(text,fn){showModal(`<p>${esc(text)}</p><button id="confirmYes">Confirm</button><button onclick="closeModal()">Cancel</button>`);$('confirmYes').onclick=async()=>{closeModal();await fn()}}
function closeModal(){$('modal')?.remove()}
function valid(el,msg){let old=el.parentElement?.querySelector('.field-error');old?.remove();el.classList.remove('invalid');if(!el.value.trim()){el.classList.add('invalid');let e=document.createElement('small');e.className='field-error';e.textContent=msg;el.parentElement?.appendChild(e);return false}return true}
function accountForm(){api('/api/me').then(d=>{let u=d.user;if(!u)return showAuth();showModal(`<h3>My contact</h3>${input('acName','Name','text',u.name)}${input('acWa','WhatsApp number','tel',u.whatsapp_number||u.phone||'')}${u.role==='buyer'?`<label><input id="acAllowWa" type="checkbox" ${u.allow_seller_whatsapp?'checked':''}> Allow sellers to contact me on WhatsApp</label>`:''}<p class="muted">Your WhatsApp number is used for IBuy contact. Sellers can only contact buyers who allow it.</p><button onclick="saveAccount()">Save</button><button onclick="closeModal()">Cancel</button>`)}).catch(e=>toast(e.message))}
async function saveAccount(){try{let d=await api('/api/account/update',{method:'POST',body:JSON.stringify({name:$('acName').value,whatsapp_number:normalizeWhatsApp($('acWa').value),allow_seller_whatsapp:$('acAllowWa')?.checked!==false})});me=d.user;closeModal();renderShell();route();toast('Contact details saved')}catch(e){toast(e.message)}}
function showAuth(){showModal(`<div class="auth"><h3>Sign in</h3>${input('liEmail','Email','email')}${input('liPw','Password','password')}<button onclick="login()">Sign in</button><hr><h3>Create account</h3>${input('suName','Name')}${input('suEmail','Email','email')}${input('suPw','Password (8+)','password')}${input('suWa','WhatsApp number','tel','')}<label>Account<select id="suRole" onchange="toggleSellerSignup()"><option value="buyer">Buyer</option><option value="seller">Seller</option></select></label><div id="sellerSignupBox" class="location-box" hidden><b>Seller shop setup</b><p class="muted">Capture your exact shop position from this phone. You can change it later from your Seller console.</p><button type="button" onclick="captureSignupLocation()">Capture exact shop location</button><small id="signupLocStatus" class="muted">Location not captured yet.</small></div><button onclick="signup()">Create account</button><p class="muted">Demo seller: seller@ibuy.local / Seller123!</p></div>`);toggleSellerSignup()}
function toggleSellerSignup(){let box=$('sellerSignupBox');if(!box)return;box.hidden=$('suRole').value!=='seller'}
function captureSignupLocation(){if(!navigator.geolocation)return toast('This phone does not provide location.');toast('Requesting precise shop location…');navigator.geolocation.getCurrentPosition(p=>{sellerSignupLocation={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy};$('signupLocStatus').textContent=`Captured: ±${Math.round(p.coords.accuracy)} m accuracy`;toast('Exact shop location captured')},e=>toast(e.code===1?'Location permission was denied.': 'Could not capture location.'),{enableHighAccuracy:true,maximumAge:0,timeout:15000})}
async function login(){if(!valid($('liEmail'),'Email is required')||!valid($('liPw'),'Password is required'))return;try{let d=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('liEmail').value,password:$('liPw').value})});me=d.user;closeModal();renderShell();route();toast('Signed in')}catch(e){toast(e.message)}}
async function signup(){if(!valid($('suName'),'Name is required')||!valid($('suEmail'),'Email is required')||!valid($('suPw'),'Password is required'))return;let role=$('suRole').value;if(role==='seller'&&!sellerSignupLocation)toast('You can capture the exact shop location now or during the seller setup that follows.');try{let payload={name:$('suName').value,email:$('suEmail').value,password:$('suPw').value,role,whatsapp_number:normalizeWhatsApp($('suWa').value)};if(role==='seller'&&sellerSignupLocation){payload.lat=sellerSignupLocation.lat;payload.lon=sellerSignupLocation.lon;payload.location_accuracy=sellerSignupLocation.accuracy;payload.location_source='device_gps'}let d=await api('/api/auth/signup',{method:'POST',body:JSON.stringify(payload)});me=d.user;closeModal();renderShell();if(d.email_verification_required)toast('Account created. Verify your email before reservations or product publishing.');if(d.store_id&&me.role==='seller')sellerOnboarding(d.store_id);else route()}catch(e){toast(e.message)}}
function sellerOnboarding(sid){storeLocationCapture=null;showModal(`<h3>Set up your exact shop</h3><div id="onboard"><p>Step 1 of 3 — store identity, address and exact map position.</p>${input('onName','Store name','text',me.name+' Store')}${input('onAddr','Address')}${input('onLand','Landmark')}<input id="onHours" value="08:00-20:00" placeholder="Hours"><div class="location-box"><b>Exact shop location</b><p id="onLocStatus" class="muted">${sellerSignupLocation?`Captured during registration: ±${Math.round(sellerSignupLocation.accuracy)} m`:'Not captured yet.'}</p><button type="button" onclick="captureOnboardingLocation('${esc(sid)}')">Capture / change exact location</button></div><button onclick="onboardStep2('${esc(sid)}')">Continue</button></div>`)}
function captureOnboardingLocation(sid){if(!navigator.geolocation)return toast('Geolocation is not available');navigator.geolocation.getCurrentPosition(p=>{storeLocationCapture={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy};$('onLocStatus').textContent=`Captured: ${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)} · ±${Math.round(p.coords.accuracy)} m`;toast('Exact shop location captured')},()=>toast('Could not capture exact shop location. Enable location permission and try again.'),{enableHighAccuracy:true,maximumAge:0,timeout:15000})}
async function onboardStep2(sid){try{let d={id:sid,name:$('onName').value,address:$('onAddr').value,landmark:$('onLand').value,hours:$('onHours').value};let loc=storeLocationCapture||sellerSignupLocation;if(loc){d.lat=loc.lat;d.lon=loc.lon;d.location_accuracy=loc.accuracy;d.location_source='device_gps'}else{toast('Capture your exact shop location before continuing.');return}await api('/api/stores/update',{method:'POST',body:JSON.stringify(d)});$('onboard').innerHTML=`<p>Step 2 of 3 — capture your storefront so buyers can recognize the exact shop.</p><label>Take storefront photo<input id="onPhoto" type="file" accept="image/*" capture="environment"></label><div id="onPhotoPreview"></div><button onclick="onboardStep3('${esc(sid)}')">Continue</button><button onclick="onboardStep3('${esc(sid)}')">Skip</button>`;$('onPhoto').addEventListener('change',e=>previewStorefrontFile(e,'onPhotoPreview'))}catch(e){toast(e.message)}}
async function onboardStep3(sid){let f=$('onPhoto')?.files?.[0];if(f){let data=await compressImageFile(f,1000,.76);if(!data)return;try{await api('/api/stores/update',{method:'POST',body:JSON.stringify({id:sid,image_b64:data})});finishOnboard(sid)}catch(e){toast(e.message)}}else finishOnboard(sid)}
function finishOnboard(sid){closeModal();seller();toast('Store setup complete. Your exact location and storefront can be changed anytime in Seller.')}
function storeForm(sid){api('/api/stores/'+encodeURIComponent(sid)).then(d=>{let s=d.store;storeLocationCapture=null;showModal(`<h3>Store profile</h3>${input('sn','Name','text',s.name)}${input('sa','Address','text',s.address)}${input('sl','Landmark','text',s.landmark||'')}${input('sh','Hours','text',s.hours||'')}${input('swa','WhatsApp number','tel',s.phone||'')}${input('sdesc','Description','text',s.description||'')}${input('swa','WhatsApp number','tel',s.phone||'')}<div class="location-box"><b>Exact shop location</b><p id="storeLocStatus" class="muted">${s.location_captured_at?`Captured ${new Date(s.location_captured_at*1000).toLocaleString()} · ±${s.location_accuracy?Math.round(s.location_accuracy):'?'} m`:'Not captured from this device yet.'}</p><button type="button" onclick="captureStoreLocation('${esc(sid)}')">Capture / change exact location</button></div><label>Storefront photo — take a new photo<input id="si" type="file" accept="image/*" capture="environment"></label><div id="sprev">${s.image_b64?`<img class="preview" src="${s.image_b64}" alt="${esc(s.name)} storefront preview">`:''}</div><button onclick="saveStore('${esc(sid)}')">Save</button><button onclick="closeModal()">Cancel</button>`);$('si').addEventListener('change',previewStoreImage)}).catch(e=>toast(e.message))}
function captureStoreLocation(sid){if(!navigator.geolocation)return toast('Geolocation is not available');navigator.geolocation.getCurrentPosition(p=>{storeLocationCapture={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy};$('storeLocStatus').textContent=`New location captured: ${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)} · ±${Math.round(p.coords.accuracy)} m`;toast('Exact shop location captured. Save to publish it.')},()=>toast('Could not capture exact shop location.'),{enableHighAccuracy:true,maximumAge:0,timeout:15000})}
let storeImage=null;function compressImageFile(f,max=1000,quality=.76){return new Promise(resolve=>{if(!f.type.startsWith('image/')){toast('Please choose an image.');return resolve(null)}let img=new Image();img.onload=()=>{let sc=Math.min(1,max/img.width),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*sc));c.height=Math.max(1,Math.round(img.height*sc));c.getContext('2d').drawImage(img,0,0,c.width,c.height);let out=c.toDataURL('image/jpeg',quality);URL.revokeObjectURL(img.src);if(out.length>400000){toast('Image is too large after compression. Try another photo.');return resolve(null)}resolve(out)};img.src=URL.createObjectURL(f)})}
function previewStorefrontFile(e,target){let f=e.target.files?.[0];if(!f)return;compressImageFile(f,1000,.76).then(out=>{if(out)$(target).innerHTML=`<img class="preview" src="${out}" alt="Storefront preview">`})}
function previewStoreImage(e){let f=e.target.files[0];if(!f)return;compressImageFile(f,1000,.76).then(out=>{if(out){storeImage=out;$('sprev').innerHTML=`<img class="preview" src="${out}" alt="Storefront preview">`}})}
async function saveStore(sid){try{let d={id:sid,name:$('sn').value,address:$('sa').value,landmark:$('sl').value,hours:$('sh').value,description:$('sdesc').value,phone:normalizeWhatsApp($('swa').value)};if(storeImage)d.image_b64=storeImage;if(storeLocationCapture){d.lat=storeLocationCapture.lat;d.lon=storeLocationCapture.lon;d.location_accuracy=storeLocationCapture.accuracy;d.location_source='device_gps'}await api('/api/stores/update',{method:'POST',body:JSON.stringify(d)});storeImage=null;storeLocationCapture=null;closeModal();toast('Store saved');seller()}catch(e){toast(e.message)}}
function documentForm(sid){showModal(`<h3>Business verification document</h3><p>Upload a business registration or supporting document. It is visible only to administrators.</p><label>Document<input id="docf" type="file" accept="image/*,.pdf"></label><button onclick="uploadDocument('${esc(sid)}')">Upload</button><button onclick="closeModal()">Cancel</button>`)}
async function uploadDocument(sid){let f=$('docf').files[0];if(!f)return toast('Choose a document');let r=new FileReader();r.onload=async()=>{if(String(r.result).length>700000)return toast('Document is too large');try{await api('/api/store-documents',{method:'POST',body:JSON.stringify({store_id:sid,kind:f.type,file_b64:r.result})});closeModal();toast('Document uploaded')}catch(e){toast(e.message)}};r.readAsDataURL(f)}
async function inviteStaff(sid){let permissions=['pricing','inventory','orders','location'].filter(x=>$('sp'+x[0].toUpperCase()+x.slice(1)).checked);try{await api('/api/staff/invite',{method:'POST',body:JSON.stringify({store_id:sid,email:$('staffEmail').value,permissions})});toast('Staff invited');seller()}catch(e){toast(e.message)}}
async function removeStaff(sid,uid){try{await api('/api/staff/remove',{method:'POST',body:JSON.stringify({store_id:sid,user_id:uid})});toast('Staff removed');seller()}catch(e){toast(e.message)}}
function legal(r){let data={terms:['Terms of Service','IBuy helps buyers discover local products and reserve them for in-person pickup. Prices, stock and store information may change. Buyers should confirm final availability with the store. Reservations expire after the stated window.'],privacy:['Privacy Policy','IBuy collects account details needed to operate the service and may collect approximate or precise device location only when a buyer explicitly starts an On My Way session. During an active session, location is shared with the selected store only, is time-limited, and can be stopped by the buyer. Ordinary browsing and directions do not share live buyer location.'],help:['Help & FAQ','How do I reserve? Add products from one store to your basket and choose Reserve. How do I cancel? Open Orders and cancel while the reservation is active. How does On My Way work? Start a time-limited location session for the selected store. Need help with a completed reservation? Use Report a problem.']}[r];$('view').innerHTML=`<div class="panel"><h2>${data[0]}</h2><p>${esc(data[1])}</p><p>For account or store support, use the in-app Help flow or contact the IBuy operator.</p></div>`}
function requestLocation(){if(!navigator.geolocation)return toast('Geolocation is not available');navigator.geolocation.getCurrentPosition(p=>{userLocation={lat:p.coords.latitude,lon:p.coords.longitude};toast('Location ready');route()},()=>toast('Location permission was not granted'),{enableHighAccuracy:false,maximumAge:300000,timeout:8000})}
async function boot(){try{let d=await api('/api/me');me=d.user}catch{}renderShell();route()}
boot();

/* Route wrapper: render first, then restore the previous scroll position for that route. */
const __ibuyRouteImpl=__ibuyRoute;
async function route(){
  const result=await __ibuyRouteImpl();
  restoreRouteScroll();
  return result;
}


/* IBuy V2.12: explicit browser action bridge.
   Generated UI contains inline onclick handlers; expose the corresponding
   actions explicitly on window so they work reliably in Android Chrome/PWA
   contexts. */
(function () {
  const actionNames = [
    'go','showAuth','login','signup','logout','accountForm','saveAccount',
    'openWhatsApp','requestLocation','searchGo','applyFilters','catalog',
    'basket','stores','orders','seller','admin','product','store',
    'addById','changeQty','reserve','cancelReservation','arrived','onway',
    'startLocation','statusUpdate','review','submitReview','dispute',
    'submitDispute','productForm','saveProduct','deactivate',
    'storeForm','saveStore','captureStoreLocation','documentForm',
    'uploadDocument','inviteStaff','removeStaff','verifyStore',
    'captureSignupLocation','captureOnboardingLocation','onboardStep2',
    'onboardStep3','finishOnboard','closeModal'
  ];

  for (const name of actionNames) {
    try {
      if (typeof window[name] !== 'function' &&
          typeof globalThis[name] === 'function') {
        window[name] = globalThis[name];
      }
    } catch (_) {}
  }

  /* V2.12: ensure the rendered Sign out control has a working action. */
  if (typeof window.logout !== 'function') {
    window.logout = async function () {
      try {
        if (typeof api === 'function') {
          await api('/api/auth/logout', { method: 'POST' });
        }
      } catch (_) {}
      try { window.me = null; } catch (_) {}
      try { renderShell(); } catch (_) {}
      try { route(); } catch (_) {}
      try { toast('Signed out'); } catch (_) {}
    };
  }

  window.IBUY_UI_READY = true;
  window.addEventListener('error', function(e){
    try{ console.error('IBuy UI error:', e.error || e.message); }catch(_){}
  });
  window.addEventListener('unhandledrejection', function(e){
    try{ console.error('IBuy unhandled rejection:', e.reason); }catch(_){}
  });
})();
