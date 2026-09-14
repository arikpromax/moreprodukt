/**
 * Fish Family — приймач замовлень із сайту.
 * Записує замовлення в Google Таблицю, одразу створює накладну Нової Пошти
 * і надсилає все в Telegram. Щогодини оновлює статуси посилок.
 *
 * ЯК ПІДКЛЮЧИТИ (один раз):
 * 1. Створіть Google Таблицю, напр. «Fish Family — замовлення».
 * 2. У таблиці: Розширення → Apps Script. Видаліть усе, вставте цей файл, збережіть.
 * 3. Telegram: напишіть @BotFather → /newbot → отримаєте токен бота.
 *    Напишіть своєму боту будь-що (або додайте бота в групу, куди мають приходити замовлення).
 * 4. Apps Script → Налаштування проєкту (шестерня) → Властивості скрипту → Додати:
 *      TG_TOKEN    — токен від BotFather
 *    Виберіть функцію findChatId → «Виконати». Скопіюйте chat_id із журналу й додайте:
 *      TG_CHAT_ID  — це число (для групи воно з мінусом)
 * 5. Нова Пошта: бізнес-кабінет → Налаштування → Безпека → створіть API-ключ. Додайте властивості:
 *      NP_API_KEY           — ключ API
 *      NP_SENDER_WAREHOUSE  — номер відділення в Дніпрі, куди здаєте посилки, напр. 12
 *      NP_COD = yes         — лише якщо в договорі з Новою Поштою є «Контроль оплати»
 *      NP_SHIP_DAYS         — дні, коли відправляєте, через кому: 1 — пн … 7 — нд (за замовчуванням 1,2,3,4,5)
 *      NP_SHIP_CUTOFF       — до котрої години замовлення ще відправляєте того ж дня (за замовчуванням 16:00)
 *    Якщо посилки забирає курʼєр з адреси магазину — замість NP_SENDER_WAREHOUSE додайте NP_SEND_FROM = doors.
 *    Виберіть функцію npSetup → «Виконати». Скрипт знайде відправника й контактну особу
 *    і покаже в журналі, що налаштовано (для курʼєра — список адрес: Ref потрібної впишіть у NP_SENDER_ADDRESS_REF).
 * 6. Виберіть функцію installTriggers → «Виконати» — вмикає щогодинну перевірку статусів посилок.
 * 7. Розгорнути → Нове розгортання → тип «Вебзастосунок»:
 *      Виконувати від імені: Я;  Хто має доступ: Усі.
 *    Дозвольте доступи, скопіюйте URL вебзастосунку й вставте в data.js → SHOP.orderEndpoint.
 * 8. Перевірка: функція testOrder — рядок у таблиці й повідомлення в Telegram (замовлення курʼєром, без ТТН).
 *    ТТН перевірте одним замовленням із сайту на Нову Пошту, потім видаліть цю накладну в кабінеті Нової Пошти.
 *
 * Якщо замовлення скасували: видаліть накладну в кабінеті Нової Пошти й поставте в колонці «Статус» — «Скасовано».
 * Ключі зберігаються лише у властивостях скрипту — на сайті їх немає.
 */

const SHEET_NAME = 'Замовлення';
const HEADERS = ['Дата', '№', 'Статус', 'Прізвище та імʼя', 'Телефон', 'Отримувач (якщо інший)', 'Доставка', 'Адреса / місто', 'Відділення / поштомат', 'Оплата', 'Товари', 'Сума, грн', 'Коментар', 'ТТН', 'Статус Нової Пошти'];
const COL_ID = 2;
const COL_STATUS = 3;
const COL_NAME = 4;
const COL_TTN = 14;
const COL_NP_STATUS = 15;

const NP_URL = 'https://api.novaposhta.ua/v2.0/json/';
const NP_DNIPRO = 'db5c88f0-391c-11dd-90d9-001a92567626';
const POSTOMAT_BOX = { width: 30, length: 40, height: 20 }; // см — розміри коробки для поштомата
const NP_RECEIVED = [9, 10, 11];
const NP_REFUSED = [102, 103, 108];

