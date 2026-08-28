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

// 关闭间隔抖动，保证间隔断言确定性（fuzz 行为在 §9 单独验证）
TTStore.saveSettings({ anki: { fuzz: false } });

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
assert(c.anki.interval === 13, 'good: interval × ease = 12.5 → 取整 13 天');
assert(Math.abs(c.anki.ease - 2.5) < 0.01, 'good 不改 ease');

c = mkCard();
c.anki.state = 'review'; c.anki.interval = 5; c.anki.due = Date.now();
TTAnki.learn(c, 'hard');
assert(c.anki.interval === 6, 'hard: interval × 1.2 = 6 天');
assert(Math.abs(c.anki.ease - 2.5) < 0.01, 'hard 不改 ease');

c = mkCard();
c.anki.state = 'review'; c.anki.interval = 5; c.anki.due = Date.now();
TTAnki.learn(c, 'easy');
assert(c.anki.interval === 16, 'easy: interval × ease × bonus = 16.25 → 取整 16 天');
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
TTStore.saveSettings({ anki: { fuzz: false } });
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

console.log('== 9. 复习到期对齐日历天 ==');
c = mkCard();
c.anki.state = 'review'; c.anki.interval = 5; c.anki.due = Date.now();
TTAnki.learn(c, 'good'); // interval → 13 天
{
  const dueDate = new Date(c.anki.due);
  const expectDate = new Date();
  expectDate.setDate(expectDate.getDate() + 13);
  assert(dueDate.getHours() === 0 && dueDate.getMinutes() === 0 && dueDate.getSeconds() === 0,
    '到期时间为当地 0 点（而非当前时刻 +N×24h）');
  assert(dueDate.getFullYear() === expectDate.getFullYear() &&
    dueDate.getMonth() === expectDate.getMonth() &&
    dueDate.getDate() === expectDate.getDate(), '到期日 = 今天 + 间隔天数');
}

console.log('== 10. hard 最小间隔 +1 天 ==');
c = mkCard();
c.anki.state = 'review'; c.anki.interval = 1; c.anki.due = Date.now();
TTAnki.learn(c, 'hard');
assert(c.anki.interval === 2, 'interval=1 时 hard → 2 天（不低于原间隔 +1）');
c = mkCard();
c.anki.state = 'review'; c.anki.interval = 10; c.anki.due = Date.now();
TTAnki.learn(c, 'hard');
assert(c.anki.interval === 12, 'interval=10 时 hard → 12 天（×1.2 高于 +1）');

console.log('== 11. 间隔抖动 fuzz ==');
TTStore.saveSettings({ anki: { fuzz: true } });
{
  let inRange = true, allInt = true;
  for (let i = 0; i < 50; i++) {
    const fc = mkCard();
    fc.anki.state = 'review'; fc.anki.interval = 10; fc.anki.due = Date.now();
    TTAnki.learn(fc, 'good'); // 基准 25 天，span=±2 → [23, 27]
    if (fc.anki.interval < 23 || fc.anki.interval > 27) inRange = false;
    if (!Number.isInteger(fc.anki.interval)) allInt = false;
  }
  assert(inRange, '开启 fuzz 后 50 次评级间隔均在 [23, 27] 天');
  assert(allInt, '间隔均为整数天');
}
{
  let exact = true;
  for (let i = 0; i < 20; i++) {
    const fc = mkCard();
    fc.anki.state = 'review'; fc.anki.interval = 1; fc.anki.due = Date.now();
    TTAnki.learn(fc, 'good'); // 基准 round(2.5)=3 天，span=±1 → [2, 4]
    if (fc.anki.interval < 2 || fc.anki.interval > 4) exact = false;
  }
  assert(exact, '小间隔（基准 3 天）抖动范围 [2, 4] 天');
}
TTStore.saveSettings({ anki: { fuzz: false } });

console.log('== 12. 明日到期统计（含记忆卡） ==');
TTStore.resetAll();
TTStore.saveSettings({ anki: { fuzz: false } });
{
  const tomorrow = TTStore.addDays(TTStore.todayStr(), 1);
  const mkReviewCardAt = (dueTs) => {
    const cc = mkCard();
    cc.anki.state = 'review'; cc.anki.interval = 3; cc.anki.due = dueTs;
    TTStore.updateContent(cc.id, { anki: cc.anki });
    return cc;
  };
  const t0 = new Date(tomorrow + 'T00:00:00').getTime();
  mkReviewCardAt(t0);                    // 明天 0 点到期 → 计入
  mkReviewCardAt(t0 + 12 * 3600 * 1000); // 明天中午到期 → 计入
  mkReviewCardAt(t0 - 1000);             // 今晚 23:59 到期 → 属今日，不计入
  mkReviewCardAt(t0 + 25 * 3600 * 1000); // 后天才到期 → 不计入
  assert(TTScheduler.tomorrowDueCount() === 2, '明日到期 = 2（仅明天日历天内到期的 review 卡）');
}

console.log('\n================');
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
