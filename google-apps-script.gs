/**
 * Fish Family — приймач замовлень із сайту.
 * Записує кожне замовлення в Google Таблицю й надсилає повідомлення в Telegram.
 *
 * ЯК ПІДКЛЮЧИТИ (один раз):
 * 1. Створіть Google Таблицю, напр. «Fish Family — замовлення».
 * 2. У таблиці: Розширення → Apps Script. Видаліть усе, вставте цей файл, збережіть.
 * 3. Telegram: напишіть @BotFather → /newbot → отримаєте токен бота.
 *    Потім напишіть своєму боту будь-яке повідомлення (або додайте бота в групу, куди мають приходити замовлення).
 * 4. Apps Script → Налаштування проєкту (шестерня) → Властивості скрипту → Додати:
 *      TG_TOKEN    — токен від BotFather
 *    Збережіть. У редакторі виберіть функцію findChatId → «Виконати».
 *    У журналі зʼявиться chat_id — додайте ще одну властивість:
 *      TG_CHAT_ID  — це число (для групи воно з мінусом)
 * 5. Розгорнути → Нове розгортання → тип «Вебзастосунок»:
 *      Виконувати від імені: Я;  Хто має доступ: Усі.
 *    Google попросить дозволи (таблиці, зовнішні запити) — дозвольте.
 *    Скопіюйте URL вебзастосунку і вставте його в data.js → SHOP.orderEndpoint.
 * 6. Перевірка: виберіть функцію testOrder → «Виконати».
 *    У таблиці зʼявиться рядок, у Telegram — повідомлення.
 *
 * Токен бота зберігається лише у властивостях скрипту — на сайті його немає.
 */

const SHEET_NAME = 'Замовлення';
const SHOP_NAME = 'Fish Family';
const HEADERS = ['Дата', '№', 'Статус', 'Прізвище та імʼя', 'Телефон', 'Отримувач (якщо інший)', 'Доставка', 'Адреса / місто', 'Відділення / поштомат', 'Оплата', 'Товари', 'Сума, грн', 'Коментар'];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.website) return json({ ok: true }); // пастка для спам-ботів

    const phoneDigits = String(data.phone || '').replace(/\D/g, '');
    if (!clean(data.name) || phoneDigits.length < 10 || !Array.isArray(data.items) || !data.items.length) {
      return json({ ok: false, error: 'bad_request' });
    }

    const id = clean(data.id, 20) || 'FF-' + String(Date.now()).slice(-6);
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      appendOrder(data, id);
    } finally {
      lock.releaseLock();
    }
    notify(data, id);
    return json({ ok: true, id: id });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'server' });
  }
}

function doGet() {
  return json({ ok: true, service: 'fishfamily-orders' });
}

function appendOrder(d, id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
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
    (d.approx ? '≈ ' : '') + Math.round(Number(d.total) || 0),
    cell((d.gift ? 'ПОДАРУНОК — не вкладати чек. ' : '') + (d.comment || ''))
  ]);
}

function notify(d, id) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TG_TOKEN');
  const chatId = props.getProperty('TG_CHAT_ID');
  if (!token || !chatId) return;

  const lines = [
    '<b>Нове замовлення ' + esc(id) + '</b>',
    '',
    esc(itemsText(d.items)),
    '',
    'Товари: ' + (d.approx ? '≈ ' : '') + money(d.goods),
    esc(clean(d.feeName) || 'Доставка') + ': ' + (Number(d.fee) ? money(d.fee) : 'безкоштовно'),
    '<b>До сплати: ' + (d.approx ? '≈ ' : '') + money(d.total) + '</b>'
  ];
  if (Number(d.npCost)) lines.push('Нова Пошта ≈ ' + money(d.npCost) + ' (при отриманні)');
  lines.push(
    '',
    'Замовник: ' + esc(clean(d.name)),
    'Телефон: ' + esc(clean(d.phone))
  );
  if (d.recipientOther) lines.push('Отримувач: ' + esc(clean(d.recipientName)) + ', ' + esc(clean(d.recipientPhone)));
  lines.push('Доставка: ' + esc(clean(d.delivery || d.zone)));
  if (d.address) lines.push('Адреса: ' + esc(clean(d.address)));
  if (d.city) lines.push('Місто: ' + esc(clean(d.city)));
  if (d.branch) lines.push('Відділення: ' + esc(clean(d.branch)));
  if (d.payment) lines.push('Оплата: ' + esc(clean(d.payment)));
  if (d.gift) lines.push('<b>Подарунок — не вкладати чек</b>');
  if (d.comment) lines.push('Коментар: ' + esc(clean(d.comment)));

  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML' }),
    muteHttpExceptions: true
  });
}

/* Запустіть один раз після того, як написали боту: покаже chat_id у журналі */
function findChatId() {
  const token = PropertiesService.getScriptProperties().getProperty('TG_TOKEN');
  if (!token) throw new Error('Спершу додайте властивість TG_TOKEN');
  const res = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates').getContentText());
  const chats = {};
  (res.result || []).forEach(function (u) {
    const m = u.message || u.channel_post || u.my_chat_member;
    if (m && m.chat) chats[m.chat.id] = m.chat.title || m.chat.username || m.chat.first_name;
  });
  console.log(Object.keys(chats).length ? chats : 'Повідомлень немає — напишіть боту й запустіть ще раз');
}

/* Тестове замовлення: перевіряє таблицю й Telegram без сайту */
function testOrder() {
  const res = doPost({ postData: { contents: JSON.stringify({
    id: 'TEST-1', name: 'Тестенко Тест', phone: '+380000000000',
    deliveryId: 'np_branch', delivery: 'Нова Пошта: відділення', city: 'м. Львів, Львівська обл.', branch: 'Відділення №1: вул. Городоцька, 359',
    payment: 'Передоплата за реквізитами ФОП', npCost: 148, gift: true,
    items: [{ name: 'Філе лосося охолоджене, 1,5–1,7 кг', qty: 1, unit: 'шт', sum: 1870 }],
    goods: 1870, fee: 0, feeName: 'Термопакування', total: 1870, comment: 'перевірка'
  }) } });
  console.log(res.getContent());
}

function itemsText(items) {
  return (items || []).slice(0, 50).map(function (it) {
    return '• ' + clean(it.name, 80) + ' — ' + Number(it.qty) + ' ' + clean(it.unit, 10) + ', ' + (it.approx ? '≈ ' : '') + money(it.sum);
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
