/* 生成小程序分包题库：每科数据 + 同包导入页（explain 120 字，每包<2MB） */
'use strict';
const fs = require('fs');
const path = require('path');
const MP = 'D:/harness/tiantian-gundong-mp';
const Q = 'D:/harness/qbank/data/questions.json';

const SUBJ = {
  '内科学':   { root: 'pkg-a',      file: 'data/neike.js',    pinyin: 'neike' },
  '外科学':   { root: 'pkg-b',      file: 'data/waike.js',    pinyin: 'waike' },
  '生理学':   { root: 'pkg-c',      file: 'data/shengli.js',  pinyin: 'shengli' },
  '病理学':   { root: 'pkg-qbank',  file: 'data/bingli.js',   pinyin: 'bingli' },
  '生物化学': { root: 'pkg-qbank',  file: 'data/shenghua.js', pinyin: 'shenghua' },
  '人文精神': { root: 'pkg-qbank',  file: 'data/renwen.js',   pinyin: 'renwen' }
};
const PACKAGE_SUBJECTS = {
  'pkg-a': ['内科学'],
  'pkg-b': ['外科学'],
  'pkg-c': ['生理学'],
  'pkg-qbank': ['病理学', '生物化学', '人文精神']
};

const qbank = JSON.parse(fs.readFileSync(Q, 'utf8'));
const bySub = {};
for (const x of qbank) {
  const keys = x.options ? Object.keys(x.options) : [];
  const opts = x.options ? Object.values(x.options) : [];
  if (!x.stem || opts.length < 2) continue;
  let ans;
  if (x.qtype === 'X') {
    ans = String(x.answer || '').split('').map(L => keys.indexOf(L)).filter(i => i >= 0);
    if (!ans.length) continue;
  } else {
    ans = keys.indexOf(x.answer);
    if (ans < 0) continue;
  }
  (bySub[x.subject] = bySub[x.subject] || []).push({
    type: 'quiz', subject: x.subject, chapter: x.chapter || '', year: x.year || null,
    question: x.stem, options: opts, answer: ans, explain: (x.analysis || '').slice(0, 120)
  });
}

/* 1) 数据文件 */
for (const s of Object.keys(SUBJ)) {
  const items = bySub[s] || [];
  const js = '// 自动生成：' + s + '（' + items.length + ' 题）\nmodule.exports = ' + JSON.stringify(items) + ';\n';
  const out = path.join(MP, SUBJ[s].root, SUBJ[s].file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, js);
  console.error(s + ': ' + items.length + ' 题, ' + (Buffer.byteLength(js, 'utf8') / 1048576).toFixed(2) + ' MB');
}

/* 2) 每个分包一个导入页（同包静态 require） */
for (const root of Object.keys(PACKAGE_SUBJECTS)) {
  const subs = PACKAGE_SUBJECTS[root];
  const requireLines = subs.map(s => `  '${s}': require('../../data/${SUBJ[s].pinyin}.js')`).join(',\n');
  const js = `const TTStore = require('../../../utils/storage.js');
const TTAnki = require('../../../utils/anki.js');
const theme = require('../../../utils/theme.js');
/* 同包静态 require（微信不允许跨分包 / 动态 require） */
const DATA = {
${requireLines}
};
const SUBJECTS = ${JSON.stringify(subs)};

Page({
  data: { dark: false, list: [], importing: false },
  onShow() { theme.apply(this); this.refresh(); },
  refresh() {
    const imported = importedList();
    this.setData({
      list: SUBJECTS.map(s => ({
        subject: s,
        count: DATA[s].length,
        done: imported.indexOf(s) >= 0
      }))
    });
  },
  importNow(e) {
    const subj = e.currentTarget.dataset.subject;
    if (this.data.importing) return;
    const imported = importedList();
    if (imported.indexOf(subj) >= 0) { wx.showToast({ title: '已导入过', icon: 'none' }); return; }
    this.setData({ importing: true });
    wx.showLoading({ title: '导入' + subj + '…' });
    try {
      const items = DATA[subj];
      TTStore.bulkAdd(items);
      imported.push(subj);
      wx.setStorageSync('ttgd.qbank.v1', JSON.stringify(imported));
      TTAnki.migrate();
      wx.hideLoading();
      wx.showToast({ title: '已导入 ' + items.length + ' 题', icon: 'success' });
      this.refresh();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '导入失败：' + err.message, icon: 'none' });
    }
    this.setData({ importing: false });
  },
  back() { wx.navigateBack(); }
});
function importedList() {
  try { return JSON.parse(wx.getStorageSync('ttgd.qbank.v1') || '[]'); } catch (e) { return []; }
}
`;
  const dir = path.join(MP, root, 'pages', 'import');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'import.js'), js);
  fs.writeFileSync(path.join(dir, 'import.json'), JSON.stringify({ navigationBarTitleText: '真题导入' }, null, 2));
  fs.writeFileSync(path.join(dir, 'import.wxml'), `<view class="page {{dark?'dark':''}}">
  <view class="card">
    <view class="card-title">题库导入</view>
    <view class="muted">点科目即导入到本地存储（约 10MB 上限）。导入后可在「练习 → 按科目刷题」使用，含多选与年份。</view>
  </view>
  <view wx:for="{{list}}" wx:key="subject" class="subj-item" data-subject="{{item.subject}}" bindtap="importNow">
    <view class="flex1">
      <view class="subj-name">{{item.subject}}</view>
      <view class="subj-count">{{item.count}} 题</view>
    </view>
    <view class="subj-state {{item.done?'ok':'go'}}">{{item.done ? '已导入 ✓' : '导入'}}</view>
  </view>
  <view class="btn-ghost" style="margin-top:24rpx" bindtap="back">返回</view>
</view>
`);
  fs.writeFileSync(path.join(dir, 'import.wxss'), `.subj-item{display:flex;align-items:center;background:#fff;border-radius:24rpx;padding:26rpx;margin-bottom:18rpx;box-shadow:0 6rpx 24rpx rgba(31,59,48,.06);}
.subj-name{font-size:30rpx;font-weight:700;}
.subj-count{font-size:24rpx;color:#98a8a0;margin-top:4rpx;}
.subj-state{font-size:26rpx;padding:10rpx 26rpx;border-radius:999rpx;}
.subj-state.go{background:linear-gradient(135deg,#2f8f6b,#38a97d);color:#fff;}
.subj-state.ok{background:#e8f6f0;color:#1f7a58;}
.page.dark .subj-item{background:var(--card);box-shadow:none;}
.page.dark .subj-name{color:var(--text);}
.page.dark .subj-count{color:#6e857a;}
`);
  console.error('导入页: ' + root + ' -> ' + subs.join(', '));
}

