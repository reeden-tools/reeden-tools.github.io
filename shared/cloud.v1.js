/* reeden-tools 共用雲端模組 v1：給 GitHub Pages 上的各工具呼叫 reeden-api。
   雲端只是選用：連不上時各工具照常使用本機儲存。
   window.ReedenCloud = { create, get, update, remove, putFile, getFile, deleteFile, parseHash, links, message, collection } */
(function () {
  'use strict';
  if (window.ReedenCloud) return;
  const BASE = 'https://reeden-api.reeden-tools.workers.dev/api/';
  const TIMEOUT = 8000;

  const MESSAGES = {
    network: '暫時連不上雲端，作品仍保存在這台裝置。',
    timeout: '雲端回應太慢，請稍後再試；作品仍保存在這台裝置。',
    not_found: '找不到這個雲端作品，可能已被刪除。',
    bad_key: '編輯密鑰不對，只能查看、不能修改。',
    data_too_large: '作品資料太大，無法存到雲端。',
    file_too_large: '檔案太大，無法存到雲端。',
    work_too_large: '這個作品的檔案總量太大，無法存到雲端。',
    too_many_files: '這個作品的檔案太多，無法存到雲端。',
    unsupported_type: '這個檔案格式不能存到雲端。',
    storage_full: '雲端空間已滿，暫時不能上傳檔案。',
    monthly_quota_reached: '本月雲端上傳次數已用完，下個月會恢復。',
    handle_taken: '這個代號已經有人用了，換一個試試。',
    bad_handle: '代號要 2 到 20 個字，只能用文字、數字、底線或減號。',
    weak_password: '密碼至少要 6 個字。',
    bad_password: '密碼不對。',
    too_many_attempts: '密碼錯太多次，請 15 分鐘後再試。',
    already_named: '這個作品集已經有代號了。',
  };
  function message(err) {
    const code = err && err.code;
    return MESSAGES[code] || '雲端發生問題（' + (code || '未知') + '），作品仍保存在這台裝置。';
  }
  function fail(code, status) { const e = new Error(code); e.code = code; e.status = status || 0; throw e; }

  async function request(method, path, opts) {
    opts = opts || {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT);
    const headers = {};
    if (opts.key) headers['X-Edit-Key'] = opts.key;
    let body = opts.body;
    if (body !== undefined && !(body instanceof Blob) && typeof body !== 'string') {
      body = JSON.stringify(body); headers['Content-Type'] = 'application/json';
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/octet-stream';
    }
    if (opts.filename) headers['X-File-Name'] = encodeURIComponent(opts.filename);
    let res;
    try {
      res = await fetch(BASE + path, { method, headers, body, signal: ctrl.signal, cache: 'no-store' });
    } catch (e) {
      fail(e && e.name === 'AbortError' ? 'timeout' : 'network');
    } finally { clearTimeout(timer); }
    if (opts.blob && res.ok) return res.blob();
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) fail((data && data.error) || 'http_' + res.status, res.status);
    return data;
  }

  const enc = encodeURIComponent;
  const work = (tool, id) => enc(tool) + '/works/' + enc(id);

  /* 作品集：同一個人的作品清單（id 和編輯密鑰）也存在雲端，換裝置時打開一個連結就能搬過去。
     兩個工具同網域，共用這台裝置記住的作品集 {id, key}；清單項目 {tool, id, key, name, page?, at}。 */
  const CKEY = 'reeden-collection';
  const cGet = () => { try { const c = JSON.parse(localStorage.getItem(CKEY) || 'null'); return c && c.id && c.key ? c : null; } catch (e) { return null; } };
  const cSet = c => { try { c ? localStorage.setItem(CKEY, JSON.stringify(c)) : localStorage.removeItem(CKEY); } catch (e) {} };
  const same = (a, b) => a.key === b.key && a.tool === b.tool && (a.name || '') === (b.name || '') && (a.page || '') === (b.page || '') && (!b.look || JSON.stringify(a.look) === JSON.stringify(b.look));
  let chain = Promise.resolve();
  // 把這個工具在本機的作品併進雲端作品集，回傳合併後的全部項目（.removed 是被拿掉的 id，各裝置照著刪）
  // opt.remove：要從作品集拿掉的 id；opt.keep：剛存過或打開過、即使以前被拿掉也要放回來的 id
  function sync(tool, local, opt) {
    opt = opt || {};
    const run = async () => {
      let c = cGet(), data = {};
      if (c) {
        try { data = (await request('GET', work('collection', c.id), { key: c.key })).data || {}; }
        catch (e) { if (e.code === 'not_found') { c = null; cSet(null); } else throw e; }
      }
      const items = data.items || [];
      const keep = new Set(opt.keep || []);
      const gone = new Set((data.removed || []).filter(id => !keep.has(id)));
      (opt.remove || []).forEach(id => gone.add(id));
      const map = new Map(items.filter(x => x && x.id && !gone.has(x.id)).map(x => [x.id, x]));
      let changed = map.size !== items.length || gone.size !== (data.removed || []).length;
      for (const it of local || []) {
        if (!it || !it.id || !it.key || gone.has(it.id)) continue;
        const n = { tool, id: it.id, key: it.key, name: it.name || '', at: it.at || Date.now() };
        if (it.page) n.page = it.page;
        if (it.look) n.look = it.look; // 畫縮圖需要的小資料（例如 SVG 的框位置和底色）
        const o = map.get(it.id);
        if (!o || !same(o, n)) { map.set(it.id, o ? Object.assign({}, o, n, { at: o.at || n.at }) : n); changed = true; }
      }
      const all = [...map.values()], removed = [...gone].slice(-500);
      all.removed = removed;
      if (!c) {
        if (!all.length) return all;
        const r = await request('POST', 'collection/works', { body: { data: { v: 1, items: all, removed }, schema_version: 'collection-1' } });
        cSet({ id: r.id, key: r.key });
      } else if (changed) await request('PUT', work('collection', c.id), { key: c.key, body: { data: { v: 1, items: all, removed } } });
      return all;
    };
    const p = chain.then(run, run); chain = p.catch(() => {}); return p;
  }
  const collection = {
    get: cGet,
    sync,
    // '#c=<id>.<key>' → {id, key}
    parse(hash) {
      const m = /^#c=([A-Za-z0-9]{16})\.([A-Za-z0-9_-]{20,128})$/.exec(hash == null ? location.hash : hash);
      return m ? { id: m[1], key: m[2] } : null;
    },
    link(c) { c = c || cGet(); return c ? location.origin + location.pathname + '#c=' + c.id + '.' + c.key : null; },
    // 換到連結裡的作品集：先確認讀得到，原本這台記住的作品會在下次同步時併進去
    async adopt(link) {
      const w = await request('GET', work('collection', link.id), { key: link.key });
      cSet({ id: link.id, key: link.key });
      return ((w.data || {}).items) || [];
    },
  };

  /* 代號：作品集的公開名字。輸入代號誰都能看（沒有編輯密鑰，只能套用成自己的一份）；
     在新裝置輸入代號和密碼，才會拿回作品集的密鑰。這台裝置的代號記在 reeden-handle。 */
  const HKEY = 'reeden-handle';
  const hGet = () => { try { return localStorage.getItem(HKEY) || null; } catch (e) { return null; } };
  const hSet = h => { try { h ? localStorage.setItem(HKEY, h) : localStorage.removeItem(HKEY); } catch (e) {} };
  const handles = {
    mine: hGet,
    // 幫這台的作品集取代號（作品集還沒建立時先建一個空的）
    async claim(handle, password) {
      let c = cGet();
      if (!c) { await sync('', []); c = cGet(); }
      if (!c) { const r = await request('POST', 'collection/works', { body: { data: { v: 1, items: [], removed: [] }, schema_version: 'collection-1' } }); c = { id: r.id, key: r.key }; cSet(c); }
      const r = await request('POST', 'handles', { key: c.key, body: { handle, password, collection_id: c.id } });
      hSet(r.handle); return r.handle;
    },
    view: handle => request('GET', 'handles/' + enc(handle)),
    // 在新裝置用代號和密碼拿回作品集；這台原本的作品會在下次同步時併進去
    async login(handle, password) {
      const r = await request('POST', 'handles/' + enc(handle) + '/login', { body: { password } });
      cSet({ id: r.collection_id, key: r.collection_key }); hSet(r.handle); return r.handle;
    },
    setPassword(password) { const c = cGet(), h = hGet(); return request('PUT', 'handles/' + enc(h), { key: c && c.key, body: { password } }); },
    forget() { hSet(null); },
    // '#u=<代號>'
    parse(hash) { const m = /^#u=(.{1,80})$/.exec(hash == null ? location.hash : hash); if (!m) return null; try { return decodeURIComponent(m[1]); } catch (e) { return null; } },
    link: h => location.origin + location.pathname + '#u=' + enc(h || hGet() || ''),
  };

  window.ReedenCloud = {
    message,
    collection,
    handles,
    // {data, title?, author_name?, schema_version?} → {id, key}
    create: (tool, body) => request('POST', enc(tool) + '/works', { body }),
    get: (tool, id, key) => request('GET', work(tool, id), { key }),
    update: (tool, id, key, body) => request('PUT', work(tool, id), { key, body }),
    remove: (tool, id, key) => request('DELETE', work(tool, id), { key }),
    // data: Blob or string; long uploads get more time
    putFile: (tool, id, key, slot, data, filename) =>
      request('PUT', work(tool, id) + '/files/' + enc(slot), { key, body: data, filename, timeout: 60000 }),
    getFile: (tool, id, slot, key) =>
      request('GET', work(tool, id) + '/files/' + enc(slot), { key, blob: true, timeout: 60000 }),
    // public address of a file, for <img src> (fonts and hidden works still need the key)
    fileUrl: (tool, id, slot) => BASE + work(tool, id) + '/files/' + enc(slot),
    deleteFile: (tool, id, key, slot) => request('DELETE', work(tool, id) + '/files/' + enc(slot), { key }),
    // '#w=<id>' or '#w=<id>.<key>' → {id, key|null}
    parseHash(hash) {
      const m = /^#w=([A-Za-z0-9]{16})(?:\.([A-Za-z0-9_-]{20,128}))?$/.exec(hash == null ? location.hash : hash);
      return m ? { id: m[1], key: m[2] || null } : null;
    },
    links(id, key) {
      const base = location.origin + location.pathname;
      return { share: base + '#w=' + id, edit: key ? base + '#w=' + id + '.' + key : null };
    },
  };
})();
