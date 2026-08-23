/* 新增功能测试（Node 环境，模拟 localStorage）：
   模式过滤 / 明日到期 / 每日记录 / 错题本 / 科目进度 / 掌握度 / 考试存储 */
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
eval(src('js/scheduler.js'));
eval(src('js/anki.js'));
eval(src('js/data.js'));
eval(src('js/bundled_imagecards.js'));

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}

TTStore.resetAll();
TTSeed.seed();
TTAnki.migrate();

console.log('== 1. 模式过滤 ==');
let qz = TTScheduler.todayQueue('quiz');
let cd = TTScheduler.todayQueue('card');
assert(qz.due.length === 0 && qz.fresh.length === 10, '刷题模式新学 10 条');
assert(cd.due.length === 0 && cd.fresh.length === 10, 'Anki 模式新学 10 条');
assert(qz.fresh.every(x => x.type === 'quiz'), '刷题队列全为选择题');
assert(cd.fresh.every(x => x.type === 'card'), 'Anki 队列全为记忆卡');

console.log('== 2. 学习后明日到期 ==');
const quiz1 = qz.fresh[0];
TTScheduler.learnItem(quiz1.id, 'ok');
assert(TTScheduler.tomorrowDueCount() >= 1, '明日到期数 ≥ 1');

console.log('== 3. 每日记录 ==');
const rec = TTScheduler.dailyRecord();
assert(rec.todayCount >= 1, '今日题数 ≥ 1');
assert(rec.recordedDays >= 1, '已记录天数 ≥ 1');

console.log('== 4. 错题本 ==');
let quiz2 = TTScheduler.subjectQuizQueue('生理学').find(x => x.id !== quiz1.id);
TTScheduler.learnItem(quiz2.id, 'wrong');
const book = TTScheduler.wrongBook();
assert(book.length >= 1, '错题本 ≥1');
assert(book.some(x => x.id === quiz2.id), '答错条目进入错题本');
assert(book[0].wrongCount >= 1, '错题计数 ≥1');
assert(TTScheduler.wrongTodayCount() >= 0, '今日错题数可计算');

console.log('== 5. 科目刷题进度 ==');
const stats = TTScheduler.subjectQuizStats();
const phys = stats.find(s => s.subject === '生理学');
assert(phys && phys.total === 2, '生理学选择题 2 题');
assert(phys.done >= 1, '生理学已完成 ≥1（至少学过一个）');

console.log('== 6. 科目队列 ==');
const qq = TTScheduler.subjectQuizQueue('生理学');
assert(qq.length === 2 && qq.every(x => x.type === 'quiz' && x.subject === '生理学'), '科目队列=生理学2题且全为选择题');

console.log('== 7. 掌握度 ==');
const mastery = TTScheduler.subjectMastery();
assert(mastery.length >= 1, '掌握度含科目');
assert(mastery.every(m => typeof m.pct === 'number'), '掌握度 pct 为数字');

console.log('== 8. 考试存储 ==');
TTStore.addExam({ date: TTStore.todayStr(), total: 20, correct: 15, pct: 75, seconds: 500 });
assert(TTStore.getExam().length === 1, '考试记录已存');
assert(TTStore.getExam()[0].pct === 75, '考试记录正确');

console.log('== 9. 收藏与笔记字段 ==');
const it = TTStore.addContent({ type: 'quiz', subject: 'X', question: 'q?', options: ['a', 'b', 'c', 'd'], answer: 0 });
assert(it.fav === false && it.note === '', '默认 fav=false note=""');
TTStore.updateContent(it.id, { fav: true, note: '易错' });
const got = TTStore.getById(it.id);
assert(got.fav === true && got.note === '易错', '收藏/笔记可写回');

