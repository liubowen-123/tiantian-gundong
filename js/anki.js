/* ===== 天天滚动 · Anki 调度模块（SM-2 风格间隔重复） ===== */
(function () {
  'use strict';

  /*
   * 适用于记忆卡（type === 'card'）：
   * 状态机：new → learning → review，review 答错 → relearning（回到学习步骤）
   * 四档评级：again(重来) / hard(困难) / good(良好) / easy(简单)
   *
   * 卡片上的 Anki 字段（存在 item.anki 中）：
   *   state:      new | learning | review | relearning
   *   ease:       难度系数，默认 2.5，范围 [1.3, 3.0]
   *   interval:   当前复习间隔（天），learning 阶段为 0
   *   step:       学习步骤索引
   *   due:        下次到期时间戳（ms），null 表示未安排
   *   lapses:     遗忘（答错）次数
   *   suspended:  是否暂停
   */

  const DEFAULT_ANKI = {
    learningSteps: [1, 10],   // 学习步骤（分钟）
    graduatingInterval: 1,    // 毕业间隔（天）
    easyInterval: 4,          // 简易间隔（天）
    easyBonus: 1.3,           // 简易加成
    startingEase: 2.5,
    minEase: 1.3,
    maxEase: 3.0,
    maxInterval: 3650         // 最长间隔（天），约 10 年
  };

  function defaultAnki() {
    const d = Object.assign({}, DEFAULT_ANKI, (TTStore.getSettings().anki || {}));
    return {
      state: 'new',
      ease: d.startingEase,
      interval: 0,
      step: 0,
      due: null,
      lapses: 0,
      suspended: false,
      settings: d
    };
  }

  /** 实时配置（设置修改即时生效） */
  function getCfg() {
    return Object.assign({}, DEFAULT_ANKI, (TTStore.getSettings().anki || {}));
  }

  function ensureAnki(item) {
    if (item.type !== 'card') return item;
    if (!item.anki) {
      const a = defaultAnki();
      // 旧数据迁移：之前用艾宾浩斯 stage 的卡片
      if (item.stage >= 0) {
        a.state = 'review';
        a.interval = 1; // 保守起步
        a.due = item.nextReview ? new Date(item.nextReview + 'T09:00:00').getTime() : Date.now();
      }
      item.anki = a;
    }
    return item;
  }

  /** 间隔 → 人类可读 */
  function fmtInterval(days) {
    if (days <= 0) return '今天';
    if (days < 1) {
      const min = Math.max(1, Math.round(days * 24 * 60));
      if (min < 60) return min + ' 分钟';
      return Math.round(min / 60) + ' 小时';
    }
    if (days < 30) return Math.round(days) + ' 天';
    if (days < 365) return Math.round(days / 30) + ' 个月';
    return (days / 365).toFixed(1) + ' 年';
  }

  /** 评级后的收尾：同步顶层字段 + 写每日日志 + 持久化 */
  function finish(card, rating, delta) {
    const a = card.anki;
    const ok = rating !== 'again';
    a.lastResult = ok ? 'ok' : 'wrong';
    a.lastReviewDate = TTStore.todayStr();
    // 同步顶层字段（内容库/进度统计依赖）
    card.reviewCount = (card.reviewCount || 0) + 1;
    card.lastResult = a.lastResult;
    card.lastReviewDate = a.lastReviewDate;
    if (ok) delta.correct = 1; else delta.wrong = 1;
    // 写回 localStorage
    TTStore.updateContent(card.id, {
      anki: a,
      reviewCount: card.reviewCount,
      lastResult: card.lastResult,
      lastReviewDate: card.lastReviewDate
    });
    TTStore.logDay(TTStore.todayStr(), delta);
    TTStore.setLastDate(TTStore.todayStr());
    return card;
  }

  const Anki = {

    DEFAULT_ANKI,
    ensureAnki,
    fmtInterval,

    /** 迁移所有卡片的 Anki 字段 */
    migrate() {
      const list = TTStore.getContent();
      let changed = false;
      list.forEach(item => {
        if (item.type !== 'card') return;
        const before = JSON.stringify(item.anki || null);
        ensureAnki(item);
        if (JSON.stringify(item.anki) !== before) changed = true;
      });
      if (changed) TTStore.saveContent(list);
    },

    /** 到期卡片（含 learning 到期与 review 到期） */
    dueCards() {
      const now = Date.now();
      return TTStore.getContent().filter(x =>
        x.type === 'card' &&
        x.anki && !x.anki.suspended &&
        x.anki.state !== 'new' &&
        x.anki.due && x.anki.due <= now
      );
    },

    /** 新卡片（未学习） */
    newCards() {
      return TTStore.getContent().filter(x =>
        x.type === 'card' && x.anki && !x.anki.suspended && x.anki.state === 'new'
      );
    },

    /** 预览各评级将安排的间隔（天） */
    preview(card, rating) {
      const a = ensureAnki(card).anki;
      const d = getCfg();
      const now = Date.now();
      const clone = { state: a.state, ease: a.ease, interval: a.interval, step: a.step, lapses: a.lapses };

      const inLearning = a.state === 'learning' || a.state === 'relearning';
      const steps = d.learningSteps;
      const lastStep = steps.length - 1;

      if (a.state === 'new') {
        // 新卡首次：直接按 good 进入学习步骤 0
        clone.state = 'learning'; clone.step = 0;
        if (rating === 'again') return { days: 0, label: '10 分钟内' };
        if (rating === 'hard') return { days: 0, label: '1 分钟后' };
        if (rating === 'good') return { days: 0, label: steps[0] + ' 分钟后' };
        if (rating === 'easy') return { days: d.easyInterval, label: fmtInterval(d.easyInterval) };
      }

      if (inLearning) {
        if (rating === 'again') return { days: 0, label: steps[0] + ' 分钟内' };
        if (rating === 'hard') return { days: 0, label: steps[clone.step] + ' 分钟内' };
        if (rating === 'good') {
          return clone.step >= lastStep
            ? { days: d.graduatingInterval, label: fmtInterval(d.graduatingInterval) }
            : { days: 0, label: steps[clone.step + 1] + ' 分钟后' };
        }
        if (rating === 'easy') return { days: d.easyInterval, label: fmtInterval(d.easyInterval) };
      }

      // review / relearning 完成态
      if (rating === 'again') return { days: 0, label: steps[0] + ' 分钟内' };
      if (rating === 'hard') {
        const iv = Math.max(1, clone.interval * 1.2);
        return { days: iv, label: fmtInterval(iv) };
      }
      if (rating === 'good') {
        const iv = Math.min(d.maxInterval, clone.interval * clone.ease);
        return { days: iv, label: fmtInterval(Math.max(1, iv)) };
      }
      if (rating === 'easy') {
        const iv = Math.min(d.maxInterval, clone.interval * clone.ease * d.easyBonus);
        return { days: iv, label: fmtInterval(Math.max(d.easyInterval, iv)) };
      }
      return { days: 0, label: '' };
    },

    /**
     * 对卡片执行一次评级，返回更新后的卡片
     * rating: 'again' | 'hard' | 'good' | 'easy'
     */
    learn(card, rating) {
      ensureAnki(card);
      const a = card.anki;
      const d = getCfg();
      const now = Date.now();
      const MIN = 60 * 1000;
      const DAY = 24 * 3600 * 1000;
      const steps = d.learningSteps;
      const lastStep = steps.length - 1;
      const wasNew = a.state === 'new';
      const wasReview = a.state === 'review';

      if (a.state === 'new') {
        // 新卡 → learning step 0
        a.state = 'learning';
        a.step = 0;
        if (rating === 'easy') {
          // easy：直接毕业进 review
          a.state = 'review';
          a.interval = d.easyInterval;
          a.ease = Math.min(d.maxEase, a.ease + 0.15);
          a.due = now + a.interval * DAY;
        } else {
          a.interval = 0;
          a.due = now + (rating === 'hard' ? 1 : steps[0]) * MIN;
        }
        return finish(card, rating, { review: 0, newLearned: 1 });
      }

      if (a.state === 'learning' || a.state === 'relearning') {
        if (rating === 'again') {
          a.step = 0;
          a.due = now + steps[0] * MIN;
        } else if (rating === 'hard') {
          a.due = now + steps[a.step] * MIN; // 停留当前步骤
        } else if (rating === 'good') {
          if (a.step >= lastStep) {
            // 学习步骤完成 → 毕业进 review
            a.state = 'review';
            a.interval = d.graduatingInterval;
            a.due = now + a.interval * DAY;
          } else {
            a.step += 1;
            a.due = now + steps[a.step] * MIN;
          }
        } else if (rating === 'easy') {
          a.state = 'review';
          a.interval = d.easyInterval;
          a.ease = Math.min(d.maxEase, a.ease + 0.15);
          a.due = now + a.interval * DAY;
        }
        return finish(card, rating, { review: 1 });
      }

      // ---- review 状态 ----
      if (rating === 'again') {
        // 遗忘 → 进入重学（relearning），ease 降低
        a.state = 'relearning';
        a.step = 0;
        a.lapses += 1;
        a.ease = Math.max(d.minEase, a.ease - 0.2);
        a.interval = 0;
        a.due = now + steps[0] * MIN;
      } else if (rating === 'hard') {
        a.interval = Math.min(d.maxInterval, Math.max(1, a.interval * 1.2));
        a.due = now + a.interval * DAY;
        // hard 不改变 ease
      } else if (rating === 'good') {
        a.interval = Math.min(d.maxInterval, a.interval * a.ease);
        a.due = now + a.interval * DAY;
        // good 不改变 ease
      } else if (rating === 'easy') {
        a.interval = Math.min(d.maxInterval, a.interval * a.ease * d.easyBonus);
        a.ease = Math.min(d.maxEase, a.ease + 0.15);
        a.due = now + a.interval * DAY;
      }
      return finish(card, rating, { review: 1 });
    },

    /** 卡片状态标签 */
    stateLabel(item) {
      const a = item.anki;
      if (!a) return '未学习';
      if (a.suspended) return '已暂停';
      if (a.state === 'new') return '新卡';
      if (a.state === 'learning') return '学习中';
      if (a.state === 'relearning') return '重学中';
      return '复习中';
    },

    /** 卡片状态徽标 class */
    stateBadgeClass(item) {
      const a = item.anki;
      if (!a || a.suspended) return 'sub';
      if (a.state === 'new') return 'type';
      if (a.state === 'learning' || a.state === 'relearning') return 'sub';
      return '';
    }
  };

  window.TTAnki = Anki;
})();
