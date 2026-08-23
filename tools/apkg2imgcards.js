/* ===== 天天滚动 · Anki 图片挖空卡 (Image Cloze) 提取 =====
   把 "图片+挖空坐标" 卡组转成小程序能导入的 JSON，并把图片解到 images/。
   用法: node tools/apkg2imgcards.js <文件.apkg> [输出.json]
   输出: 默认 导入_图像卡.json  + 图片文件写入 D:\harness\tiantian-gundong\images\  */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { readZipEntries } = require('./apkg2csv.js');

const entries = readZipEntries(fs.readFileSync(process.argv[2]));
const media = JSON.parse((entries['media'] || Buffer.from('{}')).toString('utf8'));
// 反向映射: filename -> mediaId
const fn2id = {};
Object.keys(media).forEach(id => { if (media[id]) fn2id[media[id]] = id; });

// 选笔记最多的 collection
const cands = Object.keys(entries).filter(n => /^collection\.anki/i.test(n));
let best = null, bestCount = -1, bestBuf = null;
for (const cand of cands) {
  const t = path.join(os.tmpdir(), 'ttgd-c-' + Date.now() + '-' + Math.random() + '.anki2');
  fs.writeFileSync(t, entries[cand]);
  try { const d = new DatabaseSync(t); const c = d.prepare('SELECT COUNT(*) c FROM notes').get().c; d.close(); if (c > bestCount) { bestCount = c; best = cand; bestBuf = entries[cand]; } } catch (e) {}
  try { fs.unlinkSync(t); } catch (e) {}
}
const tmp = path.join(os.tmpdir(), 'ttgd-img-' + Date.now() + '.anki2');
fs.writeFileSync(tmp, bestBuf);
const db = new DatabaseSync(tmp);

const col = db.prepare('SELECT decks, models FROM col LIMIT 1').get();
const decks = JSON.parse(col.decks);
const models = JSON.parse(col.models);

const SUBJECTS = ['外科学', '生理学', '病理学', '生物化学', '内科学', '诊断学', '药理学', '免疫学', '微生物学', '医学免疫学'];
function subjectChapter(deckName) {
  const segs = String(deckName || '').split('::').map(s => s.trim()).filter(Boolean);
  let subject = segs.find(s => SUBJECTS.some(sub => s.indexOf(sub) >= 0)) || (segs[2] || segs[0] || '未分类');
  subject = subject.replace(/^\d+/, '').trim();
  let chapter = (segs[segs.length - 1] || '');
  chapter = chapter.replace(/^\d+/, '').trim();
  if (chapter === subject) chapter = '';
  return { subject: subject || '未分类', chapter };
}

const nidDid = {};
for (const r of db.prepare('SELECT nid, did FROM cards').all()) if (!(r.nid in nidDid)) nidDid[r.nid] = r.did;

const notes = db.prepare('SELECT id, mid, tags, flds FROM notes').all();
const outDir = path.join(__dirname, '..', 'images');
fs.mkdirSync(outDir, { recursive: true });
const cards = [];
let saved = 0, skipped = 0;

function flattenMasks(m) {
  const out = [];
  (Array.isArray(m) ? m : []).forEach(g => {
    if (Array.isArray(g) && g.length && Array.isArray(g[0])) g.forEach(b => { if (b.length >= 4) out.push([b[0], b[1], b[2], b[3]]); });
    else if (Array.isArray(g) && g.length >= 4) out.push([g[0], g[1], g[2], g[3]]);
  });
  return out;
}

for (const note of notes) {
  const fields = String(note.flds).split('\x1f');
  const imgHtml = fields[2] || '';
  const src = (imgHtml.match(/src="([^"]+)"/) || [])[1];
  if (!src || !fn2id[src]) { skipped++; continue; }
  const id = fn2id[src];
  const imgBuf = entries[id];
  if (!imgBuf) { skipped++; continue; }
  fs.writeFileSync(path.join(outDir, src), imgBuf);
  saved++;
  const deckId = String(nidDid[note.id] || '');
  const deckName = decks[deckId] ? decks[deckId].name : '';
  const { subject, chapter } = subjectChapter(deckName);
  let masks = [];
  try { masks = flattenMasks(JSON.parse(fields[3] || '[]')); } catch (e) {}
  cards.push({
    type: 'card', subject, chapter,
    image: 'images/' + src,
    masks: masks.length ? masks : [[0, 0, 0.001, 0.001]],
    question: '[看图记忆卡] ' + subject + (chapter ? '·' + chapter : ''),
    explain: ''
  });
}
db.close();
try { fs.unlinkSync(tmp); } catch (e) {}

const outFile = process.argv[3] || path.join(__dirname, '..', '导入_图像卡.json');
fs.writeFileSync(outFile, JSON.stringify(cards, null, 2));
console.error('图片挖空卡: 已解 ' + saved + ' 张图片 → images/，生成 ' + cards.length + ' 张卡 → ' + path.basename(outFile));
console.log('生成文件: ' + outFile);
