// Service worker v2 — mở app tức thì từ bộ nhớ, cập nhật ngầm.
// - Giao diện (index.html, icon...): trả ngay bản đã lưu, tải bản mới ở nền (stale-while-revalidate).
// - Thư viện cdnjs (Leaflet, ExcelJS): lưu lại, lần sau không cần mạng.
// - Ô bản đồ: lưu tối đa 400 ô để xem lại nhanh.
// - Không đụng tới Google Apps Script (đăng nhập, lưu dữ liệu đi thẳng ra mạng).
const V = 'ctl-v2', LIBS = 'ctl-libs-v1', TILES = 'ctl-tiles-v1', MAX_TILES = 400;
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com', 'api.mapbox.com'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V)
      .then(c => Promise.all(SHELL.map(u =>
        fetch(new Request(u, { cache: 'reload' })).then(r => r.ok && c.put(u, r)).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(x => ![V, LIBS, TILES].includes(x)).map(x => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

async function notifyIfChanged(oldRes, newRes) {
  try {
    const a = oldRes && oldRes.headers.get('etag'), b = newRes.headers.get('etag');
    if (a && b && a !== b) {
      const cs = await self.clients.matchAll({ type: 'window' });
      cs.forEach(c => c.postMessage({ type: 'updated' }));
    }
  } catch (e) {}
}

async function trim(name, max) {
  const c = await caches.open(name), k = await c.keys();
  for (let i = 0; i < k.length - max; i++) await c.delete(k[i]);
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);

  // Giao diện của chính app: trả ngay bản đã lưu, cập nhật ngầm
  if (u.origin === location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(V);
      const cached = r.mode === 'navigate' ? await c.match('./index.html') : await c.match(r, { ignoreSearch: true });
      const net = fetch(r.url, { cache: 'no-cache' }).then(res => {
        if (res.ok) {
          const isPage = r.mode === 'navigate' || /\/(index\.html)?$/.test(u.pathname);
          if (isPage) notifyIfChanged(cached, res);
          c.put(r.mode === 'navigate' ? './index.html' : r, res.clone());
        }
        return res;
      });
      if (cached) { e.waitUntil(net.catch(() => {})); return cached; }
      return net.catch(() => Response.error());
    })());
    return;
  }

  // Thư viện: lưu lại, lần sau dùng ngay
  if (u.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(caches.open(LIBS).then(async c => {
      const hit = await c.match(r);
      if (hit) return hit;
      const res = await fetch(r);
      if (res.ok || res.type === 'opaque') c.put(r, res.clone());
      return res;
    }));
    return;
  }

  // Ô bản đồ: lưu để xem lại nhanh (chỉ lưu khi đọc được bằng CORS, tránh tốn dung lượng)
  if (TILE_HOSTS.includes(u.hostname)) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(r);
      if (hit) return hit;
      const res = await fetch(r);
      if (res.ok && res.type === 'cors') { c.put(r, res.clone()).then(() => trim(TILES, MAX_TILES)); }
      return res;
    }));
  }
});
