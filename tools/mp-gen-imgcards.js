/* 生成小程序看图挖空卡数据（本地预览版：图片指向 127.0.0.1:8341） */
'use strict';
const fs = require('fs');
const path = require('path');
const MP = 'D:/harness/tiantian-gundong-mp';
const SRC = 'D:/harness/tiantian-gundong/导入_图像卡.json';
const BASE = 'https://ttgd-images.oss-cn-hongkong.aliyuncs.com';

const cards = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const items = cards.map(c => ({
  type: 'card',
  subject: c.subject,
  chapter: c.chapter || '',
  image: BASE + '/' + c.image,
  masks: c.masks || [],
  question: c.question || ('[看图记忆卡] ' + (c.subject || '')),
  explain: ''
}));

const dataJs = '// 自动生成看图挖空卡（' + items.length + ' 张，本地预览地址）\nmodule.exports = ' + JSON.stringify(items) + ';\n';
const dataDir = path.join(MP, 'pkg-img', 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'imagecards.js'), dataJs);
console.error('图片卡数据: ' + items.length + ' 张, ' + (Buffer.byteLength(dataJs, 'utf8') / 1048576).toFixed(2) + ' MB');

/* 导入页（同包静态 require） */
const pageDir = path.join(MP, 'pkg-img', 'pages', 'import');
fs.mkdirSync(pageDir, { recursive: true });
const pageJs = `const TTStore = require('../../../utils/storage.js');
const TTAnki = require('../../../utils/anki.js');
const theme = require('../../../utils/theme.js');
const DATA = require('../../data/imagecards.js');

Page({
  data: { dark: false, count: DATA.length, done: false, importing: false },
  onShow() { theme.apply(this); this.refresh(); },
  refresh() {
    const done = (() => { try { return wx.getStorageSync('ttgd.imgcards.v1'); } catch (e) { return ''; } })() === '1';
    this.setData({ done });
  },
  importNow() {
    if (this.data.importing) return;
    if (this.data.done) { wx.showToast({ title: '已导入过', icon: 'none' }); return; }
    this.setData({ importing: true });
    wx.showLoading({ title: '导入看图卡…' });
    try {
      TTStore.bulkAdd(DATA);
      wx.setStorageSync('ttgd.imgcards.v1', '1');
      TTAnki.migrate();
      wx.hideLoading();
      wx.showToast({ title: '已导入 ' + DATA.length + ' 张', icon: 'success' });
      this.refresh();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '导入失败：' + err.message, icon: 'none' });
    }
    this.setData({ importing: false });
  },
  clearAll() {
    wx.showModal({
      title: '清除看图卡',
      content: '确定清除已导入的图片挖空卡？',
      success: res => {
        if (!res.confirm) return;
        const ids = TTStore.getContent().filter(x => x.type === 'card' && x.masks && x.masks.length).map(x => x.id);
        TTStore.removeMany(ids);
        wx.removeStorageSync('ttgd.imgcards.v1');
        wx.showToast({ title: '已清除 ' + ids.length + ' 张', icon: 'none' });
        this.refresh();
      }
    });
  },
  study() {
    getApp().globalData.pendingImageCards = true;
    wx.switchTab({ url: '/pages/learn/learn' });
  },
  back() { wx.navigateBack(); }
});
`;
fs.writeFileSync(path.join(pageDir, 'import.js'), pageJs);
fs.writeFileSync(path.join(pageDir, 'import.json'), JSON.stringify({ navigationBarTitleText: '看图挖空卡' }, null, 2));
fs.writeFileSync(path.join(pageDir, 'import.wxml'), `<view class="page {{dark?'dark':''}}">
  <view class="card">
    <view class="card-title">看图挖空卡（共 {{count}} 张）</view>
    <view class="muted">图片托管于阿里云 OSS（https），真机可直接加载。点「导入」写入本地存储后即可学习。</view>
  </view>
  <view class="subj-state {{done?'ok':'go'}}" style="margin-bottom:20rpx" bindtap="importNow">{{done?'已导入 ✓ 点此重新导入':'导入 ' + count + ' 张'}}</view>
  <view class="btn-primary" style="margin-bottom:20rpx" bindtap="study">开始学习看图卡</view>
  <view class="btn-ghost" style="margin-bottom:20rpx" bindtap="clearAll">清除已导入看图卡</view>
  <view class="btn-ghost" bindtap="back">返回</view>
</view>
`);
fs.writeFileSync(path.join(pageDir, 'import.wxss'), `.subj-state{font-size:28rpx;padding:22rpx 26rpx;border-radius:999rpx;text-align:center;font-weight:600;}
.subj-state.go{background:linear-gradient(135deg,#2f8f6b,#38a97d);color:#fff;}
.subj-state.ok{background:#e8f6f0;color:#1f7a58;}
`);
console.error('看图卡导入页已生成 pkg-img');