/* 3) 主包 题库大厅页 */
const hubDir = path.join(MP, 'pages', 'qbankhub');
fs.mkdirSync(hubDir, { recursive: true });
const hubJs = `const TTStore = require('../../utils/storage.js');
const theme = require('../../utils/theme.js');
const SUBJECTS = ${JSON.stringify(Object.keys(SUBJ).map(s => ({ subject: s, count: (bySub[s] || []).length, pkg: SUBJ[s].root })))};

Page({
  data: { dark: false, list: [], total: 0 },
  onShow() { theme.apply(this); this.refresh(); },
  refresh() {
    const imported = (() => { try { return JSON.parse(wx.getStorageSync('ttgd.qbank.v1') || '[]'); } catch (e) { return []; } })();
    this.setData({
      list: SUBJECTS.map(s => ({
        subject: s.subject, count: s.count, pkg: s.pkg,
        done: imported.indexOf(s.subject) >= 0
      })),
      total: SUBJECTS.reduce((a, s) => a + s.count, 0)
    });
  },
  go(e) {
    wx.navigateTo({ url: '/' + e.currentTarget.dataset.pkg + '/pages/import/import' });
  },
  back() { wx.switchTab({ url: '/pages/practice/practice' }); }
});
`;
fs.writeFileSync(path.join(hubDir, 'qbankhub.js'), hubJs);
fs.writeFileSync(path.join(hubDir, 'qbankhub.json'), JSON.stringify({ navigationBarTitleText: '真题题库' }, null, 2));
fs.writeFileSync(path.join(hubDir, 'qbankhub.wxml'), `<view class="page {{dark?'dark':''}}">
  <view class="card">
    <view class="card-title">306 西综真题（共 {{total}} 题 · 单选+多选+年份）</view>
    <view class="muted">按科目分包内置。点科目进入导入页，写入本地存储后即可刷题。</view>
  </view>
  <view wx:for="{{list}}" wx:key="subject" class="subj-item" data-pkg="{{item.pkg}}" bindtap="go">
    <view class="flex1">
      <view class="subj-name">{{item.subject}}</view>
      <view class="subj-count">{{item.count}} 题</view>
    </view>
    <view class="subj-state {{item.done?'ok':'go'}}">{{item.done ? '已导入 ✓' : '去导入'}}</view>
  </view>
  <view class="btn-ghost" style="margin-top:24rpx" bindtap="back">返回练习中心</view>
</view>
`);
fs.writeFileSync(path.join(hubDir, 'qbankhub.wxss'), `.subj-item{display:flex;align-items:center;background:#fff;border-radius:24rpx;padding:26rpx;margin-bottom:18rpx;box-shadow:0 6rpx 24rpx rgba(31,59,48,.06);}
.subj-name{font-size:30rpx;font-weight:700;}
.subj-count{font-size:24rpx;color:#98a8a0;margin-top:4rpx;}
.subj-state{font-size:26rpx;padding:10rpx 26rpx;border-radius:999rpx;}
.subj-state.go{background:linear-gradient(135deg,#2f8f6b,#38a97d);color:#fff;}
.subj-state.ok{background:#e8f6f0;color:#1f7a58;}
.page.dark .subj-item{background:var(--card);box-shadow:none;}
.page.dark .subj-name{color:var(--text);}
.page.dark .subj-count{color:#6e857a;}
`);
console.error('主包大厅页已生成');
