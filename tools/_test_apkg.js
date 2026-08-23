/* 用模拟的 Anki collection.anki2 构造 .apkg，验证 tools/apkg2csv.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ttgd-apkg-'));
const aki = path.join(tmp, 'collection.anki2');
const apkg = path.join(tmp, 'test.apkg');

// 1) 建库
const db = new DatabaseSync(aki);
db.exec(`CREATE TABLE col(id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);
CREATE TABLE notes(id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text);
CREATE TABLE cards(id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text);`);
db.prepare(`INSERT INTO col(id,models,decks) VALUES(1,?,?)`).run(
  JSON.stringify({ '100': { name: '基础', flds: [{ name: 'Front' }, { name: 'Back' }] } }),
  JSON.stringify({ '1': { name: '生理学::血液循环' }, '2': { name: '生物化学::糖代谢' } })
);
const ins = db.prepare('INSERT INTO notes(id,mid,tags,flds) VALUES(?,?,?,?)');
ins.run(1, 100, '生理学', '心输出量约?\u001f4.5~6 L/min, 约 60~80ml');
ins.run(2, 100, '生物化学', '糖原合成关键酶?\u001f糖原合酶');
const insCard = db.prepare('INSERT INTO cards(id,nid,did) VALUES(?,?,?)');
insCard.run(1, 1, 1);
insCard.run(2, 2, 2);
db.close();

// 2) 打成一个 stored (method 0) 的 zip
const dbBuf = fs.readFileSync(aki);
const name = Buffer.from('collection.anki2');
const lh = Buffer.alloc(30 + name.length);
lh.writeUInt32LE(0x04034b50, 0);
lh.writeUInt16LE(20, 4);       // version
lh.writeUInt16LE(0, 6);        // flags
lh.writeUInt16LE(0, 8);        // method = stored
lh.writeUInt32LE(0, 14);       // crc (不校验)
lh.writeUInt32LE(dbBuf.length, 18); // compSize
lh.writeUInt32LE(dbBuf.length, 22); // uncompSize
lh.writeUInt16LE(name.length, 26);
name.copy(lh, 30);
const cd = Buffer.alloc(46 + name.length);
cd.writeUInt32LE(0x02014b50, 0);
cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10);
cd.writeUInt32LE(0, 16); cd.writeUInt32LE(dbBuf.length, 20); cd.writeUInt32LE(dbBuf.length, 24);
cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
cd.writeUInt32LE(0, 42); // local offset
name.copy(cd, 46);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(lh.length + dbBuf.length, 16);
fs.writeFileSync(apkg, Buffer.concat([lh, dbBuf, cd, eocd]));

// 3) 跑转换器（本进程内调用，避免子进程 EPERM）
const { convert } = require('./apkg2csv.js');
const out = convert(apkg, '');
console.log('---- 转换输出 ----');
console.log(out);
const lines = out.trim().split('\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };
ok(lines[0] === 'type,subject,chapter,question,optionA,optionB,optionC,optionD,answer,explain', '首行表头正确');
ok(lines.length === 3, '共 2 张卡（表头+2）');
ok(lines[1].indexOf('card,生理学,血液循环,心输出量约?') === 0, '第1卡: 科目/章节/正面');
ok(lines[1].indexOf('"4.5~6 L/min, 约 60~80ml"') >= 0, '第1卡: 背面含逗号被引号转义');
ok(lines[2].indexOf('card,生物化学,糖代谢,糖原合成关键酶?') === 0, '第2卡: 科目/章节/正面');
ok(lines[2].endsWith(',糖原合酶'), '第2卡: 背面正确');
console.log('---- 结果: ' + pass + ' 通过, ' + fail + ' 失败 ----');
process.exit(fail > 0 ? 1 : 0);
