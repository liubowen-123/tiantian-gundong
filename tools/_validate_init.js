/* 模拟 app 初始化：导入内置图片卡并全面校验 */
'use strict';
const fs = require('fs');
const path = require('path');
const _store = {};
global.localStorage = { getItem: k => (k in _store ? _store[k] : null), setItem: (k, v) => { _store[k] = String(v); }, removeItem: k => { delete _store[k]; } };
global.window = global;
const src = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
eval(src('js/storage.js'));
eval(src('js/scheduler.js'));
eval(src('js/anki.js'));
eval(src('js/data.js'));
eval(src('js/bundled_imagecards.js'));

const ROOT = path.join(__dirname, '..');
console.log('TTBundledImageCards 加载?', Array.isArray(window.TTBundledImageCards), '长度', window.TTBundledImageCards ? window.TTBundledImageCards.length : 'N/A');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

TTSeed.seed();
TTStore.bulkAdd(window.TTBundledImageCards);
TTAnki.migrate();
const content = TTStore.getContent();
console.log('content 总数:', content.length);
ok(content.length >= 210, '导入后内容总数 ≥ 210（实际 ' + content.length + '）');

const imgCards = content.filter(c => c.masks && c.masks.length);
console.log('图片挖空卡数量:', imgCards.length);
ok(imgCards.length >= 190, '图片挖空卡 ≥ 190');

// 每张卡图片是否存在、masks 是否规范
let badImg = 0, badMask = 0, noAnki = 0, dup = 0;
const seenImg = new Set();
for (const c of imgCards) {
  if (c.type !== 'card') { badImg++; continue; }
  const p = path.join(ROOT, c.image || '');
  if (!fs.existsSync(p)) { badImg++; if (badImg <= 8) { console.error('   缺文件: ' + c.image); } }
  if (!Array.isArray(c.masks) || !c.masks.every(b => Array.isArray(b) && b.length === 4 && b.every(n => typeof n === 'number'))) { badMask++; if (badMask <= 5) console.error('   masks 异常: ' + c.question + ' masks=' + JSON.stringify(c.masks).slice(0, 60)); }
  if (!c.anki || !c.anki.state) noAnki++;
  const key = c.subject + '|' + c.chapter + '|' + c.image;
  if (seenImg.has(key)) dup++; seenImg.add(key);
}
console.log('缺图片:', badImg, '| masks 异常:', badMask, '| 无 anki:', noAnki, '| 重复(subject+chapter+image):', dup);
ok(badImg === 0, '全部图片文件存在');
ok(badMask === 0, '全部 masks 规范 [x,y,w,h]');
ok(noAnki === 0, '全部图片卡有 anki 状态');

// 新学队列（模拟今日）
const q = TTScheduler.todayQueue('card');
console.log('card 模式今日队列: total=' + q.total + ' fresh=' + q.fresh.length);
ok(q.fresh.length >= 1, '图片卡进入今日 Anki 新学队列');

// 统计科目章节分布
const subs = {};
imgCards.forEach(c => subs[c.subject] = (subs[c.subject] || 0) + 1);
console.log('科目分布:', JSON.stringify(subs));
console.log('章节数:', new Set(imgCards.map(c => c.chapter)).size);
console.log('\n==== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ====');
process.exit(fail > 0 ? 1 : 0);
