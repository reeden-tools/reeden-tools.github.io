/* reeden-tools 共用雲端模組 v1：給 GitHub Pages 上的各工具呼叫 reeden-api。
   雲端只是選用：連不上時各工具照常使用本機儲存。
   window.ReedenCloud = { create, get, update, remove, putFile, getFile, deleteFile, parseHash, links, message } */
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

  window.ReedenCloud = {
    message,
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
