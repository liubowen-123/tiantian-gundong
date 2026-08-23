/* 把 导入_图像卡.json 转成 app 首启自动导入的 js 文件 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', '导入_图像卡.json');
const out = path.join(__dirname, '..', 'js', 'bundled_imagecards.js');
const cards = JSON.parse(fs.readFileSync(src, 'utf8'));
const js = '/* 自动生成的图片挖空卡，app 首次启动自动导入（一次） */\nwindow.TTBundledImageCards = ' + JSON.stringify(cards) + ';\n';
fs.writeFileSync(out, js);
console.error('已生成 ' + out + '（' + cards.length + ' 张卡，' + Math.round(js.length / 1024) + ' KB）');
console.log(out);