/* ================= приймання замовлення ================= */

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.website) return json({ ok: true }); // пастка для спам-ботів

    const phoneDigits = String(data.phone || '').replace(/\D/g, '');
    if (!clean(data.name) || phoneDigits.length < 10 || !Array.isArray(data.items) || !data.items.length) {
      return json({ ok: false, error: 'bad_request' });
    }

    const id = clean(data.id, 20) || 'FF-' + String(Date.now()).slice(-6);
    let row;
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      row = appendOrder(data, id);
    } finally {
      lock.releaseLock();
    }

    let ttn = null;
    let ttnError = '';
    try {
      ttn = createTtn(data);
      if (ttn) {
        const sheet = orderSheet();
        sheet.getRange(row, COL_TTN).setValue("'" + ttn.number);
        sheet.getRange(row, COL_STATUS).setValue('ТТН створено');
      }
    } catch (err) {
      ttnError = String((err && err.message) || err);
      console.error('ttn', err);
    }

    notify(data, id, ttn, ttnError);
    return json({ ok: true, id: id, ttn: ttn ? ttn.number : '' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'server' });
  }
}

function doGet() {
  return json({ ok: true, service: 'fishfamily-orders' });
}

function orderSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendOrder(d, id) {
  const sheet = orderSheet();
  sheet.appendRow([
    new Date(),
    id,
    'Нове',
    cell(d.name),
    cell(d.phone),
    cell(d.recipientOther ? d.recipientName + ', ' + d.recipientPhone : ''),
    cell(d.delivery || d.zone),
    cell(d.address || d.city),
    cell(d.branch),
    cell(d.payment),
    cell(itemsText(d.items)),
    Math.round(Number(d.total) || 0),
    cell((d.gift ? 'ПОДАРУНОК — не вкладати чек. ' : '') + (d.comment || '')),
    '',
    ''
  ]);
  return sheet.getLastRow();
}

function notify(d, id, ttn, ttnError) {
  const lines = [
    '<b>Нове замовлення ' + esc(id) + '</b>',
    '',
    esc(itemsText(d.items)),
    '',
    'Товари: ' + money(d.goods),
    esc(clean(d.feeName) || 'Доставка') + ': ' + (Number(d.fee) ? money(d.fee) : 'безкоштовно'),
    '<b>До сплати: ' + money(d.total) + '</b>',
    '',
    'Замовник: ' + esc(clean(d.name)),
    'Телефон: ' + esc(clean(d.phone))
  ];
  if (d.recipientOther) lines.push('Отримувач: ' + esc(clean(d.recipientName)) + ', ' + esc(clean(d.recipientPhone)));
  lines.push('Доставка: ' + esc(clean(d.delivery || d.zone)));
  if (d.address) lines.push('Адреса: ' + esc(clean(d.address)));
  if (d.city) lines.push('Місто: ' + esc(clean(d.city)));
  if (d.branch) lines.push('Відділення: ' + esc(clean(d.branch)));
  if (d.payment) lines.push('Оплата: ' + esc(clean(d.payment)));
  if (d.gift) lines.push('<b>Подарунок — не вкладати чек</b>');
  if (d.comment) lines.push('Коментар: ' + esc(clean(d.comment)));
  if (ttn) {
    lines.push('', '<b>ТТН: ' + esc(ttn.number) + '</b> · відправка ' + ttn.date + (ttn.cost ? ' · доставка ≈ ' + money(ttn.cost) : ''));
  } else if (ttnError) {
    lines.push('', '<b>ТТН не створено:</b> ' + esc(ttnError) + ' — створіть накладну вручну');
  }
  tg(lines.join('\n'));
}

/* ================= Нова Пошта ================= */

function np(modelName, calledMethod, methodProperties) {
  const res = UrlFetchApp.fetch(NP_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ apiKey: prop('NP_API_KEY'), modelName: modelName, calledMethod: calledMethod, methodProperties: methodProperties || {} }),
    muteHttpExceptions: true
  });
  const j = JSON.parse(res.getContentText());
  if (!j.success) throw new Error((j.errors || []).concat(j.warnings || []).join('; ') || 'помилка запиту до Нової Пошти');
  return j.data || [];
}

