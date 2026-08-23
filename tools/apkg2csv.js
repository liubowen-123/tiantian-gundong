/* ===== 天天滚动 · Anki (.apkg / collection.anki2) → 小程序 CSV ===== */
/* 零依赖：内置 zlib 解 zip + node:sqlite 读库。
   用法: node tools/apkg2csv.js <文件.apkg 或 collection.anki2> [输出.csv]
   输出是小程序 📚 CSV 导入格式(type,subject,chapter,question,...,explain) */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');

/* ---------- 最小 ZIP 读取（支持 stored 与 deflate） ---------- */
function readZipEntries(buf) {
  // 找 EOCD
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip(.apkg)：未找到 EOCD');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('zip 中央目录损坏');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    // 定位本地头的数据区
    const lnameLen = buf.readUInt16LE(localOff + 26);
    const lextraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lnameLen + lextraLen;
    const raw = buf.slice(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('不支持的压缩方式: ' + method + ' (' + name + ')');
    entries[name] = data;
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ---------- CSV 转义 ---------- */
function escCsv(v) {
  v = v == null ? '' : String(v);
  if (/[",\r\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

/* ---------- 字段名→正面/背面索引 ---------- */
function frontBackIndex(model) {
  const flds = (model && model.flds) || [];
  const names = flds.map(f => (f.name || '').toLowerCase());
  const frontHits = ['front', 'question', '正面', '题干', '题目', 'q', 'word', 'term', '单词', '汉字'];
  const backHits = ['back', 'answer', '背面', '解析', '答案', 'a', 'explain', 'definition', 'meaning', '意'];
  let fI = -1;
  for (const k of frontHits) { const i = names.indexOf(k); if (i >= 0) { fI = i; break; } }
  let bI = -1;
  for (const k of backHits) { const i = names.indexOf(k); if (i >= 0) { bI = i; break; } }
  if (fI < 0) fI = 0;
  if (bI < 0) bI = 1;
  if (bI === fI) bI = fI + 1;
  return { fI, bI };
}

function deckParts(name) {
  const parts = String(name || '').split('::');
  return { subject: (parts[0] || '未分类').trim(), chapter: (parts[1] || '').trim() };
}

/* ---------- 主流程 ---------- */
function convert(input, output) {
  let buf = fs.readFileSync(input);
  let tmpDb = null;
  let dbPath;
  // 判断是 zip(.apkg) 还是裸 sqlite
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const entries = readZipEntries(buf);
    const names = Object.keys(entries);
    // 兼容 collection.anki2 / collection.anki21 / collection.anki21b 等，选笔记行数最多的那个
    const cands = names.filter(n => /^collection\.anki/i.test(n));
    if (cands.length === 0) throw new Error('.apkg 中未找到 collection.* 数据库，实际条目: ' + names.join(', '));
    let bestBuf = null, bestName = '', bestCount = -1;
    for (const cand of cands) {
      const t = path.join(os.tmpdir(), 'ttgd-cand-' + Date.now() + '-' + Math.random() + '.anki2');
      fs.writeFileSync(t, entries[cand]);
      try {
        const d = new DatabaseSync(t);
        const cnt = d.prepare('SELECT COUNT(*) c FROM notes').get().c;
        d.close();
        if (cnt > bestCount) { bestCount = cnt; bestBuf = entries[cand]; bestName = cand; }
      } catch (e) { /* 该文件无法作为库打开，忽略 */ }
      try { fs.unlinkSync(t); } catch (e) {}
    }
    if (!bestBuf) throw new Error('.apkg 中的 collection.* 均无法打开');
    tmpDb = path.join(os.tmpdir(), 'ttgd-' + Date.now() + '.anki2');
    fs.writeFileSync(tmpDb, bestBuf);
    dbPath = tmpDb;
    console.error('选用数据库: ' + bestName + '  (' + bestBuf.length + ' bytes, ' + bestCount + ' 张卡)');
  } else {
    dbPath = input;
  }

  const db = new DatabaseSync(dbPath);
  try {
    // 读取 col（decks/models JSON）
    const col = db.prepare('SELECT decks, models FROM col LIMIT 1').get();
    const decks = col && col.decks ? JSON.parse(col.decks) : {};
    const models = col && col.models ? JSON.parse(col.models) : {};

    // note → deck（取第一张卡）
    const nidDid = {};
    for (const row of db.prepare('SELECT nid, did FROM cards').all()) {
      if (!(row.nid in nidDid)) nidDid[row.nid] = row.did;
    }

    const notes = db.prepare('SELECT id, mid, tags, flds FROM notes').all();
    const lines = ['type,subject,chapter,question,optionA,optionB,optionC,optionD,answer,explain'];
    let count = 0;
    for (const note of notes) {
      const modelId = String(note.mid);
      const model = models[modelId];
      const { fI, bI } = frontBackIndex(model);
      const fields = String(note.flds || '').split('\x1f');
      const front = (fields[fI] || '').trim();
      const back = (fields[bI] || '').trim();
      if (!front) continue; // 无正面跳过
      const deckId = String(nidDid[note.id] || '');
      const deckName = decks[deckId] ? decks[deckId].name : '';
      let { subject, chapter } = deckParts(deckName);
      const tags = String(note.tags || '').split(/\s+/).filter(Boolean);
      if (subject === '未分类' && tags.length) subject = tags[0];
      if (!chapter && tags.length > 1) chapter = tags[1];
      lines.push([
        'card', subject, chapter, front, '', '', '', '', '', back
      ].map(escCsv).join(','));
      count++;
    }

    const out = lines.join('\n');
    if (output) fs.writeFileSync(output, out);
    console.error('转换完成：' + count + ' 张记忆卡' + (output ? ' → ' + output : ''));
    return out;
  } finally {
    db.close();
    if (tmpDb) { try { fs.unlinkSync(tmpDb); } catch (e) {} }
  }
}

module.exports = { convert, readZipEntries };

if (require.main === module) {
  const input = process.argv[2];
  const output = process.argv[3] || '';
  if (!input) { console.error('用法: node tools/apkg2csv.js <文件.apkg 或 collection.anki2> [输出.csv]'); process.exit(1); }
  const out = convert(input, output);
  if (!output) console.log(out);
}
