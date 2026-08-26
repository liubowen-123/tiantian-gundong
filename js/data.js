/* ===== 天天滚动 · 内置示例内容（西综考研） ===== */
/* 仅作功能演示，内容整理自公开考点，请以教材与真题为准 */
(function () {
  'use strict';

  function seed() {
    const list = [
      // ============ 生理学 ============
      { type: 'quiz', subject: '生理学', chapter: '血液', question: '血浆胶体渗透压的主要来源是：', options: ['白蛋白', '球蛋白', '纤维蛋白原', 'NaCl'], answer: 0, explain: '血浆胶体渗透压主要由白蛋白（清蛋白）维持，因其分子量小、数量多。' },
      { type: 'quiz', subject: '生理学', chapter: '血液循环', question: '正常成人安静状态下，心输出量约为：', options: ['3 L/min', '4.5~6 L/min', '8~10 L/min', '12 L/min'], answer: 1, explain: '正常成人安静时每搏输出量约 60~80ml，心率约 75 次/分，心输出量约 4.5~6 L/min。' },
      { type: 'card', subject: '生理学', chapter: '神经-肌肉', question: '神经-骨骼肌接头处的兴奋传递递质是什么？', explain: '乙酰胆碱（ACh）。ACh 与终板膜上的 N₂ 型胆碱能受体结合，引起终板电位。' },
      { type: 'card', subject: '生理学', chapter: '血液循环', question: '影响动脉血压的因素有哪些？', explain: '每搏输出量、心率、外周阻力、主动脉和大动脉的弹性贮器作用、循环血量与血管系统容量的比例。' },

      // ============ 生物化学 ============
      { type: 'quiz', subject: '生物化学', chapter: '糖代谢', question: '糖酵解过程中最重要的限速酶是：', options: ['己糖激酶', '磷酸果糖激酶-1', '丙酮酸激酶', '葡萄糖-6-磷酸酶'], answer: 1, explain: '磷酸果糖激酶-1（PFK-1）是糖酵解最主要的限速酶，受 ATP、柠檬酸抑制，受 AMP、果糖-2,6-二磷酸激活。' },
      { type: 'quiz', subject: '生物化学', chapter: '糖代谢', question: '三羧酸循环中唯一底物水平磷酸化的反应是：', options: ['柠檬酸→异柠檬酸', 'α-酮戊二酸→琥珀酰CoA', '琥珀酰CoA→琥珀酸', '苹果酸→草酰乙酸'], answer: 2, explain: '琥珀酰CoA 合成酶催化琥珀酰CoA→琥珀酸时产生 GTP（底物水平磷酸化）。' },
      { type: 'card', subject: '生物化学', chapter: '核酸', question: 'DNA 双螺旋结构的要点？', explain: '两条反向平行多核苷酸链；磷酸-脱氧核糖在外侧，碱基在内侧；A-T、G-C 碱基互补配对；螺旋直径 2nm，螺距 3.4nm（B-DNA）。' },
      { type: 'card', subject: '生物化学', chapter: '糖代谢', question: '糖原合成与分解的关键酶分别是什么？', explain: '合成关键酶：糖原合酶；分解关键酶：糖原磷酸化酶。两者受激素调节，方向相反。' },

      // ============ 病理学 ============
      { type: 'quiz', subject: '病理学', chapter: '炎症', question: '肉芽肿性炎最常见于下列哪种病原体感染？', options: ['金黄色葡萄球菌', '结核分枝杆菌', '大肠杆菌', '肺炎链球菌'], answer: 1, explain: '结核分枝杆菌感染引起典型肉芽肿——结核结节，属感染性肉芽肿。' },
      { type: 'quiz', subject: '病理学', chapter: '肿瘤', question: '良恶性肿瘤最主要的区别在于：', options: ['生长速度', '有无包膜', '分化程度', '体积大小'], answer: 2, explain: '分化程度（异型性）是区分良恶性的最根本依据，异型性越大恶性程度越高。' },
      { type: 'card', subject: '病理学', chapter: '炎症', question: '纤维素性炎的好发部位？', explain: '心包（绒毛心）、肺（大叶性肺炎灰色肝样变期）、肠黏膜（菌痢假膜）等，渗出物以纤维素为主。' },
      { type: 'card', subject: '病理学', chapter: '局部血液循环障碍', question: '血栓形成的条件有哪些？', explain: '①心血管内膜损伤（最重要）；②血流状态改变（缓慢、涡流）；③血液凝固性增加。' },

      // ============ 内科学 ============
      { type: 'quiz', subject: '内科学', chapter: '呼吸系统', question: '诊断慢性阻塞性肺疾病（COPD）的肺功能金标准是：', options: ['FEV1/FVC < 70% 且吸入支气管扩张剂后 FEV1 < 80% 预计值', '残气量增加', '肺总量增加', '弥散功能下降'], answer: 0, explain: '吸入支气管扩张剂后 FEV1/FVC < 70% 提示持续气流受限，是 COPD 诊断的金标准。' },
      { type: 'quiz', subject: '内科学', chapter: '循环系统', question: '急性心肌梗死最早出现的心电图改变是：', options: ['T 波倒置', 'ST 段抬高', '病理性 Q 波', '高尖 T 波'], answer: 3, explain: '超急性期最早出现高尖 T 波（数分钟内），随后 ST 段抬高，Q 波多在数小时至 1~2 天内出现。' },
      { type: 'card', subject: '内科学', chapter: '血液系统', question: '缺铁性贫血的血象与骨髓象特征？', explain: '小细胞低色素性贫血；骨髓红系增生，铁染色示细胞外铁减少或消失，铁粒幼细胞减少。' },
      { type: 'card', subject: '内科学', chapter: '循环系统', question: '高血压急症的处理原则？', explain: '迅速将血压控制在安全范围（但不宜过低），常用静脉降压药（硝普钠、乌拉地尔等），避免使用短效口服降压药舌下含服。' },

      // ============ 外科学 ============
      { type: 'quiz', subject: '外科学', chapter: '无菌术', question: '外科手术切口感染最常见的病原菌是：', options: ['金黄色葡萄球菌', '大肠杆菌', '铜绿假单胞菌', '厌氧菌'], answer: 0, explain: '皮肤表面寄居的金黄色葡萄球菌是切口感染最常见来源。' },
      { type: 'quiz', subject: '外科学', chapter: '胸部损伤', question: '开放性气胸急救处理的首要措施是：', options: ['吸氧', '立即封闭伤口', '胸腔闭式引流', '气管插管'], answer: 1, explain: '开放性气胸应立即用无菌敷料（凡士林纱布）封闭创口，变开放性为闭合性，再行进一步处理。' },
      { type: 'card', subject: '外科学', chapter: '无菌术', question: '无菌术包括哪些内容？', explain: '灭菌法、消毒法、无菌操作规则及管理制度。灭菌是杀灭一切活的微生物，消毒是杀灭病原微生物。' },
      { type: 'card', subject: '外科学', chapter: '围手术期处理', question: '术后早期下床活动的优点？', explain: '预防深静脉血栓、促进肠蠕动恢复、减少肺部并发症、防止压疮和尿潴留。' },

      // ============ 诊断学 ============
      { type: 'quiz', subject: '诊断学', chapter: '心电图', question: '心电图 P 波代表：', options: ['心房除极', '心室除极', '心房复极', '心室复极'], answer: 0, explain: 'P 波为心房除极波；QRS 波为心室除极；T 波为心室复极。' },
      { type: 'card', subject: '诊断学', chapter: '常见症状', question: '稽留热、弛张热、间歇热各见于哪些疾病？', explain: '稽留热：大叶性肺炎、伤寒高热期；弛张热：败血症、风湿热；间歇热：疟疾、急性肾盂肾炎。' },
    ];

    // 打上创建时间，保证入库顺序稳定；标记 _sample 供 removeSamples 识别
    const base = Date.now() - list.length * 60000;
    return list.map((item, i) => {
      const s = TTStore.addContent(Object.assign({ _sample: true }, item));
      TTStore.updateContent(s.id, { createdAt: base + i * 60000 });
      return s;
    });
  }

  /* 初始示例题的题干（用于启动时清理掉这些"最开始生成的题"） */
  const SAMPLE_QUESTIONS = [
    '血浆胶体渗透压的主要来源是：',
    '正常成人安静状态下，心输出量约为：',
    '神经-骨骼肌接头处的兴奋传递递质是什么？',
    '影响动脉血压的因素有哪些？',
    '糖酵解过程中最重要的限速酶是：',
    '三羧酸循环中唯一底物水平磷酸化的反应是：',
    'DNA 双螺旋结构的要点？',
    '糖原合成与分解的关键酶分别是什么？',
    '肉芽肿性炎最常见于下列哪种病原体感染？',
    '良恶性肿瘤最主要的区别在于：',
    '纤维素性炎的好发部位？',
    '血栓形成的条件有哪些？',
    '诊断慢性阻塞性肺疾病（COPD）的肺功能金标准是：',
    '急性心肌梗死最早出现的心电图改变是：',
    '缺铁性贫血的血象与骨髓象特征？',
    '高血压急症的处理原则？',
    '外科手术切口感染最常见的病原菌是：',
    '开放性气胸急救处理的首要措施是：',
    '无菌术包括哪些内容？',
    '术后早期下床活动的优点？',
    '心电图 P 波代表：',
    '稽留热、弛张热、间歇热各见于哪些疾病？'
  ];

  window.TTSeed = { seed, SAMPLE_QUESTIONS };
})();