/* Запустіть один раз після того, як додали NP_API_KEY: знайде відправника й відділення відправки */
function npSetup() {
  const P = PropertiesService.getScriptProperties();
  if (!prop('NP_API_KEY')) throw new Error('Спершу додайте властивість NP_API_KEY');

  const sender = np('Counterparty', 'getCounterparties', { CounterpartyProperty: 'Sender', Page: '1' })[0];
  if (!sender) throw new Error('У кабінеті Нової Пошти не знайдено відправника');
  const contact = np('Counterparty', 'getCounterpartyContactPersons', { Ref: sender.Ref, Page: '1' })[0];
  if (!contact) throw new Error('У відправника немає контактної особи — додайте її в кабінеті Нової Пошти');
  P.setProperties({
    NP_SENDER_REF: sender.Ref,
    NP_CONTACT_REF: contact.Ref,
    NP_SENDER_PHONE: normPhone(prop('NP_SENDER_PHONE') || contact.Phones)
  });

  const log = [
    'Відправник: ' + sender.Description,
    'Контактна особа: ' + contact.Description + ', ' + prop('NP_SENDER_PHONE')
  ];
  if (prop('NP_SEND_FROM') === 'doors') {
    const addresses = np('Counterparty', 'getCounterpartyAddresses', { Ref: sender.Ref, CounterpartyProperty: 'Sender' });
    log.push('Посилки забирає курʼєр. Адреси відправника — Ref потрібної впишіть у властивість NP_SENDER_ADDRESS_REF:');
    addresses.forEach(function (a) { log.push('  ' + a.Description + '  →  ' + a.Ref); });
    if (!addresses.length) log.push('  адрес немає — додайте адресу в кабінеті Нової Пошти й запустіть npSetup ще раз');
  } else {
    const num = prop('NP_SENDER_WAREHOUSE');
    if (!num) throw new Error('Додайте властивість NP_SENDER_WAREHOUSE — номер відділення, куди здаєте посилки');
    const wh = np('AddressGeneral', 'getWarehouses', { CityRef: prop('NP_SENDER_CITY_REF') || NP_DNIPRO, WarehouseId: String(num), Page: '1' })[0];
    if (!wh) throw new Error('Відділення №' + num + ' не знайдено в Дніпрі');
    P.setProperty('NP_SENDER_WAREHOUSE_REF', wh.Ref);
    log.push('Відділення відправки: ' + wh.Description);
  }
  log.push('Контроль оплати: ' + (prop('NP_COD') === 'yes' ? 'увімкнено' : 'вимкнено'));
  console.log(log.join('\n'));
}

/* Створює накладну для замовлення Новою Поштою. Повертає null, якщо НП ще не підключено або доставка курʼєром */
function createTtn(d) {
  if (!d.deliveryId || d.deliveryId === 'courier') return null;
  if (!prop('NP_API_KEY')) return null;
  if (!d.cityRef || !d.branchRef) throw new Error('місто або відділення вписані вручну, без вибору зі списку');

  const doors = prop('NP_SEND_FROM') === 'doors';
  const senderAddress = doors ? prop('NP_SENDER_ADDRESS_REF') : prop('NP_SENDER_WAREHOUSE_REF');
  if (!prop('NP_SENDER_REF') || !prop('NP_CONTACT_REF') || !senderAddress) {
    throw new Error('не налаштовано відправника — запустіть npSetup');
  }

  const other = !!d.recipientOther;
  const firstName = clean(other ? d.recipientFirstName : d.firstName, 40);
  const lastName = clean(other ? d.recipientLastName : d.lastName, 40);
  const phone = normPhone(other ? d.recipientPhone : d.phone);

  const recipient = np('Counterparty', 'save', {
    FirstName: firstName,
    MiddleName: '',
    LastName: lastName,
    Phone: phone,
    Email: '',
    CounterpartyType: 'PrivatePerson',
    CounterpartyProperty: 'Recipient'
  })[0];
  const contactRecipient = recipient && recipient.ContactPerson && recipient.ContactPerson.data && recipient.ContactPerson.data[0]
    ? recipient.ContactPerson.data[0].Ref
    : '';

  const postomat = d.deliveryId === 'np_postomat';
  const weight = Math.max(0.5, Number(d.weight) || 1);
  const date = shipDate();
  const props = {
    PayerType: 'Recipient',
    PaymentMethod: 'Cash',
    DateTime: date,
    CargoType: 'Parcel',
    Weight: String(weight),
    ServiceType: (doors ? 'Doors' : 'Warehouse') + (postomat ? 'Postomat' : 'Warehouse'),
    SeatsAmount: '1',
    Description: 'Продукти харчування',
    Cost: String(Math.max(300, Math.round(Number(d.goods) || Number(d.total) || 0))),
    CitySender: prop('NP_SENDER_CITY_REF') || NP_DNIPRO,
    Sender: prop('NP_SENDER_REF'),
    SenderAddress: senderAddress,
    ContactSender: prop('NP_CONTACT_REF'),
    SendersPhone: prop('NP_SENDER_PHONE'),
    CityRecipient: d.cityRef,
    Recipient: recipient.Ref,
    RecipientAddress: d.branchRef,
    ContactRecipient: contactRecipient,
    RecipientsPhone: phone
  };
  if (postomat) {
    props.OptionsSeat = [{
      volumetricWidth: String(POSTOMAT_BOX.width),
      volumetricLength: String(POSTOMAT_BOX.length),
      volumetricHeight: String(POSTOMAT_BOX.height),
      weight: String(weight)
    }];
  }
  if (d.paymentId === 'cod' && prop('NP_COD') === 'yes') {
    props.AfterpaymentOnGoodsCost = String(Math.round(Number(d.total) || 0));
  }

  const doc = np('InternetDocument', 'save', props)[0];
  return { number: String(doc.IntDocNumber), ref: doc.Ref, cost: Number(doc.CostOnSite) || 0, date: date };
}

