/* ===== 天天滚动 · 调度引擎（艾宾浩斯 + Anki 双轨） ===== */
(function () {
  'use strict';

  /*
   * 双轨调度：
   * - 选择题（quiz）：艾宾浩斯固定间隔 1/2/4/7/15/30 天，答错当天重刷
   * - 记忆卡（card）：Anki SM-2 风格（见 anki.js），四档评级动态间隔
   * 两条轨道合并为统一的"今日队列"。
   */

  function todayStr() { return TTStore.todayStr(); }

  function isQuiz(x) { return x.type === 'quiz'; }
  function isCard(x) { return x.type === 'card'; }

  /** 按学习模式过滤条目：all(全部) | quiz(刷题) | card(Anki) */
  function typeOk(x, mode) {
    if (mode === 'quiz') return x.type === 'quiz';
    if (mode === 'card') return x.type === 'card';
    if (mode === 'wrong') return true;
    return true;
  }

  const Scheduler = {

    /** 条目是否视为"已毕业"（不再进队列） */
    isGraduated(x) {
      if (isCard(x)) {
        // 卡片无显式毕业；间隔 ≥ 365 天视为长期掌握
        return !!(x.anki && x.anki.interval >= 365);
      }
      return !!x.graduated;
    },

    /** 今日待复习（到期）条目：艾宾浩斯到期 + Anki 到期。mode: all|quiz|card */
    dueItems(mode) {
      const today = todayStr();
      const now = Date.now();
      return TTStore.getContent().filter(x => {
        if (!typeOk(x, mode)) return false;
        if (isQuiz(x)) {
          return !x.graduated && x.stage >= 0 && x.nextReview && x.nextReview <= today;
        }
        if (isCard(x)) {
          return x.anki && !x.anki.suspended &&
            x.anki.state !== 'new' &&
            x.anki.due != null && x.anki.due <= now &&
            !(x.anki.interval >= 365);
        }
        return false;
      });
    },

    /** 今日新学额度：未学习条目（选择题 stage<0 或 卡片 new），按创建时间取前 N 个。mode: all|quiz|card */
    newItems(mode) {
      const settings = TTStore.getSettings();
      const unlearned = TTStore.getContent()
        .filter(x => {
          if (!typeOk(x, mode)) return false;
          if (isQuiz(x)) return x.stage < 0;
          if (isCard(x)) return x.anki && !x.anki.suspended && x.anki.state === 'new';
          return false;
        })
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const done = this.dayLog().newLearned;
      return unlearned.slice(0, Math.max(0, settings.dailyNew - done));
    },

    /** 今日队列：先复习，后新学。mode: all|quiz|card */
    todayQueue(mode) {
      const due = this.dueItems(mode);
      const fresh = this.newItems(mode);
      // 错题重刷：今天答错过且仍到期的，插到复习队列最前
      const wrongToday = this.wrongItemsToday(mode);
      const dueIds = new Set(due.map(x => x.id));
      const wrongIds = new Set(wrongToday.map(x => x.id));
      const orderedDue = [
        ...wrongToday.filter(x => dueIds.has(x.id)),
        ...due.filter(x => !wrongIds.has(x.id))
      ];
      return { due: orderedDue, fresh, total: orderedDue.length + fresh.length };
    },

    /** 错题优先队列：仅今日错题。mode: all|quiz|card|wrong */
    wrongTodayQueue(mode) {
      const wrong = this.wrongItemsToday(mode);
      return { due: wrong, fresh: [], total: wrong.length };
    },

    /** 今日答错待重刷条目。mode: all|quiz|card|wrong */
    wrongItemsToday(mode) {
      const today = todayStr();
      const now = Date.now();
      return TTStore.getContent().filter(x => {
        if (!typeOk(x, mode)) return false;
        if (isQuiz(x)) {
          return !x.graduated && x.stage >= 0 &&
            x.nextReview === today && x.lastResult === 'wrong';
        }
        if (isCard(x)) {
          return x.anki && !x.anki.suspended &&
            x.lastReviewDate === today && x.lastResult === 'wrong' &&
            x.anki.due != null && x.anki.due <= now;
        }
        return false;
      });
    },

    /** 今日已完成复习的条目 */
    doneItemsToday() {
      const today = todayStr();
      return TTStore.getContent().filter(x =>
        !this.isGraduated(x) && x.lastReviewDate === today && x.lastResult === 'ok'
      );
    },

    /** 今日进度：完成数 / 总队列 */
    todayProgress() {
      const q = this.todayQueue();
      const done = this.doneItemsToday().length;
      const total = q.total;
      return { done, total, pct: total === 0 ? 1 : Math.min(1, done / total) };
    },

    dayLog() {
      const log = TTStore.getLog();
      return log[todayStr()] || { review: 0, correct: 0, wrong: 0, newLearned: 0, graduated: 0 };
    },

    /**
     * 学习一条选择题（艾宾浩斯轨道）
     * result: 'ok' | 'wrong'
     */
    learnItem(id, result) {
      const item = TTStore.getById(id);
      if (!item || !isQuiz(item)) return null;
      const today = todayStr();
      const settings = TTStore.getSettings();
      const intervals = settings.intervals;

      const isNew = item.stage < 0;
      const correct = result === 'ok';
      const delta = { review: isNew ? 0 : 1, correct: 0, wrong: 0, newLearned: isNew ? 1 : 0, graduated: 0 };

      let nextStage = item.stage;
      if (isNew) {
        nextStage = 0;
      } else if (correct) {
        nextStage = item.stage + 1;
      } else {
        nextStage = Math.max(0, item.stage - 1);
      }

      const graduated = !isNew && correct && nextStage >= intervals.length;

      let nextReview = null;
      if (!graduated) {
        if (correct) {
          const idx = Math.min(nextStage, intervals.length - 1);
          nextReview = TTStore.addDays(today, intervals[idx]);
        } else {
          nextReview = today;
        }
      }

      const patch = {
        stage: nextStage,
        nextReview,
        graduated,
        reviewCount: item.reviewCount + (isNew ? 0 : 1),
        wrongCount: item.wrongCount + (correct ? 0 : 1),
        lastResult: correct ? 'ok' : 'wrong',
        lastReviewDate: today
      };
      if (isNew) patch.firstLearnDate = today;

      if (correct) delta.correct = 1; else delta.wrong = 1;
      if (graduated) delta.graduated = 1;

      TTStore.updateContent(id, patch);
      TTStore.logDay(today, delta);
      TTStore.setLastDate(today);

      return {
        item: TTStore.getById(id),
        isNew,
        correct,
        graduated,
        delta
      };
    },

    /**
     * 学习一条记忆卡（Anki 轨道）
     * rating: 'again' | 'hard' | 'good' | 'easy'
     */
    learnCard(id, rating) {
      const card = TTStore.getById(id);
      if (!card || !isCard(card)) return null;
      const wasNew = card.anki && card.anki.state === 'new';
      TTAnki.learn(card, rating);
      return {
        item: TTStore.getById(id),
        isNew: wasNew,
        correct: rating !== 'again',
        graduated: false,
        delta: null
      };
    },

    /** 今日是否已学习（用于打卡横幅） */
    hasStudiedToday() {
      const log = TTStore.getLog()[todayStr()];
      return !!(log && (log.review > 0 || log.newLearned > 0));
    },

    /** 连续打卡天数 */
    streak() {
      const log = TTStore.getLog();
      let streak = 0;
      let d = new Date();
      if (!this.hasStudiedToday()) d.setDate(d.getDate() - 1);
      while (true) {
        const key = TTStore.todayStr(d);
        const day = log[key];
        if (day && (day.review > 0 || day.newLearned > 0)) {
          streak++;
          d.setDate(d.getDate() - 1);
        } else {
          break;
        }
      }
      return streak;
    },

    /** 总正确率 */
    accuracy() {
      const log = TTStore.getLog();
      let correct = 0, wrong = 0;
      Object.keys(log).forEach(k => {
        correct += log[k].correct || 0;
        wrong += log[k].wrong || 0;
      });
      const total = correct + wrong;
      return total === 0 ? null : Math.round(correct / total * 100);
    },

    /** 明日到期数（含明日到期的选择题；记忆卡按分钟到期难预测，略去） */
    tomorrowDueCount() {
      const tomorrow = TTStore.addDays(todayStr(), 1);
      return TTStore.getContent().filter(x =>
        isQuiz(x) && !x.graduated && x.stage >= 0 && x.nextReview === tomorrow
      ).length;
    },

    /** 每日记录：今日题数 + 累计已记录天数 */
    dailyRecord() {
      const log = TTStore.getLog();
      const today = todayStr();
      const td = log[today] || { review: 0, newLearned: 0 };
      const todayCount = (td.review || 0) + (td.newLearned || 0);
      let activeDays = 0;
      Object.keys(log).forEach(k => {
        const d = log[k];
        if (d && ((d.review || 0) > 0 || (d.newLearned || 0) > 0)) activeDays++;
      });
      return { todayCount, recordedDays: activeDays };
    },

    /** 错题本：所有答错过（wrongCount>0）的条目，按错次排序 */
    wrongBook() {
      return TTStore.getContent()
        .filter(x => (x.wrongCount || 0) > 0)
        .sort((a, b) => (b.wrongCount || 0) - (a.wrongCount || 0));
    },

    /** 今日错题数（用于任务页"错题回炉"） */
    wrongTodayCount() {
      return this.wrongItemsToday().length;
    },

    /** 按科目统计选择题刷题进度：{subject, total, done, pct} */
    subjectQuizStats() {
      const bySub = {};
      TTStore.getContent().forEach(x => {
        if (!isQuiz(x)) return;
        bySub[x.subject] = bySub[x.subject] || { total: 0, done: 0 };
        bySub[x.subject].total++;
        if (x.stage >= 0 || (x.reviewCount || 0) > 0) bySub[x.subject].done++;
      });
      return Object.keys(bySub).map(s => {
        const o = bySub[s];
        return { subject: s, total: o.total, done: o.done, pct: o.total === 0 ? 0 : Math.round(o.done / o.total * 100) };
      }).sort((a, b) => b.total - a.total);
    },

    /** 五科掌握度：每科 已掌握(毕业)/总数 占比 */
    subjectMastery() {
      const bySub = {};
      TTStore.getContent().forEach(x => {
        bySub[x.subject] = bySub[x.subject] || { total: 0, mastered: 0 };
        bySub[x.subject].total++;
        if (this.isGraduated(x)) bySub[x.subject].mastered++;
      });
      return Object.keys(bySub).map(s => {
        const o = bySub[s];
        return { subject: s, total: o.total, mastered: o.mastered, pct: o.total === 0 ? 0 : Math.round(o.mastered / o.total * 100) };
      }).sort((a, b) => b.total - a.total);
    },

    /** 所有科目名（按条目数降序） */
    subjects() {
      const bySub = {};
      TTStore.getContent().forEach(x => {
        bySub[x.subject] = (bySub[x.subject] || 0) + 1;
      });
      return Object.keys(bySub).sort((a, b) => bySub[b] - bySub[a]);
    },

    /** 某科目的刷题队列：选择题按创建时间排序（新学在前、先呈现） */
    subjectQuizQueue(subject) {
      return TTStore.getContent()
        .filter(x => isQuiz(x) && x.subject === subject)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    },

    /** 某科目的章节列表（按条目数降序；空章节记作"未分章"） */
    subjectChapters(subject) {
      const byCh = {};
      TTStore.getContent().forEach(x => {
        if (x.subject !== subject) return;
        const ch = x.chapter || '未分章';
        byCh[ch] = (byCh[ch] || 0) + 1;
      });
      return Object.keys(byCh).sort((a, b) => byCh[b] - byCh[a]);
    },

    /** 某科目内按章节统计选择题进度：{chapter, total, done, pct} */
    chapterQuizStats(subject) {
      const byCh = {};
      TTStore.getContent().forEach(x => {
        if (!isQuiz(x) || x.subject !== subject) return;
        const ch = x.chapter || '未分章';
        byCh[ch] = byCh[ch] || { total: 0, done: 0 };
        byCh[ch].total++;
        if (x.stage >= 0 || (x.reviewCount || 0) > 0) byCh[ch].done++;
      });
      return Object.keys(byCh).map(ch => {
        const o = byCh[ch];
        return { chapter: ch, total: o.total, done: o.done, pct: o.total === 0 ? 0 : Math.round(o.done / o.total * 100) };
      }).sort((a, b) => b.total - a.total);
    },

    /** 某科目某章节的选择题刷题队列 */
    chapterQuizQueue(subject, chapter) {
      const target = chapter || '未分章';
      return TTStore.getContent()
        .filter(x => isQuiz(x) && x.subject === subject && (x.chapter || '未分章') === target)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    },

    /** 图片挖空卡（可按 章节字符串 或 {subject,chapter} 筛选；空/不传 → 全部） */
    imageCards(sel) {
      const has = Array.isArray(sel) && sel.length > 0;
      const match = x => {
        if (!has) return true;
        return sel.some(s => {
          if (typeof s === 'string') return (x.chapter || '未分章') === s;
          return x.subject === s.subject && (x.chapter || '未分章') === s.chapter;
        });
      };
      return TTStore.getContent()
        .filter(x => isCard(x) && Array.isArray(x.masks) && x.masks.length)
        .filter(match)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    },

    /** 图片挖空卡的（科目, 章节）清单与数量 */
    imageChapters() {
      const byK = {};
      TTStore.getContent().forEach(x => {
        if (isCard(x) && Array.isArray(x.masks) && x.masks.length) {
          const subject = x.subject || '未分类';
          const chapter = x.chapter || '未分章';
          const k = subject + '|' + chapter;
          if (!byK[k]) byK[k] = { subject, chapter, count: 0 };
          byK[k].count++;
        }
      });
      return Object.values(byK)
        .map(o => ({ subject: o.subject, chapter: o.chapter, count: o.count }))
        .sort((a, b) => a.subject === b.subject ? b.count - a.count : String(a.subject).localeCompare(String(b.subject)));
    },

    /** 选择题的年份清单与数量（有 year 字段的） */
    quizYears() {
      const byY = {};
      TTStore.getContent().forEach(x => {
        if (!isQuiz(x) || !x.year) return;
        byY[x.year] = (byY[x.year] || 0) + 1;
      });
      return Object.keys(byY).map(y => ({ year: Number(y), count: byY[y] })).sort((a, b) => a.year - b.year);
    },

    /** 按年份筛选选择题刷题队列（years 空 → 全部） */
    quizByYears(years) {
      const has = Array.isArray(years) && years.length > 0;
      return TTStore.getContent()
        .filter(x => isQuiz(x) && (!has || years.indexOf(x.year) >= 0))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    },


    };

  window.TTScheduler = Scheduler;
})();