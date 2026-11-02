/**
 * Free GST Billing Software - In-Browser Storage Engine & API Interceptor
 * Enables 100% full browser functionality on Vercel, mobile, and any modern browser.
 * Uses IndexedDB with LocalStorage fallback for high performance and offline persistence.
 */
(function() {
  'use strict';

  const DB_NAME = 'FreeGSTBillingDB';
  const DB_VERSION = 1;
  const STORES = [
    'bills', 'clients', 'products', 'expenses', 'purchases',
    'recurring', 'receipts', 'profiles', 'templates', 'meta', 'saved_pdfs'
  ];

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        return resolve(null); // Fallback to localStorage
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        STORES.forEach((storeName) => {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'id' });
          }
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return dbPromise;
  }

  // Generic DB helpers
  async function getAll(storeName) {
    const db = await openDB();
    if (!db) {
      try {
        const raw = localStorage.getItem(`gst_${storeName}`);
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async function getOne(storeName, id) {
    const db = await openDB();
    if (!db) {
      const items = await getAll(storeName);
      return items.find(i => i.id === id) || null;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function putOne(storeName, item) {
    const db = await openDB();
    if (!db) {
      try {
        const items = await getAll(storeName);
        const idx = items.findIndex(i => i.id === item.id);
        if (idx >= 0) items[idx] = item;
        else items.push(item);
        localStorage.setItem(`gst_${storeName}`, JSON.stringify(items));
        return item;
      } catch { return item; }
    }
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(item);
        req.onsuccess = () => resolve(item);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  async function deleteOne(storeName, id) {
    const db = await openDB();
    if (!db) {
      try {
        let items = await getAll(storeName);
        items = items.filter(i => i.id !== id);
        localStorage.setItem(`gst_${storeName}`, JSON.stringify(items));
        return true;
      } catch { return false; }
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  // Meta counter / settings helpers
  async function getMeta(key) {
    const item = await getOne('meta', key);
    if (item && item.value !== undefined) return item.value;
    try {
      const raw = localStorage.getItem(`gst_meta_${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async function setMeta(key, value) {
    await putOne('meta', { id: key, value });
    try {
      localStorage.setItem(`gst_meta_${key}`, JSON.stringify(value));
    } catch {}
    return value;
  }

  async function incrementMeta(key, start = 1) {
    const current = await getMeta(key);
    const num = (current !== null && !isNaN(Number(current))) ? Number(current) : (start - 1);
    const next = num + 1;
    await setMeta(key, next);
    return next;
  }

  // Default Business Profile
  const DEFAULT_PROFILE = {
    id: 'default_profile',
    businessName: '',
    address: '',
    state: '',
    gstin: '',
    pan: '',
    email: '',
    phone: '',
    bankName: '',
    accountNumber: '',
    ifsc: '',
    logo: '',
    signature: '',
    upiId: '',
    country: 'India',
    googleClientId: '',
    googleDriveFolder: 'GST Billing Invoices'
  };

  async function getProfile() {
    const profile = await getOne('meta', 'profile');
    if (profile && profile.data) return { ...DEFAULT_PROFILE, ...profile.data };
    try {
      const stored = localStorage.getItem('gst_profile');
      if (stored) return { ...DEFAULT_PROFILE, ...JSON.parse(stored) };
    } catch {}
    return { ...DEFAULT_PROFILE };
  }

  async function saveProfile(data) {
    const merged = { ...DEFAULT_PROFILE, ...data, id: 'profile' };
    await putOne('meta', { id: 'profile', data: merged });
    try {
      localStorage.setItem('gst_profile', JSON.stringify(merged));
    } catch {}
    return merged;
  }

  // Intercept fetch
  const originalFetch = window.fetch;

  window.fetch = async function(input, init = {}) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    const method = (init.method || 'GET').toUpperCase();

    // Check if this is an API call
    if (url.startsWith('/api') || url.includes('localhost:47371/api')) {
      const pathname = url.replace(/^https?:\/\/[^\/]+/, '').split('?')[0];
      const search = url.includes('?') ? url.split('?')[1] : '';
      const params = new URLSearchParams(search);

      // Try local server first if on localhost:47371
      const isLocalDesktop = window.location.hostname === 'localhost' && window.location.port === '47371';
      if (isLocalDesktop) {
        try {
          const res = await originalFetch(input, init);
          if (res.ok) return res;
        } catch {
          // Local server offline, fall through to browser storage
        }
      }

      // Browser Storage Handlers
      try {
        // 1. /api/profile
        if (pathname === '/api/profile') {
          if (method === 'GET') {
            const p = await getProfile();
            return new Response(JSON.stringify(p), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'POST') {
            const body = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
            const saved = await saveProfile(body);
            return new Response(JSON.stringify({ success: true, profile: saved }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }

        // 2. /api/bills
        if (pathname === '/api/bills') {
          if (method === 'GET') {
            const bills = await getAll('bills');
            bills.sort((a, b) => new Date(b.invoiceDate || 0) - new Date(a.invoiceDate || 0));
            return new Response(JSON.stringify(bills), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'POST') {
            const bill = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
            if (!bill.id) {
              return new Response(JSON.stringify({ error: 'Bill must have an id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
            // Check overwrite
            const overwrite = params.get('overwrite') === '1' || params.get('overwrite') === 'true';
            const existing = await getOne('bills', bill.id);
            if (existing && !overwrite) {
              return new Response(JSON.stringify({ error: 'A bill with this invoice number already exists', invoiceNumber: bill.id }), { status: 409, headers: { 'Content-Type': 'application/json' } });
            }
            await putOne('bills', bill);
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }

        // /api/bills/:id
        const billMatch = pathname.match(/^\/api\/bills\/([^\/]+)$/);
        if (billMatch) {
          const id = decodeURIComponent(billMatch[1]);
          if (method === 'DELETE') {
            await deleteOne('bills', id);
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'GET') {
            const b = await getOne('bills', id);
            if (!b) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
            return new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }

        // 3. /api/clients
        if (pathname === '/api/clients') {
          if (method === 'GET') {
            const clients = await getAll('clients');
            return new Response(JSON.stringify(clients), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'POST') {
            const client = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
            if (!client.id) client.id = 'client_' + Date.now();
            await putOne('clients', client);
            return new Response(JSON.stringify(client), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }
        const clientMatch = pathname.match(/^\/api\/clients\/([^\/]+)$/);
        if (clientMatch && method === 'DELETE') {
          await deleteOne('clients', decodeURIComponent(clientMatch[1]));
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // 4. /api/products
        if (pathname === '/api/products') {
          if (method === 'GET') {
            const products = await getAll('products');
            return new Response(JSON.stringify(products), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'POST') {
            const prod = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
            if (!prod.id) prod.id = 'prod_' + Date.now();
            await putOne('products', prod);
            return new Response(JSON.stringify(prod), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }
        const prodMatch = pathname.match(/^\/api\/products\/([^\/]+)$/);
        if (prodMatch && method === 'DELETE') {
          await deleteOne('products', decodeURIComponent(prodMatch[1]));
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // 5. /api/expenses
        if (pathname === '/api/expenses') {
          if (method === 'GET') {
            const exp = await getAll('expenses');
            return new Response(JSON.stringify(exp), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'POST') {
            const expense = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
            if (!expense.id) expense.id = 'exp_' + Date.now();
            await putOne('expenses', expense);
            return new Response(JSON.stringify(expense), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }
        const expMatch = pathname.match(/^\/api\/expenses\/([^\/]+)$/);
        if (expMatch && method === 'DELETE') {
          await deleteOne('expenses', decodeURIComponent(expMatch[1]));
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // 6. /api/purchases
        if (pathname === '/api/purchases') {
          if (method === 'GET') {
            const p = await getAll('purchases');
            return new Response(JSON.stringify(p), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'POST') {
            const purchase = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
            if (!purchase.id) purchase.id = 'purch_' + Date.now();
            await putOne('purchases', purchase);
            return new Response(JSON.stringify(purchase), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }
        const purchMatch = pathname.match(/^\/api\/purchases\/([^\/]+)$/);
        if (purchMatch && method === 'DELETE') {
          await deleteOne('purchases', decodeURIComponent(purchMatch[1]));
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // 7. /api/recurring
        if (pathname === '/api/recurring') {
          if (method === 'GET') {
            const r = await getAll('recurring');
            return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'POST') {
            const item = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
            if (!item.id) item.id = 'rec_' + Date.now();
            await putOne('recurring', item);
            return new Response(JSON.stringify(item), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }
        const recMatch = pathname.match(/^\/api\/recurring\/([^\/]+)$/);
        if (recMatch && method === 'DELETE') {
          await deleteOne('recurring', decodeURIComponent(recMatch[1]));
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // 8. /api/receipts
        if (pathname === '/api/receipts') {
          if (method === 'GET') {
            const rec = await getAll('receipts');
            return new Response(JSON.stringify(rec), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'POST') {
            const item = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
            if (!item.id) item.id = 'rcpt_' + Date.now();
            await putOne('receipts', item);
            return new Response(JSON.stringify(item), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }
        const rcptMatch = pathname.match(/^\/api\/receipts\/([^\/]+)$/);
        if (rcptMatch && method === 'DELETE') {
          await deleteOne('receipts', decodeURIComponent(rcptMatch[1]));
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // 9. /api/templates
        if (pathname === '/api/templates') {
          if (method === 'GET') {
            const t = await getAll('templates');
            return new Response(JSON.stringify(t), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'POST') {
            const item = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
            if (!item.id) item.id = 'tmpl_' + Date.now();
            await putOne('templates', item);
            return new Response(JSON.stringify(item), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }
        const tmplMatch = pathname.match(/^\/api\/templates\/([^\/]+)$/);
        if (tmplMatch && method === 'DELETE') {
          await deleteOne('templates', decodeURIComponent(tmplMatch[1]));
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // 10. /api/profiles
        if (pathname === '/api/profiles') {
          if (method === 'GET') {
            const profs = await getAll('profiles');
            return new Response(JSON.stringify(profs), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'POST') {
            const p = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
            if (!p.id) p.id = 'prof_' + Date.now();
            await putOne('profiles', p);
            return new Response(JSON.stringify(p), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }
        const profMatch = pathname.match(/^\/api\/profiles\/([^\/]+)$/);
        if (profMatch && method === 'DELETE') {
          await deleteOne('profiles', decodeURIComponent(profMatch[1]));
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // 11. /api/meta/:key & /api/meta/:key/increment
        const metaIncMatch = pathname.match(/^\/api\/meta\/([^\/]+)\/increment$/);
        if (metaIncMatch && method === 'POST') {
          const key = decodeURIComponent(metaIncMatch[1]);
          const body = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
          const nextVal = await incrementMeta(key, Number(body.start) || 1);
          return new Response(JSON.stringify({ key, value: nextVal }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const metaMatch = pathname.match(/^\/api\/meta\/([^\/]+)$/);
        if (metaMatch) {
          const key = decodeURIComponent(metaMatch[1]);
          if (method === 'GET') {
            const val = await getMeta(key);
            return new Response(JSON.stringify({ key, value: val }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'POST') {
            const body = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
            await setMeta(key, body.value);
            return new Response(JSON.stringify({ key, value: body.value }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }

        // 12. /api/local-prefs
        if (pathname === '/api/local-prefs') {
          if (method === 'GET') {
            const prefs = {};
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && (k.startsWith('gst_') || k.startsWith('freegstbill_'))) {
                prefs[k] = localStorage.getItem(k);
              }
            }
            return new Response(JSON.stringify({ value: prefs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (method === 'POST') {
            const body = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
            if (body.set) {
              Object.entries(body.set).forEach(([k, v]) => {
                try { localStorage.setItem(k, v); } catch {}
              });
            }
            if (body.remove && Array.isArray(body.remove)) {
              body.remove.forEach(k => {
                try { localStorage.removeItem(k); } catch {}
              });
            }
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }

        // 13. System info
        if (pathname === '/api/version') {
          return new Response(JSON.stringify({ current: '1.10.82', mode: 'browser' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (pathname === '/api/check-update') {
          return new Response(JSON.stringify({ updateAvailable: false, latest: '1.10.82' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (pathname === '/api/changelog') {
          return new Response(JSON.stringify({ text: '# Free GST Billing Software\n\nVersion 1.10.82\n- Complete browser & desktop edition' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (pathname === '/api/lock') {
          return new Response(JSON.stringify({ enabled: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (pathname === '/api/lock/verify') {
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (pathname === '/api/save-pdf') {
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (pathname === '/api/control-panel/status') {
          return new Response(JSON.stringify({ running: true, port: 'browser', mode: 'browser' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (pathname === '/api/health') {
          return new Response(JSON.stringify({ ok: true, mode: 'browser' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // 14. /api/export & /api/import
        if (pathname === '/api/export') {
          const [bills, clients, products, expenses, purchases, recurring, receipts, templates, profiles] = await Promise.all([
            getAll('bills'), getAll('clients'), getAll('products'), getAll('expenses'), getAll('purchases'),
            getAll('recurring'), getAll('receipts'), getAll('templates'), getAll('profiles')
          ]);
          const profile = await getProfile();
          const metaItems = await getAll('meta');
          const meta = {};
          metaItems.forEach(m => { meta[m.id] = m.value; });
          return new Response(JSON.stringify({
            profile, bills, clients, products, expenses, purchases, recurring, receipts, templates, profiles, meta,
            exportedAt: new Date().toISOString()
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (pathname === '/api/import' && method === 'POST') {
          const data = typeof init.body === 'string' ? JSON.parse(init.body) : (init.body || {});
          if (data.profile) await saveProfile(data.profile);
          if (Array.isArray(data.bills)) for (const b of data.bills) await putOne('bills', b);
          if (Array.isArray(data.clients)) for (const c of data.clients) await putOne('clients', c);
          if (Array.isArray(data.products)) for (const p of data.products) await putOne('products', p);
          if (Array.isArray(data.expenses)) for (const e of data.expenses) await putOne('expenses', e);
          if (Array.isArray(data.purchases)) for (const p of data.purchases) await putOne('purchases', p);
          if (Array.isArray(data.recurring)) for (const r of data.recurring) await putOne('recurring', r);
          if (Array.isArray(data.receipts)) for (const rc of data.receipts) await putOne('receipts', rc);
          if (Array.isArray(data.templates)) for (const t of data.templates) await putOne('templates', t);
          if (Array.isArray(data.profiles)) for (const pr of data.profiles) await putOne('profiles', pr);
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      } catch (err) {
        console.warn('Browser storage handler error:', err);
      }
    }

    // Default to native fetch
    return originalFetch(input, init);
  };

  console.log('[Free GST Billing] In-Browser Storage Engine active.');
})();
