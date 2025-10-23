export class StatisticData {
    constructor(user, type, element) {
        this.user = user;
        this.type = type || '';
        this.element = element || '';
        // StatAcc style
        this.stats = { normal: 0, critical: 0, lucky: 0, crit_lucky: 0, hpLessen: 0, total: 0 };
        this.count = { normal: 0, critical: 0, lucky: 0, total: 0 };
        this.realtimeWindow = []; // last 1s sliding window
        this.timeRange = []; // first and last timestamps
        this.realtimeStats = { value: 0, max: 0 };
        // ActiveSeconds: measured by capped intervals between events (<= 1000ms each)
        this._lastEventTime = 0;
        this._activeMs = 0;
        // Extremes
        this.maxSingle = 0;
        this.minSingle = 0;
    }

    /** 添加数据记录
     * @param {number} value - 数值
     * @param {boolean} isCrit - 是否为暴击
     * @param {boolean} isLucky - 是否为幸运
     * @param {number} hpLessenValue - 生命值减少量（仅伤害使用）
     */
    addRecord(value, isCrit, isLucky, hpLessenValue = 0) {
        const now = Date.now();

        // Update active time: add capped delta since last event (max 1000ms per event)
        if (this._lastEventTime > 0) {
            const delta = now - this._lastEventTime;
            this._activeMs += Math.min(delta, 1000);
        }
        this._lastEventTime = now;

        if (isCrit) {
            if (isLucky) {
                this.stats.crit_lucky += value;
            } else {
                this.stats.critical += value;
            }
        } else if (isLucky) {
            this.stats.lucky += value;
        } else {
            this.stats.normal += value;
        }
        this.stats.total += value;
        this.stats.hpLessen += hpLessenValue;

        if (isCrit) {
            this.count.critical++;
        }
        if (isLucky) {
            this.count.lucky++;
        }
        if (!isCrit && !isLucky) {
            this.count.normal++;
        }
        this.count.total++;

        if (value > 0) {
            if (this.maxSingle === 0 || value > this.maxSingle) this.maxSingle = value;
            if (this.minSingle === 0 || value < this.minSingle) this.minSingle = value;
        }

        this.realtimeWindow.push({
            time: now,
            value,
        });

        if (this.timeRange[0]) {
            this.timeRange[1] = now;
        } else {
            this.timeRange[0] = now;
        }
    }

    updateRealtimeStats() {
        const now = Date.now();

        while (this.realtimeWindow.length > 0 && now - this.realtimeWindow[0].time > 1000) {
            this.realtimeWindow.shift();
        }

        this.realtimeStats.value = 0;
        for (const entry of this.realtimeWindow) {
            this.realtimeStats.value += entry.value;
        }

        if (this.realtimeStats.value > this.realtimeStats.max) {
            this.realtimeStats.max = this.realtimeStats.value;
        }
    }

    getTotalPerSecond() {
        // Prefer ActiveSeconds-based rate (SR style): sum of capped active intervals
        if (this._activeMs && this._activeMs > 0) {
            const rate = (this.stats.total / this._activeMs) * 1000;
            return Number.isFinite(rate) ? rate : 0;
        }
        if (!this.timeRange[0] || !this.timeRange[1]) return 0;
        const totalPerSecond = (this.stats.total / (this.timeRange[1] - this.timeRange[0])) * 1000 || 0;
        return Number.isFinite(totalPerSecond) ? totalPerSecond : 0;
    }

    reset() {
        this.stats = { normal: 0, critical: 0, lucky: 0, crit_lucky: 0, hpLessen: 0, total: 0 };
        this.count = { normal: 0, critical: 0, lucky: 0, total: 0 };
        this.realtimeWindow = [];
        this.timeRange = [];
        this.realtimeStats = { value: 0, max: 0 };
        this._lastEventTime = 0;
        this._activeMs = 0;
        this.maxSingle = 0;
        this.minSingle = 0;
    }
}