/* Дата відправки в накладній — найближчий день, коли магазин відправляє.
   NP_SHIP_DAYS — дні відправки через кому: 1 — пн … 7 — нд (за замовчуванням 1,2,3,4,5).
   NP_SHIP_CUTOFF — до котрої години замовлення ще відправляють того ж дня (за замовчуванням 16:00). */
function shipDate() {
  const days = (prop('NP_SHIP_DAYS') || '1,2,3,4,5').split(',')
    .map(function (s) { return Number(s.trim()); })
    .filter(function (n) { return n >= 1 && n <= 7; });
  const cut = (prop('NP_SHIP_CUTOFF') || '16:00').split(':');
  const cutMinutes = Number(cut[0]) * 60 + Number(cut[1] || 0);
  const now = new Date();
  const hm = Utilities.formatDate(now, 'Europe/Kiev', 'HH:mm').split(':');
  const nowMinutes = Number(hm[0]) * 60 + Number(hm[1]);
  for (let add = 0; add < 14; add++) {
    const d = new Date(now.getTime() + add * 86400000);
    const weekday = Number(Utilities.formatDate(d, 'Europe/Kiev', 'u')); // 1 — понеділок … 7 — неділя
    if (days.indexOf(weekday) < 0) continue;
    if (add === 0 && nowMinutes >= cutMinutes) continue;
    return Utilities.formatDate(d, 'Europe/Kiev', 'dd.MM.yyyy');
  }
  return Utilities.formatDate(now, 'Europe/Kiev', 'dd.MM.yyyy');
}

