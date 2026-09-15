/* ============================================================
   天天滚动 · 题目→导图 精准匹配引擎（js/match-engine.js）v2
   针对旧版“考关键酶却配到维生素”的错配全面重做：
   1. 查询只取【题干 + 正确选项 + 清洗后的解析】，错误干扰项不参与，
      并删除解析中“（X错）/…错误/…排除”等描述错误选项的片段；
   2. 强术语（3/4字 gram、英文 token 如 NAD/FAD/CoA）主导打分，
      双字词只做有限辅助分（封顶），杜绝碎片双字堆分反超；
   3. IDF 稀有度加权：专业术语权重高、满图泛词权重低；
   4. 硬性强锚点：候选块必须命中强术语，否则 0 分；
   5. 章节别名 + 三层收窄（同章→同科→自动定科），最佳/次佳 margin
      不足时宁可不显示，绝不乱配；
   6. build() 预提取全部块术语，单题匹配毫秒级。UMD，Node 可评测。
   ============================================================ */
(function (root) {
  'use strict';

  var STOP2 = {
    '下列':1,'哪一':1,'一项':1,'不包':1,'包括':1,'关于':1,'错误':1,'正确':1,'属于':1,'不属':1,
    '可见':1,'主要':1,'最可':1,'可能':1,'见于':1,'表现':1,'临床':1,'治疗':1,'诊断':1,'检查':1,
    '机制':1,'特点':1,'因素':1,'发生':1,'形成':1,'结构':1,'功能':1,'作用':1,'合成':1,'代谢':1,
    '患者':1,'男性':1,'女性':1,'患儿':1,'查体':1,'化验':1,'实验':1,'验室':1,'首选':1,'确诊':1,'鉴别':1,
    '原因':1,'目的':1,'部位':1,'器官':1,'组织':1,'细胞':1,'蛋白':1,'物质':1,'反应':1,'过程':1,
    '变化':1,'异常':1,'正常':1,'出现':1,'引起':1,'导致':1,'相关':1,'描述':1,'叙述':1,'陈述':1,
    '称为':1,'叫做':1,'进行':1,'通过':1,'需要':1,'可以':1,'能够':1,'具有':1,'含有':1,'存在':1,
    '选项':1,'答案':1,'解析':1,'考点':1,'题目':1,'上述':1,'以下':1,'哪个':1,'哪些':1,'分别':1,
    '主诉':1,'病史':1,'既往':1,'症状':1,'体征':1,'辅助':1,'测定':1,'检测':1,'指标':1,
    '升高':1,'降低':1,'增多':1,'减少':1,'增快':1,'减慢':1,'水平':1,'浓度':1,'含量':1,'活性':1,
    '因为':1,'所以':1,'由于':1,'因此':1,'从而':1,'进而':1,'使得':1,'提示':1,'考虑':1,'最常':1,
    '常见':1,'典型':1,'特征':1,'特性':1,'方式':1,'方法':1,'类型':1,'分类':1,'分期':1,'分型':1,
    '并发':1,'继发':1,'原发':1,'急性':1,'慢性':1,'良性':1,'恶性':1,'综合':1,'全身':1,'局部':1,
    '关键':1,'键酶':1,'限速':1,'调节':1,'激活':1,'抑制':1,'促进':1,'受体':1,'载体':1,'通道':1,
    '见于':1,'好发':1,'多发':1,'少见':1,'罕见':1,'注意':1,'记住':1,'掌握':1,'理解':1,'记忆':1
  };

  var STOP3 = {
    '该患者':1,'本患者':1,'患者最':1,'者最可':1,'最可能':1,'可能的':1,'的诊断':1,'诊断为':1,'诊断是':1,'初步诊':1,'其诊断':1,'临床诊':1,
    '入院后':1,'查体示':1,'实验室':1,'辅助检':1,'检查示':1,'检查结':1,'最恰当':1,'首选的':1,'治疗方':1,'处理是':1,'下列哪':1,'哪一项':1,
    '一项是':1,'的叙述':1,'述正确':1,'正确的':1,'错误的':1,'不包括':1,'见于哪':1,'该病人':1,'病人最':1,'目前应':1,'应采取':1,'下列符':1,'列符合':1,
    '治疗原':1,'疗原则':1,'原则的':1,'则的是':1,'下列不':1,'下列对':1,'关于该':1,'该患目':1,'首先考':1,'考虑为':1,'可能诊':1,'并说明':1,
    '该患术':1,'术后第':1,'患者术':1,'患者经':1,'患者目':1,'患者当':1,'患者自':1,'患者入':1,'患者于':1,'男患者':1,'女患者':1,
    // 跨科通用体征/部位词，不代表具体疾病主题
    '病理征':1,'征阳性':1,'征阴性':1,'右上腹':1,'左上腹':1,'右下腹':1,'左下腹':1,'上腹部':1,'下腹部':1,'剑突下':1,'脐周':1,
    '全腹压':1,'腹压痛':1,'反跳痛':1,'肌紧张':1,'肠鸣音':1,'低热盗':1,'热盗汗':1,'双下肢':1,'下肢无':1,'软组织':1,'组织肿':1
  };

  var CH_ALIAS = {
    '生理学': {
      '绪论':['绪论'], '细胞的基本功能':['跨膜转运','细胞电活动','细胞信号','骨骼肌收缩'],
      '血液':['血液特性','生理性止血','血型'], '血液循环':['心脏泵血','心肌电','血压','心血管调节','微循环'],
      '呼吸':['肺通气','肺换气','呼吸调节'], '消化和吸收':['消化','胃内消化','肠内'],
      '能量代谢与体温':['能量代谢'], '尿的生成和排出':['泌尿','肾小球','小管'],
      '感觉器官':['视觉','听觉','其它感觉','其他感觉'], '神经系统':['神经','突触','递质','躯体运动','脑电'],
      '内分泌':['内分泌','激素','胰岛素','生长激素','甲状腺','糖皮质','钙调节'], '生殖':['生殖']
    },
    '生物化学': {
      '蛋白质的结构与功能':['蛋白质'], '酶与酶促反应':['酶'], '核酸的结构与功能':['核酸'],
      '维生素':['维生素'], '糖代谢':['糖无氧氧化','磷酸戊糖'], '脂质代谢':['脂肪代谢','血浆脂蛋白','磷脂'],
      '氨基酸代谢':['氨基酸代谢'], '生物氧化':['氧化磷酸化'], '核苷酸代谢':['核苷酸代谢'],
      '真核基因与基因组':['真核基因','小基因'], 'DNA的合成':['DNA的合成'], 'RNA的生物合成':['转录'],
      '蛋白质的合成':['翻译'], '基因表达调控':['基因表达调控'], 'DNA重组':['小基因'],
      '常用的分子生物学技术':['小基因'], 'DNA损伤和损伤修复':['DNA损伤'],
      '肝的生物化学':['生物转化','胆色素'], '血液的生物化学':['血浆脂蛋白'],
      '细胞信号转导与疾病':['信号转导','信号通路'], '代谢的整合与调节':['代谢调节','代谢整合'], '癌症的分子基础':['基因表达调控','真核基因']
    },
    '病理学': {
      '细胞和组织的适应与损伤':['适应和损伤'], '损伤的修复':['损伤的修复'], '局部血液循环障碍':['局部血液循环障碍'],
      '炎症':['炎症'], '免疫性疾病':['免疫性疾病'], '肿瘤':['肿瘤'],
      '心血管系统疾病':['动脉粥样硬化','高血压','风湿病','心肌疾病','感染性心内膜炎'],
      '呼吸系统疾病':['慢支','肺炎','支扩','硅肺','呼吸系统肿瘤','肺气肿','肺心病'],
      '消化系统疾病':['胃炎','消化性溃疡','病毒性肝炎','肝硬化','消化道肿瘤','原发性肝癌','阑尾','胰腺'],
      '淋巴造血系统疾病':['肿瘤'], '泌尿系统疾病':['适应和损伤'],
      '生殖系统和乳腺疾病':['生殖系统','乳腺'], '内分泌系统疾病':['内分泌系统疾病'],
      '神经系统疾病':['适应和损伤'], '传染病':['结核','其它传染病','其他传染病']
    },
    '内科学': {
      '慢性阻塞性肺疾病':['COPD'], '支气管哮喘':['支气管哮喘'], '支气管扩张症':['支气管扩张症'],
      '肺部感染性疾病':['肺炎'], '肺脓肿':['急性肺脓肿'], '肺结核':['肺结核'], '肺癌':['肺癌'],
      '肺血栓栓塞症':['急性肺血栓栓塞'], '肺动脉高压':['肺动脉高压'], '间质性肺疾病':['肺间质性疾病'],
      '胸膜疾病':['胸膜疾病'], '急性呼吸窘迫综合征':['ARDS'], '呼吸衰竭与呼吸支持技术':['呼吸衰竭'],
      '心力衰竭':['收缩性心衰'], '心律失常':['心律失常'],
      '动脉粥样硬化和冠状动脉粥样硬化性心脏病':['冠心病'], '高血压':['高血压'],
      '心脏瓣膜病':['心瓣膜病'], '心肌疾病':['心肌疾病'], '感染性心内膜炎':['感染性心内膜炎'],
      '心包疾病':['心包疾病'], '心脏骤停与心脏性猝死':['心脏骤停'],
      '胃食管反流病':['胃食管反流病'], '胃炎':['胃炎'], '消化性溃疡':['消化性溃疡'],
      '肠结核和结核性腹膜炎':['肠结核'], '炎症性肠病':['炎症性肠病'], '肝硬化':['肝硬化'],
      '原发性肝癌':['原发性肝细胞癌'], '胰腺炎':['胰腺炎'], '消化道出血':['消化道出血'],
      '原发性肾小球疾病':['原发性肾小球疾病'], '尿路感染':['尿路感染'], '急性肾损伤':['肾衰竭'],
      '慢性肾衰竭':['肾衰竭'], '贫血概述':['缺铁性贫血','溶血性贫血','再生障碍性贫血'],
      '缺铁性贫血':['缺铁性贫血'], '巨幼细胞贫血':['溶血性贫血'], '再生障碍性贫血':['再生障碍性贫血'],
      '溶血性贫血':['溶血性贫血'], '白血病':['白血病'], '淋巴瘤':['淋巴瘤'], '多发性骨髓瘤':['骨髓瘤'],
      '骨髓增生异常性肿瘤':['MDS'], '出血性疾病概述':['出血性疾病'], '紫癜性疾病':['出血性疾病'],
      '凝血障碍性疾病':['出血性疾病'], '甲状腺疾病':['甲亢','甲减'], '糖尿病':['糖尿病'],
      '肾上腺疾病':['库欣综合征','原醛','嗜铬细胞瘤'], '肥胖症':['内分泌系统总论'],
      '总论':['总论','系统总论'], '类风湿关节炎':['类风湿关节炎'], '系统性红斑狼疮':['SLE'],
      '系统性血管炎':['系统性血管炎'], '干燥综合征':['原发性干燥综合征'], '脊柱关节炎':['类风湿关节炎'],
      '抗磷脂综合征':['SLE'], '风湿热':['风湿系统总论'], '痛风':['风湿系统总论'], '中毒':['中毒']
    },
    '外科学': {
      '外科无菌原则':['其他外科学总论','其它外科学总论'], '外科病人的代谢及营养治疗':['营养代谢'],
      '水、电解质代谢紊乱和酸碱平衡失调':['体液失衡'], '输血':['输血'], '休克':['休克'],
      '麻醉':['麻醉'], '重症监测治疗及复苏':['其他外科学总论','其它外科学总论'], '疼痛治疗':['麻醉'],
      '围手术期处理':['围术期'], '外科感染':['感染'], '创伤':['感染'], '烧伤、冻伤与咬蜇伤':['烧伤'],
      '肿瘤':['其他外科学总论','其它外科学总论'], '器官、组织和细胞移植':['其他外科学总论','其它外科学总论'],
      '颅内压增高和脑疝':['其它颈胸部疾病','其他颈胸部疾病'], '颅脑损伤':['其它颈胸部疾病','其他颈胸部疾病'],
      '颅内和椎管内肿瘤':['其它颈胸部疾病','其他颈胸部疾病'], '颈部疾病':['颈部疾病'],
      '乳房疾病':['乳房疾病'], '胸部损伤':['其它颈胸部疾病','其他颈胸部疾病'], '肺疾病':['其它颈胸部疾病','其他颈胸部疾病'],
      '食管疾病':['食管疾病'], '腹外疝':['腹外疝'], '腹部损伤':['腹部损伤'],
      '周围血管与淋巴疾病':['周围血管疾病'], '急性化脓性腹膜炎':['腹腔感染'],
      '胃十二指肠疾病':['胃肿瘤'], '小肠疾病':['肠梗阻'], '阑尾疾病':['阑尾炎'],
      '结、直肠与肛管疾病':['大肠癌','其它大肠','其他大肠'], '肝疾病':['细菌性肝脓肿'],
      '门静脉高压症':['门脉高压症'], '胆道疾病':['胆系疾病'], '胰腺疾病':['胰腺肿瘤'],
      '消化道大出血的诊断与外科处理原则':['其它大肠','其他大肠'], '急腹症的诊断与鉴别诊断':['腹腔感染'],
      '泌尿、男生殖系统疾病总论':['泌外梗阻和外伤'], '泌尿、男生殖系统损伤':['泌外梗阻和外伤'],
      '泌尿、男生殖系统感染':['泌外感染和肿瘤'], '良性前列腺增生':['泌外梗阻和外伤'],
      '泌尿系统结石':['泌外梗阻和外伤'], '泌尿、男生殖系统肿瘤':['泌外感染和肿瘤'],
      '泌尿、男生殖系统先天性畸形':['泌外梗阻和外伤'], '骨折概述':['骨折概论'],
      '上肢骨、关节损伤':['四肢骨折和脱位'], '下肢骨、关节损伤':['四肢骨折和脱位'],
      '手外伤及断肢（指）再植':['手外伤'], '周围神经损伤':['手外伤','神经损伤'],
      '脊柱、脊髓损伤':['躯干骨骨折'], '骨盆、髋臼骨折':['躯干骨骨折'],
      '运动系统慢性损伤':['运动系统慢性损伤'], '颈、腰椎退行性疾病':['颈腰椎'],
      '骨与关节化脓性感染':['骨与关节感染'], '骨与关节结核':['骨与关节感染'],
      '非化脓性关节炎':['非化脓性关节炎'], '骨肿瘤':['骨肿瘤'], '运动系统畸形':['运动系统畸形'],
      '股骨头坏死':['股骨头坏死']
    }
  };

  function extractTerms(text) {
    var g2 = [], g3 = [], g4 = [], tok = [], s2={}, s3={}, s4={}, st={};
    if (!text) return { g2: g2, g3: g3, g4: g4, tok: tok };
    var tm = String(text).match(/[A-Za-z][A-Za-z0-9]*(?:\d+)?/g);
    if (tm) tm.forEach(function (t) { var u = t.toUpperCase(); if (u.length >= 2 && !st[u]) { st[u]=1; tok.push(u); } });
    var segs = String(text).match(/[一-龥]+/g) || [];
    // OCR 归一：中文片段额外生成一套“去连接符/阿拉伯与罗马数字”的 gram，
    // 修复“磷酸果糖激酶-1 / 激酶一1 / 辅酶Ⅰ”等异体写法导致的答案词漏匹配（不删中文数字，避免误伤“一级结构”）
    var NORM_RE = /[0-9０-９ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ\-—–−_·\.．]/g;
    function pushGrams(seg) {
      var n = seg.length;
      for (var i = 0; i + 2 <= n; i++) { var t=seg.substr(i,2); if(!s2[t]){s2[t]=1;g2.push(t);} }
      for (var j = 0; j + 3 <= n; j++) { var t3=seg.substr(j,3); if(!s3[t3]){s3[t3]=1;g3.push(t3);} }
      for (var k = 0; k + 4 <= n; k++) { var t4=seg.substr(k,4); if(!s4[t4]){s4[t4]=1;g4.push(t4);} }
    }
    segs.forEach(function (seg) {
      pushGrams(seg);
      var norm = seg.replace(NORM_RE, '');
      if (norm && norm !== seg) pushGrams(norm);
    });
    return { g2: g2, g3: g3, g4: g4, tok: tok };
  }
  // 清洗解析：按小句删除描述错误选项的内容（如“XX是糖异生关键酶（B错）”整句剔除）
  function cleanExplain(text) {
    var s = String(text || '');
    var parts = s.split(/([，。；;、])/), out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      // 小句中出现：（X错）/（AB错）/ X错 / 为错误 / 是错误 / 不选 / 排除 / 干扰 → 整句剔除
      if (/[（(]?[A-EＡ-Ｅ][、\s\.．]*[A-EＡ-Ｅ]?[\s\.、]*错|[A-EＡ-Ｅ][\s\.、]?错|为错误|是错误|错误选项|该项错误|不选|可排除|予以排除|属干扰|是干扰|无关选项/.test(p)) continue;
      out.push(p);
    }
    return out.join('');
  }
  function normChapter(s) {
    return String(s || '').replace(/第[一二三四五六七八九十百零〇\d]+[篇章节]/g, '').replace(/[\s，。、（）()：:；;,.!?！？·\[\]【】“”‘’\-—_]/g, '');
  }
  function bigrams(s) { var r = {}; for (var i = 0; i < s.length - 1; i++) r[s.substr(i, 2)] = 1; if (s.length === 1) r[s] = 1; return r; }
  function dice(a, b) {
    var ag = bigrams(a), inter = 0, an = 0;
    Object.keys(ag).forEach(function (k) { an++; if (b.indexOf(k) >= 0) inter++; });
    var bn = Math.max(1, b.length - 1);
    return 2 * inter / (an + bn);
  }
  function chapterSim(subject, qChRaw, mChRaw) {
    var q = normChapter(qChRaw), m = String(mChRaw || '');
    if (!q || !m) return 0;
    var mn = normChapter(m);
    if (q && mn && (mn.indexOf(q) >= 0 || q.indexOf(mn) >= 0)) return 1;
    var best = 0;
    m.split(/[、,，&＆/／]/).forEach(function (p) {
      var pn = normChapter(p); if (!pn) return;
      if (pn === q || q.indexOf(pn) >= 0 || pn.indexOf(q) >= 0) { best = Math.max(best, 0.95); return; }
      best = Math.max(best, dice(q, pn));
    });
    // 别名表
    var alias = CH_ALIAS[subject];
    if (alias) Object.keys(alias).forEach(function (qKey) {
      if (q.indexOf(normChapter(qKey)) >= 0) {
        alias[qKey].forEach(function (ak) { if (m.indexOf(ak) >= 0) best = Math.max(best, 0.9); });
      }
    });
    return best;
  }

  var ENGINE = {
    ready: false, _docs: null, _df: null, _N: 0, _bySubject: null,
    stats: { ms: 0 },
    build: function () {
      var IDX = root.TTImgOcrIndex, CARDS = root.TTBundledImageCards;
      if (!IDX || !CARDS) return false;
      if (this.ready) return true;
      var t0 = Date.now(), docs = [], df = {}, bySubject = {};
      for (var i = 0; i < CARDS.length; i++) {
        var card = CARDS[i], key = String(card.image).split('/').pop(), ent = IDX[key];
        if (!ent || !ent.b || !ent.b.length) continue;
        var allText = '', pblocks = [];
        for (var bi = 0; bi < ent.b.length; bi++) {
          var txt = ent.b[bi][4]; allText += ' ' + txt;
          var te = extractTerms(txt);
          pblocks.push({ b: ent.b[bi], g2: te.g2, g3: te.g3, g4: te.g4, tok: te.tok });
        }
        var dte = extractTerms(allText), seen = {};
        [dte.g2, dte.g3, dte.g4, dte.tok].forEach(function (arr) { arr.forEach(function (t) { if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; } }); });
        var chapterName = card.chapter || ent.c || '';
        var doc = { card: card, key: key, ent: ent, subject: card.subject, chapter: chapterName, pblocks: pblocks, chTerms: extractTerms(chapterName) };
        docs.push(doc); (bySubject[card.subject] = bySubject[card.subject] || []).push(doc);
      }
      this._docs = docs; this._df = df; this._N = docs.length; this._bySubject = bySubject;
      this.ready = true; this.stats.ms = Date.now() - t0;
      return true;
    },
    idf: function (t) { return Math.log((this._N + 1) / ((this._df[t] || 0) + 1)) + 0.3; },

    /* 查询权重：strong（3/4gram、token）与 weak（双字）分开；
       strict=整卷无科目章节场景：强术语稀有度门槛更高，挡住跨科泛医学词 */
    _query: function (it, strict) {
      var ans = it.answer, ansArr = Array.isArray(ans) ? ans : (ans == null ? [] : [ans]), correct = [];
      (it.options || []).forEach(function (o, i) { if (ansArr.indexOf(i) >= 0) correct.push(o); });
      var S = {}, W = {}, H = {}, A = {}, self = this, SIDF = strict ? 2.3 : 1.35;
      function feed(text, sw, ww, isAnchor) {
        if (!text) return;
        var te = extractTerms(text);
        function put(arr, kind, w) {
          arr.forEach(function (t) {
            if (kind === 's' && STOP3[t]) return;          // 临床套话三字/四字词不计强分
            if (kind === 's' && t.length === 4 && (STOP3[t.substr(0, 3)] || STOP3[t.substr(1, 3)])) return;
            var idf = self.idf(t);
            if (kind === 'w' && idf < 2.2) return;   // 双字要求更高 IDF
            if (kind === 's' && idf < SIDF) return;
            var v = w * idf, dst = kind === 's' ? S : W;
            if (dst[t] == null || v > dst[t]) dst[t] = v;
            if (isAnchor && kind === 's') H[t] = idf;  // 题干/正确选项专属锚点（解析不算）
          });
        }
        put(te.g3, 's', sw); put(te.g4, 's', sw * 1.2); put(te.tok, 's', sw * 1.4);
        // 极稀有双字专名（idf≥3.0，仅出现在约≤90张图）升入强分，如“胆囊/肾素/幽门”
        te.g2.forEach(function (t) {
          if (STOP2[t]) return;
          var idf = self.idf(t);
          if (idf >= 3.0) {
            var v = ww * 1.1 * idf;
            if (S[t] == null || v > S[t]) S[t] = v;
            if (isAnchor) H[t] = idf;
          }
        });
        put(te.g2, 'w', ww);
      }
      feed(it.question, 1.0, 0.55, true);
      feed(correct.join(' '), 3.0, 1.4, true);
      feed(cleanExplain(it.explain), 0.85, 0.25, false);

      /* 答案专名通道 A：只来自【正确选项】，与题干/解析分离，用于“答案一致性”选块/选卡。
         这是“严格按题目和答案匹配、绝不乱配”的关键：名词型答案必须定位到真正讲到该专名的块。 */
      var hasAns = false;
      var cte = extractTerms(correct.join(' '));
      function addAns(arr, w, minIdf) {
        arr.forEach(function (t) {
          if (STOP3[t]) return;
          if (t.length === 4 && (STOP3[t.substr(0, 3)] || STOP3[t.substr(1, 3)])) return;
          if (t.length === 2 && STOP2[t]) return;
          var idf = self.idf(t);
          if (minIdf != null && idf < minIdf) return;
          var v = w * idf;
          if (A[t] == null || v > A[t]) { A[t] = v; hasAns = true; }
        });
      }
      addAns(cte.g4, 3.4, 1.2);
      addAns(cte.g3, 2.8, 1.2);
      addAns(cte.tok, 3.2, 0.8);
      addAns(cte.g2, 2.4, 2.4);   // 两字答案专名（肽键/氢键/辅酶/激酶…）要求足够稀有
      return { S: S, W: W, H: H, A: A, hasAns: hasAns };
    },

    _blockScore: function (pb, Q) {
      var ss = 0, ws = 0, ansSc = 0, hits = [], ansHits = [], anchor = 0;
      function strong(t, mul) { var v = Q.S[t]; if (v != null) { ss += v * mul; hits.push(t); if (Q.H[t] != null) anchor = Math.max(anchor, Q.H[t]); } }
      pb.g3.forEach(function (t) { strong(t, 1.0); });
      pb.g4.forEach(function (t) { strong(t, 1.15); });
      pb.tok.forEach(function (t) { strong(t, 1.3); });
      pb.g2.forEach(function (t) {
        if (STOP2[t]) return;
        // 修复：稀有两字专名被 _query 升入 S 后，块级也必须能在 S 命中（旧版只查 W，导致“肽键”等两字答案永不命中）
        var vs = Q.S[t];
        if (vs != null) { ss += vs * 0.95; hits.push(t); if (Q.H[t] != null) anchor = Math.max(anchor, Q.H[t]); }
        var v = Q.W[t]; if (v != null) ws += v;
      });
      // 答案专名命中分（独立累计，只用于答案一致性判断与排序，不重复计入 ss）
      function ans(t, mul) { var v = Q.A[t]; if (v != null) { ansSc += v * mul; ansHits.push(t); } }
      pb.g4.forEach(function (t) { ans(t, 1.1); });
      pb.g3.forEach(function (t) { ans(t, 1.0); });
      pb.tok.forEach(function (t) { ans(t, 1.2); });
      pb.g2.forEach(function (t) { ans(t, 0.9); });
      // 硬锚点：强术语分必须达标；双字辅助分封顶（不超过强分的 75%）
      if (ss < 3.0) return { sc: 0, hits: [], ansHits: [], ansSc: 0, anchor: 0 };
      ws = Math.min(ws, ss * 0.75);
      return { sc: ss + ws, ss: ss, ws: ws, ansSc: ansSc, hits: hits, ansHits: ansHits, anchor: anchor };
    },

    _docScore: function (doc, Q) {
      var ranked = [];
      for (var i = 0; i < doc.pblocks.length; i++) {
        var pb = doc.pblocks[i], r = this._blockScore(pb, Q);
        if (r.sc > 0) ranked.push({ b: pb.b, sc: r.sc, ss: r.ss, ansSc: r.ansSc, anchor: r.anchor,
          hits: r.hits, ansHits: r.ansHits, cy: pb.b[1] + pb.b[3] / 2 });
      }
      if (!ranked.length) return null;
      ranked.sort(function (a, b) { return b.sc - a.sc; });
      // 答案锚定：名词型答案只在“命中答案专名”的块里选 top，避免题干泛词把块带偏到别的知识点
      var ansBlocks = Q.hasAns ? ranked.filter(function (x) { return x.ansSc > 0; }) : [];
      var ansMatched = ansBlocks.length > 0;
      var top;
      if (ansMatched) {
        ansBlocks.sort(function (a, b) { return b.ansSc - a.ansSc || b.sc - a.sc; });
        top = ansBlocks[0];
      } else {
        top = ranked[0];
      }
      var sc = top.sc, used = [top];
      // 邻近块合并扩框：优先合并与 top 答案命中状态一致的邻近块
      for (var k = 0; k < ranked.length && used.length < 4; k++) {
        if (ranked[k] === top) continue;
        if (Math.abs(ranked[k].cy - top.cy) < 0.10 && ((ranked[k].ansSc > 0) === ansMatched)) {
          sc += ranked[k].sc * 0.4; used.push(ranked[k]);
        }
      }
      // 章节名命中：章节名是最可靠的主题信号（如题目含 ARDS，章节名就是 ARDS）
      var chHit = 0, chAnc = 0, self = this;
      var ct = doc.chTerms;
      [ct.g3, ct.g4, ct.tok, ct.g2].forEach(function (arr, ai) {
        arr.forEach(function (t) {
          var v = Q.S[t];
          if (v != null) { chHit += v * (ai < 3 ? 1.6 : 1.1); if (Q.H[t] != null) chAnc = Math.max(chAnc, self.idf(t)); }
        });
      });
      if (chAnc > top.anchor) top.anchor = chAnc;
      sc += chHit * 1.6;
      return { sc: sc, ss: top.ss + chHit, top: top, used: used, ansMatched: ansMatched, ansSc: top.ansSc || 0 };
    },

    /* 在指定文档池内评分排序，返回 scored[] */
    _rankPool: function (pool, Q, subject, qCh) {
      var scored = [];
      for (var i = 0; i < pool.length; i++) {
        var ds = this._docScore(pool[i], Q);
        if (!ds) continue;
        var csim = (subject && qCh) ? chapterSim(subject, qCh, pool[i].chapter) : 0;
        scored.push({ doc: pool[i], ds: ds, csim: csim });
      }
      scored.sort(function (a, b) { return b.ds.sc - a.ds.sc; });
      return scored;
    },

    match: function (it) {
      if (!it || !it.question) return null;
      if (!this.ready && !this.build()) return null;
      // 人文法规/伦理题：导图库无对应内容，直接不匹配，避免被泛词带偏
      if (/医学道德|医德|伦理学?|医疗事故|病历|抢救结束|补记|处方管理|执业医师|卫生行政|知情同意|侵权责任|医师法|传染病防治|突发公共卫生|药品管理|母婴保健|医疗损害|干涉权|医学会|调遣|吊销|赔付|价格昂贵|经济状况/.test(it.question || '')) return null;
      var five = ['生理学', '生物化学', '病理学', '内科学', '外科学'];
      var strict = five.indexOf(it.subject) < 0;
      // 整卷场景：系列病例承接题（疾病信息在上一题，本题只有“该患者/首选检查/最适宜方案”）
      // 单题文本不含主题，任何字面匹配都不可靠 → 不显示
      if (strict) {
        var qraw = String(it.question || '').replace(/\s+/g, '');
        if (qraw.length <= 36 && /该患者|该病人|上述|为明确|首选的?(检查|影像|辅助检查)|影像学检查|最适宜|最佳的?(处理|措施|治疗|方案)|处理措施|治疗措施|进一步(采取|检查|治疗|处理)|目前最?主要?(的)?治疗|目前的?处理|需进行的检查|治疗的反应|评估.*治疗/.test(qraw)) return null;
      }
      var Q = this._query(it, strict), qCh = it.chapter || '';
      var hasSubj = !strict && this._bySubject[it.subject];
      var subject = it.subject, pool;

      // 阈值：sc=总分, ss=强术语分, anchor=题目自身高稀有度锚点的IDF
      var T_CH = 4.5, SS_CH = 3.0, T_SUBJ = 7.0, SS_SUBJ = 8.0, ANCHOR = strict ? 3.0 : 2.6;
      var ANS_MIN = 2.6, T_SUBJ_ANS = 5.5;                       // 答案专名命中门槛
      var T_CH_STRONG = 12.0, SS_CH_STRONG = 8.5, ANCHOR_STRONG = 3.2;  // 同章强题干回退门槛

      // 整卷无科目 → 自动定科。名词型答案优先用“答案专名命中”定科（比题干泛词更硬），
      // 答案命中打平时再用题干主题分；描述型/无答案命中时回退到强术语 ss 定科。
      if (!hasSubj) {
        var subjTop = [], ansTop = [];
        for (var si = 0; si < five.length; si++) {
          var sp = this._bySubject[five[si]], sr = this._rankPool(sp, Q, null, '');
          if (!sr.length) continue;
          subjTop.push({ subject: five[si], sc: sr[0].ds.sc, ss: sr[0].ds.ss });
          var ad = null;
          for (var ai2 = 0; ai2 < sr.length; ai2++) {
            if (sr[ai2].ds.ansMatched && (!ad || sr[ai2].ds.ansSc > ad.ds.ansSc)) ad = sr[ai2];
          }
          if (ad) ansTop.push({ subject: five[si], ans: ad.ds.ansSc, docSc: ad.ds.sc, plain: sr[0].ds.sc });
        }
        if (!subjTop.length) return null;
        var pick = null;
        if (Q.hasAns && ansTop.length) {
          // 答案专名打平时，用“该科题干主题最强分 plain”选科（主题最契合者），而非答案块自身分
          ansTop.sort(function (a, b) { return b.ans - a.ans || b.plain - a.plain; });
          var a0 = ansTop[0], a1 = ansTop[1];
          var ansOk = ansTop.length === 1 || a0.ans >= a1.ans * 1.18 ||
            (a1.ans > 0 && Math.abs(a0.ans - a1.ans) <= a1.ans * 0.05 && a0.plain >= a1.plain);
          if (ansOk && a0.ans >= ANS_MIN && a0.docSc >= 5.0) pick = a0.subject;
        }
        if (!pick) {
          subjTop.sort(function (a, b) { return b.ss - a.ss || b.sc - a.sc; });
          var confident = subjTop.length === 1 || subjTop[0].ss >= subjTop[1].ss * 1.4;
          if (confident) pick = subjTop[0].subject;
        }
        if (pick) { subject = pick; hasSubj = true; }
        else return null; // 科目都定不准 → 宁可不显示，杜绝跨科乱配
      } else { pool = this._bySubject[subject]; }

      var scored = this._rankPool(this._bySubject[subject], Q, subject, qCh);
      if (!scored.length) return null;
      var bySc = function (a, b) { return b.ds.sc - a.ds.sc; };
      var byAns = function (a, b) { return b.ds.ansSc - a.ds.ansSc || b.ds.sc - a.ds.sc; };
      var L1 = scored.filter(function (x) { return x.csim >= 0.45; });

      /* ============ 名词型答案：严格“答案一致性”路径（宁缺毋滥） ============ */
      if (Q.hasAns) {
        // 1) 同章且块命中答案专名 —— 最可靠，优先返回
        var l1ans = L1.filter(function (x) { return x.ds.ansMatched; });
        l1ans.sort(byAns);
        if (l1ans.length && l1ans[0].ds.sc >= T_CH && l1ans[0].ds.ansSc >= ANS_MIN)
          return this._assemble(l1ans[0], 'ch');

        // 2) 同科命中答案专名（答案知识点画在同科别的卡上，如“肽键”画在酶卡）——跨章捞回
        var subAns = scored.filter(function (x) { return x.ds.ansMatched; });
        subAns.sort(byAns);
        // 同章未命中答案、但题干锚点极强的候选（答案词可能被 OCR 漏识别），保守保留同章
        var l1Plain = L1.filter(function (x) { return !x.ds.ansMatched; });
        l1Plain.sort(bySc);
        if (l1Plain.length && l1Plain[0].ds.sc >= T_CH_STRONG && l1Plain[0].ds.ss >= SS_CH_STRONG &&
            l1Plain[0].ds.top.anchor >= ANCHOR_STRONG)
          return this._assemble(l1Plain[0], 'ch');
        if (subAns.length && (subAns[0].ds.sc >= T_SUBJ_ANS || subAns[0].ds.ansSc >= 6.5) && subAns[0].ds.ansSc >= ANS_MIN) {
          var marginOk = subAns.length < 2 ||
            subAns[0].ds.ansSc >= subAns[1].ds.ansSc * 1.12 || subAns[0].ds.sc >= subAns[1].ds.sc * 1.25 ||
            (subAns[0].ds.ansSc >= subAns[1].ds.ansSc * 0.95 && subAns[0].ds.sc >= subAns[1].ds.sc);
          if (marginOk) return this._assemble(subAns[0], subAns[0].csim >= 0.45 ? 'ch' : 'subj');
        }
        // 名词型答案但没有任何块讲到该专名、同章题干也不够强 → 宁可不显示，杜绝乱配
        return null;
      }

      /* ============ 描述型答案：沿用强术语 + 锚点 + margin 路径 ============ */
      if (L1.length) {
        L1.sort(bySc);
        // 同章层：候选本就属于同一知识点范围，取最高分即可，不做 margin，但要有强术语锚点
        if (L1[0].ds.sc >= T_CH && L1[0].ds.ss >= SS_CH) return this._assemble(L1[0], 'ch');
      }
      // 同科目层（跨章节）：强术语分+题目自身高稀有度锚点双达标，且与次佳拉开差距
      scored.sort(bySc);
      if (scored[0].ds.sc >= T_SUBJ && scored[0].ds.ss >= SS_SUBJ && scored[0].ds.top.anchor >= ANCHOR &&
          (scored.length < 2 || scored[0].ds.ss >= scored[1].ds.ss * 1.4))
        return this._assemble(scored[0], scored[0].csim >= 0.45 ? 'ch' : 'subj');
      // L3 宽松兜底（仅整卷 strict；题库已有章节、覆盖率足够，不启用以免引入噪声）：
      // 已成功定科=主题科属明确，放宽分值/差距，但仍要求题目自身锚点（非纯套话）且不跨科
      if (strict && scored[0].ds.sc >= 6.0 && scored[0].ds.ss >= 5.0 && scored[0].ds.top.anchor >= 2.3 &&
          (scored.length < 2 || scored[0].ds.ss >= scored[1].ds.ss * 1.22))
        return this._assemble(scored[0], scored[0].csim >= 0.45 ? 'ch' : 'subj');
      return null;
    },

    _assemble: function (pick, layer) {
      var doc = pick.doc, top = pick.ds.top, used = pick.ds.used, ent = doc.ent;
      var bx = top.b[0], by = top.b[1], bw = top.b[2], bh = top.b[3];
      var y0 = Math.max(0, by - bh * 0.6), y1 = Math.min(1, by + bh * 2.8);
      var x0 = Math.max(0, bx - 0.012), x1 = Math.min(1, bx + bw + 0.012), anchorCy = top.cy;
      ent.b.forEach(function (b) {
        var cy = b[1] + b[3] / 2;
        if (Math.abs(cy - anchorCy) < 0.10) {
          x0 = Math.min(x0, Math.max(0, b[0] - 0.008));
          x1 = Math.max(x1, Math.min(1, b[0] + b[2] + 0.008));
          if (cy >= y0 && cy <= y1) { y0 = Math.min(y0, Math.max(0, b[1] - b[3] * 0.5)); y1 = Math.max(y1, Math.min(1, b[1] + b[3] * 1.4)); }
        }
      });
      var hitSet = {};
      used.forEach(function (u) { u.hits.forEach(function (h) { hitSet[h] = 1; }); });
      return {
        card: doc.card, x: x0, y: y0, w: Math.min(1, x1 - x0), h: y1 - y0,
        iw: ent.W || 2416, ih: ent.H || 1313, text: top.b[4], sc: pick.ds.sc,
        sameCh: layer === 'ch', layer: layer, hits: Object.keys(hitSet).slice(0, 10)
      };
    }
  };

  root.TTMatchEngine = ENGINE;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