console.log('== 10. 科目→章节层级 ==');
TTStore.resetAll();
TTSeed.seed();
TTAnki.migrate();
const chs = TTScheduler.subjectChapters('生理学');
assert(chs.length >= 2, '生理学含多个章节');
assert(chs.indexOf('血液循环') >= 0, '含「血液循环」章节');
const cstats = TTScheduler.chapterQuizStats('生理学');
assert(cstats.some(c => c.chapter === '血液' && c.total === 1), '血液章节 1 题');
assert(cstats.some(c => c.chapter === '血液循环' && c.total === 1), '血液循环章节 1 题');
const cq = TTScheduler.chapterQuizQueue('生理学', '血液循环');
assert(cq.length === 1 && cq[0].question.indexOf('心输出量') >= 0, '血液循环章节队列正确');
TTStore.addContent({ type: 'quiz', subject: '生理学', chapter: '', question: '无章节题?', options: ['a', 'b', 'c', 'd'], answer: 0 });
assert(TTScheduler.subjectChapters('生理学').indexOf('未分章') >= 0, '空章节归入「未分章」');

console.log('== 11. 图片挖空卡字段 ==');
const imgIt = TTStore.addContent({ type: 'card', subject: '外科学', chapter: '骨科', image: 'images/x.png', masks: [[0.4, 0.1, 0.2, 0.02], [0.5, 0.3, 0.1, 0.04]] });
assert(imgIt.image === 'images/x.png' && imgIt.masks.length === 2, '图片卡 image/masks 字段保留');
assert(TTScheduler.isGraduated(imgIt) === false, '图片卡归为 card 类型');
const qImg = TTScheduler.todayQueue('card');
assert(!qImg.fresh.some(x => x.id === imgIt.id), '图片卡进入新学队列（card）');

console.log('== 12. 内置图片挖空卡自动导入 ==');
if (window.TTBundledImageCards && window.TTBundledImageCards.length > 100) {
  const before = TTStore.getContent().length;
  TTStore.bulkAdd(window.TTBundledImageCards);
  TTAnki.migrate();
  const after = TTStore.getContent().length;
  assert(after - before >= 100, '批量导入内置图片挖空卡（' + (after - before) + ' 张）');
  const joined = TTStore.getContent().filter(c => c.type === 'card' && c.masks && c.masks.length);
  assert(joined.length >= 100, '图片挖空卡数量 ≥ 100');
  assert(joined.every(c => c.anki && c.anki.state === 'new'), '所有图片卡均有 Anki 新卡状态');
  assert(TTScheduler.newItems('card').length >= 1, '图片卡进入 Anki 新学队列');
  assert(TTScheduler.imageCards().length >= 100, 'imageCards() 返回全部图片挖空卡');
  const chs0 = TTScheduler.imageChapters();
  assert(chs0.length >= 1 && chs0[0].subject, 'imageChapters() 返回带科目的章节清单');
  const one = chs0[0];
  assert(TTScheduler.imageCards([{ subject: one.subject, chapter: one.chapter }]).length === one.count, '按科目+章节筛选数量正确');
  assert(TTScheduler.imageCards([]).length === TTScheduler.imageCards().length, '空筛选=全部');
} else {
  assert(false, '未加载内置图片挖空卡数据');
}

console.log('== 13. 年份筛选 & 多选答案 ==');
TTStore.addContent({ type: 'quiz', subject: 'X', year: 2020, question: '2020题?', options: ['a', 'b', 'c', 'd'], answer: 0 });
TTStore.addContent({ type: 'quiz', subject: 'X', year: 2021, question: '2021题?', options: ['a', 'b', 'c', 'd'], answer: 1 });
const yrs = TTScheduler.quizYears();
assert(yrs.length >= 2, 'quizYears 列出年份');
assert(TTScheduler.quizByYears([2020]).length === 1 && TTScheduler.quizByYears([2020])[0].year === 2020, 'quizByYears 按年筛选');
assert(TTScheduler.quizByYears([]).length === TTScheduler.quizByYears().length, '空年份=全部');
const m = TTStore.addContent({ type: 'quiz', subject: 'X', year: 2020, question: '多选?', options: ['a', 'b', 'c', 'd'], answer: [0, 2] });
const m2 = TTStore.getById(m.id);
assert(Array.isArray(m2.answer) && m2.answer.length === 2, '多选答案数组可持久化');

console.log('\n================');
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
