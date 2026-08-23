/* Anki 调度模块逻辑测试（Node 环境，模拟 localStorage） */
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

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}

function mkCard(over = {}) {
  const c = TTStore.addContent(Object.assign({
    type: 'card', subject: '测试', question: 'Q', explain: 'A'
  }, over));
  TTAnki.ensureAnki(c);
  return c;
}

const MIN = 60000, DAY = 86400000;
const now = Date.now();

console.log('== 1. 新卡首次学习 ==');
let c = mkCard();
TTAnki.learn(c, 'good');
assert(c.anki.state === 'learning', 'good → learning');
assert(c.anki.step === 0, 'step=0');
assert(Math.abs(c.anki.due - (now + 1 * MIN)) < 5000, 'good → 1 分钟后 (steps[0])');

c = mkCard();
TTAnki.learn(c, 'again');
assert(c.anki.state === 'learning' && c.anki.step === 0, 'again → learning step 0');
assert(c.anki.lapses === 0, '学习阶段 again 不计 lapses');
assert(c.lastResult === 'wrong' && c.lastReviewDate === TTStore.todayStr(), '顶层字段同步');

c = mkCard();
TTAnki.learn(c, 'easy');
assert(c.anki.state === 'review', 'easy → 直接毕业 review');
assert(c.anki.interval === 4, 'easy 间隔 = easyInterval(4天)');
assert(c.anki.ease > 2.5, 'easy 提升 ease');

console.log('== 2. 学习步骤推进 ==');
c = mkCard();
TTAnki.learn(c, 'good'); // step 0, due 1min
c.anki.due = Date.now(); // 模拟到期
TTAnki.learn(c, 'good'); // step 1, due 10min
assert(c.anki.step === 1, '第二次 good → step 1');
assert(Math.abs(c.anki.due - (Date.now() + 10 * MIN)) < 5000, 'due = 10 分钟后 (steps[1])');
c.anki.due = Date.now();
TTAnki.learn(c, 'good'); // 最后一步 → 毕业
assert(c.anki.state === 'review', '第三步 good → 毕业 review');
assert(c.anki.interval === 1, '毕业间隔 = 1 天');

console.log('== 3. review 间隔计算 ==');
c = mkCard();
c.anki.state = 'review'; c.anki.interval = 5; c.anki.due = Date.now();
TTAnki.learn(c, 'good');
assert(Math.abs(c.anki.interval - 5 * 2.5) < 0.01, 'good: interval × ease = 12.5');
assert(Math.abs(c.anki.ease - 2.5) < 0.01, 'good 不改 ease');

c = mkCard();
c.anki.state = 'review'; c.anki.interval = 5; c.anki.due = Date.now();
TTAnki.learn(c, 'hard');
assert(Math.abs(c.anki.interval - 6) < 0.01, 'hard: interval × 1.2 = 6');
assert(Math.abs(c.anki.ease - 2.5) < 0.01, 'hard 不改 ease');

c = mkCard();
c.anki.state = 'review'; c.anki.interval = 5; c.anki.due = Date.now();
TTAnki.learn(c, 'easy');
assert(Math.abs(c.anki.interval - 5 * 2.5 * 1.3) < 0.01, 'easy: interval × ease × bonus');
assert(c.anki.ease > 2.5, 'easy 提升 ease');

console.log('== 4. 遗忘 → 重学 ==');
c = mkCard();
c.anki.state = 'review'; c.anki.interval = 20; c.anki.ease = 2.5; c.anki.due = Date.now();
TTAnki.learn(c, 'again');
assert(c.anki.state === 'relearning', 'again → relearning');
assert(c.anki.lapses === 1, 'lapses +1');
assert(Math.abs(c.anki.ease - 2.3) < 0.01, 'ease -0.2 = 2.3');
assert(Math.abs(c.anki.due - (Date.now() + 1 * MIN)) < 5000, 'due = steps[0] 后');

console.log('== 5. ease 上下限 ==');
c = mkCard();
c.anki.state = 'review'; c.anki.interval = 10; c.anki.ease = 1.3; c.anki.due = Date.now();
TTAnki.learn(c, 'again');
assert(c.anki.ease === 1.3, 'ease 不低于 1.3');
c.anki.ease = 2.95; c.anki.state = 'review'; c.anki.interval = 10; c.anki.due = Date.now();
TTAnki.learn(c, 'easy');
assert(c.anki.ease === 3.0, 'ease 不高于 3.0');

console.log('== 6. 队列集成 ==');
TTStore.resetAll();
TTSeed.seed();
TTAnki.migrate();
const q0 = TTScheduler.todayQueue();
assert(q0.fresh.length === 10, '默认每日新学 10 条（含卡片）');
// 学习 1 张卡片 easy → 直接毕业
const card = TTScheduler.newItems().find(x => x.type === 'card');
TTScheduler.learnCard(card.id, 'easy');
const q1 = TTScheduler.todayQueue();
assert(q1.fresh.length === 9, '新学额度 -1，剩余 9');
assert(!q1.fresh.some(x => x.id === card.id), '已学习卡片不再出现在新学');
assert(TTScheduler.dayLog().newLearned === 1, '新学日志 +1');

console.log('== 7. 暂停 ==');
const card2 = TTScheduler.newItems().find(x => x.type === 'card');
TTAnki.ensureAnki(card2);
TTStore.updateContent(card2.id, { anki: Object.assign({}, card2.anki, { suspended: true }) });
const q2 = TTScheduler.todayQueue();
assert(!q2.fresh.some(x => x.id === card2.id), '暂停卡片不进入队列');

console.log('== 8. 卡片到期复习 ==');
const card3 = TTScheduler.newItems().find(x => x.type === 'card');
TTScheduler.learnCard(card3.id, 'good'); // learning, due +1min
TTStore.updateContent(card3.id, { anki: Object.assign({}, TTStore.getById(card3.id).anki, { due: Date.now() - 1000 }) });
const q3 = TTScheduler.todayQueue();
assert(q3.due.some(x => x.id === card3.id), '到期卡片进入复习队列');
assert(TTScheduler.dueItems().some(x => x.id === card3.id), 'dueItems 含卡片');

console.log('\n================');
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
