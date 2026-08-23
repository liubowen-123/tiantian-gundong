/* 天天滚动 · 306 西综题库 (data/questions.json) → 小程序内置题库 js
   全部题型（A/B/U 单选 + X 多选），保留年份；解析截断 200 字；按科目分组。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const Q = path.join(ROOT, '..', 'qbank', 'data', 'questions.json');
if (!fs.existsSync(Q)) { console.error('未找到 ' + Q); process.exit(1); }
const all = JSON.parse(fs.readFileSync(Q, 'utf8'));

const bySub = {};
let total = 0, skipped = 0;
for (const x of all) {
  const keys = x.options ? Object.keys(x.options) : [];
  const opts = x.options ? Object.values(x.options) : [];
  if (!x.stem || opts.length < 2) { skipped++; continue; }
  let ans;
  if (x.qtype === 'X') {
    // 多选：answer 形如 "ACD" → 索引数组 [0,2,3]
    ans = String(x.answer || '').split('').map(L => keys.indexOf(L)).filter(i => i >= 0);
    if (!ans.length) { skipped++; continue; }
  } else {
    ans = keys.indexOf(x.answer);
    if (ans < 0) { skipped++; continue; }
  }
  const it = {
    type: 'quiz',
    subject: x.subject || '未分类',
    chapter: x.chapter || '',
    year: x.year || null,
    question: x.stem,
    options: opts,
    answer: ans,
    explain: (x.analysis || '').slice(0, 200)
  };
  (bySub[it.subject] = bySub[it.subject] || []).push(it);
  total++;
}
const js = '/* 自动生成的 306 西综真题题库（含多选 X 型与年份） */\nwindow.TTBundledQuestionBank = ' + JSON.stringify(bySub) + ';\n';
fs.writeFileSync(path.join(ROOT, 'js', 'bundled_questions.js'), js);
console.error('共 ' + total + ' 道（含多选），跳过 ' + skipped + ' 道');
Object.keys(bySub).forEach(s => {
  const b = Buffer.byteLength(JSON.stringify(bySub[s]), 'utf8');
  console.error('  ' + s + ': ' + bySub[s].length + ' 题, ' + (b / 1024 / 1024).toFixed(2) + ' MB');
});
console.error('已生成 js/bundled_questions.js (' + Math.round(js.length / 1024 / 1024 * 10) / 10 + ' MB)');
