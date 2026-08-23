/* 调度引擎逻辑测试（Node 环境，模拟 localStorage） */
const fs = require('fs');
const path = require('path');

// ---- 模拟浏览器环境 ----
const _store = {};
global.localStorage = {
  getItem: k => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: k => { delete _store[k]; }
};
global.window = global;

// ---- 加载源码 ----
const src = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
eval(src('js/storage.js'));
eval(src('js/scheduler.js'));
eval(src('js/data.js'));

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}

// ---- 测试 ----
console.log('== 1. 种子数据 ==');
TTSeed.seed();
const content = TTStore.getContent();
assert(content.length === 22, '种子内容 22 条，实际 ' + content.length);
assert(content.every(c => c.stage === -1), '全部为未学习状态');

console.log('== 2. 新学队列 ==');
let q = TTScheduler.todayQueue();
assert(q.fresh.length === 10, '每日新学默认 10 条，实际 ' + q.fresh.length);
assert(q.due.length === 0, '无到期复习');
assert(q.total === 10, '队列共 10 项');

console.log('== 3. 学习新学条目 ==');
const first = q.fresh[0];
let r = TTScheduler.learnItem(first.id, 'ok');
assert(r.isNew === true, '标记为新学');
assert(r.item.stage === 0, '新学后 stage=0');
assert(r.item.nextReview === TTStore.addDays(TTStore.todayStr(), 1), '次日首次复习');
const log = TTScheduler.dayLog();
assert(log.newLearned === 1, '今日新学计数 +1');

console.log('== 4. 复习推进间隔 ==');
// 模拟 1 天后：把 nextReview 改到今天
TTStore.updateContent(first.id, { nextReview: TTStore.todayStr() });
r = TTScheduler.learnItem(first.id, 'ok');
assert(r.item.stage === 1, '复习答对 stage=1');
assert(r.item.nextReview === TTStore.addDays(TTStore.todayStr(), 2), '第二次复习在 2 天后 (intervals[1])');

console.log('== 5. 答错 → 当天重刷 ==');
TTStore.updateContent(first.id, { nextReview: TTStore.todayStr() });
r = TTScheduler.learnItem(first.id, 'wrong');
assert(r.item.stage === 0, '答错回退到 stage=0');
assert(r.item.nextReview === TTStore.todayStr(), '答错当天重刷');
q = TTScheduler.todayQueue();
assert(q.due.some(x => x.id === first.id), '错题进入今日重刷队列');

console.log('== 6. 毕业 ==');
// 直接推进到 stage 5（intervals 长度 6，stage 5 答对 → 6 ≥ 6 → 毕业）
TTStore.updateContent(first.id, { stage: 5, nextReview: TTStore.todayStr() });
r = TTScheduler.learnItem(first.id, 'ok');
assert(r.graduated === true, '最后一个阶段答对后毕业');
assert(r.item.graduated === true, '条目标记 graduated');
q = TTScheduler.todayQueue();
assert(!q.due.some(x => x.id === first.id), '毕业条目不再进入队列');

console.log('== 7. 连续打卡 ==');
assert(TTScheduler.hasStudiedToday(), '今日已学习');
assert(TTScheduler.streak() >= 1, '连续打卡 ≥ 1 天');

console.log('== 8. 正确率 ==');
const acc = TTScheduler.accuracy();
assert(typeof acc === 'number', '正确率可计算: ' + acc + '%');

console.log('== 9. 今日进度 ==');
const prog = TTScheduler.todayProgress();
console.log('  进度: done=' + prog.done + ' total=' + prog.total + ' pct=' + prog.pct);

console.log('\n================');
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
