/* 把一套新科目的图片挖空卡追加进已合并的 导入_图像卡.json（按图片路径去重，幂等）
 * 用法: node tools/append_imgcard_deck.js 导入_生化图像卡.json 生物化学
 * 之后运行 node tools/h5-images-to-oss.js 切 OSS 地址并重新生成 bundled_imagecards.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const [deckFile, subject] = process.argv.slice(2);
if (!deckFile || !subject) {
  console.error('用法: node tools/append_imgcard_deck.js <卡组.json> <科目名>');
  process.exit(1);
}

const mergedPath = path.join(ROOT, '导入_图像卡.json');
const merged = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
const cards = JSON.parse(fs.readFileSync(path.join(ROOT, deckFile), 'utf8'));

cards.forEach(c => {
  c.subject = subject;
  c.question = '[看图记忆卡] ' + subject + (c.chapter ? '·' + c.chapter : '');
});

const seen = new Set(merged.map(c => c.image));
let added = 0;
for (const c of cards) {
  if (seen.has(c.image)) continue;
  seen.add(c.image);
  merged.push(c);
  added++;
}

let miss = 0;
merged.forEach(c => {
  if (!/^https?:\/\//.test(c.image) && !fs.existsSync(path.join(ROOT, c.image))) miss++;
});

fs.writeFileSync(mergedPath, JSON.stringify(merged, null, 2));
const subDist = {};
merged.forEach(c => subDist[c.subject] = (subDist[c.subject] || 0) + 1);
console.error(deckFile + ': ' + cards.length + ' 张，新增 ' + added + ' 张');
console.error('合并后: ' + merged.length + ' 张，缺本地图片: ' + miss);
console.error('科目分布: ' + JSON.stringify(subDist));