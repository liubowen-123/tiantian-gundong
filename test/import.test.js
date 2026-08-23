/* 题库 CSV 导入解析测试（Node 环境，模拟 localStorage） */
const fs = require('fs');
const path = require('path');

const _store = {};
global.localStorage = {
  getItem: k => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: k => { delete _store[k]; }
};
global.window = global;

const src = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
eval(src('js/storage.js'));

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}

console.log('== 1. 带表头：选择题 + 记忆卡 ==');
let csv = [
  'type,subject,question,optionA,optionB,optionC,optionD,answer,explain',
  'quiz,生理学,问1?,A项,B项,C项,D项,A,解1',
  'card,生物化学,正面?,,,,,,背面答案'
].join('\n');
let r = TTStore.parseCsv(csv);
assert(r.total === 2, '解析出 2 条');
assert(r.items[0].type === 'quiz' && r.items[0].subject === '生理学' && r.items[0].answer === 0, '选择题：type/科目/答案A=0');
assert(r.items[0].options.join('|') === 'A项|B项|C项|D项', '选择题 4 项');
assert(r.items[1].type === 'card' && r.items[1].question === '正面?' && r.items[1].explain === '背面答案', '记忆卡：card/正面/背面');

console.log('== 2. answer 各种写法 ==');
csv = 'type,subject,question,optionA,optionB,optionC,optionD,answer,explain\n'
  + 'quiz,生理学,问,a,b,c,d,A,x\nquiz,生理学,问,a,b,c,d,1,x\nquiz,生理学,问,a,b,c,d,4,x\nquiz,生理学,问,a,b,c,d,c,x\n';
r = TTStore.parseCsv(csv);
assert(r.items[0].answer === 0, 'answer=A → 0');
assert(r.items[1].answer === 0, 'answer=1 → 0');
assert(r.items[2].answer === 3, 'answer=4 → 3');
assert(r.items[3].answer === 2, 'answer=c → 2');

console.log('== 3. 引号字段（含逗号） ==');
csv = 'type,subject,question,optionA,optionB,optionC,optionD,answer,explain\n'
  + 'quiz,生理学,"问,含逗号?",A,B,C,D,A,解析\n';
r = TTStore.parseCsv(csv);
assert(r.items[0].question === '问,含逗号?', '引号内逗号被正确处理');
assert(r.items[0].options.length === 4, '选项 4 项');

console.log('== 4. 无表头（纯题库） ==');
csv = '生理学,问2?,A,B,C,D,B,解2s\n生理学,问3?,甲,乙,丙,丁,C,解3\n';
r = TTStore.parseCsv(csv);
assert(r.total === 2, '无表头解析 2 条');
assert(r.items[0].subject === '生理学' && r.items[0].answer === 1, '无表头第二列是题干，B=1');
assert(r.items[1].answer === 2, '无表头 C=2');

console.log('== 5. 错误行被跳过 ==');
csv = 'type,subject,question,optionA,optionB,optionC,optionD,answer,explain\n'
  + 'quiz,生理学,,A,B,C,D,A,无题干,x\n'
  + 'quiz,生理学,选项不足,A,,,,A,解析\n'
  + 'quiz,生理学,正常?,A,B,C,D,B,ok\n';
r = TTStore.parseCsv(csv);
assert(r.total === 1 && r.items[0].question === '正常?', '跳过无题干/选项不足行，只留 1 条');
assert(r.errors.length >= 2, '记录错误信息');

console.log('== 6. 批量入库 ==');
TTStore.resetAll();
TTStore.bulkAdd([{ type: 'quiz', subject: 'X', question: 'q?', options: ['a', 'b', 'c', 'd'], answer: 0 }]);
assert(TTStore.getContent().length === 1, 'bulkAdd 入库 1 条');

console.log('== 7. 章节列 ==');
csv = 'type,subject,chapter,question,optionA,optionB,optionC,optionD,answer,explain\n'
  + 'quiz,生理学,血液循环,心输出量?,a,b,c,d,B,x\n'
  + 'card,生物化学,糖代谢,糖原?,,,,,,解析\n';
r = TTStore.parseCsv(csv);
assert(r.items[0].chapter === '血液循环', '选择题解析章节');
assert(r.items[1].chapter === '糖代谢', '记忆卡解析章节');
assert(r.items[0].subject === '生理学' && r.items[1].subject === '生物化学', '科目正确');

console.log('== 8. Anki 导出解析 ==');
let ak = 'Front\tBack\tTags\nq1\ta1\t生理学 血液循环\nq2\ta2\t生理学 神经-肌肉\n';
let r2 = TTStore.parseAnki(ak);
assert(r2.total === 2, 'Anki 带表头 2 条');
assert(r2.items[0].type === 'card' && r2.items[0].question === 'q1' && r2.items[0].explain === 'a1', 'Anki 正面/背面映射');
assert(r2.items[0].subject === '生理学' && r2.items[0].chapter === '血液循环', '标签→科目/章节');
assert(r2.items[1].chapter === '神经-肌肉', '第 2 个标签→章节');

ak = 'q3\ta3\nq4\ta4\n';
r2 = TTStore.parseAnki(ak);
assert(r2.items[0].question === 'q3' && r2.items[0].subject === '未分类', '无表头按位置解析');

ak = 'Front\tBack\nQ1\tA1\n';
r2 = TTStore.parseAnki(ak, { subject: '生理学', chapter: '血液' });
assert(r2.items[0].subject === '生理学' && r2.items[0].chapter === '血液', '固定科目/章节');

ak = 'Front\tBack\n\tA\nQ2\tA2\n';
r2 = TTStore.parseAnki(ak);
assert(r2.total === 1 && r2.items[0].question === 'Q2', '缺正面跳过');

console.log('== 9. bulkAdd 大批量（O(n) 一次性写入） ==');
TTStore.resetAll();
const many = [];
for (let i = 0; i < 3000; i++) many.push({ type: 'quiz', subject: 'X', question: 'q' + i, options: ['a', 'b', 'c', 'd'], answer: 0 });
const t0 = Date.now();
const n = TTStore.bulkAdd(many);
const dt = Date.now() - t0;
assert(n === 3000 && TTStore.getContent().length === 3000, 'bulkAdd 3000 条成功');
assert(dt < 5000, 'bulkAdd 3000 条耗时 < 5s（实际 ' + dt + 'ms）');

console.log('\n================');
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
