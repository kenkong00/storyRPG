// ========== 工具函数 ==========

const Utils = {
    // 获取DOM元素
    $(selector) {
        return document.querySelector(selector);
    },

    $$(selector) {
        return document.querySelectorAll(selector);
    },

    // 显示/隐藏
    show(el) {
        if (typeof el === 'string') el = this.$(el);
        if (el) el.classList.remove('hidden');
    },

    hide(el) {
        if (typeof el === 'string') el = this.$(el);
        if (el) el.classList.add('hidden');
    },

    // Toast消息
    toast(msg, duration = 2500) {
        const container = this.$('#toast');
        const div = document.createElement('div');
        div.className = 'toast-msg';
        div.textContent = msg;
        container.appendChild(div);
        setTimeout(() => div.remove(), duration);
    },

    // 打字机效果
    async typeText(element, text, speed = 30) {
        if (typeof element === 'string') element = this.$(element);
        element.textContent = '';
        for (let i = 0; i < text.length; i++) {
            element.textContent += text[i];
            await this.sleep(speed);
        }
    },

    // 快速显示文本（跳过打字效果）
    setText(element, text) {
        if (typeof element === 'string') element = this.$(element);
        element.textContent = text;
    },

    // 睡眠
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    // 渐入动画
    fadeIn(el, duration = 300) {
        if (typeof el === 'string') el = this.$(el);
        el.style.opacity = '0';
        el.style.transition = `opacity ${duration}ms ease`;
        this.show(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; });
    },

    // 渐出动画
    fadeOut(el, duration = 300) {
        if (typeof el === 'string') el = this.$(el);
        el.style.opacity = '0';
        setTimeout(() => this.hide(el), duration);
    },

    // 计算百分比
    percent(value, max) {
        if (max === 0) return 0;
        return Math.max(0, Math.min(100, (value / max) * 100));
    },

    // 随机整数
    randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    // 设置HP条
    setHPBar(barId, fillId, current, max) {
        const fill = this.$(fillId);
        if (fill) fill.style.width = this.percent(current, max) + '%';
    },

    // 获取背景图（使用抽象色块代替）
    getSceneBg(sceneType) {
        const colors = {
            town: 'linear-gradient(135deg, #2d1b0e, #4a3520, #6b5b3a)',
            forest: 'linear-gradient(135deg, #0a1a0a, #1a3a1a, #0d2d0d)',
            castle: 'linear-gradient(135deg, #1a1a2e, #2a2a3e, #1a1a2e)',
            dungeon: 'linear-gradient(135deg, #0a0a0f, #1a1a2e, #0f0f1a)',
            wilderness: 'linear-gradient(135deg, #1a2a0a, #3a4a2a, #1a2a1a)',
            cave: 'linear-gradient(135deg, #0f0f0a, #1a1a0f, #0a0a0a)',
            battlefield: 'linear-gradient(135deg, #2a0a0a, #3a1a1a, #1a0a0a)',
        };
        return colors[sceneType] || colors.wilderness;
    },

    // 设置场景背景
    setSceneBg(sceneType, imageUrl = null) {
        const bg = this.$('#background-layer');
        const img = this.$('#bg-image');
        
        if (imageUrl) {
            // 使用实际图片
            img.src = imageUrl;
            img.style.display = 'block';
            bg.style.background = 'none';
        } else {
            // 没有图片时使用渐变色
            const gradient = this.getSceneBg(sceneType);
            bg.style.background = gradient;
            bg.style.backgroundSize = 'cover';
            img.style.display = 'none';
        }
    },

    // 获取随机角色头像色块
    getAvatarPlaceholder(name) {
        const colors = ['#c94848', '#4890c9', '#48c970', '#c9a84c', '#c948c9',
                       '#48c9c9', '#c97048', '#9048c9', '#90c948', '#c99048'];
        const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        return colors[hash % colors.length];
    },

    // 绑定事件
    on(el, event, handler) {
        if (typeof el === 'string') el = this.$(el);
        if (el) el.addEventListener(event, handler);
    },

    // 移除事件
    off(el, event, handler) {
        if (typeof el === 'string') el = this.$(el);
        if (el) el.removeEventListener(event, handler);
    },
};