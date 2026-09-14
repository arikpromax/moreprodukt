/* Fish Family — спільна логіка всіх сторінок. Товари, категорії, доставка й налаштування — у data.js */
(() => {
  'use strict';

  const CFG = typeof SHOP !== 'undefined' ? SHOP : {};
  const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fmt = n => Math.round(n).toLocaleString('uk-UA');
  const dec = n => String(Math.round(n * 100) / 100).replace('.', ',');
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

  /* ---------- найближча пʼятниця ---------- */
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const toFriday = (5 - today.getDay() + 7) % 7;
  const friday = new Date(today);
  friday.setDate(today.getDate() + toFriday);
  const dayMonth = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  $$('[data-friday]').forEach(el => { el.textContent = toFriday === 0 ? `сьогодні, ${dayMonth(friday)}` : `пʼятниця, ${dayMonth(friday)}`; });
  $$('[data-friday-date]').forEach(el => { el.textContent = dayMonth(friday); });
  $$('[data-price-of]').forEach(el => { const p = byId(el.dataset.priceOf); if (p) el.textContent = fmt(p.price); });

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
  Object.keys(cart).forEach(id => { if (!byId(id) || !(cart[id] > 0)) delete cart[id]; });
  let zone = store.get('ff-zone', 'dnipro');
  if (!ZONES[zone]) zone = 'dnipro';

  const avgKg = p => (p.kg[0] + p.kg[1]) / 2;
  const unitPrice = p => (p.kg ? p.price * avgKg(p) : p.price);
  const subtotal = () => Object.keys(cart).reduce((s, id) => s + unitPrice(byId(id)) * cart[id], 0);
  const hasApprox = () => Object.keys(cart).some(id => byId(id).kg);
  const feeFor = sub => (sub >= ZONES[zone].free ? 0 : ZONES[zone].fee);
  const hooks = [];

  function setQty(id, q) {
    if (q <= 0) delete cart[id];
    else cart[id] = Math.min(q, 50);
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
  const stepHtml = (id, q, unit) =>
    `<div class="step step--sm">
      <button type="button" data-act="dec" data-id="${id}" aria-label="Менше">${icon('minus')}</button>
      <output>${q} ${unit}</output>
      <button type="button" data-act="inc" data-id="${id}" aria-label="Більше">${icon('plus')}</button>
    </div>`;
  const phClass = p => (p.cat === 'ryba' ? 'ph' : 'ph ph--sea');
  const shot = (p, i) => (p.photos && p.photos[i]
    ? `<img src="${p.photos[i]}" alt="${p.name}"${i ? ' loading="lazy"' : ''}>`
    : '');

  function card(p) {
    return `<article class="card">
      <a class="card__link" href="tovar.html?id=${p.id}">
        <figure class="${phClass(p)}">${p.tag ? `<em class="card__tag">${p.tag}</em>` : ''}${shot(p, 0)}</figure>
        <h3>${p.name}</h3>
      </a>
      <p>${p.short}</p>
      <div class="card__price">${fmt(p.price)} <small>грн/${p.per}</small></div>
      <div class="card__foot" data-foot="${p.id}"></div>
    </article>`;
  }

  function renderFoots() {
    $$('[data-foot]').forEach(foot => {
      const id = foot.dataset.foot;
      const q = cart[id] || 0;
      foot.innerHTML = q
        ? stepHtml(id, q, byId(id).unit)
        : `<button type="button" class="add" data-act="inc" data-id="${id}">${icon('cart')}У кошик</button>`;
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
  let buyQty = 1;

  function renderBuy() {
    const p = current;
    if (!p) return;
    $$('[data-buy-qty]').forEach(el => { el.textContent = buyQty; });
    $$('[data-buy-est]').forEach(el => { el.textContent = `${p.kg ? '≈ ' : ''}${fmt(unitPrice(p) * buyQty)} грн`; });
    $$('[data-buy-sub]').forEach(el => {
      el.textContent = p.kg
        ? `за ${buyQty} ${p.unit} ≈ ${dec(avgKg(p) * buyQty)} кг`
        : `${buyQty} ${p.unit} × ${fmt(p.price)} грн`;
    });
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
    $('#pPrice').textContent = fmt(p.price);
    $('#pPer').textContent = `грн/${p.per}`;
    $('#pWeekly').hidden = !p.weekly;
    const badge = $('#pBadge');
    badge.textContent = p.badge || '';
    badge.hidden = !p.badge;
    $('#pLead').textContent = p.lead;
    $('#pSpecs').innerHTML = p.specs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('#pQtyLabel').textContent = p.qtyLabel;
    const note = $('#pNote');
    note.textContent = p.note || '';
    note.hidden = !p.note;
    const perks = $('#pPerks');
    perks.innerHTML = (p.perks || []).map(([ic, t]) => `<div class="perk">${icon(ic)}${t}</div>`).join('');
    perks.hidden = !p.perks;
    $('#barName').innerHTML = `${p.name}<small>${fmt(p.price)} грн/${p.per} · <span data-buy-est></span></small>`;
    $$('[data-extra]').forEach(el => { el.hidden = el.dataset.extra !== p.id; });
    const sim = $('#similar');
    if (sim) sim.innerHTML = PRODUCTS.filter(x => x.id !== p.id).map(card).join('');

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

    renderBuy();

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

  /* ---------- Нова Пошта: місто й відділення зі списку ---------- */
  const NP_URL = 'https://api.novaposhta.ua/v2.0/json/';
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

  function initNovaPoshta() {
    const city = $('#fCity');
    const branch = $('#fBranch');
    if (!city || !branch) return;

    const syncBranch = () => {
      branch.disabled = !form.npCityRef && !npDown;
      branch.placeholder = branch.disabled ? 'Спершу оберіть місто' : 'Номер або адреса відділення';
    };
    const clearBranch = () => {
      form.npBranchRef = '';
      form.npBranchName = '';
      form.fBranch = '';
      branch.value = '';
    };

    city.addEventListener('input', () => {
      if (city.value.trim() === form.npCityName) return;
      form.npCityRef = '';
      form.npCityName = '';
      clearBranch();
      saveForm();
      syncBranch();
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
        clearBranch();
        saveForm();
        syncBranch();
        city.closest('.field').classList.remove('err');
        branch.focus();
      },
      onError: syncBranch
    });

    autocomplete(branch, $('#fBranchList'), {
      minChars: 0,
      query: v => (v.trim() === form.npBranchName ? '' : v.trim()),
      load: q => {
        if (!form.npCityRef) return Promise.reject(Object.assign(new Error('nocity'), { msg: 'Спершу оберіть місто зі списку' }));
        // якщо ввели лише номер — відділення з цим номером іде першим
        const num = /^\s*№?\s*\d+\s*$/.test(q) ? q.replace(/\D/g, '') : '';
        const base = { CityRef: form.npCityRef, Limit: '50', Page: '1', Language: 'UA' };
        return Promise.all([
          npCall('AddressGeneral', 'getWarehouses', { ...base, FindByString: q }),
          num ? npCall('AddressGeneral', 'getWarehouses', { ...base, WarehouseId: num }).catch(() => []) : []
        ]).then(([found, exact]) => {
          const seen = new Set();
          return [...exact.filter(w => String(w.Number) === num), ...found]
            .filter(w => !seen.has(w.Ref) && seen.add(w.Ref))
            .map(w => ({
              title: w.Description,
              sub: /postomat/i.test(w.CategoryOfWarehouse) ? 'Поштомат' : '',
              value: w.Description,
              ref: w.Ref
            }));
        });
      },
      pick: r => {
        form.npBranchRef = r.ref;
        form.npBranchName = r.value;
        form.fBranch = r.value;
        saveForm();
        branch.closest('.field').classList.remove('err');
      },
      onError: syncBranch
    });

    syncBranch();
  }

  /* ---------- сторінка кошика ---------- */
  let done = false;
  let sending = false;
  const form = store.get('ff-form', {}) || {};
  const saveForm = () => store.set('ff-form', form);

  function initCart() {
    $$('[data-f]').forEach(el => {
      el.value = form[el.id] || '';
      el.addEventListener('input', () => {
        form[el.id] = el.value;
        saveForm();
        el.closest('.field').classList.remove('err');
      });
    });
    initNovaPoshta();
    hooks.push(renderCart);
  }

  function renderCart() {
    const list = $('#cartList');
    if (!list) return;
    const ids = Object.keys(cart);
    const z = ZONES[zone];
    $('#orderDone').hidden = !done;
    $('#cartEmpty').hidden = done || ids.length > 0;
    $('#cartFilled').hidden = done || ids.length === 0;
    if (done) return;

    list.innerHTML = ids.map(id => {
      const p = byId(id);
      const q = cart[id];
      return `<li class="citem">
        <a class="citem__info" href="tovar.html?id=${p.id}"><b>${p.name}</b><small>${fmt(p.price)} грн/${p.per}${p.kg ? ` · філе ${dec(p.kg[0])}–${dec(p.kg[1])} кг` : ''}</small></a>
        ${stepHtml(id, q, p.unit)}
        <div class="citem__sum">${p.kg ? '≈ ' : ''}${fmt(unitPrice(p) * q)} грн</div>
        <button type="button" class="citem__x" data-act="remove" data-id="${id}" aria-label="Прибрати">${icon('close')}</button>
      </li>`;
    }).join('');

    const sub = subtotal();
    const fee = feeFor(sub);
    const ap = hasApprox() ? '≈ ' : '';
    $('#sumGoods').textContent = `${ap}${fmt(sub)} грн`;
    $('#sumFeeName').textContent = z.feeName;
    $('#sumFee').textContent = fee ? `${fmt(fee)} грн` : 'безкоштовно';
    $('#sumTotal').textContent = `${ap}${fmt(sub + fee)} грн`;
    const note = $('#sumNote');
    note.textContent = z.note || '';
    note.hidden = !z.note;

    const warn = $('#cartWarn');
    if (ids.length && sub < z.min) {
      warn.hidden = false;
      warn.classList.add('is-min');
      warn.textContent = `Мінімальне замовлення (${z.label}) — ${fmt(z.min)} грн. Додайте ще на ${fmt(z.min - sub)} грн.`;
    } else if (ids.length && fee) {
      warn.hidden = false;
      warn.classList.remove('is-min');
      warn.textContent = `Ще ${fmt(z.free - sub)} грн — і ${zone === 'dnipro' ? 'доставка' : 'термопакування'} безкоштовно.`;
    } else {
      warn.hidden = true;
    }
  }

  function validate() {
    const need = [
      ['fName', v => v.length > 1, 'Вкажіть, будь ласка, імʼя'],
      ['fPhone', v => v.replace(/\D/g, '').length >= 10, 'Перевірте номер телефону']
    ];
    if (zone === 'dnipro') {
      need.push(['fAddr', v => v.length > 3, 'Вкажіть адресу доставки']);
    } else {
      need.push(
        ['fCity', v => (npDown ? v.length > 1 : !!form.npCityRef), npDown ? 'Вкажіть місто' : 'Оберіть місто зі списку'],
        ['fBranch', v => (npDown ? v.length > 0 : !!form.npBranchRef), npDown ? 'Вкажіть відділення або поштомат' : 'Оберіть відділення або поштомат зі списку']
      );
    }
    $$('.field.err').forEach(f => f.classList.remove('err'));
    for (const [id, ok, msg] of need) {
      const el = document.getElementById(id);
      if (!ok(el.value.trim())) {
        el.closest('.field').classList.add('err');
        if (!el.disabled) el.focus();
        toast(msg);
        return false;
      }
    }
    return true;
  }

  function orderPayload() {
    const z = ZONES[zone];
    const sub = subtotal();
    const fee = feeFor(sub);
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ua = zone === 'ukraine';
    return {
      id: `FF-${pad(d.getDate())}${pad(d.getMonth() + 1)}-${Math.floor(1000 + Math.random() * 9000)}`,
      name: val('fName'),
      phone: val('fPhone'),
      zone: z.label,
      address: ua ? '' : val('fAddr'),
      city: ua ? val('fCity') : '',
      cityRef: ua ? form.npCityRef || '' : '',
      branch: ua ? val('fBranch') : '',
      branchRef: ua ? form.npBranchRef || '' : '',
      comment: val('fNote'),
      website: val('fWebsite'),
      items: Object.keys(cart).map(id => {
        const p = byId(id);
        return { id, name: p.name, qty: cart[id], unit: p.unit, price: p.price, per: p.per, sum: Math.round(unitPrice(p) * cart[id]), approx: !!p.kg };
      }),
      goods: Math.round(sub),
      feeName: z.feeName,
      fee,
      total: Math.round(sub + fee),
      approx: hasApprox()
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
    const btn = $('#cartSend');
    const label = $('#cartSendTxt');
    btn.disabled = true;
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
        btn.disabled = false;
        label.textContent = 'Оформити замовлення';
      });
  }

  /* ---------- кліки ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-zone-pick],[data-menu]');
    if (!t) return;
    if (t.dataset.zonePick) { setZone(t.dataset.zonePick); return; }
    if (t.dataset.menu) { openMenu(t.dataset.menu === 'open'); return; }

    const id = t.dataset.id;
    switch (t.dataset.act) {
      case 'buy-dec': buyQty = Math.max(1, buyQty - 1); renderBuy(); break;
      case 'buy-inc': buyQty = Math.min(20, buyQty + 1); renderBuy(); break;
      case 'add-main':
        if (!current) break;
        setQty(current.id, (cart[current.id] || 0) + buyQty);
        location.href = 'koshyk.html';
        break;
      case 'inc': {
        const was = cart[id] || 0;
        setQty(id, was + 1);
        if (!was) { bump(); toast(`${byId(id).name} — у кошику`, true); }
        break;
      }
      case 'dec': setQty(id, (cart[id] || 0) - 1); break;
      case 'remove': setQty(id, 0); break;
      case 'send': send(); break;
    }
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') openMenu(false); });

  const pages = { home: initHome, catalog: initCatalog, product: initProduct, cart: initCart };
  const init = pages[document.body.dataset.page];
  if (init) init();
  setZone(zone);
  refresh();
})();
