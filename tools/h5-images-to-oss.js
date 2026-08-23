/* H5 图片卡数据切到阿里云 OSS 地址 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const BASE = 'https://ttgd-images.oss-cn-hongkong.aliyuncs.com';

const src = path.join(ROOT, '导入_图像卡.json');
const cards = JSON.parse(fs.readFileSync(src, 'utf8'));
let changed = 0;
cards.forEach(c => {
  if (c.image && !/^https?:\/\//.test(c.image)) {
    c.image = BASE + '/' + c.image.replace(/^\.?\//, '');
    changed++;
  }
});
fs.writeFileSync(src, JSON.stringify(cards, null, 2));
const js = '/* 自动生成的图片挖空卡，app 首次启动自动导入（一次） */\nwindow.TTBundledImageCards = ' + JSON.stringify(cards) + ';\n';
fs.writeFileSync(path.join(ROOT, 'js', 'bundled_imagecards.js'), js);
console.error('已切换 ' + changed + ' 张图片到 OSS，并重新生成 bundled_imagecards.js');
