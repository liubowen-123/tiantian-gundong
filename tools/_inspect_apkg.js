/* 检查 Anki .apkg 内部结构（zip 条目 + SQLite 表/行数 + 样例） */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { readZipEntries } = require('./apkg2csv.js');

const apkg = process.argv[2];
if (!apkg) { console.error('用法: node tools/_inspect_apkg.js <file.apkg>'); process.exit(1); }
const buf = fs.readFileSync(apkg);
const entries = readZipEntries(buf);
console.log('=== zip 内条目 ===');
Object.keys(entries).forEach(n => console.log('  ' + n + '  (' + entries[n].length + ' bytes)'));

const dbName = Object.keys(entries).find(n => /collection\.anki(?:2|21b|3)/i.test(n));
if (!dbName) { console.error('未找到 collection.* 数据库'); process.exit(1); }
const tmp = path.join(os.tmpdir(), 'ttgd-inspect-' + Date.now() + '.anki2');
fs.writeFileSync(tmp, entries[dbName]);
const db = new DatabaseSync(tmp);
console.log('\n=== 数据库表与行数 (' + dbName + ') ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
for (const t of tables) {
  const name = t.name;
  try {
    const cnt = db.prepare('SELECT COUNT(*) c FROM "' + name + '"').get().c;
    console.log('  ' + name + ' : ' + cnt + ' 行');
  } catch (e) { console.log('  ' + name + ' : 读取失败 ' + e.message); }
}
console.log('\n=== col 里的 decks / models / conf ===');
try {
  const col = db.prepare('SELECT * FROM col LIMIT 1').get();
  if (col) {
    console.log('  decks keys:', Object.keys(JSON.parse(col.decks || '{}')).length);
    console.log('  models keys:', Object.keys(JSON.parse(col.models || '{}')).length);
    Object.keys(JSON.parse(col.models || '{}')).forEach(mid => {
      const m = JSON.parse(col.models)[mid];
      console.log('    model[' + mid + '] = ' + m.name + ' => flds: ' + (m.flds || []).map(f => f.name).join('|'));
    });
    Object.keys(JSON.parse(col.decks || '{}')).slice(0, 12).forEach(did => {
      console.log('    deck[' + did + '] = ' + JSON.parse(col.decks)[did].name);
    });
  }
} catch (e) { console.log('  col 读取失败: ' + e.message); }
console.log('\n=== 样例笔记 ===');
try {
  const notes = db.prepare('SELECT id, mid, tags, flds FROM notes LIMIT 6').all();
  notes.forEach(n => console.log('  #' + n.id + ' mid=' + n.mid + ' tags=' + n.tags + ' flds=' + JSON.stringify(n.flds)));
} catch (e) { console.log('  notes 读取失败: ' + e.message); }
db.close();
try { fs.unlinkSync(tmp); } catch (e) {}
