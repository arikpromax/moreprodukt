/* Fish Family — спільна логіка всіх сторінок. Товари, доставка, оплата й налаштування — у data.js */
(() => {
  'use strict';

  const CFG = typeof SHOP !== 'undefined' ? SHOP : {};
  const DLV = typeof DELIVERY !== 'undefined' ? DELIVERY : [];
  const PAY = typeof PAYMENTS !== 'undefined' ? PAYMENTS : { courier: [], np: [] };
  const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fmt = n => Math.round(n).toLocaleString('uk-UA');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const icon = name => `<svg class="i"><use href="#i-${name}"/></svg>`;
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватний режим */ } }
  };

  const byId = id => PRODUCTS.find(p => p.id === id);
  const catName = id => (CATS.find(c => c.id === id) || {}).name || '';
  const inCat = c => (c === 'all' ? PRODUCTS : PRODUCTS.filter(p => p.cat === c));
  const plural = (n, one, few, many) => {
    const a = n % 10, b = n % 100;
    return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
  };
  const goods = n => plural(n, 'товар', 'товари', 'товарів');

  /* ---------- варіанти товару (вага, фасування) ---------- */
  const variantsOf = p => p.variants || [];
  const variantOf = (p, vid) => variantsOf(p).find(v => v.id === vid) || variantsOf(p)[0];
  const minPrice = p => Math.min(...variantsOf(p).map(v => v.price));
  const keyOf = (p, v) => `${p.id}:${v.id}`;
  // ключ кошика «товар:варіант» → { p, v }
  const parseKey = key => {
    const [pid, vid] = String(key).split(':');
    const p = byId(pid);
    if (!p) return null;
    const v = vid ? variantsOf(p).find(x => x.id === vid) : variantsOf(p)[0];
    return v ? { p, v } : null;
  };

  /* ---------- найближча пʼятниця ---------- */
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const toFriday = (5 - today.getDay() + 7) % 7;
  const friday = new Date(today);
  friday.setDate(today.getDate() + toFriday);
  const dayMonth = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  $$('[data-friday]').forEach(el => { el.textContent = toFriday === 0 ? `сьогодні, ${dayMonth(friday)}` : `пʼятниця, ${dayMonth(friday)}`; });
  $$('[data-friday-date]').forEach(el => { el.textContent = dayMonth(friday); });
  $$('[data-price-of]').forEach(el => { const p = byId(el.dataset.priceOf); if (p) el.textContent = fmt(minPrice(p)); });

  /* ---------- бігучий рядок: дублюємо для безшовної прокрутки ---------- */
  const tickGroup = $('.ticker__group');
  if (tickGroup) {
    const copy = tickGroup.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    tickGroup.parentNode.appendChild(copy);
  }

  /* ---------- Telegram «ми онлайн» ---------- */
  const tgFloat = $('#tgFloat');
  if (tgFloat && CFG.telegram) tgFloat.href = CFG.telegram;

  /* ---------- кошик ---------- */
  let cart = store.get('ff-cart', {});
  if (!cart || typeof cart !== 'object' || Array.isArray(cart)) cart = {};
  // старі ключі без варіанта переводимо на перший варіант, неіснуючі прибираємо
  Object.keys(cart).forEach(key => {
    const q = cart[key];
    const it = parseKey(key);
    delete cart[key];
    if (it && q > 0) {
      const k = keyOf(it.p, it.v);
      cart[k] = (cart[k] || 0) + q;
    }
  });
  let zone = store.get('ff-zone', 'dnipro');
  if (!ZONES[zone]) zone = 'dnipro';

  const subtotal = () => Object.keys(cart).reduce((s, key) => {
    const it = parseKey(key);
    return s + (it ? it.v.price * cart[key] : 0);
  }, 0);
  const feeFor = sub => (sub >= ZONES[zone].free ? 0 : ZONES[zone].fee);
  const hooks = [];

  function setQty(key, q) {
    if (q <= 0) delete cart[key];
    else cart[key] = Math.min(q, 50);
    store.set('ff-cart', cart);
    refresh();
  }

  function refresh() {
    const n = Object.keys(cart).length;
    $$('[data-cart-count]').forEach(el => { el.textContent = n; el.hidden = n === 0; });
    renderFoots();
    hooks.forEach(fn => fn());
  }

  function bump() {
    $$('[data-cart-count]').forEach(el => {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    });
  }

  function setZone(z) {
    if (!ZONES[z]) return;
    zone = z;
    store.set('ff-zone', z);
    $$('[data-zone-pick]').forEach(b => {
      const on = b.dataset.zonePick === z;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $$('[data-zone]').forEach(el => { el.hidden = el.dataset.zone !== z; });
    hooks.forEach(fn => fn());
  }

  /* ---------- підказка знизу ---------- */
  const toastEl = document.createElement('a');
  toastEl.className = 'toast';
  toastEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastEl);
  let toastTimer = 0;
  function toast(msg, withCart) {
    toastEl.innerHTML = withCart ? `<span>${msg}</span><u>Кошик</u>` : `<span>${msg}</span>`;
    if (withCart) toastEl.href = 'koshyk.html';
    else toastEl.removeAttribute('href');
    toastEl.classList.toggle('is-link', !!withCart);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  /* ---------- мобільне меню ---------- */
  const nav = $('#nav');
  const menuBtn = $('#menuBtn');
  function openMenu(on) {
    if (!nav) return;
    nav.classList.toggle('open', on);
    nav.setAttribute('aria-hidden', String(!on));
    if (menuBtn) menuBtn.setAttribute('aria-expanded', String(on));
    document.documentElement.classList.toggle('lock', on);
  }

  /* ---------- картки товарів ---------- */
  const stepHtml = (key, q) =>
    `<div class="step step--sm">
      <button type="button" data-act="dec" data-id="${key}" aria-label="Менше">${icon('minus')}</button>
      <output>${q} шт</output>
      <button type="button" data-act="inc" data-id="${key}" aria-label="Більше">${icon('plus')}</button>
    </div>`;
  const phClass = p => (p.cat === 'ryba' ? 'ph' : 'ph ph--sea');
  const shot = (p, i) => (p.photos && p.photos[i]
    ? `<img src="${p.photos[i]}" alt="${p.name}"${i ? ' loading="lazy"' : ''}>`
    : '');
  const priceHtml = p => (variantsOf(p).length > 1
    ? `<small>від</small> ${fmt(minPrice(p))} <small>грн</small>`
    : `${fmt(variantsOf(p)[0].price)} <small>грн · ${variantsOf(p)[0].label}</small>`);

  function card(p) {
    return `<article class="card">
      <a class="card__link" href="tovar.html?id=${p.id}">
        <figure class="${phClass(p)}">${p.tag ? `<em class="card__tag">${p.tag}</em>` : ''}${shot(p, 0)}</figure>
        <h3>${p.name}</h3>
      </a>
      <p>${p.short}</p>
      <div class="card__price">${priceHtml(p)}</div>
      <div class="card__foot" data-foot="${p.id}"></div>
    </article>`;
  }

  function renderFoots() {
    $$('[data-foot]').forEach(foot => {
      const p = byId(foot.dataset.foot);
      if (!p) return;
      // кілька варіантів — вибір ваги на сторінці товару
      if (variantsOf(p).length > 1) {
        foot.innerHTML = `<a class="add" href="tovar.html?id=${p.id}">Вибрати ${icon('arrow')}</a>`;
        return;
      }
      const key = keyOf(p, variantsOf(p)[0]);
      const q = cart[key] || 0;
      foot.innerHTML = q
        ? stepHtml(key, q)
        : `<button type="button" class="add" data-act="inc" data-id="${key}">${icon('cart')}У кошик</button>`;
    });
  }

  /* ---------- головна ---------- */
  function initHome() {
    const grid = $('#homeGrid');
    if (grid) grid.innerHTML = PRODUCTS.map(card).join('');
    $$('[data-cat-count]').forEach(el => { el.textContent = goods(inCat(el.dataset.catCount).length); });

    const days = $('#days');
    if (!days) return;
    const names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
    const mon = new Date(friday);
    mon.setDate(friday.getDate() - 4);
    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      const isToday = d.getTime() === today.getTime();
      const past = d < today;
      const cls = ['day', i === 4 && 'is-fri', isToday && 'is-today', past && 'is-past'].filter(Boolean).join(' ');
      const note = i === 4 ? 'свіжа поставка' : isToday ? 'сьогодні' : past || i > 4 ? '' : 'замовлення';
      html += `<li class="${cls}"><b>${names[i]}</b><span>${d.getDate()}</span><em>${note}</em></li>`;
    }
    days.innerHTML = html;
    $('#daysLegend').textContent = toFriday === 0
      ? `Сьогодні свіжа поставка — ${dayMonth(friday)}`
      : `До поставки ${plural(toFriday, 'день', 'дні', 'днів')} — пʼятниця, ${dayMonth(friday)}`;
  }

  /* ---------- каталог ---------- */
  function initCatalog() {
    let cat = new URLSearchParams(location.search).get('cat');
    if (!CATS.some(c => c.id === cat)) cat = 'all';
    const chips = $('#chips');
    const grid = $('#catGrid');
    chips.innerHTML = CATS.map(c =>
      `<button type="button" class="chip" data-cat="${c.id}">${c.name} <small>${inCat(c.id).length}</small></button>`).join('');

    const show = c => {
      const list = inCat(c);
      const title = c === 'all' ? 'Каталог' : catName(c);
      const href = c === 'all' ? 'katalog.html' : `katalog.html?cat=${c}`;
      grid.innerHTML = list.map(card).join('');
      renderFoots();
      $$('.chip', chips).forEach(b => b.classList.toggle('on', b.dataset.cat === c));
      $('#catTitle').textContent = title;
      $('#catCount').textContent = goods(list.length);
      $('#crumbs').innerHTML = c === 'all'
        ? '<a href="index.html">Головна</a> › <span>Каталог</span>'
        : `<a href="index.html">Головна</a> › <a href="katalog.html">Каталог</a> › <span>${title}</span>`;
      $$('.hdr__nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === href));
      document.title = `${title} — Fish Family, Дніпро`;
      try { history.replaceState(null, '', href); } catch (e) { /* file:// */ }
    };
    chips.addEventListener('click', e => {
      const b = e.target.closest('[data-cat]');
      if (b) show(b.dataset.cat);
    });
    show(cat);
  }

  /* ---------- сторінка товару ---------- */
  let current = null;
  let currentVar = null;
  let buyQty = 1;

  function renderBuy() {
    const v = currentVar;
    if (!current || !v) return;
    $$('[data-buy-qty]').forEach(el => { el.textContent = buyQty; });
    $$('[data-buy-est]').forEach(el => { el.textContent = `${fmt(v.price * buyQty)} грн`; });
    $$('[data-buy-sub]').forEach(el => { el.textContent = `${buyQty} шт × ${fmt(v.price)} грн`; });
  }

  function selectVariant(vid) {
    const p = current;
    if (!p) return;
    const v = variantOf(p, vid);
    currentVar = v;
    const many = variantsOf(p).length > 1;
    $('#pPrice').textContent = fmt(v.price);
    $('#pPer').textContent = many ? 'грн' : `грн · ${v.label}`;
    $$('#pVariants [data-vid]').forEach(b => {
      const on = b.dataset.vid === v.id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    $('#barName').innerHTML = `${esc(p.name)}<small>${esc(v.label)} · <span data-buy-est></span></small>`;
    renderBuy();
  }

  function initProduct() {
    const p = byId(new URLSearchParams(location.search).get('id') || 'losos');
    if (!p) { location.replace('katalog.html'); return; }
    current = p;

    document.title = `${p.title} — Fish Family, Дніпро`;
    const md = $('meta[name="description"]');
    if (md) md.setAttribute('content', `${p.title}: ${p.short}. Доставка по Дніпру й Новою Поштою по Україні.`);
    $('#crumbs').innerHTML = `<a href="index.html">Головна</a> › <a href="katalog.html">Каталог</a> › <a href="katalog.html?cat=${p.cat}">${catName(p.cat)}</a> › <span>${p.name}</span>`;
    $$('.hdr__nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === `katalog.html?cat=${p.cat}`));

    $('#pTitle').textContent = p.title;
    $('#pWeekly').hidden = !p.weekly;
    const badge = $('#pBadge');
    badge.textContent = p.badge || '';
    badge.hidden = !p.badge;
    $('#pLead').textContent = p.lead;
    $('#pSpecs').innerHTML = p.specs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('#pQtyLabel').textContent = 'Кількість';
    const note = $('#pNote');
    note.textContent = p.note || '';
    note.hidden = !p.note;
    const perks = $('#pPerks');
    perks.innerHTML = (p.perks || []).map(([ic, t]) => `<div class="perk">${icon(ic)}${t}</div>`).join('');
    perks.hidden = !p.perks;
    $$('[data-extra]').forEach(el => { el.hidden = el.dataset.extra !== p.id; });
    const sim = $('#similar');
    if (sim) sim.innerHTML = PRODUCTS.filter(x => x.id !== p.id).map(card).join('');

    // кнопки ваги / фасування
    const box = $('#pVariantsBox');
    if (box) {
      const many = variantsOf(p).length > 1;
      box.hidden = !many;
      if (many) {
        $('#pVarLabel').textContent = p.variantLabel || 'Вага';
        $('#pVariants').innerHTML = variantsOf(p).map(v =>
          `<button type="button" class="pill" data-act="variant" data-vid="${v.id}" role="radio" aria-checked="false">${esc(v.label)}</button>`).join('');
      }
    }
    selectVariant(variantsOf(p)[0].id);

    // галерея
    const count = Math.max(1, (p.photos || []).length, (p.shots || []).length);
    const track = $('#galTrack');
    const thumbs = $('#galThumbs');
    const dots = $('#galDots');
    track.innerHTML = Array.from({ length: count }, (_, i) => `<figure class="${phClass(p)}">${shot(p, i)}</figure>`).join('');
    if (count > 1) {
      const go = i => track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
      $$('figure', track).forEach((slide, i) => {
        const t = document.createElement('button');
        t.type = 'button';
        t.setAttribute('aria-label', `Фото ${i + 1}`);
        t.appendChild(slide.cloneNode(true));
        t.addEventListener('click', () => go(i));
        thumbs.appendChild(t);
        const d = document.createElement('button');
        d.type = 'button';
        d.setAttribute('aria-label', `Фото ${i + 1}`);
        d.addEventListener('click', () => go(i));
        dots.appendChild(d);
      });
      let raf = 0;
      const mark = () => {
        raf = 0;
        const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        [...thumbs.children].forEach((b, k) => b.classList.toggle('on', k === i));
        [...dots.children].forEach((b, k) => b.classList.toggle('on', k === i));
      };
      track.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(mark); }, { passive: true });
      mark();
    } else {
      thumbs.hidden = true;
      dots.hidden = true;
    }

    // липка панель, коли кнопка покупки пішла за екран
    const bar = $('#bar');
    const buyBtns = $('#buyBtns');
    if (bar && buyBtns && 'IntersectionObserver' in window) {
      new IntersectionObserver(([en]) => {
        const show = !en.isIntersecting && en.boundingClientRect.top < 0;
        bar.classList.toggle('show', show);
        document.body.classList.toggle('bar-on', show);
      }).observe(buyBtns);
    }
  }

  /* ---------- Нова Пошта: місто, відділення, поштомат ---------- */
  const NP_URL = 'https://api.novaposhta.ua/v2.0/json/';
  const NP_DNIPRO = 'db5c88f0-391c-11dd-90d9-001a92567626';
  const NP_TYPES = {
    np_branch: '841339c7-591a-42e2-8233-7a0a00f0ed6f',
    np_postomat: 'f9316480-5f2d-425d-bc2c-ac7cd29decf0'
  };
  let npDown = false;

  function npCall(modelName, calledMethod, methodProperties) {
    return fetch(NP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: CFG.npApiKey || '', modelName, calledMethod, methodProperties })
    })
      .then(r => r.json())
      .catch(err => { npDown = true; throw err; })
      .then(j => {
        npDown = false;
        if (!j.success) throw new Error((j.errors || []).join(', ') || 'np');
        return j.data || [];
      });
  }

  // випадний список підказок під полем
  function autocomplete(input, list, opts) {
    let timer = 0;
    let reqId = 0;
    let items = [];
    let active = -1;

    const close = () => {
      list.hidden = true;
      active = -1;
      input.setAttribute('aria-expanded', 'false');
    };
    const show = (rows, msg) => {
      items = rows;
      active = -1;
      list.innerHTML = msg
        ? `<li class="ac__msg">${esc(msg)}</li>`
        : rows.map((r, i) => `<li class="ac__item" role="option" data-i="${i}"><b>${esc(r.title)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</li>`).join('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    const run = () => {
      const q = opts.query ? opts.query(input.value) : input.value.trim();
      if (q.length < opts.minChars) { close(); return; }
      const my = ++reqId;
      show([], 'Шукаємо…');
      opts.load(q)
        .then(rows => { if (my === reqId) (rows.length ? show(rows) : show([], 'Нічого не знайдено')); })
        .catch(err => {
          if (my !== reqId) return;
          show([], (err && err.msg) || 'Не вдалося завантажити список — впишіть вручну');
          if (opts.onError) opts.onError();
        });
    };
    const choose = i => {
      const r = items[i];
      if (!r) return;
      input.value = r.value;
      close();
      opts.pick(r);
    };

    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 280); });
    input.addEventListener('focus', () => { if (opts.minChars === 0) run(); });
    input.addEventListener('blur', () => setTimeout(close, 180));
    input.addEventListener('keydown', e => {
      if (list.hidden) return;
      const opt = $$('.ac__item', list);
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && opt.length) {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + opt.length) % opt.length;
        opt.forEach((o, k) => o.classList.toggle('on', k === active));
        opt[active].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        choose(active);
      } else if (e.key === 'Escape') {
        close();
      }
    });
    list.addEventListener('mousedown', e => e.preventDefault());
    list.addEventListener('click', e => {
      const li = e.target.closest('.ac__item');
      if (li) choose(Number(li.dataset.i));
    });
  }

  function clearBranchSel() {
    form.npBranchRef = '';
    form.npBranchName = '';
    form.fBranch = '';
    const b = $('#fBranch');
    if (b) b.value = '';
  }

  function syncBranchInput() {
    const b = $('#fBranch');
    if (!b) return;
    b.disabled = !form.npCityRef && !npDown;
    b.placeholder = b.disabled
      ? 'Спершу оберіть місто'
      : form.dlv === 'np_postomat' ? 'Номер або адреса поштомата' : 'Номер або адреса відділення';
  }

  function initNovaPoshta() {
    const city = $('#fCity');
    const branch = $('#fBranch');
    if (!city || !branch) return;

    city.addEventListener('input', () => {
      if (city.value.trim() === form.npCityName) return;
      form.npCityRef = '';
      form.npCityName = '';
      clearBranchSel();
      saveForm();
      syncBranchInput();
      renderCart();
    });
    branch.addEventListener('input', () => {
      if (branch.value.trim() === form.npBranchName) return;
      form.npBranchRef = '';
      form.npBranchName = '';
      saveForm();
    });

    autocomplete(city, $('#fCityList'), {
      minChars: 2,
      load: q => npCall('Address', 'searchSettlements', { CityName: q, Limit: '20', Page: '1' })
        .then(d => ((d[0] && d[0].Addresses) || [])
          .filter(a => Number(a.Warehouses) > 0)
          .map(a => ({ title: a.MainDescription, sub: a.Present, value: a.Present, ref: a.DeliveryCity }))),
      pick: r => {
        form.npCityRef = r.ref;
        form.npCityName = r.value;
        form.fCity = r.value;
        clearBranchSel();
        saveForm();
        syncBranchInput();
        fieldMsg(city, '');
        renderCart();
        branch.focus();
      },
      onError: syncBranchInput
    });

    autocomplete(branch, $('#fBranchList'), {
      minChars: 0,
      query: v => (v.trim() === form.npBranchName ? '' : v.trim()),
      load: q => {
        if (!form.npCityRef) return Promise.reject(Object.assign(new Error('nocity'), { msg: 'Спершу оберіть місто зі списку' }));
        // у великих містах перша сотня поштоматів — у житлових будинках, тож без пошуку список марний
        if (form.dlv === 'np_postomat' && !q) return Promise.reject(Object.assign(new Error('hint'), { msg: 'Введіть номер поштомата або назву вулиці' }));
        // якщо ввели лише номер — відділення з цим номером іде першим
        const num = /^\s*№?\s*\d+\s*$/.test(q) ? q.replace(/\D/g, '') : '';
        const base = { CityRef: form.npCityRef, Limit: '100', Page: '1', Language: 'UA' };
        if (NP_TYPES[form.dlv]) base.TypeOfWarehouseRef = NP_TYPES[form.dlv];
        return Promise.all([
          npCall('AddressGeneral', 'getWarehouses', { ...base, FindByString: q }),
          num ? npCall('AddressGeneral', 'getWarehouses', { ...base, WarehouseId: num }).catch(() => []) : []
        ]).then(([found, exact]) => {
          const seen = new Set();
          // поштомати в житлових будинках — у кінець списку з позначкою
          const residents = w => /тільки для мешканців/i.test(w.Description);
          return [...exact.filter(w => String(w.Number) === num), ...found]
            .filter(w => !seen.has(w.Ref) && seen.add(w.Ref))
            .sort((a, b) => residents(a) - residents(b))
            .map(w => ({ title: w.Description, sub: residents(w) ? 'лише для мешканців будинку' : '', value: w.Description, ref: w.Ref }));
        });
      },
      pick: r => {
        form.npBranchRef = r.ref;
        form.npBranchName = r.value;
        form.fBranch = r.value;
        saveForm();
        fieldMsg(branch, '');
      },
      onError: syncBranchInput
    });
  }

  /* ---------- оформлення замовлення ---------- */
  let done = false;
  let sending = false;
  const form = store.get('ff-form', {}) || {};
  const saveForm = () => store.set('ff-form', form);
  const isNp = () => !!form.dlv && form.dlv !== 'courier';
  const isOther = () => form.recv === 'other';
  // імʼя й прізвище — лише українські літери: інакше Нова Пошта не створить накладну
  const NAME_RE = /^[А-ЩЬЮЯҐЄІЇа-щьюяґєії'’ʼ -]{2,40}$/;

  // телефон: +380 стоїть окремо, у полі — 9 цифр «67 123 45 67»
  const phoneDigits = v => {
    let d = String(v).replace(/\D/g, '');
    if (d.length > 9 && d.startsWith('380')) d = d.slice(3);
    else if (d.length > 9 && d.startsWith('80')) d = d.slice(2);
    if (d.startsWith('0')) d = d.slice(1);
    return d.slice(0, 9);
  };
  const formatPhone = d => [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');

  // текст помилки під полем
  function fieldMsg(el, msg) {
    const field = el.closest('.field');
    if (!field) return;
    let m = field.querySelector('.field__msg');
    if (!msg) {
      field.classList.remove('err');
      if (m) m.remove();
      return;
    }
    field.classList.add('err');
    if (!m) {
      m = document.createElement('small');
      m.className = 'field__msg';
      field.appendChild(m);
    }
    m.textContent = msg;
  }

  const optHtml = (name, o, checked, withPrice) =>
    `<label class="opt"><input type="radio" name="${name}" value="${o.id}"${checked ? ' checked' : ''}>` +
    `<span class="opt__txt"><b>${esc(o.title)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span>` +
    `${withPrice ? `<em class="opt__price" data-price-for="${o.id}"></em>` : ''}</label>`;

  // орієнтовна вартість доставки Новою Поштою
  let npQuote = { key: '', cost: null, loading: false };
  const cartWeight = () => Object.keys(cart).reduce((s, key) => {
    const it = parseKey(key);
    return s + (it ? (it.v.weight || 0.5) * cart[key] : 0);
  }, 1); // +1 кг на термопакування з охолоджувачами

  function refreshNpQuote() {
    if (!isNp() || !form.npCityRef || !Object.keys(cart).length) {
      npQuote = { key: '', cost: null, loading: false };
      return;
    }
    const weight = Math.ceil(cartWeight() * 2) / 2;
    const declared = Math.max(300, Math.round(subtotal()));
    const key = [form.npCityRef, form.dlv, weight, declared].join('|');
    if (npQuote.key === key) return;
    npQuote = { key, cost: null, loading: true };
    npCall('InternetDocument', 'getDocumentPrice', {
      CitySender: CFG.npSenderCityRef || NP_DNIPRO,
      CityRecipient: form.npCityRef,
      Weight: String(weight),
      ServiceType: form.dlv === 'np_postomat' ? 'WarehousePostomat' : 'WarehouseWarehouse',
      Cost: String(declared),
      CargoType: 'Parcel',
      SeatsAmount: '1'
    })
      .then(d => {
        if (npQuote.key !== key) return;
        npQuote = { key, cost: d[0] ? Number(d[0].Cost) : null, loading: false };
        renderCart();
      })
      .catch(() => {
        if (npQuote.key !== key) return;
        npQuote = { key, cost: null, loading: false };
        renderCart();
      });
  }

  const npQuoteText = () => {
    if (!form.npCityRef) return 'оберіть місто';
    if (npQuote.loading) return 'рахуємо…';
    return npQuote.cost != null ? `≈ ${fmt(npQuote.cost)} грн` : 'за тарифом НП';
  };

  function renderPayOpts() {
    const box = $('#payOpts');
    if (!box) return;
    const list = PAY[isNp() ? 'np' : 'courier'] || [];
    if (!list.some(p => p.id === form.pay)) {
      form.pay = list[0] ? list[0].id : '';
      saveForm();
    }
    box.innerHTML = list.map(p => optHtml('pay', p, p.id === form.pay, false)).join('');
  }

  // «Я отримувач» / «Отримувач інша людина»
  function syncOther() {
    const other = isOther();
    $$('[data-recv]').forEach(b => {
      const on = b.dataset.recv === (other ? 'other' : 'me');
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    const box = $('#otherFields');
    if (box) box.hidden = !other;
  }

  function setDelivery(id) {
    const d = DLV.find(x => x.id === id) || DLV[0];
    if (!d) return;
    if (form.dlv && form.dlv !== d.id && form.dlv !== 'courier' && d.id !== 'courier') clearBranchSel();
    form.dlv = d.id;
    saveForm();
    $$('input[name="dlv"]').forEach(i => { i.checked = i.value === d.id; });
    const group = d.id === 'courier' ? 'courier' : 'np';
    $$('[data-dlv]').forEach(el => { el.hidden = el.dataset.dlv !== group; });
    const lbl = $('#fBranchLbl');
    if (lbl) lbl.innerHTML = `${d.id === 'np_postomat' ? 'Поштомат' : 'Відділення'} Нової Пошти <i class="req">*</i>`;
    syncBranchInput();
    renderPayOpts();
    setZone(d.zone);
  }

  // на телефоні — закріплена панель «До сплати · Підтвердити», поки основна кнопка поза екраном
  function initCoBar() {
    const bar = $('#cobar');
    const btn = $('#cartSend');
    if (!bar || !btn || !('IntersectionObserver' in window)) return;
    const mq = window.matchMedia('(max-width: 960px)');
    let btnVisible = false;
    const sync = () => {
      const show = mq.matches && !btnVisible && !done && Object.keys(cart).length > 0;
      bar.hidden = !show;
      document.body.classList.toggle('cobar-on', show);
    };
    new IntersectionObserver(([en]) => { btnVisible = en.isIntersecting; sync(); }).observe(btn);
    if (mq.addEventListener) mq.addEventListener('change', sync);
    else if (mq.addListener) mq.addListener(sync);
    hooks.push(sync);
  }

  function initCart() {
    if (!form.recv) form.recv = form.fOther ? 'other' : 'me';

    $$('[data-f]').forEach(el => {
      el.value = form[el.id] || '';
      el.addEventListener('input', () => {
        form[el.id] = el.value;
        saveForm();
        fieldMsg(el, '');
      });
    });

    $$('[data-phone]').forEach(phone => {
      const apply = () => {
        phone.value = formatPhone(phoneDigits(phone.value));
        form[phone.id] = phone.value;
        saveForm();
      };
      if (phone.value) apply();
      phone.addEventListener('input', apply);
    });

    const gift = $('#fGift');
    if (gift) gift.checked = !!form.gift;

    const opts = $('#deliveryOpts');
    if (opts) opts.innerHTML = DLV.map(d => optHtml('dlv', d, false, true)).join('');
    initNovaPoshta();
    hooks.push(renderCart);
    initCoBar();
    syncOther();

    const stored = DLV.find(d => d.id === form.dlv);
    const initial = stored && stored.zone === zone ? stored : DLV.find(d => d.zone === zone) || DLV[0];
    if (initial) setDelivery(initial.id);
  }

  function renderCart() {
    const list = $('#cartList');
    if (!list) return;
    const keys = Object.keys(cart);
    const z = ZONES[zone];
    $('#orderDone').hidden = !done;
    $('#cartEmpty').hidden = done || keys.length > 0;
    $('#cartFilled').hidden = done || keys.length === 0;
    if (done) return;

    list.innerHTML = keys.map(key => {
      const it = parseKey(key);
      if (!it) return '';
      const q = cart[key];
      return `<li class="citem">
        <a class="citem__info" href="tovar.html?id=${it.p.id}"><b>${it.p.name}</b><small>${it.v.label} · ${fmt(it.v.price)} грн</small></a>
        ${stepHtml(key, q)}
        <div class="citem__sum">${fmt(it.v.price * q)} грн</div>
        <button type="button" class="citem__x" data-act="remove" data-id="${key}" aria-label="Прибрати">${icon('close')}</button>
      </li>`;
    }).join('');

    refreshNpQuote();
    const sub = subtotal();
    const fee = feeFor(sub);
    const np = isNp();

    $('#sumCount').textContent = `Товари (${keys.length})`;
    $('#sumGoods').textContent = `${fmt(sub)} грн`;
    $('#sumFeeName').textContent = z.feeName;
    $('#sumFee').textContent = fee ? `${fmt(fee)} грн` : 'безкоштовно';
    $('#sumNpRow').hidden = !np;
    if (np) $('#sumNp').textContent = npQuoteText();
    const total = `${fmt(sub + fee)} грн`;
    $('#sumTotal').textContent = total;
    const cobarTotal = $('#cobarTotal');
    if (cobarTotal) cobarTotal.textContent = total;

    const notes = [];
    if (np) notes.push('Доставку Нова Пошта рахує за своїм тарифом, оплачується при отриманні.');
    if (np && form.pay === 'cod') notes.push('За оплату при отриманні Нова Пошта бере комісію.');
    const note = $('#sumNote');
    note.textContent = notes.join(' ');
    note.hidden = !notes.length;

    const courierFee = sub >= ZONES.dnipro.free ? 'безкоштовно' : `${fmt(ZONES.dnipro.fee)} грн`;
    $$('[data-price-for]').forEach(el => {
      const id = el.dataset.priceFor;
      if (id === 'courier') el.textContent = courierFee;
      else el.textContent = id === form.dlv && npQuote.cost != null ? `≈ ${fmt(npQuote.cost)} грн` : 'тариф НП';
    });

    const warn = $('#cartWarn');
    if (keys.length && sub < z.min) {
      warn.hidden = false;
      warn.classList.add('is-min');
      warn.textContent = `Мінімальне замовлення (${z.label}) — ${fmt(z.min)} грн. Додайте ще на ${fmt(z.min - sub)} грн.`;
    } else if (keys.length && fee) {
      warn.hidden = false;
      warn.classList.remove('is-min');
      warn.textContent = `Ще ${fmt(z.free - sub)} грн — і ${zone === 'dnipro' ? 'доставка' : 'термопакування'} безкоштовно.`;
    } else {
      warn.hidden = true;
    }
  }

  function validate() {
    const nameRule = (id, empty) => [id, v => NAME_RE.test(v), v => (v ? 'Лише українські літери, як у документі' : empty)];
    const phoneRule = id => [id, v => phoneDigits(v).length === 9, v => (phoneDigits(v) ? 'Номер має містити 9 цифр' : 'Вкажіть номер телефону')];
    const rules = [
      nameRule('fFirst', 'Вкажіть імʼя'),
      nameRule('fLast', 'Вкажіть прізвище'),
      phoneRule('fPhone')
    ];
    if (isOther()) {
      rules.push(nameRule('fRFirst', 'Вкажіть імʼя отримувача'), nameRule('fRLast', 'Вкажіть прізвище отримувача'), phoneRule('fRPhone'));
    }
    if (!isNp()) {
      rules.push(['fAddr', v => v.length > 3, () => 'Вкажіть вулицю, будинок і квартиру']);
    } else {
      const what = form.dlv === 'np_postomat' ? 'поштомат' : 'відділення';
      rules.push(
        ['fCity', v => (npDown ? v.length > 1 : !!form.npCityRef), () => (npDown ? 'Вкажіть місто' : 'Оберіть місто зі списку')],
        ['fBranch', v => (npDown ? v.length > 0 : !!form.npBranchRef), () => (npDown ? `Вкажіть ${what}` : `Оберіть ${what} зі списку`)]
      );
    }

    // старі помилки з полів, які зараз приховані, прибираємо
    $$('.field__msg').forEach(m => { m.closest('.field').classList.remove('err'); m.remove(); });
    let first = null;
    for (const [id, ok, msg] of rules) {
      const el = document.getElementById(id);
      if (!el) continue;
      const v = el.value.trim();
      if (ok(v)) { fieldMsg(el, ''); continue; }
      fieldMsg(el, msg(v));
      if (!first) first = el;
    }
    if (!first) return true;
    first.closest('.field').scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (!first.disabled) first.focus({ preventScroll: true });
    toast('Перевірте виділені поля');
    return false;
  }

  function orderPayload() {
    const z = ZONES[zone];
    const sub = subtotal();
    const fee = feeFor(sub);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const np = isNp();
    const other = isOther();
    const dlv = DLV.find(x => x.id === form.dlv) || {};
    const pay = (PAY[np ? 'np' : 'courier'] || []).find(x => x.id === form.pay) || {};
    return {
      id: `FF-${pad(d.getDate())}${pad(d.getMonth() + 1)}-${Math.floor(1000 + Math.random() * 9000)}`,
      firstName: val('fFirst'),
      lastName: val('fLast'),
      name: `${val('fLast')} ${val('fFirst')}`,
      phone: `+380${phoneDigits(val('fPhone'))}`,
      gift: !!form.gift,
      recipientOther: other,
      recipientFirstName: other ? val('fRFirst') : '',
      recipientLastName: other ? val('fRLast') : '',
      recipientName: other ? `${val('fRLast')} ${val('fRFirst')}` : '',
      recipientPhone: other ? `+380${phoneDigits(val('fRPhone'))}` : '',
      zone: z.label,
      deliveryId: dlv.id || '',
      delivery: dlv.title || '',
      address: np ? '' : val('fAddr'),
      city: np ? val('fCity') : '',
      cityRef: np ? form.npCityRef || '' : '',
      branch: np ? val('fBranch') : '',
      branchRef: np ? form.npBranchRef || '' : '',
      npCost: np && npQuote.cost != null ? Math.round(npQuote.cost) : 0,
      weight: Math.ceil(cartWeight() * 2) / 2,
      paymentId: pay.id || '',
      payment: pay.title || '',
      comment: val('fNote'),
      website: val('fWebsite'),
      items: Object.keys(cart).map(key => {
        const it = parseKey(key);
        return { id: key, name: `${it.p.name}, ${it.v.label}`, qty: cart[key], unit: 'шт', price: it.v.price, sum: it.v.price * cart[key] };
      }),
      goods: Math.round(sub),
      feeName: z.feeName,
      fee,
      total: Math.round(sub + fee)
    };
  }

  function send() {
    if (sending || !Object.keys(cart).length) return;
    const z = ZONES[zone];
    if (subtotal() < z.min) {
      toast(`Мінімальне замовлення — ${fmt(z.min)} грн`);
      $('#cartWarn').scrollIntoView({ block: 'center' });
      return;
    }
    if (!validate()) return;

    const errBox = $('#sendError');
    errBox.hidden = true;
    if (!CFG.orderEndpoint) {
      console.warn('Fish Family: у data.js не задано SHOP.orderEndpoint — замовлення нікуди не надсилається');
      errBox.hidden = false;
      toast('Не вдалося надіслати замовлення');
      return;
    }

    const order = orderPayload();
    sending = true;
    const buttons = $$('[data-act="send"]');
    const label = $('#cartSendTxt');
    buttons.forEach(b => { b.disabled = true; });
    label.textContent = 'Надсилаємо…';
    fetch(CFG.orderEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(order)
    })
      .then(r => r.json())
      .then(res => {
        if (!res || !res.ok) throw new Error((res && res.error) || 'fail');
        $('#doneId').textContent = res.id || order.id;
        cart = {};
        store.set('ff-cart', cart);
        done = true;
        refresh();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch(() => {
        errBox.hidden = false;
        toast('Не вдалося надіслати замовлення');
      })
      .finally(() => {
        sending = false;
        buttons.forEach(b => { b.disabled = false; });
        label.textContent = 'Підтвердити замовлення';
      });
  }

  /* ---------- кліки й вибір ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-zone-pick],[data-menu]');
    if (!t) return;
    if (t.dataset.zonePick) { setZone(t.dataset.zonePick); return; }
    if (t.dataset.menu) { openMenu(t.dataset.menu === 'open'); return; }

    const id = t.dataset.id;
    switch (t.dataset.act) {
      case 'buy-dec': buyQty = Math.max(1, buyQty - 1); renderBuy(); break;
      case 'buy-inc': buyQty = Math.min(20, buyQty + 1); renderBuy(); break;
      case 'variant': selectVariant(t.dataset.vid); break;
      case 'add-main': {
        if (!current || !currentVar) break;
        const key = keyOf(current, currentVar);
        setQty(key, (cart[key] || 0) + buyQty);
        location.href = 'koshyk.html';
        break;
      }
      case 'inc': {
        const was = cart[id] || 0;
        setQty(id, was + 1);
        const it = parseKey(id);
        if (!was && it) { bump(); toast(`${it.p.name} — у кошику`, true); }
        break;
      }
      case 'dec': setQty(id, (cart[id] || 0) - 1); break;
      case 'remove': setQty(id, 0); break;
      case 'recv':
        form.recv = t.dataset.recv === 'other' ? 'other' : 'me';
        saveForm();
        syncOther();
        break;
      case 'send': send(); break;
    }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'dlv') setDelivery(t.value);
    else if (t.name === 'pay') { form.pay = t.value; saveForm(); renderCart(); }
    else if (t.id === 'fGift') { form.gift = t.checked; saveForm(); }
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') openMenu(false); });

  const pages = { home: initHome, catalog: initCatalog, product: initProduct, cart: initCart };
  const init = pages[document.body.dataset.page];
  if (init) init();
  setZone(zone);
  refresh();
})();