/* Щогодини: статуси посилок у таблицю, «отримано» й «відмова» — у Telegram */
function trackParcels() {
  if (!prop('NP_API_KEY')) return;
  const sheet = orderSheet();
  const last = sheet.getLastRow();
  if (last < 2) return;

  const rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const pending = [];
  rows.forEach(function (r, i) {
    const ttn = String(r[COL_TTN - 1] || '').replace(/\D/g, '');
    const status = String(r[COL_STATUS - 1] || '');
    const npStatus = String(r[COL_NP_STATUS - 1] || '');
    if (!ttn || status === 'Скасовано' || npStatus === 'Отримано' || npStatus === 'Відмова') return;
    pending.push({ row: i + 2, ttn: ttn, id: r[COL_ID - 1], name: r[COL_NAME - 1], old: npStatus });
  });

  for (let i = 0; i < pending.length; i += 100) {
    const chunk = pending.slice(i, i + 100);
    const docs = np('TrackingDocument', 'getStatusDocuments', {
      Documents: chunk.map(function (p) { return { DocumentNumber: p.ttn, Phone: prop('NP_SENDER_PHONE') }; })
    });
    docs.forEach(function (doc) {
      const p = chunk.filter(function (x) { return x.ttn === String(doc.Number); })[0];
      if (!p) return;
      const code = Number(doc.StatusCode);
      const received = NP_RECEIVED.indexOf(code) >= 0;
      const refused = NP_REFUSED.indexOf(code) >= 0;
      const label = received ? 'Отримано' : refused ? 'Відмова' : clean(doc.Status, 120);
      if (label === p.old) return;
      sheet.getRange(p.row, COL_NP_STATUS).setValue(label);
      if (received) {
        sheet.getRange(p.row, COL_STATUS).setValue('Отримано');
        tg('Посилку отримано: ' + esc(p.id) + ' · ' + esc(p.name) + ' · ТТН ' + p.ttn);
      } else if (refused) {
        sheet.getRange(p.row, COL_STATUS).setValue('Відмова');
        tg('<b>Відмова від посилки:</b> ' + esc(p.id) + ' · ' + esc(p.name) + ' · ТТН ' + p.ttn);
      }
    });
  }
}

/* Запустіть один раз: вмикає щогодинну перевірку статусів */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'trackParcels') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('trackParcels').timeBased().everyHours(1).create();
  console.log('Щогодинна перевірка статусів посилок увімкнена');
}

/* ================= Telegram ================= */

function tg(text) {
  const token = prop('TG_TOKEN');
  const chatId = prop('TG_CHAT_ID');
  if (!token || !chatId) return;
  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true }),
    muteHttpExceptions: true
  });
}

/* Запустіть один раз після того, як написали боту: покаже chat_id у журналі */
function findChatId() {
  const token = prop('TG_TOKEN');
  if (!token) throw new Error('Спершу додайте властивість TG_TOKEN');
  const res = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates').getContentText());
  const chats = {};
  (res.result || []).forEach(function (u) {
    const m = u.message || u.channel_post || u.my_chat_member;
    if (m && m.chat) chats[m.chat.id] = m.chat.title || m.chat.username || m.chat.first_name;
  });
  console.log(Object.keys(chats).length ? chats : 'Повідомлень немає — напишіть боту й запустіть ще раз');
}

/* Тестове замовлення курʼєром: перевіряє таблицю й Telegram без сайту і без ТТН */
function testOrder() {
  const res = doPost({ postData: { contents: JSON.stringify({
    id: 'TEST-1', name: 'Тестенко Тест', firstName: 'Тест', lastName: 'Тестенко', phone: '+380000000000',
    deliveryId: 'courier', delivery: 'Курʼєр по Дніпру', address: 'тестова адреса',
    payment: 'Готівкою при отриманні', gift: true,
    items: [{ name: 'Філе лосося охолоджене, 1,5–1,7 кг', qty: 1, unit: 'шт', sum: 1870 }],
    goods: 1870, fee: 0, feeName: 'Доставка по Дніпру', total: 1870, comment: 'перевірка'
  }) } });
  console.log(res.getContent());
}

/* ================= допоміжне ================= */

function prop(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

// телефон у форматі Нової Пошти: 380XXXXXXXXX
function normPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 10 && d.charAt(0) === '0') d = '38' + d;
  if (d.length === 9) d = '380' + d;
  return d;
}

function itemsText(items) {
  return (items || []).slice(0, 50).map(function (it) {
    return '• ' + clean(it.name, 80) + ' — ' + Number(it.qty) + ' ' + clean(it.unit, 10) + ', ' + money(it.sum);
  }).join('\n');
}

// прибирає керівні символи (крім переносу рядка) й зайві пробіли
function clean(v, max) {
  const s = String(v == null ? '' : v).split('').map(function (ch) {
    const c = ch.charCodeAt(0);
    return c === 10 || c >= 32 ? ch : ' ';
  }).join('');
  return s.replace(/ {2,}/g, ' ').trim().slice(0, max || 300);
}

// захист від формул у клітинках
function cell(v) {
  const s = clean(v, 1000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function money(n) {
  return Math.round(Number(n) || 0).toLocaleString('uk-UA') + ' грн';
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
