/* 合并四套图片挖空卡 → 统一的 导入_图像卡.json + js/bundled_imagecards.js */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const groups = [
  { file: '导入_图像卡.json',    subject: '外科学' },
  { file: '导入_卡组_生理学.json', subject: '生理学' },
  { file: '导入_卡组_病理学.json', subject: '病理学' },
  { file: '导入_卡组_内科学.json', subject: '内科学' }
];
let all = [];
for (const g of groups) {
  const p = path.join(ROOT, g.file);
  if (!fs.existsSync(p)) { console.error('跳过(不存在): ' + g.file); continue; }
  const cards = JSON.parse(fs.readFileSync(p, 'utf8'));
  cards.forEach(c => {
    c.subject = g.subject;
    c.question = '[看图记忆卡] ' + g.subject + (c.chapter ? '·' + c.chapter : '');
  });
  all = all.concat(cards);
  console.error(g.subject + ': ' + cards.length + ' 张');
}
const seen = new Set(); const merged = [];
for (const c of all) { if (!seen.has(c.image)) { seen.add(c.image); merged.push(c); } }
console.error('合并后(去重): ' + merged.length + ' 张');
let miss = 0;
merged.forEach(c => { if (!fs.existsSync(path.join(ROOT, c.image))) miss++; });
console.error('缺图片: ' + miss);
const subDist = {};
merged.forEach(c => subDist[c.subject] = (subDist[c.subject] || 0) + 1);
console.error('科目分布: ' + JSON.stringify(subDist));
fs.writeFileSync(path.join(ROOT, '导入_图像卡.json'), JSON.stringify(merged, null, 2));
const js = '/* 自动生成的图片挖空卡，app 首次启动自动导入（一次） */\nwindow.TTBundledImageCards = ' + JSON.stringify(merged) + ';\n';
fs.writeFileSync(path.join(ROOT, 'js', 'bundled_imagecards.js'), js);
console.error('已生成 js/bundled_imagecards.js (' + Math.round(js.length / 1024) + ' KB)');
