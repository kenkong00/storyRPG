// ========== 故事剧情管理模块（三级结构） ==========
Admin.registerPage('story', async (container) => {
  // 三级状态
  let storyArcs = [];
  let chapters = [];
  let nodes = [];
  let currentArcId = null;
  let currentChapterId = null;
  let viewMode = 'grid'; // 'grid' | 'list'

  // 当前层级: 'arcs' | 'chapters' | 'nodes'
  let currentLevel = 'arcs';

  // 自定义分类
  let currentArcCategory = '';
  let currentChapterCategory = '';
  let arcCategoryBarInstance = null;
  let chapterCategoryBarInstance = null;
  // 全量缓存（用于分类计数）
  let allArcsCache = [];
  let allChaptersCache = [];
  // 批量选择
  let selectedArcIds = new Set();
  let selectedChapterIds = new Set();

  const NODE_TYPES = { dialogue: '对话', choice: '选择', battle: '战斗', cutscene: '过场' };

  // ===== 模块级共享变量（节点表单使用） =====
  let nodeFormChars = [];
  // 动作 id → 中文名（打开表情选择时从动作库载入；对话里存的就是动作 id）
  let poseNameMap = {};
  // 页面打开就先拉一遍动作库，让对话行上的表情名直接显示中文，
  // 不用等用户点开选择器才认识 pose id。
  (async () => {
    try {
      const lib = await Admin.get('/poses/library');
      (lib.poses || []).forEach(p => { poseNameMap[p.id] = p.name; });
    } catch (_) {}
  })();
  const nodeFormExpTypes = [
    { key: '', label: '无表情' },
    { key: 'normal', label: '平静' }, { key: 'happy', label: '微笑' },
    { key: 'angry', label: '愤怒' }, { key: 'sad', label: '悲伤' },
    { key: 'surprised', label: '惊讶' }, { key: 'arrogant', label: '狂傲' },
    { key: 'defeated', label: '战败' }, { key: 'jealous', label: '妒忌' },
    { key: 'regretful', label: '悔恨' }, { key: 'crying', label: '哭泣' },
    { key: 'begging', label: '求饶' }, { key: 'confident', label: '自信' },
    { key: 'shocked', label: '震惊' }, { key: 'desperate', label: '绝望' },
    { key: 'determined', label: '坚定' },
  ];

  // 位置选项（7种：左三/中间/右三）
  function positionOptions(selected) {
    const positions = [
      { value: 'left-1', label: '左侧1' }, { value: 'left-2', label: '左侧2' }, { value: 'left-3', label: '左侧3' },
      { value: 'center', label: '中间' },
      { value: 'right-1', label: '右侧1' }, { value: 'right-2', label: '右侧2' }, { value: 'right-3', label: '右侧3' },
    ];
    return positions.map(p =>
      `<option value="${p.value}" ${selected === p.value ? 'selected' : ''}>${p.label}</option>`
    ).join('');
  }

  function expressionLabel(exp) {
    if (!exp) return '无表情';
    if (poseNameMap[exp]) return poseNameMap[exp];
    return (nodeFormExpTypes.find(e => e.key === exp) || { label: exp }).label;
  }

  // 表情网格（9列）
  function buildExprGrid(exprs, selectedExp) {
    let html = '<div style="display:grid;grid-template-columns:repeat(9,1fr);gap:4px">';
    nodeFormExpTypes.forEach(et => {
      const imgUrl = exprs[et.key] || '';
      const sel = selectedExp === et.key ? 'selected' : '';
      html += `
        <div class="exp-option ${sel}" data-exp="${et.key}" style="border:2px solid ${sel ? 'var(--gold)' : 'var(--border)'};border-radius:4px;padding:4px;text-align:center;cursor:pointer">
          ${imgUrl ? `<img src="${imgUrl}" style="width:100%;height:50px;object-fit:contain;display:block;margin-bottom:2px">` : `<div style="height:50px;display:flex;align-items:center;justify-content:center;font-size:18px;opacity:0.3">?</div>`}
          <div style="font-size:9px;color:var(--text-muted)">${et.label}</div>
        </div>
      `;
    });
    html += '</div>';
    return html;
  }

  // 对话列表里的百分比 X 坐标 → 旧站位枚举（写回 multi_characters 用）
  function legacyPosOf(posX) {
    const x = Number.isFinite(parseFloat(posX)) ? parseFloat(posX) : 50;
    if (x <= 18) return 'left-1';
    if (x <= 31) return 'left-2';
    if (x <= 44) return 'left-3';
    if (x <= 57) return 'center';
    if (x <= 69) return 'right-3';
    if (x <= 82) return 'right-2';
    return 'right-1';
  }

  // 简易HTML转义
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  // ===== 数据加载 =====
  async function loadArcs() {
    allArcsCache = await Admin.get('/story-arcs/');
    applyArcFilter();
  }

  function applyArcFilter() {
    if (currentArcCategory) {
      storyArcs = allArcsCache.filter(a => a.category_path === currentArcCategory);
    } else {
      storyArcs = allArcsCache.filter(a => !a.category_path);
    }
    selectedArcIds.clear();
    currentLevel = 'arcs';
    renderArcs();
  }

  async function loadChapters(arcId) {
    currentArcId = arcId;
    allChaptersCache = await Admin.get(`/story/chapters?story_arc_id=${arcId}`);
    applyChapterFilter();
  }

  function applyChapterFilter() {
    if (currentChapterCategory) {
      chapters = allChaptersCache.filter(c => c.category_path === currentChapterCategory);
    } else {
      chapters = allChaptersCache.filter(c => !c.category_path);
    }
    selectedChapterIds.clear();
    currentLevel = 'chapters';
    renderChapters();
  }

  async function loadNodes(chapterId) {
    currentChapterId = chapterId;
    nodes = await Admin.get(`/story/nodes?chapter_id=${chapterId}`);
    currentLevel = 'nodes';
    renderNodes();
  }

  // ===== 故事列表渲染 =====
  function renderArcs() {
    const batchAttr = selectedArcIds.size === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : '';
    const barHtml = `
      <div id="arc-cat-bar-host"></div>
      <div class="search-bar">
        <span style="color:var(--text-muted);line-height:2">共 ${storyArcs.length} 个故事</span>
        <span style="color:var(--gold);line-height:2;margin-left:8px">已选 ${selectedArcIds.size} 个</span>
        <span style="margin:0 4px;color:var(--text-muted)">|</span>
        <button class="btn btn-outline btn-sm" id="btn-arc-move-cat" ${batchAttr}>移动分类</button>
        <button class="btn btn-danger btn-sm" id="btn-arc-del-sel" ${batchAttr}>删除选中</button>
        <button class="btn btn-outline btn-sm" id="btn-arc-clear-sel" ${batchAttr}>取消选择</button>
        <div style="flex:1"></div>
        <button class="btn btn-outline btn-sm ${viewMode === 'grid' ? 'btn-gold' : ''}" id="arc-view-grid" title="网格视图">&#9638;</button>
        <button class="btn btn-outline btn-sm ${viewMode === 'list' ? 'btn-gold' : ''}" id="arc-view-list" title="列表视图">&#9776;</button>
        <button class="btn btn-primary btn-sm" id="btn-add-arc">+ 新建故事</button>
      </div>
    `;

    let folderHtml = '';
    if (arcCategoryBarInstance) {
      folderHtml = arcCategoryBarInstance.renderFolderCards();
    }

    let bodyHtml = '';
    if (storyArcs.length === 0 && folderHtml === '') {
      bodyHtml = '<div class="table-empty">暂无故事剧情，请点击"新建故事"创建</div>';
    } else if (storyArcs.length === 0) {
      bodyHtml = folderHtml + '<div class="table-empty">该分类下暂无故事</div>';
    } else if (viewMode === 'grid') {
      bodyHtml = folderHtml + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">';
      storyArcs.forEach(arc => {
        const checked = selectedArcIds.has(arc.id) ? 'checked' : '';
        const imgHtml = arc.image
          ? `<img src="${arc.image}" style="width:100%;height:150px;object-fit:cover;border-radius:4px;margin-bottom:10px">`
          : `<div style="width:100%;height:150px;background:var(--bg-input);border-radius:4px;margin-bottom:10px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px">暂无封面</div>`;
        bodyHtml += `
          <div class="stat-card" style="padding:14px;cursor:pointer;position:relative" data-arc-id="${arc.id}">
            <input type="checkbox" class="arc-checkbox" data-id="${arc.id}" ${checked}
              style="position:absolute;top:8px;left:8px;width:16px;height:16px;accent-color:var(--gold);z-index:2;cursor:pointer">
            ${imgHtml}
            <div style="font-size:14px;font-weight:500;margin-bottom:4px">${arc.title}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">${(arc.description || '').substring(0, 60)}</div>
            <div style="display:flex;gap:4px;justify-content:space-between;align-items:center">
              <span style="font-size:10px;color:var(--text-muted)">排序: ${arc.order_index}</span>
              <div style="display:flex;gap:4px">
                <button class="btn btn-outline btn-sm btn-edit-arc" data-id="${arc.id}" style="font-size:10px;padding:2px 8px">编辑</button>
                <button class="btn btn-outline btn-sm btn-del-arc" data-id="${arc.id}" style="font-size:10px;padding:2px 8px;color:var(--red);border-color:var(--red)">删除</button>
              </div>
            </div>
          </div>
        `;
      });
      bodyHtml += '</div>';
    } else {
      // 列表视图
      bodyHtml = folderHtml + '<div class="table-container"><table><thead><tr><th style="width:40px"><input type="checkbox" id="arc-select-all" title="全选"></th><th style="width:60px">封面</th><th>标题</th><th>描述</th><th>排序</th><th>触发条件</th><th style="width:140px">操作</th></tr></thead><tbody>';
      storyArcs.forEach(arc => {
        const checked = selectedArcIds.has(arc.id) ? 'checked' : '';
        const imgHtml = arc.image
          ? `<img src="${arc.image}" style="width:48px;height:48px;object-fit:cover;border-radius:4px">`
          : `<div style="width:48px;height:48px;background:var(--bg-input);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:10px">无图</div>`;
        bodyHtml += `
          <tr data-arc-id="${arc.id}" style="cursor:pointer">
            <td><input type="checkbox" class="arc-checkbox" data-id="${arc.id}" ${checked} style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>
            <td>${imgHtml}</td>
            <td>${arc.title}</td>
            <td style="font-size:12px">${(arc.description || '').substring(0, 40)}</td>
            <td>${arc.order_index}</td>
            <td style="font-size:11px;color:var(--text-muted)">${arc.trigger_condition ? arc.trigger_condition.substring(0, 20) : '-'}</td>
            <td>
              <div class="action-btns">
                <button class="btn-edit-arc" data-id="${arc.id}">编辑</button>
                <button class="btn-del-arc" data-id="${arc.id}" style="color:var(--red)">删除</button>
              </div>
            </td>
          </tr>
        `;
      });
      bodyHtml += '</tbody></table></div>';
    }

    container.innerHTML = barHtml + bodyHtml;
    // 挂载故事分类栏
    const arcHost = document.getElementById('arc-cat-bar-host');
    if (arcHost) {
      if (!arcCategoryBarInstance) {
        arcCategoryBarInstance = CategoryBar.mount(arcHost, 'story_arc', {
          label: '故事分类',
          totalCount: allArcsCache.length,
          getCount: (path) => {
            if (!path) return allArcsCache.filter(a => !a.category_path).length;
            return allArcsCache.filter(a => a.category_path === path).length;
          },
          onSelect: (path) => {
            currentArcCategory = path || '';
            applyArcFilter();
          },
          onTreeChange: () => renderArcs(),
        });
      } else {
        arcCategoryBarInstance.setPath(currentArcCategory);
      }
    }
    bindArcEvents();
  }

  function bindArcEvents() {
    document.getElementById('arc-view-grid')?.addEventListener('click', () => { viewMode = 'grid'; renderArcs(); });
    document.getElementById('arc-view-list')?.addEventListener('click', () => { viewMode = 'list'; renderArcs(); });
    document.getElementById('btn-add-arc')?.addEventListener('click', () => showArcForm());

    // 全选
    document.getElementById('arc-select-all')?.addEventListener('change', (e) => {
      if (e.target.checked) storyArcs.forEach(a => selectedArcIds.add(a.id));
      else selectedArcIds.clear();
      renderArcs();
    });
    // 单个复选框
    container.querySelectorAll('.arc-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id);
        if (cb.checked) selectedArcIds.add(id); else selectedArcIds.delete(id);
        renderArcs();
      });
      cb.addEventListener('click', (e) => e.stopPropagation());
    });
    // 文件夹卡片点击
    container.querySelectorAll('.folder-card').forEach(el => {
      el.addEventListener('click', () => {
        currentArcCategory = el.dataset.path || '';
        if (arcCategoryBarInstance) arcCategoryBarInstance.setPath(currentArcCategory);
        applyArcFilter();
      });
    });
    // 批量移动分类
    document.getElementById('btn-arc-move-cat')?.addEventListener('click', () => batchMoveArcsCategory());
    // 批量删除
    document.getElementById('btn-arc-del-sel')?.addEventListener('click', async () => {
      if (selectedArcIds.size === 0) return;
      if (!await Admin.confirm(`确定删除选中的 ${selectedArcIds.size} 个故事及其所有章节和节点？`)) return;
      for (const id of selectedArcIds) {
        try { await Admin.del(`/story-arcs/${id}`); } catch {}
      }
      Admin.toast('删除完成', 'success');
      await loadArcs();
    });
    document.getElementById('btn-arc-clear-sel')?.addEventListener('click', () => {
      if (selectedArcIds.size === 0) return;
      selectedArcIds.clear();
      renderArcs();
    });

    // 点击故事卡片/行进入章节
    container.querySelectorAll('[data-arc-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.action-btns, button, input')) return;
        loadChapters(parseInt(el.dataset.arcId));
      });
    });

    // 编辑/删除
    container.querySelectorAll('.btn-edit-arc').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const arc = storyArcs.find(a => a.id === parseInt(btn.dataset.id));
        if (arc) showArcForm(arc);
      });
    });
    container.querySelectorAll('.btn-del-arc').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await Admin.confirm('确定要删除该故事及其所有章节和节点吗？');
        if (!confirmed) return;
        try {
          await Admin.del(`/story-arcs/${btn.dataset.id}`);
          Admin.toast('故事已删除', 'success');
          await loadArcs();
        } catch (e) {
          Admin.toast('删除失败: ' + e.message, 'error');
        }
      });
    });
  }

  function batchMoveArcsCategory() {
    if (selectedArcIds.size === 0) return;
    const tree = arcCategoryBarInstance ? arcCategoryBarInstance.getTree() : [];
    function buildOpts(nodes, depth) {
      let html = '';
      nodes.forEach(n => {
        const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
        html += `<option value="${n.path}">${prefix}${n.name}</option>`;
        if (n.children && n.children.length > 0) html += buildOpts(n.children, depth + 1);
      });
      return html;
    }
    const bodyHtml = `
      <p style="font-size:14px;margin-bottom:16px">将选中的 <b style="color:var(--gold)">${selectedArcIds.size}</b> 个故事移动到：</p>
      <div class="form-group">
        <select id="batch-arc-cat" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
          <option value="">-- 未分类 --</option>
          ${buildOpts(tree, 0)}
        </select>
      </div>
    `;
    Admin.showModal('批量移动分类', bodyHtml, async () => {
      const newCat = document.getElementById('batch-arc-cat')?.value || '';
      let success = 0, fail = 0;
      for (const id of selectedArcIds) {
        try { await Admin.put(`/story-arcs/${id}`, { category_path: newCat }); success++; } catch { fail++; }
      }
      Admin.toast(`移动完成: ${success} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success');
      Admin.closeModal();
      await loadArcs();
    });
  }

  // ===== 章节列表渲染 =====
  function renderChapters() {
    const arc = storyArcs.find(a => a.id === currentArcId);
    const batchAttr = selectedChapterIds.size === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : '';
    const barHtml = `
      <div id="chapter-cat-bar-host"></div>
      <div class="search-bar">
        <button class="btn btn-outline btn-sm" id="btn-back-arcs" style="padding:4px 10px">&larr; 返回故事列表</button>
        <span style="color:var(--text-muted);line-height:2;margin-left:8px">${arc ? arc.title : ''} &gt; 章节</span>
        <span style="color:var(--text-muted);line-height:2;margin-left:8px">共 ${chapters.length} 章</span>
        <span style="color:var(--gold);line-height:2;margin-left:8px">已选 ${selectedChapterIds.size} 个</span>
        <span style="margin:0 4px;color:var(--text-muted)">|</span>
        <button class="btn btn-outline btn-sm" id="btn-ch-move-cat" ${batchAttr}>移动分类</button>
        <button class="btn btn-outline btn-sm" id="btn-ch-move-arc" ${batchAttr}>移动到其他故事</button>
        <button class="btn btn-danger btn-sm" id="btn-ch-del-sel" ${batchAttr}>删除选中</button>
        <button class="btn btn-outline btn-sm" id="btn-ch-clear-sel" ${batchAttr}>取消选择</button>
        <div style="flex:1"></div>
        <button class="btn btn-primary btn-sm" id="btn-add-chapter">+ 新章节</button>
      </div>
    `;

    let folderHtml = '';
    if (chapterCategoryBarInstance) {
      folderHtml = chapterCategoryBarInstance.renderFolderCards();
    }

    let bodyHtml = '';
    if (chapters.length === 0 && folderHtml === '') {
      bodyHtml = '<div class="table-empty">暂无章节</div>';
    } else if (chapters.length === 0) {
      bodyHtml = folderHtml + '<div class="table-empty">该分类下暂无章节</div>';
    } else {
      bodyHtml = folderHtml + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">';
      chapters.forEach(ch => {
        const checked = selectedChapterIds.has(ch.id) ? 'checked' : '';
        const imgHtml = ch.image
          ? `<img src="${ch.image}" style="width:100%;height:120px;object-fit:cover;border-radius:4px;margin-bottom:8px">`
          : `<div style="width:100%;height:120px;background:var(--bg-input);border-radius:4px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px">暂无图片</div>`;
        const conditionHtml = ch.unlock_condition
          ? `<span class="tag tag-npc" style="font-size:10px">有条件</span>`
          : '';
        bodyHtml += `
          <div class="stat-card" style="padding:12px;cursor:pointer;position:relative" data-chapter-id="${ch.id}">
            <input type="checkbox" class="ch-checkbox" data-id="${ch.id}" ${checked}
              style="position:absolute;top:8px;left:8px;width:16px;height:16px;accent-color:var(--gold);z-index:2;cursor:pointer">
            ${imgHtml}
            <div style="font-size:13px;font-weight:500;margin-bottom:2px">第${ch.chapter_order}章 ${ch.title}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${(ch.description || '').substring(0, 50)}</div>
            <div style="display:flex;gap:4px;justify-content:space-between;align-items:center">
              <div>
                <span class="tag tag-${ch.is_main_story ? 'player' : 'npc'}" style="font-size:10px">${ch.is_main_story ? '主线' : '支线'}</span>
                ${conditionHtml}
              </div>
              <div style="display:flex;gap:4px">
                <button class="btn btn-outline btn-sm btn-edit-ch" data-id="${ch.id}" style="font-size:10px;padding:2px 8px">编辑</button>
                <button class="btn btn-outline btn-sm btn-del-ch" data-id="${ch.id}" style="font-size:10px;padding:2px 8px;color:var(--red);border-color:var(--red)">删除</button>
              </div>
            </div>
          </div>
        `;
      });
      bodyHtml += '</div>';
    }

    container.innerHTML = barHtml + bodyHtml;
    // 挂载章节分类栏
    const chHost = document.getElementById('chapter-cat-bar-host');
    if (chHost) {
      if (!chapterCategoryBarInstance) {
        chapterCategoryBarInstance = CategoryBar.mount(chHost, 'chapter', {
          label: '章节分类',
          totalCount: allChaptersCache.length,
          getCount: (path) => {
            if (!path) return allChaptersCache.filter(c => !c.category_path).length;
            return allChaptersCache.filter(c => c.category_path === path).length;
          },
          onSelect: (path) => {
            currentChapterCategory = path || '';
            applyChapterFilter();
          },
          onTreeChange: () => renderChapters(),
        });
      } else {
        chapterCategoryBarInstance.setPath(currentChapterCategory);
      }
    }
    bindChapterEvents();
  }

  function bindChapterEvents() {
    document.getElementById('btn-back-arcs')?.addEventListener('click', () => loadArcs());
    document.getElementById('btn-add-chapter')?.addEventListener('click', () => showChapterForm());

    // 复选框
    container.querySelectorAll('.ch-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id);
        if (cb.checked) selectedChapterIds.add(id); else selectedChapterIds.delete(id);
        renderChapters();
      });
      cb.addEventListener('click', (e) => e.stopPropagation());
    });
    // 文件夹卡片点击
    container.querySelectorAll('.folder-card').forEach(el => {
      el.addEventListener('click', () => {
        currentChapterCategory = el.dataset.path || '';
        if (chapterCategoryBarInstance) chapterCategoryBarInstance.setPath(currentChapterCategory);
        applyChapterFilter();
      });
    });
    // 批量移动分类
    document.getElementById('btn-ch-move-cat')?.addEventListener('click', () => batchMoveChaptersCategory());
    // 批量移动到其他故事
    document.getElementById('btn-ch-move-arc')?.addEventListener('click', () => batchMoveChaptersToArc());
    // 批量删除
    document.getElementById('btn-ch-del-sel')?.addEventListener('click', async () => {
      if (selectedChapterIds.size === 0) return;
      if (!await Admin.confirm(`确定删除选中的 ${selectedChapterIds.size} 个章节及其所有节点？`)) return;
      for (const id of selectedChapterIds) {
        try { await Admin.del(`/story/chapters/${id}`); } catch {}
      }
      Admin.toast('删除完成', 'success');
      await loadChapters(currentArcId);
    });
    document.getElementById('btn-ch-clear-sel')?.addEventListener('click', () => {
      if (selectedChapterIds.size === 0) return;
      selectedChapterIds.clear();
      renderChapters();
    });

    container.querySelectorAll('[data-chapter-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.action-btns, button, input')) return;
        loadNodes(parseInt(el.dataset.chapterId));
      });
    });

    container.querySelectorAll('.btn-edit-ch').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ch = chapters.find(c => c.id === parseInt(btn.dataset.id));
        if (ch) showChapterForm(ch);
      });
    });
    container.querySelectorAll('.btn-del-ch').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await Admin.confirm('确定要删除该章节及其所有节点吗？');
        if (!confirmed) return;
        try {
          await Admin.del(`/story/chapters/${btn.dataset.id}`);
          Admin.toast('章节已删除', 'success');
          await loadChapters(currentArcId);
        } catch (e) {
          Admin.toast('删除失败: ' + e.message, 'error');
        }
      });
    });
  }

  function batchMoveChaptersCategory() {
    if (selectedChapterIds.size === 0) return;
    const tree = chapterCategoryBarInstance ? chapterCategoryBarInstance.getTree() : [];
    function buildOpts(nodes, depth) {
      let html = '';
      nodes.forEach(n => {
        const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
        html += `<option value="${n.path}">${prefix}${n.name}</option>`;
        if (n.children && n.children.length > 0) html += buildOpts(n.children, depth + 1);
      });
      return html;
    }
    const bodyHtml = `
      <p style="font-size:14px;margin-bottom:16px">将选中的 <b style="color:var(--gold)">${selectedChapterIds.size}</b> 个章节移动到分类：</p>
      <div class="form-group">
        <select id="batch-ch-cat" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
          <option value="">-- 未分类 --</option>
          ${buildOpts(tree, 0)}
        </select>
      </div>
    `;
    Admin.showModal('批量移动分类', bodyHtml, async () => {
      const newCat = document.getElementById('batch-ch-cat')?.value || '';
      let success = 0, fail = 0;
      for (const id of selectedChapterIds) {
        try { await Admin.put(`/story/chapters/${id}`, { category_path: newCat }); success++; } catch { fail++; }
      }
      Admin.toast(`移动完成: ${success} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success');
      Admin.closeModal();
      await loadChapters(currentArcId);
    });
  }

  function batchMoveChaptersToArc() {
    if (selectedChapterIds.size === 0) return;
    // 加载所有故事供选择
    Admin.get('/story-arcs/').then(arcs => {
      const arcOpts = arcs.filter(a => a.id !== currentArcId).map(a =>
        `<option value="${a.id}">${a.title}</option>`
      ).join('');
      const bodyHtml = `
        <p style="font-size:14px;margin-bottom:16px">将选中的 <b style="color:var(--gold)">${selectedChapterIds.size}</b> 个章节移动到其他故事：</p>
        <div class="form-group">
          <label>目标故事</label>
          <select id="batch-ch-arc" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
            ${arcOpts || '<option value="" disabled>暂无其他故事</option>'}
          </select>
        </div>
      `;
      Admin.showModal('移动章节到其他故事', bodyHtml, async () => {
        const targetArcId = parseInt(document.getElementById('batch-ch-arc')?.value);
        if (!targetArcId) { Admin.toast('请选择目标故事', 'info'); return; }
        let success = 0, fail = 0;
        for (const id of selectedChapterIds) {
          try { await Admin.put(`/story/chapters/${id}`, { story_arc_id: targetArcId }); success++; } catch { fail++; }
        }
        Admin.toast(`移动完成: ${success} 成功, ${fail} 失败`, fail > 0 ? 'error' : 'success');
        Admin.closeModal();
        await loadChapters(currentArcId);
      });
    }).catch(e => Admin.toast('加载故事列表失败: ' + e.message, 'error'));
  }

  // ===== 节点列表渲染（大改：直接新增、拖拽排序、J编号、快捷修改、批量始终显示） =====
  // 将 order_index 转为 J0001 格式
  function toJCode(orderIndex) {
    const n = parseInt(orderIndex) || 0;
    return 'J' + String(n).padStart(4, '0');
  }

  // 节点按 order_index 排序
  function sortedNodes() {
    return [...nodes].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  }

  function renderNodes() {
    const chapter = chapters.find(c => c.id === currentChapterId);

    // 并行加载场景、角色、动效数据
    Promise.all([
      Admin.get('/scenes/').catch(() => []),
      Admin.get('/characters').catch(() => []),
      Admin.get('/animation-effects/').catch(() => []),
      Admin.get('/tags/').catch(() => []),
    ]).then(([allScenes, allChars, allEffects, tags]) => {
      window._sceneMap = {};
      allScenes.forEach(s => { window._sceneMap[s.id] = s; });
      window._charMap = {};
      allChars.forEach(c => { window._charMap[c.id] = c; });
      window._effectMap = {};
      allEffects.forEach(e => { window._effectMap[e.id] = e; });
      window._allEffects = allEffects;
      window._allTags = tags;
      // 实际渲染
      _renderNodeTable(chapter);
    }).catch(() => {
      _renderNodeTable(chapter);
    });
  }

  function _renderNodeTable(chapter) {
    let chapterOptions = chapters.map(ch =>
      `<option value="${ch.id}" ${ch.id === currentChapterId ? 'selected' : ''}>第${ch.chapter_order}章 ${ch.title}</option>`
    ).join('');

    const sorted = sortedNodes();

    let html = `
      <div class="search-bar">
        <button class="btn btn-outline btn-sm" id="btn-back-chapters" style="padding:4px 10px">&larr; 返回章节列表</button>
        <select id="chapter-select" style="padding:6px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:12px">${chapterOptions}</select>
        <span style="color:var(--text-muted);line-height:2;margin-left:8px">共 ${sorted.length} 个节点</span>
        <div style="flex:1"></div>
        <button class="btn btn-gold btn-sm" id="btn-add-node" title="直接在列表底部新增一个节点">+ 新节点</button>
      </div>
      <!-- 批量管理栏始终显示，未选时禁用 -->
      <div id="node-batch-bar" style="padding:8px 12px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span id="node-sel-count" style="font-size:12px;color:var(--text-muted);margin-right:4px">已选 0 项</span>
        <span style="color:var(--text-muted);margin:0 2px">|</span>
        <button class="btn btn-outline btn-sm" id="btn-node-batch-bg" disabled style="opacity:0.5;cursor:not-allowed">修改背景图片</button>
        <button class="btn btn-outline btn-sm" id="btn-node-batch-type" disabled style="opacity:0.5;cursor:not-allowed">修改类型</button>
        <button class="btn btn-outline btn-sm" id="btn-node-batch-anim" disabled style="opacity:0.5;cursor:not-allowed">批量设置动效</button>
        <button class="btn btn-outline btn-sm" id="btn-node-batch-tag" disabled style="opacity:0.5;cursor:not-allowed">批量打标</button>
        <button class="btn btn-danger btn-sm" id="btn-node-batch-delete" disabled style="opacity:0.5;cursor:not-allowed">批量删除</button>
        <button class="btn btn-outline btn-sm" id="btn-node-clear-sel" disabled style="opacity:0.5;cursor:not-allowed">取消选择</button>
      </div>
      <div class="table-container">
        <div class="table-header"><h3>剧情节点列表（拖拽行可排序，点击单元格可快捷修改）</h3></div>
        <table>
          <thead><tr>
            <th style="width:30px"><input type="checkbox" id="node-select-all" title="全选"></th>
            <th style="width:60px">序号</th>
            <th style="width:80px">预览(背景)</th>
            <th style="width:90px">类型</th>
            <th style="width:180px">说话者（对话列表）</th>
            <th style="width:110px">动效</th>
            <th style="width:50px">标签</th>
            <th style="width:130px">操作</th>
          </tr></thead>
          <tbody id="node-tbody">
    `;

    if (sorted.length === 0) {
      html += '<tr><td colspan="8" class="table-empty">暂无节点，点击"+ 新节点"直接添加</td></tr>';
    } else {
      sorted.forEach(node => {
        html += _renderNodeRow(node);
      });
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
    bindNodeEvents();
  }

  // 渲染单行节点（支持快捷修改）
  function _renderNodeRow(node) {
    // J编号
    const jCode = toJCode(node.order_index);

    // 背景图片缩略图（可点击修改）
    let thumbUrl = '';
    if (node.background_change) {
      thumbUrl = node.background_change;
    } else if (node.scene_id && window._sceneMap && window._sceneMap[node.scene_id]) {
      thumbUrl = window._sceneMap[node.scene_id].background_image;
    }
    const thumbHtml = thumbUrl
      ? `<img src="${thumbUrl}" class="node-bg-thumb" data-node-id="${node.id}" style="width:70px;height:45px;object-fit:cover;border-radius:3px;border:1px solid var(--border);cursor:pointer" loading="lazy" title="点击修改背景图片">`
      : `<div class="node-bg-thumb" data-node-id="${node.id}" style="width:70px;height:45px;background:var(--bg-input);border-radius:3px;border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:10px;cursor:pointer" title="点击选择背景图片">无</div>`;

    // 类型选择（可直接修改）
    const typeHtml = `<select class="node-type-select" data-node-id="${node.id}" style="padding:3px 6px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:11px;cursor:pointer">
      <option value="dialogue" ${node.node_type === 'dialogue' ? 'selected' : ''}>对话</option>
      <option value="choice" ${node.node_type === 'choice' ? 'selected' : ''}>选择</option>
      <option value="battle" ${node.node_type === 'battle' ? 'selected' : ''}>战斗</option>
      <option value="cutscene" ${node.node_type === 'cutscene' ? 'selected' : ''}>过场</option>
    </select>`;

    // 说话者：显示该节点「对话列表」里所有发过言的角色名（只读，由对话列表自动生成）
    let speakerNames = [];
    if (Array.isArray(node.speaker_names) && node.speaker_names.length > 0) {
      speakerNames = node.speaker_names;
    } else if (node.speaker_id && window._charMap && window._charMap[node.speaker_id]) {
      speakerNames = [window._charMap[node.speaker_id].name];
    } else if (node.speaker_id) {
      speakerNames = [`#${node.speaker_id}`];
    }
    const speakerTitle = speakerNames.length
      ? `该节点对话列表中的发言角色：${speakerNames.join('、')}`
      : '该节点还没有对话内容';
    const speakerHtml = `<div class="node-speaker-cell" title="${esc(speakerTitle)}" style="padding:4px 6px;font-size:11px;line-height:1.5;display:flex;flex-wrap:wrap;gap:4px">${
      speakerNames.length
        ? speakerNames.map(n => `<span class="node-speaker-tag">${esc(n)}</span>`).join('')
        : '<span style="color:var(--text-muted)">—</span>'
    }</div>`;

    // 动效（可点击修改）
    let effectName = '点击选择';
    if (node.bg_animation_effect_id && window._effectMap && window._effectMap[node.bg_animation_effect_id]) {
      effectName = window._effectMap[node.bg_animation_effect_id].name;
    }
    const effectHtml = `<div class="node-anim-pick" data-node-id="${node.id}" style="padding:4px 6px;background:var(--bg-input);border:1px solid var(--border);border-radius:3px;cursor:pointer;font-size:11px;text-align:center;min-height:22px;display:flex;align-items:center;justify-content:center" title="双击选择动效">${esc(effectName)}</div>`;

    // 标签
    let tagsHtml = '<span style="color:var(--text-muted);font-size:10px">无</span>';
    if (node.tags) {
      try {
        const tagIds = JSON.parse(node.tags);
        if (tagIds.length > 0) {
          tagsHtml = `<span style="font-size:10px;color:var(--gold)">${tagIds.length}个</span>`;
        }
      } catch(e) {}
    }

    return `
      <tr class="node-row" data-node-id="${node.id}" draggable="true" style="cursor:move">
        <td><input type="checkbox" class="node-checkbox" value="${node.id}"></td>
        <td><span style="font-size:11px;font-weight:600;color:var(--gold)">${jCode}</span></td>
        <td>${thumbHtml}</td>
        <td>${typeHtml}</td>
        <td>${speakerHtml}</td>
        <td>${effectHtml}</td>
        <td>${tagsHtml}</td>
        <td>
          <div class="action-btns">
            <button class="btn-edit" data-id="${node.id}" data-action="edit">编辑</button>
            <button class="btn-edit" data-id="${node.id}" data-action="choices">选项</button>
            <button class="btn-del" data-id="${node.id}" data-action="delete">删除</button>
          </div>
        </td>
      </tr>
    `;
  }

  // 快捷修改：立即保存单个字段到数据库
  async function patchNodeField(nodeId, field, value) {
    try {
      await Admin.patch(`/story/nodes/${nodeId}/field`, { field, value });
      // 同步更新本地 nodes 数组
      const node = nodes.find(n => n.id === nodeId);
      if (node) node[field] = value;
      Admin.toast('已保存', 'success');
    } catch (e) {
      Admin.toast('保存失败: ' + e.message, 'error');
    }
  }

  // 对话列表保存后同步节点列表里的「说话者」单元格（不整表重绘）。
  // 必须在页面作用域：saveDialogues 是节点表单里的函数，看不到 bindNodeEvents 内部的声明，
  // 之前放在里面就会抛 "syncNodeSpeakerCell is not defined"，表现为每次改一句都弹「对话保存失败」。
  function syncNodeSpeakerCell(nodeId, rows) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const ids = [];
    (rows || []).forEach(r => { if (r.speaker_id && !ids.includes(r.speaker_id)) ids.push(r.speaker_id); });
    const names = ids
      .map(id => (window._charMap && window._charMap[id] ? window._charMap[id].name : null))
      .filter(Boolean);
    node.speaker_names = names;
    const cell = document.querySelector(`.node-row[data-node-id="${nodeId}"] .node-speaker-cell`);
    if (!cell) return;
    cell.title = names.length ? `该节点对话列表中的发言角色：${names.join('、')}` : '该节点还没有对话内容';
    cell.innerHTML = names.length
      ? names.map(n => `<span class="node-speaker-tag">${esc(n)}</span>`).join('')
      : '<span style="color:var(--text-muted)">—</span>';
  }

  function bindNodeEvents() {
    document.getElementById('btn-back-chapters')?.addEventListener('click', () => loadChapters(currentArcId));

    const chapterSelect = document.getElementById('chapter-select');
    if (chapterSelect) {
      chapterSelect.addEventListener('change', async () => {
        currentChapterId = parseInt(chapterSelect.value);
        nodes = await Admin.get(`/story/nodes?chapter_id=${currentChapterId}`);
        renderNodes();
      });
    }

    // 直接新增节点（不弹窗，直接在列表底部添加）
    document.getElementById('btn-add-node')?.addEventListener('click', async () => {
      const sorted = sortedNodes();
      const maxOrder = sorted.length > 0 ? Math.max(...sorted.map(n => n.order_index || 0)) : 0;
      try {
        const newNode = await Admin.post('/story/nodes', {
          chapter_id: currentChapterId,
          node_type: 'dialogue',
          content: '',
          order_index: maxOrder + 1,
        });
        Admin.toast('已新增节点 ' + toJCode(newNode.order_index), 'success');
        nodes = await Admin.get(`/story/nodes?chapter_id=${currentChapterId}`);
        renderNodes();
      } catch (e) {
        Admin.toast('新增失败: ' + e.message, 'error');
      }
    });

    // 行操作按钮
    container.querySelectorAll('.action-btns button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const action = btn.dataset.action;
        if (action === 'edit') editNode(id);
        if (action === 'choices') manageChoices(id);
        if (action === 'delete') deleteNode(id);
      });
    });

    // 对话列表保存后同步节点列表里的「说话者」单元格（页面级函数，见文件上方）

  // ===== 快捷修改：背景图片 =====
    container.querySelectorAll('.node-bg-thumb').forEach(el => {
      el.addEventListener('click', async () => {
        const nodeId = parseInt(el.dataset.nodeId);
        const node = nodes.find(n => n.id === nodeId);
        const currentUrl = node?.background_change || '';
        const url = await Admin.Pickers.image({ multi: false, currentUrl, allowUpload: true });
        if (url) {
          await patchNodeField(nodeId, 'background_change', url);
          // 更新缩略图
          if (el.tagName === 'IMG') {
            el.src = url;
          } else {
            // 替换为 img
            const img = document.createElement('img');
            img.src = url;
            img.className = 'node-bg-thumb';
            img.dataset.nodeId = nodeId;
            img.style.cssText = 'width:70px;height:45px;object-fit:cover;border-radius:3px;border:1px solid var(--border);cursor:pointer';
            img.title = '点击修改背景图片';
            img.addEventListener('click', () => bindNodeEvents());
            el.replaceWith(img);
            // 重新绑定
            renderNodes();
          }
        }
      });
    });

    // ===== 快捷修改：类型 =====
    container.querySelectorAll('.node-type-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const nodeId = parseInt(sel.dataset.nodeId);
        await patchNodeField(nodeId, 'node_type', sel.value);
      });
      sel.addEventListener('click', (e) => e.stopPropagation());
    });


    // ===== 快捷修改：动效（双击选择） =====
    container.querySelectorAll('.node-anim-pick').forEach(el => {
      el.addEventListener('dblclick', async (e) => {
        e.stopPropagation();
        const nodeId = parseInt(el.dataset.nodeId);
        const node = nodes.find(n => n.id === nodeId);
        const preSelect = node?.bg_animation_effect_id ? [node.bg_animation_effect_id] : [];
        const selected = await Admin.Pickers.animation({ multi: false, preSelect });
        if (selected && selected.id) {
          await patchNodeField(nodeId, 'bg_animation_effect_id', selected.id);
          el.textContent = selected.name;
        } else if (selected === null) {
          // 清除动效
          await patchNodeField(nodeId, 'bg_animation_effect_id', null);
          el.textContent = '点击选择';
        }
      });
      // 单击也支持
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const nodeId = parseInt(el.dataset.nodeId);
        const node = nodes.find(n => n.id === nodeId);
        const preSelect = node?.bg_animation_effect_id ? [node.bg_animation_effect_id] : [];
        const selected = await Admin.Pickers.animation({ multi: false, preSelect });
        if (selected && selected.id) {
          await patchNodeField(nodeId, 'bg_animation_effect_id', selected.id);
          el.textContent = selected.name;
        }
      });
    });

    // ===== 快捷修改：内容（失焦自动保存） =====

    // ===== 拖拽排序 =====
    let dragNodeId = null;
    container.querySelectorAll('.node-row').forEach(row => {
      row.addEventListener('dragstart', (e) => {
        dragNodeId = parseInt(row.dataset.nodeId);
        row.style.opacity = '0.4';
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        row.style.opacity = '';
        // 清除所有拖拽指示样式
        container.querySelectorAll('.node-row').forEach(r => r.style.borderTop = '');
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const currentDragId = parseInt(row.dataset.nodeId);
        if (currentDragId !== dragNodeId) {
          row.style.borderTop = '2px solid var(--gold)';
        }
      });
      row.addEventListener('dragleave', () => {
        row.style.borderTop = '';
      });
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.style.borderTop = '';
        const targetNodeId = parseInt(row.dataset.nodeId);
        if (dragNodeId === null || dragNodeId === targetNodeId) return;
        // 重新排序：将 dragNode 移动到 targetNode 之前
        const sorted = sortedNodes();
        const dragIdx = sorted.findIndex(n => n.id === dragNodeId);
        const targetIdx = sorted.findIndex(n => n.id === targetNodeId);
        if (dragIdx === -1 || targetIdx === -1) return;
        // 从原位置删除，插入到目标位置之前
        const [moved] = sorted.splice(dragIdx, 1);
        sorted.splice(targetIdx, 0, moved);
        // 重新分配 order_index
        const orderedIds = sorted.map(n => n.id);
        try {
          await Admin.post('/story/nodes/reorder', { chapter_id: currentChapterId, ordered_ids: orderedIds });
          Admin.toast('排序已更新', 'success');
          nodes = await Admin.get(`/story/nodes?chapter_id=${currentChapterId}`);
          renderNodes();
        } catch (e) {
          Admin.toast('排序失败: ' + e.message, 'error');
        }
        dragNodeId = null;
      });
    });

    // ===== 全选/取消全选 =====
    const selectAll = document.getElementById('node-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', () => {
        document.querySelectorAll('.node-checkbox').forEach(cb => cb.checked = selectAll.checked);
        updateNodeBatchBar();
      });
    }

    // 单个复选框
    document.querySelectorAll('.node-checkbox').forEach(cb => {
      cb.addEventListener('change', updateNodeBatchBar);
      cb.addEventListener('click', (e) => e.stopPropagation());
    });

    // ===== 批量操作按钮（始终显示，未选时禁用） =====
    document.getElementById('btn-node-batch-delete')?.addEventListener('click', async () => {
      const ids = getSelectedNodeIds();
      if (ids.length === 0) return;
      const confirmed = await Admin.confirm(`确定要删除选中的 ${ids.length} 个节点吗？`);
      if (!confirmed) return;
      try {
        await Admin.post('/story/nodes/batch-delete', { ids });
        Admin.toast(`已删除 ${ids.length} 个节点`, 'success');
        nodes = await Admin.get(`/story/nodes?chapter_id=${currentChapterId}`);
        renderNodes();
      } catch (e) {
        Admin.toast('批量删除失败: ' + e.message, 'error');
      }
    });

    // 批量打标
    document.getElementById('btn-node-batch-tag')?.addEventListener('click', () => {
      const ids = getSelectedNodeIds();
      if (ids.length === 0) return;
      showNodeBatchTagForm(ids);
    });

    // 批量设置动效
    document.getElementById('btn-node-batch-anim')?.addEventListener('click', () => {
      const ids = getSelectedNodeIds();
      if (ids.length === 0) return;
      showNodeBatchAnimForm(ids);
    });

    // 批量修改背景图片
    document.getElementById('btn-node-batch-bg')?.addEventListener('click', async () => {
      const ids = getSelectedNodeIds();
      if (ids.length === 0) return;
      const url = await Admin.Pickers.image({ multi: false, allowUpload: true });
      if (!url) return;
      try {
        await Admin.post('/story/nodes/batch-update-background', { ids, background: url });
        Admin.toast(`已为 ${ids.length} 个节点设置背景图片`, 'success');
        nodes = await Admin.get(`/story/nodes?chapter_id=${currentChapterId}`);
        renderNodes();
      } catch (e) {
        Admin.toast('批量修改背景失败: ' + e.message, 'error');
      }
    });

    // 批量修改类型
    document.getElementById('btn-node-batch-type')?.addEventListener('click', () => {
      const ids = getSelectedNodeIds();
      if (ids.length === 0) return;
      const bodyHtml = `
        <div style="margin-bottom:12px;font-size:13px">为选中的 <strong>${ids.length}</strong> 个节点设置类型：</div>
        <div class="form-group">
          <label>选择类型</label>
          <select id="batch-type-select" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
            <option value="dialogue">对话</option>
            <option value="choice">选择</option>
            <option value="battle">战斗</option>
            <option value="cutscene">过场</option>
          </select>
        </div>
      `;
      Admin.showModal('批量修改类型', bodyHtml, async () => {
        const nodeType = document.getElementById('batch-type-select')?.value;
        if (!nodeType) return;
        try {
          await Admin.post('/story/nodes/batch-update-type', { ids, node_type: nodeType });
          Admin.toast(`已为 ${ids.length} 个节点修改类型`, 'success');
          Admin.closeModal();
          nodes = await Admin.get(`/story/nodes?chapter_id=${currentChapterId}`);
          renderNodes();
        } catch (e) {
          Admin.toast('批量修改类型失败: ' + e.message, 'error');
        }
      });
    });

    // 取消选择
    document.getElementById('btn-node-clear-sel')?.addEventListener('click', () => {
      document.querySelectorAll('.node-checkbox').forEach(cb => cb.checked = false);
      if (document.getElementById('node-select-all')) document.getElementById('node-select-all').checked = false;
      updateNodeBatchBar();
    });
  }

  function getSelectedNodeIds() {
    return Array.from(document.querySelectorAll('.node-checkbox:checked')).map(cb => parseInt(cb.value));
  }

  // 批量栏：始终显示，未选时禁用按钮
  function updateNodeBatchBar() {
    const count = document.getElementById('node-sel-count');
    const checked = document.querySelectorAll('.node-checkbox:checked').length;
    if (count) count.textContent = `已选 ${checked} 项`;
    const btnIds = ['btn-node-batch-bg', 'btn-node-batch-type', 'btn-node-batch-anim', 'btn-node-batch-tag', 'btn-node-batch-delete', 'btn-node-clear-sel'];
    btnIds.forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      if (checked > 0) {
        btn.disabled = false;
        btn.style.opacity = '';
        btn.style.cursor = 'pointer';
      } else {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
      }
    });
  }

  // 批量设置动效表单
  function showNodeBatchAnimForm(ids) {
    Admin.get('/animation-effects/').then(effects => {
      const animOptions = effects.length > 0
        ? effects.map(e => `<option value="${e.id}">${e.name}</option>`).join('')
        : '<option value="">暂无动效</option>';

      const bodyHtml = `
        <div style="margin-bottom:12px;font-size:13px">为选中的 <strong>${ids.length}</strong> 个节点设置背景转场动效：</div>
        <div class="form-group">
          <label>选择动效</label>
          <select id="batch-anim-select" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
            <option value="">-- 清除动效 --</option>
            ${animOptions}
          </select>
        </div>
      `;

      Admin.showModal('批量设置动效', bodyHtml, async () => {
        const effectId = document.getElementById('batch-anim-select')?.value;
        const payload = { ids, effect_id: effectId ? parseInt(effectId) : null };
        try {
          await Admin.post('/story/nodes/batch-update-bg-animation', payload);
          Admin.toast(`已为 ${ids.length} 个节点${effectId ? '设置' : '清除'}动效`, 'success');
          Admin.closeModal();
          nodes = await Admin.get(`/story/nodes?chapter_id=${currentChapterId}`);
          renderNodes();
        } catch (e) {
          Admin.toast('批量设置动效失败: ' + e.message, 'error');
        }
      });
    }).catch(e => {
      Admin.toast('加载动效列表失败: ' + e.message, 'error');
    });
  }

  function showNodeBatchTagForm(ids) {
    Admin.get('/tags/').then(tags => {
      const grouped = {};
      tags.forEach(t => {
        if (!grouped[t.category]) grouped[t.category] = [];
        grouped[t.category].push(t);
      });

      let tagOptionsHtml = '';
      Object.entries(grouped).forEach(([cat, tagList]) => {
        tagOptionsHtml += `<optgroup label="${cat}">`;
        tagList.forEach(t => {
          tagOptionsHtml += `<option value="${t.id}">${t.name}</option>`;
        });
        tagOptionsHtml += '</optgroup>';
      });

      const bodyHtml = `
        <div style="margin-bottom:12px;font-size:13px">为选中的 <strong>${ids.length}</strong> 个节点操作标签：</div>
        <div class="form-group">
          <label>操作模式</label>
          <select id="batch-tag-mode" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
            <option value="add">追加标签</option>
            <option value="remove">移除标签</option>
            <option value="replace">替换为选定标签</option>
          </select>
        </div>
        <div class="form-group">
          <label>选择标签（可多选）</label>
          <select id="batch-tag-select" multiple style="width:100%;min-height:160px;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
            ${tagOptionsHtml}
          </select>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">按住 Ctrl 键多选</div>
        </div>
      `;

      Admin.showModal('批量打标', bodyHtml, async () => {
        const mode = document.getElementById('batch-tag-mode')?.value || 'add';
        const select = document.getElementById('batch-tag-select');
        const tagIds = Array.from(select.selectedOptions).map(o => parseInt(o.value));
        if (tagIds.length === 0) { Admin.toast('请选择标签', 'info'); return; }
        try {
          await Admin.post('/story/nodes/batch-update-tags', { ids, tag_ids: tagIds, mode });
          Admin.toast(`已为 ${ids.length} 个节点${mode === 'add' ? '添加' : mode === 'remove' ? '移除' : '替换'}标签`, 'success');
          Admin.closeModal();
          nodes = await Admin.get(`/story/nodes?chapter_id=${currentChapterId}`);
          renderNodes();
        } catch (e) {
          Admin.toast('批量打标失败: ' + e.message, 'error');
        }
      });
    }).catch(e => {
      Admin.toast('加载标签列表失败: ' + e.message, 'error');
    });
  }

  // ===== 表单：故事 =====
  function showArcForm(data = null) {
    const isEdit = !!data;
    const bodyHtml = `
      <div class="form-group">
        <label>标题 *</label>
        <input name="title" value="${data?.title || ''}" required>
      </div>
      <div class="form-group">
        <label>自定义分类</label>
        <select name="category_path" id="arc-category-select" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
          <option value="">-- 未分类 --</option>
        </select>
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea name="description">${data?.description || ''}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>排序</label>
          <input name="order_index" type="number" value="${data?.order_index || 0}">
        </div>
        <div class="form-group">
          <label>是否激活</label>
          <select name="is_active">
            <option value="1" ${data?.is_active !== 0 ? 'selected' : ''}>激活</option>
            <option value="0" ${data?.is_active === 0 ? 'selected' : ''}>停用</option>
          </select>
        </div>
      </div>
      <div id="arc-image-upload-area"></div>
      <div class="form-group">
        <label>封面图片路径</label>
        <input name="image" id="arc_image_input" value="${data?.image || ''}" placeholder="如: /images/xxx.png">
      </div>
      <div class="form-group">
        <label>触发条件（JSON）</label>
        <textarea name="trigger_condition" rows="3">${data?.trigger_condition || ''}</textarea>
        <span style="font-size:10px;color:var(--text-muted)">如: {"flag": "quest_completed", "value": "quest_001"}</span>
      </div>
    `;

    Admin.showModal(isEdit ? '编辑故事' : '新建故事', bodyHtml, async () => {
      const formData = Admin.getFormData('.modal-body');
      try {
        if (isEdit) {
          await Admin.put(`/story-arcs/${data.id}`, formData);
          Admin.toast('故事已更新', 'success');
        } else {
          await Admin.post('/story-arcs/', formData);
          Admin.toast('故事已创建', 'success');
        }
        Admin.closeModal();
        await loadArcs();
      } catch (e) {
        Admin.toast('保存失败: ' + e.message, 'error');
      }
    });

    setTimeout(async () => {
      const imgArea = document.getElementById('arc-image-upload-area');
      if (imgArea) {
        Admin.renderImageUpload(imgArea, data?.image, (url) => {
          document.getElementById('arc_image_input').value = url;
        });
      }
      // 加载分类下拉
      try {
        const catData = await Admin.get('/resource-categories/story_arc/tree');
        const catSelect = document.getElementById('arc-category-select');
        if (catSelect) {
          const initialCat = data?.category_path || currentArcCategory || '';
          function buildOpts(nodes, depth) {
            let html = '';
            nodes.forEach(n => {
              const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
              html += `<option value="${n.path}" ${initialCat === n.path ? 'selected' : ''}>${prefix}${n.name}</option>`;
              if (n.children && n.children.length > 0) html += buildOpts(n.children, depth + 1);
            });
            return html;
          }
          catSelect.innerHTML = '<option value="">-- 未分类 --</option>' + buildOpts((catData.tree || []), 0);
        }
      } catch (e) { console.warn('加载分类失败:', e); }
    }, 100);
  }

  // ===== 表单：章节 =====
  function showChapterForm(data = null) {
    const isEdit = !!data;
    const bodyHtml = `
      <div class="form-group">
        <label>标题 *</label>
        <input name="title" value="${data?.title || ''}" required>
      </div>
      <div class="form-group">
        <label>自定义分类</label>
        <select name="category_path" id="chapter-category-select" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
          <option value="">-- 未分类 --</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>章节顺序</label>
          <input name="chapter_order" type="number" value="${data?.chapter_order || 1}">
        </div>
        <div class="form-group">
          <label>主线/支线</label>
          <select name="is_main_story">
            <option value="1" ${data?.is_main_story !== 0 ? 'selected' : ''}>主线</option>
            <option value="0" ${data?.is_main_story === 0 ? 'selected' : ''}>支线</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea name="description">${data?.description || ''}</textarea>
      </div>
      <div id="chapter-image-upload-area"></div>
      <div class="form-group">
        <label>章节图片路径</label>
        <input name="image" id="chapter_image_input" value="${data?.image || ''}" placeholder="如: /images/xxx.png">
      </div>
      <div class="form-group">
        <label>解锁条件（JSON）</label>
        <textarea name="unlock_condition" rows="3">${data?.unlock_condition || ''}</textarea>
        <span style="font-size:10px;color:var(--text-muted)">如: {"prerequisite_chapter": 1, "level": 5}</span>
      </div>
    `;

    Admin.showModal(isEdit ? '编辑章节' : '新建章节', bodyHtml, async () => {
      const formData = Admin.getFormData('.modal-body');
      formData.story_arc_id = currentArcId;
      try {
        if (isEdit) {
          await Admin.put(`/story/chapters/${data.id}`, formData);
          Admin.toast('章节已更新', 'success');
        } else {
          await Admin.post('/story/chapters', formData);
          Admin.toast('章节已创建', 'success');
        }
        Admin.closeModal();
        await loadChapters(currentArcId);
      } catch (e) {
        Admin.toast('保存失败: ' + e.message, 'error');
      }
    });

    setTimeout(async () => {
      const imgArea = document.getElementById('chapter-image-upload-area');
      if (imgArea) {
        Admin.renderImageUpload(imgArea, data?.image, (url) => {
          document.getElementById('chapter_image_input').value = url;
        });
      }
      // 加载分类下拉
      try {
        const catData = await Admin.get('/resource-categories/chapter/tree');
        const catSelect = document.getElementById('chapter-category-select');
        if (catSelect) {
          const initialCat = data?.category_path || currentChapterCategory || '';
          function buildOpts(nodes, depth) {
            let html = '';
            nodes.forEach(n => {
              const prefix = depth > 0 ? '└' + '─'.repeat(depth) + ' ' : '';
              html += `<option value="${n.path}" ${initialCat === n.path ? 'selected' : ''}>${prefix}${n.name}</option>`;
              if (n.children && n.children.length > 0) html += buildOpts(n.children, depth + 1);
            });
            return html;
          }
          catSelect.innerHTML = '<option value="">-- 未分类 --</option>' + buildOpts((catData.tree || []), 0);
        }
      } catch (e) { console.warn('加载分类失败:', e); }
    }, 100);
  }

  // ===== 参数配置的「配置存储」：把当前这套参数存成固定配置，下一个节点直接套用 =====
  // 存在 localStorage，不进数据库：这是纯个人的快捷方式，换台电脑不跟过去也无所谓。
  const CFG_STORE_KEY = 'rpg_dlg_cfg_presets_v1';
  function cfgStoreLoad() {
    try {
      const a = JSON.parse(localStorage.getItem(CFG_STORE_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function cfgStoreSave(list) {
    try { localStorage.setItem(CFG_STORE_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function cfgStoreUpsert(name, cfg, id) {
    const list = cfgStoreLoad();
    if (id) {
      const hit = list.find(x => x.id === id);
      if (hit) { hit.name = name; hit.cfg = cfg; cfgStoreSave(list); return hit.id; }
    }
    const item = { id: 'c' + Date.now().toString(36), name, cfg };
    list.push(item);
    cfgStoreSave(list);
    return item.id;
  }

  // ===== 表单：节点（改进版：9列表情 + 多人同场选项卡 + 场景背景图片管理 + 动效选择） =====
  async function showNodeForm(data = null) {
    const isEdit = !!data;
    // 并行加载角色、声音列表、动效列表、场景列表（场景背景可直接从场景库取）
    let [chars, sounds, animations, scenes] = [[], [], [], []];
    try {
      [chars, sounds, animations, scenes] = await Promise.all([
        Admin.get('/characters'),
        Admin.get('/sounds/'),
        Admin.get('/animation-effects/'),
        Admin.get('/scenes/').catch(() => []),
      ]);
    } catch (e) { /* ignore */ }
    nodeFormChars = chars; // 供 rebuildMultiCharUI 使用

    // ===== 节点对话列表（一个节点可写多句对白） =====
    let dlgRows = [];
    if (isEdit) {
      try {
        dlgRows = await Admin.get(`/story/nodes/${data.id}/dialogues`);
      } catch (e) { dlgRows = []; }
    }
    let removedDlgIds = [];
    let dlgSaveTimer = null;
    let dlgSelectedIdx = null;      // 当前选中的对话行索引
    let dlgConfigClipboard = null;  // 右键「复制配置」的剪贴板（不含台词）

    // 显示部位预设（相对立绘高度的百分比区间）
    const CROP_PRESETS = [
      { key: 'full',   label: '全身',     top: 0,  bottom: 100 },
      { key: 'knee',   label: '膝盖以上', top: 0,  bottom: 60  },
      { key: 'waist',  label: '腰部以上', top: 0,  bottom: 45  },
      { key: 'chest',  label: '胸部以上', top: 0,  bottom: 30  },
      { key: 'head',   label: '头部特写', top: 0,  bottom: 18  },
      { key: 'custom', label: '自定义',   top: null, bottom: null },
    ];
    function cropPresetOf(d) {
      const p = CROP_PRESETS.find(p => p.top === d.crop_top && p.bottom === d.crop_bottom);
      return p ? p.key : 'custom';
    }
    function nz(v, def) { const n = parseFloat(v); return Number.isFinite(n) ? n : def; }

    // ===== 对话列表：单行HTML =====
    // 取某个角色某个表情的缩略图（没有表情图则回落肖像）
    function exprThumbUrl(speakerId, expression) {
      const ch = chars.find(c => c.id == speakerId);
      if (!ch) return '';
      let url = '';
      try {
        const ex = ch.expressions ? JSON.parse(ch.expressions) : {};
        if (expression && ex[expression]) url = ex[expression];
      } catch (e) {}
      return url || ch.portrait_image || '';
    }

    function cropPresetOpts(selected) {
      return CROP_PRESETS.map(p =>
        `<option value="${p.key}" ${selected === p.key ? 'selected' : ''}>${p.label}</option>`
      ).join('');
    }

    function buildDialogueRow(d, i) {
      const speakerOpts = chars.map(c =>
        `<option value="${c.id}" ${d.speaker_id == c.id ? 'selected' : ''}>${esc(c.name)}</option>`
      ).join('');
      const preset = cropPresetOf(d);
      const isCustom = preset === 'custom';
      const thumb = exprThumbUrl(d.speaker_id, d.expression);
      const expLabel = expressionLabel(d.expression);

      return `
        <div class="dlg-row" data-idx="${i}" data-id="${d.id || ''}" draggable="true" title="左键=选中 · 右键=菜单 · 拖住 ⋮⋮ 排序">
          <span class="dlg-grip" title="按住拖动可调整顺序">⋮⋮</span>
          <span class="dlg-idx">#${i + 1}</span>
          <select class="dlg-speaker">
            <option value="">-- 旁白 --</option>
            ${speakerOpts}
          </select>
          <button type="button" class="dlg-exp-btn" title="点击选择表情">
            ${thumb ? `<img src="${thumb}" alt="">` : `<span class="dlg-exp-empty">?</span>`}
            <span class="dlg-exp-label">${expLabel}</span>
          </button>
          <input type="hidden" class="dlg-expression" value="${esc(d.expression || '')}">
          <input type="text" class="dlg-content" placeholder="这句台词的内容…" value="${esc(d.content || '')}">
          <button type="button" class="dlg-cfg-btn" title="参数配置：坐标 / 大小 / 裁剪 / 动效 / 翻转 / 消失">⚙</button>
          <button type="button" class="btn btn-outline btn-sm dlg-copy" title="复制配置（不含台词）：说话人 / 表情 / 坐标 / 缩放 / 动效…">⚙⧉</button>
          <div class="dlg-params" style="display:none">
            <input class="dlg-x" type="number" step="1" value="${nz(d.pos_x, 50)}">
            <input class="dlg-y" type="number" step="1" value="${nz(d.pos_y, 0)}">
            <input class="dlg-scale" type="number" step="0.05" min="0.1" max="3" value="${nz(d.scale, 1)}">
            <input class="dlg-z" type="number" value="${d.z_index || 1}">
            <select class="dlg-preset">${cropPresetOpts(preset)}</select>
            <input class="dlg-crop-top" type="number" step="1" value="${nz(d.crop_top, 0)}">
            <input class="dlg-crop-bottom" type="number" step="1" value="${nz(d.crop_bottom, 100)}">
            <select class="dlg-anim">
              <option value="">-- 无动效 --</option>
              ${animOptions}
            </select>
            <input type="checkbox" class="dlg-flip" ${d.flip ? 'checked' : ''}>
            <input type="checkbox" class="dlg-disappear" ${d.disappear_after ? 'checked' : ''}>
          </div>
        </div>
      `;
    }

    function renderDialogueRows() {
      const box = document.getElementById('dialogue-list');
      if (!box) return;
      box.innerHTML = dlgRows.length
        ? dlgRows.map((d, i) => buildDialogueRow(d, i)).join('')
        : '<div style="font-size:12px;color:var(--text-muted);padding:10px;text-align:center">暂无对话，点「+ 添加一句」开始</div>';
      // 回填动效选中值
      document.querySelectorAll('.dlg-row').forEach((el, i) => {
        const sel = el.querySelector('.dlg-anim');
        if (sel && dlgRows[i]?.animation_effect_id) sel.value = dlgRows[i].animation_effect_id;
      });
      if (dlgRows.length > 0 && (dlgSelectedIdx === null || dlgSelectedIdx >= dlgRows.length)) {
        dlgSelectedIdx = 0;
      }
      bindDialogueRowEvents();
      applyDialogueSelection();
      renderStagePreview();
    }

    // 选中态：左键/右键点击某一句时高亮
    function selectDialogueRow(idx, scrollIntoView) {
      dlgSelectedIdx = idx;
      applyDialogueSelection();
      if (scrollIntoView) {
        const el = document.querySelector(`.dlg-row[data-idx="${idx}"]`);
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      }
    }

    function applyDialogueSelection() {
      document.querySelectorAll('.dlg-row').forEach(el => {
        el.classList.toggle('selected', parseInt(el.dataset.idx, 10) === dlgSelectedIdx);
      });
      // 预览只画选中句 → 选中变化时需要重画
      renderStagePreview();
    }

    function collectDialogueRows() {
      const rows = [];
      document.querySelectorAll('.dlg-row').forEach((el, i) => {
        rows.push({
          id: el.dataset.id ? parseInt(el.dataset.id) : null,
          order_index: i,
          speaker_id: parseInt(el.querySelector('.dlg-speaker')?.value) || null,
          content: el.querySelector('.dlg-content')?.value || '',
          expression: el.querySelector('.dlg-expression')?.value || null,
          pos_x: parseFloat(el.querySelector('.dlg-x')?.value),
          pos_y: parseFloat(el.querySelector('.dlg-y')?.value),
          scale: parseFloat(el.querySelector('.dlg-scale')?.value),
          crop_top: parseFloat(el.querySelector('.dlg-crop-top')?.value),
          crop_bottom: parseFloat(el.querySelector('.dlg-crop-bottom')?.value),
          flip: el.querySelector('.dlg-flip')?.checked ? 1 : 0,
          z_index: parseInt(el.querySelector('.dlg-z')?.value) || 1,
          disappear_after: el.querySelector('.dlg-disappear')?.checked ? 1 : 0,
          animation_effect_id: parseInt(el.querySelector('.dlg-anim')?.value) || null,
        });
      });
      return rows;
    }

    // 取某一句「除台词以外」的全部配置（用于复制配置 / 粘贴配置）
    function collectRowConfig(idx) {
      const r = collectDialogueRows()[idx];
      if (!r) return null;
      return {
        speaker_id: r.speaker_id,
        expression: r.expression,
        pos_x: r.pos_x, pos_y: r.pos_y, scale: r.scale,
        crop_top: r.crop_top, crop_bottom: r.crop_bottom,
        flip: r.flip, z_index: r.z_index,
        disappear_after: r.disappear_after,
        animation_effect_id: r.animation_effect_id,
      };
    }

    // 把配置套用到某一句（不动台词内容）
    function applyRowConfig(idx, cfg) {
      const row = document.querySelector(`.dlg-row[data-idx="${idx}"]`);
      if (!row || !cfg) return;
      const set = (sel, val, isCheck) => {
        const el = row.querySelector(sel);
        if (!el) return;
        if (isCheck) el.checked = !!val;
        else if (val !== null && val !== undefined && !Number.isNaN(val)) el.value = val;
      };
      set('.dlg-speaker', cfg.speaker_id ?? '');
      set('.dlg-expression', cfg.expression ?? '');
      set('.dlg-x', cfg.pos_x); set('.dlg-y', cfg.pos_y); set('.dlg-scale', cfg.scale);
      set('.dlg-crop-top', cfg.crop_top); set('.dlg-crop-bottom', cfg.crop_bottom);
      set('.dlg-z', cfg.z_index);
      set('.dlg-flip', cfg.flip, true);
      set('.dlg-disappear', cfg.disappear_after, true);
      set('.dlg-anim', cfg.animation_effect_id ?? '');
      // 显示部位下拉：按数值匹配预设，匹配不上就切到自定义
      const pSel = row.querySelector('.dlg-preset');
      if (pSel) {
        const p = CROP_PRESETS.find(x => x.top === cfg.crop_top && x.bottom === cfg.crop_bottom);
        pSel.value = p ? p.key : 'custom';
        const t = row.querySelector('.dlg-crop-top');
        const b = row.querySelector('.dlg-crop-bottom');
        if (t && b) { const dis = !p || p.key === 'custom'; t.disabled = !dis; b.disabled = !dis; }
      }
      updateExprButton(row);
      renderStagePreview();
      if (isEdit) saveDialogues();
    }

    // 刷新表情按钮的缩略图与文字
    function updateExprButton(row) {
      const btn = row?.querySelector('.dlg-exp-btn');
      if (!btn) return;
      const speakerId = parseInt(row.querySelector('.dlg-speaker')?.value);
      const exp = row.querySelector('.dlg-expression')?.value || '';
      const url = exprThumbUrl(speakerId, exp);
      const label = expressionLabel(exp);
      btn.innerHTML = `${url ? `<img src="${url}" alt="">` : `<span class="dlg-exp-empty">?</span>`}<span class="dlg-exp-label">${label}</span>`;
    }

    // ===== 表情选择弹窗（小图点击选择） =====
    function closeExprPicker() {
      const old = document.getElementById('dlg-expr-pop');
      if (old) old.remove();
      document.removeEventListener('mousedown', exprPopOutsideHandler, true);
    }
    function exprPopOutsideHandler(e) {
      const pop = document.getElementById('dlg-expr-pop');
      if (pop && !pop.contains(e.target) && !e.target.closest?.('.dlg-exp-btn')) closeExprPicker();
    }
    async function openExprPicker(btn) {
      closeExprPicker();
      const row = btn.closest('.dlg-row');
      if (!row) return;
      const speakerId = parseInt(row.querySelector('.dlg-speaker')?.value);
      if (!speakerId) { Admin.toast('请先选择说话者', 'info'); return; }
      let ch = null, exprs = {}, lib = { categories: [], poses: [] }, poseImages = [];
      try {
        const [chRes, libRes, imgRes] = await Promise.all([
          Admin.get(`/characters/${speakerId}`),
          Admin.get('/poses/library'),
          Admin.get(`/characters/${speakerId}/poses`),
        ]);
        ch = chRes;
        lib = libRes;
        poseImages = imgRes.images || [];
        exprs = ch.expressions ? JSON.parse(ch.expressions) : {};
      } catch (e) {
        try { ch = await Admin.get(`/characters/${speakerId}`); exprs = ch.expressions ? JSON.parse(ch.expressions) : {}; } catch (_) {}
      }
      (lib.poses || []).forEach(p => { poseNameMap[p.id] = p.name; });
      // 同步刷新页面缓存里这个角色的表情表：刚出的动作图还没进 chars 缓存时，
      // 选完动作行上的缩略图会是一片空白。
      const cachedChar = chars.find(c => c.id == speakerId);
      if (cachedChar && ch) cachedChar.expressions = ch.expressions;
      // 动作 id → 最新一张图（同一动作可能出了多张，取最新）
      const imgByPose = {};
      poseImages.forEach(im => {
        if (im.pose_id && !imgByPose[im.pose_id]) imgByPose[im.pose_id] = im.image_url;
      });
      // 旧表情（normal/happy/...）单独归一类，避免历史节点突然没图可选
      const oldFaces = {};
      Object.keys(exprs || {}).forEach(k => {
        if (exprs[k] && !poseNameMap[k]) oldFaces[k] = exprs[k];
      });
      const cur = row.querySelector('.dlg-expression')?.value || '';
      const ch2 = chars.find(c => c.id == speakerId);
      const cats = [{ id: '', name: '全部' }]
        .concat((lib.categories || []).map(c => ({ id: c.id, name: c.name })));
      if (Object.keys(oldFaces).length) cats.push({ id: '__legacy', name: '旧表情' });
      let activeCat = '';
      let onlyGen = true;

      const pop = document.createElement('div');
      pop.className = 'dlg-expr-pop';
      pop.id = 'dlg-expr-pop';
      pop.innerHTML = `
        <div class="dlg-expr-pop-head">
          <span>${ch2 ? esc(ch2.name) : ''} · 选择动作表情 <span style="color:var(--text-muted);font-size:10px">（按动作分类，对应人物实际出图）</span></span>
          <button type="button" class="dlg-expr-pop-close">&times;</button>
        </div>
        <div class="dlg-expr-cats" id="dlg-expr-cats"></div>
        <div class="dlg-expr-filter">
          <label><input type="checkbox" id="dlg-expr-only" checked> 只看已出图</label>
          <span class="cnt"></span>
        </div>
        <div class="dlg-expr-grid" id="dlg-expr-grid"></div>
        <div class="dlg-expr-pop-hint" style="padding:7px 12px 9px;font-size:11px;color:var(--text-muted);border-top:1px solid var(--border)">
          没有图的动作：先到「人物管理 → 动作表情」给这个人物的这套外观生成。选中的动作 id 会直接存进这句对白。
        </div>
      `;
      document.body.appendChild(pop);

      const catsEl = pop.querySelector('#dlg-expr-cats');
      const gridEl = pop.querySelector('#dlg-expr-grid');
      const hasImg = (p) => !!(imgByPose[p.id] || exprs[p.id]);

      function renderCats() {
        const withCount = cats.map(c => {
          let count = 0;
          if (c.id === '__legacy') count = Object.keys(oldFaces).length;
          else count = (lib.poses || []).filter(p => (!c.id || p.cat === c.id) && (!onlyGen || hasImg(p))).length;
          return { ...c, count };
        }).filter(c => !onlyGen || c.id === '' || c.id === '__legacy' || c.count > 0);
        catsEl.innerHTML = withCount.map(c => `<span class="dlg-expr-cat${activeCat === c.id ? ' on' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}<span style="opacity:.65;font-size:10px;margin-left:4px">${c.count}</span></span>`).join('');
        catsEl.querySelectorAll('.dlg-expr-cat').forEach(el => {
          el.addEventListener('click', () => { activeCat = el.dataset.cat; renderCats(); renderGrid(); });
        });
        // 当前分类被过滤掉了（例如切到只看已出图）→ 回到「全部」
        if (activeCat && !withCount.some(c => c.id === activeCat)) {
          activeCat = '';
          renderCats(); renderGrid();
        }
      }

      function renderGrid() {
        const cells = [];
        if (activeCat === '__legacy') {
          Object.entries(oldFaces).forEach(([k, url]) => {
            if (onlyGen && !url) return;
            cells.push(`<div class="dlg-expr-cell${cur === k ? ' selected' : ''}" data-exp="${esc(k)}" title="旧表情：${esc(k)}">
              <img src="${esc(url)}" alt="">
              <span class="ex-cat">${esc(expressionLabel(k))}</span>
              <span class="ex-sub">旧表情</span>
            </div>`);
          });
        } else {
          const catName = {};
          (lib.categories || []).forEach(c => { catName[c.id] = c.name; });
          const list = (lib.poses || []).filter(p => !activeCat || p.cat === activeCat);
          list.forEach(p => {
            const url = imgByPose[p.id] || exprs[p.id] || '';
            if (onlyGen && !url) return;
            // 右上角徽标：以前写死「有图 / 未出图」，勾了「只看已出图」之后
            // 满屏都是「有图」，等于没信息 —— 改成显示这个表情自己的名字。
            // 图片下方那行改成显示所属分类，避免同一个名字出现两遍。
            cells.push(`<div class="dlg-expr-cell${cur === p.id ? ' selected' : ''}${url ? '' : ' missing'}" data-exp="${esc(p.id)}"
                title="${esc(p.cn || p.name)}${url ? '' : '（这个动作还没出图）'}">
              ${url ? `<img src="${esc(url)}" alt="">` : `<div class="dlg-expr-none">?</div>`}
              <span class="ex-cat ${url ? '' : 'miss'}">${esc(p.name)}</span>
              <span class="ex-sub">${esc(catName[p.cat] || '')}</span>
            </div>`);
          });
        }
        gridEl.innerHTML = cells.length ? cells.join('')
          : `<div class="cpp-empty" style="grid-column:1/-1">${onlyGen ? '这个分类下还没有出过图，取消「只看已出图」可看到全部动作' : '该分类下没有动作'}</div>`;
        const cnt = pop.querySelector('.dlg-expr-filter .cnt');
        if (cnt) cnt.textContent = `当前显示 ${cells.length} 个`;
        gridEl.querySelectorAll('.dlg-expr-cell').forEach(cell => {
          cell.addEventListener('click', () => {
            if (cell.classList.contains('missing')) {
              Admin.toast('这个动作还没出图：到「人物管理 → 动作表情」生成后再选', 'info');
              return;
            }
            row.querySelector('.dlg-expression').value = cell.dataset.exp;
            updateExprButton(row);
            closeExprPicker();
            scheduleDialogueSave();
          });
        });
      }

      pop.querySelector('#dlg-expr-only').addEventListener('change', (e) => {
        onlyGen = !!e.target.checked;
        renderCats(); renderGrid();
      });
      renderCats();
      renderGrid();

      const r = btn.getBoundingClientRect();
      const pw = pop.offsetWidth || 560, ph = pop.offsetHeight || 420;
      let left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
      let top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - ph - 8));
      // 不要盖住右侧的舞台预览
      const preview = document.getElementById('dlg-stage-preview');
      if (preview) {
        const pr = preview.getBoundingClientRect();
        if (left + pw > pr.left - 8 && left < pr.right && top < pr.bottom && top + ph > pr.top) {
          left = Math.max(8, pr.left - pw - 12);
          top = Math.max(8, Math.min(r.top, window.innerHeight - ph - 8));
        }
      }
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';

      pop.querySelector('.dlg-expr-pop-close').addEventListener('click', closeExprPicker);
      setTimeout(() => document.addEventListener('mousedown', exprPopOutsideHandler, true), 0);
    }

    // ===== 参数配置弹窗（坐标 / 大小 / 裁剪 / 动效 / 翻转 / 消失） =====
    function closeCfgPop() {
      const old = document.getElementById('dlg-cfg-pop');
      if (old) old.remove();
      document.removeEventListener('mousedown', cfgPopOutsideHandler, true);
    }
    function cfgPopOutsideHandler(e) {
      const p = document.getElementById('dlg-cfg-pop');
      if (p && !p.contains(e.target) && !e.target.closest?.('.dlg-cfg-btn')) closeCfgPop();
    }
    function openCfgPop(btn) {
      closeCfgPop();
      const row = btn.closest('.dlg-row');
      if (!row) return;
      const q = (sel) => row.querySelector(sel);

      const pop = document.createElement('div');
      pop.className = 'dlg-cfg-pop';
      pop.id = 'dlg-cfg-pop';
      pop.innerHTML = `
        <div class="dlg-cfg-head">
          <span>#${parseInt(row.dataset.idx, 10) + 1} 参数配置</span>
          <button type="button" class="dlg-cfg-close">&times;</button>
        </div>

        <!-- 配置存储：把当前这套参数存成固定配置，别处直接套用 -->
        <div class="cfg-store">
          <select class="cfg-store-sel" title="选择一套已存的配置"></select>
          <button type="button" class="cfg-store-btn" data-sa="new"    title="新建：用当前参数存一套新配置">＋</button>
          <button type="button" class="cfg-store-btn" data-sa="rename" title="改名：给选中的这套改个名字">✎</button>
          <button type="button" class="cfg-store-btn" data-sa="save"   title="存储：用当前参数覆盖选中的这套">💾</button>
          <button type="button" class="cfg-store-btn danger" data-sa="del" title="删除：删掉选中的这套">🗑</button>
        </div>

        <div class="dlg-cfg-grid">
          <label class="dlg-cfg-slider">
            <span class="sl-head"><span>水平 X 坐标（%）</span><output class="cfg-xv">50</output></span>
            <input class="cfg-x" type="range" min="0" max="100" step="0.5">
          </label>
          <label class="dlg-cfg-slider">
            <span class="sl-head"><span>垂直 Y 坐标（% · 负值下沉）</span><output class="cfg-yv">0</output></span>
            <input class="cfg-y" type="range" min="-40" max="80" step="0.5">
          </label>
          <label class="dlg-cfg-slider">
            <span class="sl-head"><span>缩放</span><output class="cfg-scalev">1</output></span>
            <input class="cfg-scale" type="range" min="0.1" max="3" step="0.05">
          </label>
          <label class="dlg-cfg-slider">
            <span class="sl-head"><span>层级（数字越大越靠前）</span><output class="cfg-zv">1</output></span>
            <input class="cfg-z" type="range" min="0" max="20" step="1">
          </label>
          <label>画面裁切<select class="cfg-preset">${cropPresetOpts(q('.dlg-preset')?.value)}</select></label>
          <label>动效<select class="cfg-anim"><option value="">-- 无 --</option>${animOptions}</select></label>
        </div>
        <div class="dlg-cfg-checks">
          <label><input type="checkbox" class="cfg-flip">翻转</label>
          <label><input type="checkbox" class="cfg-dis">消失</label>
          <span class="dlg-cfg-tip">改完自动保存</span>
        </div>
      `;
      document.body.appendChild(pop);

      const p = (sel) => pop.querySelector(sel);
      p('.cfg-x').value = q('.dlg-x')?.value ?? 50;
      p('.cfg-y').value = q('.dlg-y')?.value ?? 0;
      p('.cfg-xv').textContent = p('.cfg-x').value;
      p('.cfg-yv').textContent = p('.cfg-y').value;
      p('.cfg-scale').value = q('.dlg-scale')?.value ?? 1;
      p('.cfg-scalev').textContent = p('.cfg-scale').value;
      p('.cfg-z').value = q('.dlg-z')?.value ?? 1;
      p('.cfg-zv').textContent = p('.cfg-z').value;
      p('.cfg-anim').value = q('.dlg-anim')?.value || '';
      p('.cfg-flip').checked = !!q('.dlg-flip')?.checked;
      p('.cfg-dis').checked = !!q('.dlg-disappear')?.checked;

      const write = (targetSel, val, isCheck) => {
        const t = q(targetSel);
        if (!t) return;
        if (isCheck) t.checked = !!val; else t.value = val;
        scheduleDialogueSave();
      };
      const bind = (popSel, targetSel, isCheck) => {
        const el = p(popSel);
        if (!el) return;
        const handler = () => write(targetSel, isCheck ? el.checked : el.value, isCheck);
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
      };
      bind('.cfg-flip', '.dlg-flip', true); bind('.cfg-dis', '.dlg-disappear', true);

      // 滑杆：拖动时同步到隐藏字段并实时刷新数值
      const bindRange = (popSel, targetSel, outSel) => {
        const el = p(popSel), out = p(outSel);
        const handler = () => {
          if (out) out.textContent = el.value;
          write(targetSel, el.value);
        };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
      };
      bindRange('.cfg-x', '.dlg-x', '.cfg-xv');
      bindRange('.cfg-y', '.dlg-y', '.cfg-yv');
      bindRange('.cfg-scale', '.dlg-scale', '.cfg-scalev');
      bindRange('.cfg-z', '.dlg-z', '.cfg-zv');

      p('.cfg-anim').addEventListener('change', () => {
        q('.dlg-anim').value = p('.cfg-anim').value;
        scheduleDialogueSave();
      });
      p('.cfg-preset').addEventListener('change', () => {
        const preset = CROP_PRESETS.find(x => x.key === p('.cfg-preset').value);
        if (preset && preset.key !== 'custom') {
          write('.dlg-crop-top', preset.top);
          write('.dlg-crop-bottom', preset.bottom);
        }
        scheduleDialogueSave();
      });

      // ===== 配置存储：新建 / 改名 / 存储 / 删除 =====
      let curStoreId = '';
      const curCfg = () => collectRowConfig(parseInt(row.dataset.idx, 10));

      function renderStore() {
        const list = cfgStoreLoad();
        const sel = p('.cfg-store-sel');
        sel.innerHTML = `<option value="">-- 选择已存配置 --</option>` +
          list.map(x => `<option value="${esc(x.id)}"${x.id === curStoreId ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
        if (curStoreId && !list.some(x => x.id === curStoreId)) curStoreId = '';
        sel.value = curStoreId;
        const has = !!curStoreId;
        p('[data-sa="rename"]').disabled = !has;
        p('[data-sa="save"]').disabled = !has;
        p('[data-sa="del"]').disabled = !has;
      }
      p('.cfg-store-sel').addEventListener('change', () => {
        curStoreId = p('.cfg-store-sel').value;
        renderStore();
        const hit = cfgStoreLoad().find(x => x.id === curStoreId);
        if (hit) { applyRowConfig(parseInt(row.dataset.idx, 10), hit.cfg); refreshCfgFromRow(); }
      });
      p('[data-sa="new"]').addEventListener('click', async () => {
        const name = await Admin.prompt('新建配置', { label: '给这套配置起个名字（例如：左侧半身 / 右侧特写）', value: '' });
        if (!name) return;
        curStoreId = cfgStoreUpsert(name, curCfg(), null);
        renderStore();
        Admin.toast(`已存为「${name}」`, 'success');
      });
      p('[data-sa="rename"]').addEventListener('click', async () => {
        const hit = cfgStoreLoad().find(x => x.id === curStoreId);
        if (!hit) return;
        const name = await Admin.prompt('改名', { label: '改成什么名字：', value: hit.name });
        if (!name) return;
        cfgStoreUpsert(name, hit.cfg, hit.id);
        renderStore();
        Admin.toast('已改名', 'success');
      });
      p('[data-sa="save"]').addEventListener('click', () => {
        const hit = cfgStoreLoad().find(x => x.id === curStoreId);
        if (!hit) return;
        cfgStoreUpsert(hit.name, curCfg(), hit.id);
        Admin.toast(`已把当前参数存进「${hit.name}」`, 'success');
      });
      p('[data-sa="del"]').addEventListener('click', async () => {
        const hit = cfgStoreLoad().find(x => x.id === curStoreId);
        if (!hit) return;
        if (!await Admin.confirm(`删掉配置「${hit.name}」？删了就找不回来了。`)) return;
        cfgStoreSave(cfgStoreLoad().filter(x => x.id !== curStoreId));
        curStoreId = '';
        renderStore();
        Admin.toast('已删除', 'success');
      });
      renderStore();

      // 面板里的值跟随当前行（粘贴配置 / 切预设之后用）
      function refreshCfgFromRow() {
        const d = collectDialogueRows()[parseInt(row.dataset.idx, 10)];
        if (!d) return;
        p('.cfg-x').value = d.pos_x ?? 50; p('.cfg-xv').textContent = p('.cfg-x').value;
        p('.cfg-y').value = d.pos_y ?? 0;  p('.cfg-yv').textContent = p('.cfg-y').value;
        p('.cfg-scale').value = d.scale ?? 1; p('.cfg-scalev').textContent = p('.cfg-scale').value;
        p('.cfg-z').value = d.z_index ?? 1;  p('.cfg-zv').textContent = p('.cfg-z').value;
        p('.cfg-anim').value = d.animation_effect_id || '';
        p('.cfg-flip').checked = !!d.flip;
        p('.cfg-dis').checked = !!d.disappear_after;
        const pr = CROP_PRESETS.find(x => x.top === d.crop_top && x.bottom === d.crop_bottom);
        p('.cfg-preset').value = pr ? pr.key : 'custom';
      }

      p('.dlg-cfg-close').addEventListener('click', closeCfgPop);

      const r = btn.getBoundingClientRect();
      const pw = pop.offsetWidth || 560, ph = pop.offsetHeight || 380;
      let left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8));
      let top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - ph - 8));
      // 参数窗口放大后不要压住右侧的舞台预览：放不下就整体挪到预览左边
      const preview = document.getElementById('dlg-stage-preview');
      if (preview) {
        const pr = preview.getBoundingClientRect();
        if (left + pw > pr.left - 8 && left < pr.right && top < pr.bottom && top + ph > pr.top) {
          left = Math.max(8, pr.left - pw - 14);
          top = Math.max(8, Math.min(r.top, window.innerHeight - ph - 8));
        }
      }
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
      setTimeout(() => document.addEventListener('mousedown', cfgPopOutsideHandler, true), 0);
    }

    // ===== 右键菜单 =====
    function closeDlgContextMenu() {
      const old = document.getElementById('dlg-ctxmenu');
      if (old) old.remove();
      document.removeEventListener('mousedown', ctxMenuOutsideHandler, true);
    }
    function ctxMenuOutsideHandler(e) {
      const m = document.getElementById('dlg-ctxmenu');
      if (m && !m.contains(e.target)) closeDlgContextMenu();
    }
    function showDlgContextMenu(x, y, idx) {
      closeDlgContextMenu();
      const menu = document.createElement('div');
      menu.className = 'dlg-ctxmenu';
      menu.id = 'dlg-ctxmenu';
      const items = [
        { key: 'copyAll', label: '⧉ 复制整句（含台词）' },
        { key: 'copyCfg', label: '⚙ 复制配置（不含台词）' },
        { key: 'pasteCfg', label: '⎘ 粘贴配置到这一句', disabled: !dlgConfigClipboard,
          hint: dlgConfigClipboard ? `（来自 #${dlgConfigClipboard.fromIdx + 1}）` : '（剪贴板为空）' },
        { sep: true },
        { key: 'pasteCfgAll', label: '⎘⎘ 粘贴配置到本节点所有句', disabled: !dlgConfigClipboard },
        { sep: true },
        { key: 'up', label: '↑ 上移' },
        { key: 'down', label: '↓ 下移' },
        { sep: true },
        { key: 'del', label: '✕ 删除这一句', danger: true },
      ];
      menu.innerHTML = items.map(it => it.sep
        ? '<div class="dlg-ctxmenu-sep"></div>'
        : `<div class="dlg-ctxmenu-item${it.disabled ? ' disabled' : ''}${it.danger ? ' danger' : ''}" data-key="${it.key}">${it.label}${it.hint ? `<span class="dlg-ctxmenu-hint">${it.hint}</span>` : ''}</div>`
      ).join('');
      document.body.appendChild(menu);
      const mw = menu.offsetWidth || 220, mh = menu.offsetHeight || 200;
      menu.style.left = Math.max(4, Math.min(x, window.innerWidth - mw - 8)) + 'px';
      menu.style.top = Math.max(4, Math.min(y, window.innerHeight - mh - 8)) + 'px';
      menu.querySelectorAll('.dlg-ctxmenu-item').forEach(el => {
        if (el.classList.contains('disabled')) return;
        el.addEventListener('click', () => { closeDlgContextMenu(); dlgContextAction(el.dataset.key, idx); });
      });
      setTimeout(() => document.addEventListener('mousedown', ctxMenuOutsideHandler, true), 0);
    }

    function dlgContextAction(key, idx) {
      switch (key) {
        case 'copyAll': {
          const rows = collectDialogueRows();
          const cur = rows[idx];
          if (!cur) return;
          cur.id = null;
          rows.splice(idx + 1, 0, cur);
          dlgRows = rows;
          dlgSelectedIdx = idx + 1;
          renderDialogueRows();
          if (isEdit) saveDialogues();
          break;
        }
        case 'copyCfg': {
          const cfg = collectRowConfig(idx);
          if (!cfg) return;
          dlgConfigClipboard = { ...cfg, fromIdx: idx };
          Admin.toast('已复制配置（不含台词），右键其他句可粘贴', 'success');
          break;
        }
        case 'pasteCfg': {
          if (!dlgConfigClipboard) return;
          const { fromIdx, ...cfg } = dlgConfigClipboard;
          applyRowConfig(idx, cfg);
          Admin.toast(`配置已粘贴到 #${idx + 1}`, 'success');
          break;
        }
        case 'pasteCfgAll': {
          if (!dlgConfigClipboard) return;
          const { fromIdx, ...cfg } = dlgConfigClipboard;
          const total = document.querySelectorAll('.dlg-row').length;
          for (let i = 0; i < total; i++) applyRowConfig(i, cfg);
          Admin.toast(`配置已粘贴到全部 ${total} 句`, 'success');
          break;
        }
        case 'up': moveDialogueRow(idx, -1); break;
        case 'down': moveDialogueRow(idx, 1); break;
        case 'del': {
          const row = document.querySelector(`.dlg-row[data-idx="${idx}"]`);
          if (!row) return;
          const id = parseInt(row.dataset.id);
          if (id) removedDlgIds.push(id);
          row.remove();
          renumberDialogueRows();
          renderStagePreview();
          if (isEdit) saveDialogues();
          break;
        }
      }
    }

    // 拖拽排序：把 from 挪到 to 的前面/后面
    function reorderDialogueRows(from, to, after) {
      const rows = collectDialogueRows();
      if (from < 0 || from >= rows.length || to < 0 || to >= rows.length) return;
      const [moved] = rows.splice(from, 1);
      let insert;
      if (from < to) insert = after ? to : to - 1;
      else insert = after ? to + 1 : to;
      insert = Math.max(0, Math.min(rows.length, insert));
      rows.splice(insert, 0, moved);
      dlgRows = rows;
      dlgSelectedIdx = insert;
      renderDialogueRows();
      if (isEdit) saveDialogues();
    }

    // 舞台预览：按坐标/缩放/裁剪画出各句立绘的位置
    // ===== 场景背景选择器：大图预览 + 选择/上传/清除 + 同步舞台预览 =====
    function setupBgPicker() {
      const input = document.getElementById('bg-change-input');
      const thumb = document.getElementById('bg-thumb');
      const pathText = document.getElementById('bg-path-text');
      const clearBtn = document.getElementById('bg-clear-btn');
      const pickBtn = document.getElementById('bg-pick-btn');
      const uploadBtn = document.getElementById('bg-upload-btn');
      if (!input || !thumb) return;

      const cur = () => (input.value || '').trim();
      const paint = () => {
        const url = cur();
        if (url) {
          thumb.innerHTML = `<img src="${url}" alt="" onerror="this.style.display='none'">`;
          thumb.classList.add('has-img');
        } else {
          thumb.innerHTML = '<div class="bg-thumb-empty">未设置背景</div>';
          thumb.classList.remove('has-img');
        }
        if (pathText) pathText.textContent = url || '未设置背景（沿用场景默认）';
        if (pathText) pathText.title = url || '';
        if (clearBtn) clearBtn.disabled = !url;
        renderStagePreview();
      };
      const set = (url) => { input.value = url || ''; paint(); };

      thumb.addEventListener('click', () => pickBtn && pickBtn.click());
      pickBtn?.addEventListener('click', () => {
        Admin.Pickers.image({ multi: false, category: 'scenes/cutscene', currentUrl: cur(), allowUpload: true })
          .then(url => { if (url) { set(url); Admin.toast('已选择背景', 'success'); } });
      });
      uploadBtn?.addEventListener('click', () => {
        Admin.Pickers.uploadImage('scenes/cutscene', () => {
          Admin.toast('上传完成，点「选择背景」即可使用', 'info');
        });
      });
      clearBtn?.addEventListener('click', () => {
        set('');
        Admin.toast('已清除背景', 'info');
      });

      // 从「场景管理」里做好的场景直接取封面当对话背景
      document.getElementById('bg-scene-apply')?.addEventListener('click', () => {
        const sel = document.getElementById('bg-scene-select');
        const sid = parseInt(sel?.value);
        const sc = scenes.find(x => x.id === sid);
        if (!sc) { Admin.toast('先选一个场景', 'info'); return; }
        if (!sc.background_image) { Admin.toast('这个场景还没有封面：到「场景管理 → 场景拼装」出一张图', 'error'); return; }
        set(sc.background_image);
        const sidInput = document.getElementById('bg-scene-id');
        if (sidInput) sidInput.value = String(sc.id);
        Admin.toast('已使用场景「' + sc.name + '」的封面', 'success');
      });

      paint();
    }

    // 舞台预览：只显示「当前选中的那一句」，避免多句立绘叠在一起分不清；背景跟随场景背景
    function renderStagePreview() {
      const box = document.getElementById('dlg-stage-preview');
      if (!box) return;
      const rows = collectDialogueRows();
      const H = box.clientHeight || 290;
      const W = box.clientWidth || 420;
      box.innerHTML = '';

      // 场景背景：跟随节点的背景图设置
      const bgUrl = (document.getElementById('bg-change-input')?.value || '').trim();
      box.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : 'none';
      box.style.backgroundSize = 'cover';
      box.style.backgroundPosition = 'center';
      box.style.backgroundRepeat = 'no-repeat';

      // 舞台辅助线
      const grid = document.createElement('div');
      grid.style.cssText = 'position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,255,255,.04) 0 1px,transparent 1px 10%),repeating-linear-gradient(0deg,rgba(255,255,255,.04) 0 1px,transparent 1px 10%)';
      box.appendChild(grid);

      // 只画选中的那一句（没选中就默认第一句）
      let sel = (dlgSelectedIdx === null || dlgSelectedIdx === undefined) ? -1 : dlgSelectedIdx;
      if (sel < 0 || sel >= rows.length) sel = rows.length > 0 ? 0 : -1;

      if (sel < 0) {
        const empty = document.createElement('div');
        empty.className = 'stage-preview-empty';
        empty.textContent = '暂无对话，点「+ 添加一句」开始';
        box.appendChild(empty);
        return;
      }

      const i = sel;
      const r = rows[i];
      let other = 0;
      rows.forEach((x, k) => { if (k !== i && x.speaker_id) other++; });

      let drawn = false;
      if (r && r.speaker_id) {
        const ch = chars.find(c => c.id === r.speaker_id);
        if (ch) {
          let url = ch.portrait_image || '';
          try {
            const ex = ch.expressions ? JSON.parse(ch.expressions) : {};
            if (r.expression && ex[r.expression]) url = ex[r.expression];
          } catch (e) {}
          if (url) {
            let imgH = H * 0.85 * (r.scale || 1);
            let imgW = imgH * 0.62;
            const maxW = W * 0.9;
            if (imgW > maxW) { const k = maxW / imgW; imgW *= k; imgH *= k; }
            const top = Math.min(100, Math.max(0, r.crop_top || 0));
            const bottom = Math.min(100, Math.max(top + 2, r.crop_bottom ?? 100));
            const winH = imgH * (bottom - top) / 100;

            const win = document.createElement('div');
            win.style.cssText = `position:absolute;overflow:hidden;width:${imgW}px;height:${winH}px;left:${r.pos_x}%;bottom:${r.pos_y}%;transform:translateX(-50%);border:1px dashed rgba(212,175,55,.55);z-index:${r.z_index || 1}`;
            const img = document.createElement('img');
            img.src = url;
            img.style.cssText = `position:absolute;width:${imgW}px;height:${imgH}px;left:0;top:${-imgH * top / 100}px;${r.flip ? 'transform:scaleX(-1);' : ''}`;
            win.appendChild(img);
            box.appendChild(win);
            drawn = true;
          }
          const tag = document.createElement('div');
          tag.className = 'stage-preview-tag';
          tag.textContent = `正在预览 #${i + 1} · ${ch.name}${r.disappear_after ? ' · 说完消失' : ''}`;
          box.appendChild(tag);
        }
      }
      if (!drawn) {
        const tag = document.createElement('div');
        tag.className = 'stage-preview-tag';
        tag.textContent = `正在预览 #${i + 1} · ${r && r.speaker_id ? '该角色暂无立绘' : '旁白（无立绘）'}`;
        box.appendChild(tag);
      }

      if (other > 0) {
        const hint = document.createElement('div');
        hint.className = 'stage-preview-hint';
        hint.textContent = `已隐藏其余 ${other} 句 · 点某一句可单独预览`;
        box.appendChild(hint);
      }
    }

    function scheduleDialogueSave() {
      renderStagePreview();
      if (!isEdit) return;
      clearTimeout(dlgSaveTimer);
      dlgSaveTimer = setTimeout(() => saveDialogues(), 500);
    }

    async function saveDialogues() {
      if (!isEdit) return;
      const rows = collectDialogueRows();
      try {
        const rowEls = document.querySelectorAll('.dlg-row');
        for (let i = 0; i < rows.length; i++) {
          const payload = { ...rows[i] };
          delete payload.id;
          if (rows[i].id) {
            await Admin.put(`/story/nodes/${data.id}/dialogues/${rows[i].id}`, payload);
          } else {
            const created = await Admin.post(`/story/nodes/${data.id}/dialogues`, payload);
            if (rowEls[i]) rowEls[i].dataset.id = created.id;
            rows[i].id = created.id;
          }
        }
        for (const id of removedDlgIds) {
          try { await Admin.del(`/story/nodes/${data.id}/dialogues/${id}`); } catch (e) {}
        }
        removedDlgIds = [];
        // 同步节点列表里的「说话者」单元格（不整表重绘）
        syncNodeSpeakerCell(data.id, rows);
        const ids = [...document.querySelectorAll('.dlg-row')]
          .map(e => parseInt(e.dataset.id)).filter(Boolean);
        if (ids.length > 1) {
          await Admin.post(`/story/nodes/${data.id}/dialogues/reorder`, { ordered_ids: ids });
        }
      } catch (e) {
        Admin.toast('对话保存失败: ' + e.message, 'error');
      }
    }

    let dlgDragIdx = null;

    function bindDialogueRowEvents() {
      document.querySelectorAll('.dlg-row').forEach(row => {
        row.querySelectorAll('input,select,textarea').forEach(inp => {
          inp.addEventListener('input', scheduleDialogueSave);
          inp.addEventListener('change', scheduleDialogueSave);
        });

        // 左键点击 → 选中该句
        row.addEventListener('click', (e) => {
          const idx = parseInt(row.dataset.idx, 10);
          if (dlgSelectedIdx !== idx) selectDialogueRow(idx, false);
        });

        // 右键 → 选中并弹出菜单
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const idx = parseInt(row.dataset.idx, 10);
          selectDialogueRow(idx, false);
          showDlgContextMenu(e.clientX, e.clientY, idx);
        });

        // 表情按钮 → 弹出表情小图选择
        row.querySelector('.dlg-exp-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          openExprPicker(row.querySelector('.dlg-exp-btn'));
        });

        // 参数配置按钮 → 弹出小窗口
        row.querySelector('.dlg-cfg-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          openCfgPop(row.querySelector('.dlg-cfg-btn'));
        });

        // 切换说话者 → 刷新表情缩略图
        const speakerSel = row.querySelector('.dlg-speaker');
        speakerSel?.addEventListener('change', () => {
          updateExprButton(row);
          scheduleDialogueSave();
        });

        // 显示部位预设 → 自动填 crop 数值
        const presetSel = row.querySelector('.dlg-preset');
        presetSel?.addEventListener('change', () => {
          const p = CROP_PRESETS.find(x => x.key === presetSel.value);
          const t = row.querySelector('.dlg-crop-top');
          const b = row.querySelector('.dlg-crop-bottom');
          if (p && p.key !== 'custom') {
            t.value = p.top; b.value = p.bottom;
            t.disabled = true; b.disabled = true;
          } else {
            t.disabled = false; b.disabled = false;
          }
          scheduleDialogueSave();
        });

        // 删除按钮已移除（避免误触），删除请走右键菜单
        // ⧉ 只复制配置，不含台词（与右键「复制配置（不含台词）」一致）
        row.querySelector('.dlg-copy')?.addEventListener('click', (e) => {
          e.stopPropagation();
          dlgContextAction('copyCfg', parseInt(row.dataset.idx, 10));
        });
        row.querySelector('.dlg-up')?.addEventListener('click', (e) => {
          e.stopPropagation();
          moveDialogueRow(parseInt(row.dataset.idx, 10), -1);
        });
        row.querySelector('.dlg-down')?.addEventListener('click', (e) => {
          e.stopPropagation();
          moveDialogueRow(parseInt(row.dataset.idx, 10), 1);
        });

        // ===== 拖拽排序（与节点列表一致：按住拖动，松手落位） =====
        row.addEventListener('mousedown', (e) => {
          // 在输入框/按钮上按下时不启动拖拽，避免影响文本选择与点击
          row.draggable = !e.target.closest('input,textarea,select,button');
        });
        row.addEventListener('dragstart', (e) => {
          if (!row.draggable) { e.preventDefault(); return; }
          dlgDragIdx = parseInt(row.dataset.idx, 10);
          row.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', String(dlgDragIdx)); } catch (err) {}
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('dragging');
          document.querySelectorAll('.dlg-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
          dlgDragIdx = null;
        });
        row.addEventListener('dragover', (e) => {
          if (dlgDragIdx === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const rect = row.getBoundingClientRect();
          const after = (e.clientY - rect.top) > rect.height / 2;
          row.classList.toggle('drag-over-bottom', after);
          row.classList.toggle('drag-over-top', !after);
        });
        row.addEventListener('dragleave', () => {
          row.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          row.classList.remove('drag-over-top', 'drag-over-bottom');
          if (dlgDragIdx === null) return;
          const to = parseInt(row.dataset.idx, 10);
          const rect = row.getBoundingClientRect();
          const after = (e.clientY - rect.top) > rect.height / 2;
          const from = dlgDragIdx;
          dlgDragIdx = null;
          if (from === to) return;
          reorderDialogueRows(from, to, after);
        });
      });
    }

    function moveDialogueRow(idx, dir) {
      const rows = collectDialogueRows();
      const target = idx + dir;
      if (target < 0 || target >= rows.length) return;
      const tmp = rows[idx]; rows[idx] = rows[target]; rows[target] = tmp;
      dlgRows = rows;
      renderDialogueRows();
      if (isEdit) saveDialogues();
    }

    function renumberDialogueRows() {
      document.querySelectorAll('.dlg-row').forEach((el, i) => {
        el.dataset.idx = i;
        const tag = el.querySelector('.dlg-idx');
        if (tag) tag.textContent = `#${i + 1}`;
      });
    }

    // 动效选项HTML
    const animOptions = animations.map(a =>
      `<option value="${a.id}">${a.name} (${a.duration}ms)</option>`
    ).join('');
    const sceneOptions = scenes.map(s =>
      `<option value="${s.id}">${esc(s.name)}${s.background_image ? '' : '（无封面）'}</option>`
    ).join('');

    // 解析多人同场数据
    let multiChars = [];
    if (data?.multi_characters) {
      try {
        multiChars = typeof data.multi_characters === 'string'
          ? JSON.parse(data.multi_characters)
          : data.multi_characters;
      } catch (e) {}
    }
    // 无多人数据但有speaker_id → 单人物兼容
    if (multiChars.length === 0 && data?.speaker_id) {
      multiChars.push({
        speaker_id: data.speaker_id,
        expression: data.expression || '',
        position: data.position || 'center'
      });
    }
    // 至少保留一个空位
    if (multiChars.length === 0) {
      multiChars.push({ speaker_id: '', expression: '', position: 'center' });
    }

    const charOptions = chars.map(c =>
      `<option value="${c.id}">${c.name}${c.title ? ' · ' + c.title : ''} (${c.character_type})</option>`
    ).join('');

    const voiceOptions = sounds.filter(s => s.category === 'voice').map(s =>
      `<option value="${s.file_url}">${s.name}</option>`
    ).join('');
    const bgmOptions = sounds.filter(s => s.category === 'bgm').map(s =>
      `<option value="${s.file_url}">${s.name}</option>`
    ).join('');

    // ===== 工具函数（使用模块级函数：positionOptions / buildExprGrid / esc） =====

    // 单个人物面板HTML
    function buildCharPanel(index, charData) {
      const speakerOpts = chars.map(c =>
        `<option value="${c.id}" ${charData.speaker_id == c.id ? 'selected' : ''}>${c.name}${c.title ? ' · ' + c.title : ''}</option>`
      ).join('');
      const posHtml = positionOptions(charData.position || 'center');
      return `
        <div class="char-panel" data-index="${index}" style="${index > 0 ? 'display:none' : ''}">
          <div class="form-row">
            <div class="form-group" style="flex:1">
              <label>说话者</label>
              <select class="char-speaker" data-index="${index}" style="width:100%">
                <option value="">-- 无 --</option>
                ${speakerOpts}
              </select>
            </div>
            <div class="form-group" style="flex:0 0 160px">
              <label>位置</label>
              <select class="char-position" data-index="${index}" style="width:100%">
                ${posHtml}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>表情（点击选择）</label>
            <input type="hidden" class="char-expression-input" data-index="${index}" value="${charData.expression || ''}">
            <div class="char-expr-area" data-index="${index}">
              ${charData.speaker_id ? '<div style="font-size:11px;color:var(--text-muted);padding:4px">加载表情数据...</div>' : '<div style="font-size:11px;color:var(--text-muted);padding:4px">请先选择说话者</div>'}
            </div>
          </div>
          <div class="form-group">
            <label>表情动效</label>
            <select class="char-anim-effect" data-index="${index}" style="width:100%;padding:6px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:12px">
              <option value="">-- 无动效 --</option>
              ${animOptions}
            </select>
          </div>
        </div>
      `;
    }

    // Tab按钮HTML
    function buildTabButtons(count, activeIndex) {
      let html = '';
      for (let i = 0; i < count; i++) {
        const active = i === activeIndex ? 'btn-gold' : 'btn-outline';
        html += `<button class="btn btn-sm char-tab ${active}" data-index="${i}" style="padding:3px 10px;font-size:11px">人物${i+1}${i > 0 ? ' <span class="remove-char" data-index="'+i+'" style="margin-left:4px;color:var(--red);cursor:pointer">&times;</span>' : ''}</button>`;
      }
      return html;
    }

    // ===== 构建主表单（紧凑：顶栏一行 → 场景背景 → 对话列表） =====
    const bodyHtml = `
      <input type="hidden" name="content" id="node-content-input" value="${esc(data?.content || '')}">
      <input type="hidden" name="multi_characters" id="multi-char-json" value='${esc(JSON.stringify(multiChars))}'>

      <!-- ===== 顶栏：标题 / 类型 / 顺序 / 音乐 ===== -->
      <div class="node-head-bar">
        <div class="nh-row">
          <label class="nh-field nh-title">
            <span class="nh-label">节点标题</span>
            <input name="title" value="${esc(data?.title || '')}" placeholder="给这个节点起个名字（便于后台查找）">
          </label>
          <label class="nh-field" style="flex:0 0 116px">
            <span class="nh-label">类型</span>
            <select name="node_type">
              <option value="dialogue" ${data?.node_type === 'dialogue' ? 'selected' : ''}>对话</option>
              <option value="choice" ${data?.node_type === 'choice' ? 'selected' : ''}>选择</option>
              <option value="battle" ${data?.node_type === 'battle' ? 'selected' : ''}>战斗</option>
              <option value="cutscene" ${data?.node_type === 'cutscene' ? 'selected' : ''}>过场</option>
            </select>
          </label>
          <label class="nh-field" style="flex:0 0 84px">
            <span class="nh-label">顺序</span>
            <input name="order_index" type="number" value="${data?.order_index || 1}">
          </label>
          <label class="nh-field" style="flex:1 1 220px">
            <span class="nh-label">音乐</span>
            <select name="bgm" id="node-bgm-select">
              <option value="">-- 无音乐 --</option>
              <optgroup label="人声">${voiceOptions || '<option disabled>无人声</option>'}</optgroup>
              <optgroup label="背景音乐">${bgmOptions || '<option disabled>无背景音乐</option>'}</optgroup>
            </select>
          </label>
          <button class="btn btn-outline btn-sm nh-play" id="btn-preview-music" title="试听所选音乐">&#9654;</button>
        </div>
      </div>

      <!-- ===== 对话列表（一个节点多句对白，按顺序播放） ===== -->
      <div class="node-sec">
        <div class="node-sec-head">
          <span>对话列表（一个节点可写多句，按顺序播放）</span>
          <span class="node-sec-tip">左键=选中 · 右键=菜单（复制/粘贴配置） · 拖住行首 <b>⋮⋮</b> 排序 · 点 <b>⚙</b> 配参数</span>
          <span style="flex:1"></span>
          <button class="btn btn-outline btn-sm" id="btn-dlg-from-node" title="把该节点旧的单句对白转成对话列表">↧ 导入旧内容</button>
          <button class="btn btn-gold btn-sm" id="btn-add-dialogue">+ 添加一句</button>
        </div>
        <div style="display:flex;gap:14px;align-items:flex-start">
          <div id="dialogue-list" style="flex:1;min-width:0"></div>
          <div style="flex:0 0 420px;position:sticky;top:0">
            <div class="node-sec-tip" style="margin-bottom:4px">舞台预览（随坐标 / 缩放 / 裁剪实时更新）</div>
            <div id="dlg-stage-preview" style="position:relative;width:420px;height:290px;background:linear-gradient(135deg,#1a1a22,#101018);border:1px solid var(--border);border-radius:6px;overflow:hidden"></div>
          </div>
        </div>
        ${isEdit ? '' : '<div class="node-sec-tip" style="margin-top:6px">新建节点：对话会在节点创建后自动保存</div>'}
      </div>

      <!-- ===== 场景背景 ===== -->
      <div class="node-sec bg-sec">
        <div class="node-sec-head">
          <span>场景背景</span>
          <span class="node-sec-tip">选中的背景会同步显示到右侧舞台预览里</span>
        </div>
        <div class="bg-sec-body">
          <div class="bg-picker">
            <div class="bg-thumb" id="bg-thumb" title="点击选择背景图"></div>
            <div class="bg-actions">
              <button type="button" class="btn btn-gold btn-sm" id="bg-pick-btn">选择背景</button>
              <button type="button" class="btn btn-outline btn-sm" id="bg-upload-btn">上传</button>
              <button type="button" class="btn btn-outline btn-sm" id="bg-clear-btn">清除</button>
            </div>
          </div>
          <div class="bg-side">
            <label class="nh-field">
              <span class="nh-label">背景转场动效</span>
              <select name="bg_animation_effect_id">
                <option value="">-- 无转场动效 --</option>
                ${animOptions}
              </select>
            </label>
            <div class="bg-path" id="bg-path-text">未设置背景</div>
            <div class="node-sec-tip">图片来源：图片管理 → 人物过场（scenes/cutscene），或直接从场景库取封面</div>
            <div style="display:flex;gap:6px;align-items:center;margin-top:6px">
              <select id="bg-scene-select" style="flex:1;min-width:0;padding:5px 7px;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:12px">
                <option value="">-- 从场景库选择 --</option>${sceneOptions}
              </select>
              <button type="button" class="btn btn-outline btn-sm" id="bg-scene-apply">用它的封面</button>
            </div>
          </div>
        </div>
        <input type="hidden" name="background_change" id="bg-change-input" value="${esc(data?.background_change || '')}">
        <input type="number" name="scene_id" id="bg-scene-id" value="${data?.scene_id || ''}" style="display:none">
      </div>

      <!-- ===== 战斗配置（仅 node_type = battle 生效） ===== -->
      <details class="node-sec" id="battle-config-sec" ${(data?.node_type === 'battle' || data?.battle_config) ? 'open' : ''}>
        <summary style="cursor:pointer;font-weight:600;color:var(--accent);font-size:15px">
          战斗配置（仅「战斗」类型节点生效）
        </summary>
        <div class="bt-what">
          <b>这是什么：</b>当这个节点的「类型」选成 <b>战斗</b> 时，剧情推进到这里会先打一场再继续。
          下面这段 JSON 就是告诉系统<b>打谁、按什么强度打、打赢/打输/逃跑之后跳到哪个节点</b>。
          类型是「对话 / 选择 / 过场」时，这里写什么都不生效，可以直接留空。
        </div>
        <div style="margin-top:10px">
          <textarea name="battle_config" id="battle-config-input" rows="10" spellcheck="false"
            style="width:100%;font-family:Consolas,'Courier New',monospace;font-size:14px;line-height:1.75;padding:10px 12px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:6px"
            placeholder='{"enemies":[{"character_id":2,"level_mode":"match"}],"difficulty":1.0,"allow_flee":true}'>${esc(data?.battle_config || '')}</textarea>
          <div id="battle-config-hint" style="font-size:13px;margin-top:6px;line-height:1.6"></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
            <button type="button" class="btn btn-outline btn-sm" data-btpl="basic">基础模板</button>
            <button type="button" class="btn btn-outline btn-sm" data-btpl="boss">BOSS 模板</button>
            <button type="button" class="btn btn-outline btn-sm" data-btpl="group">群战模板</button>
            <button type="button" class="btn btn-outline btn-sm" id="btn-battle-from-npc">按登场人物生成敌人</button>
          </div>
          <div class="bt-doc">
            <div class="bt-doc-t">字段说明（看不懂就用上面的模板按钮，再改 character_id）</div>
            <div class="bt-doc-row"><b>enemies</b><span>这一战的敌人列表，每个敌人可写：
              <code>character_id</code>（用哪个人物当敌人）、<code>name</code>（覆盖显示名）、
              <code>level_mode</code>（<i>match</i>=按玩家属性派生／<i>scale</i>=按等级缩放／<i>fixed</i>=固定值）、
              <code>power</code>、<code>hp_ratio</code>、<code>atk_ratio</code>、<code>def_ratio</code>、<code>spd_ratio</code>、
              <code>is_boss</code>、<code>skills</code>、<code>phases</code>（Boss 分阶段）、<code>drops</code>、<code>ai</code>。</span></div>
            <div class="bt-doc-row"><b>difficulty</b><span>全局难度倍率，1.0 = 标准。调高敌人更强。</span></div>
            <div class="bt-doc-row"><b>allow_flee</b><span>true / false，是否允许玩家逃跑。</span></div>
            <div class="bt-doc-row"><b>exp_multiplier</b><span>经验倍率。</span></div>
            <div class="bt-doc-row"><b>victory / defeat / flee_node_id</b><span>打赢、打输、逃跑之后分别跳到哪个节点 id。</span></div>
            <div class="bt-doc-row"><b>banter</b><span>战斗中插话，<code>trigger</code> 可选
              battle_start / round / hp_below / ally_down / victory / defeat。</span></div>
            <div class="bt-doc-row"><b>留空会怎样</b><span>自动按「场景 NPC → 节点登场人物 → 说话者」的顺序决定敌人。</span></div>
          </div>
        </div>
      </details>
    `;

    // ===== 战斗配置编辑器：模板 / 校验 / 按登场人物生成敌人 =====
    function initBattleConfigEditor() {
      const ta = document.getElementById('battle-config-input');
      const hint = document.getElementById('battle-config-hint');
      if (!ta) return;

      const validate = () => {
        const raw = (ta.value || '').trim();
        if (!raw) {
          if (hint) {
            hint.innerHTML = '<span style="color:var(--text-muted)">未配置：将按「场景NPC → 节点登场人物 → 说话者」自动决定敌人</span>';
          }
          return true;
        }
        try {
          const cfg = JSON.parse(raw);
          if (typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('必须是对象');
          const parts = [];
          if (Array.isArray(cfg.enemies)) parts.push(`${cfg.enemies.length} 个敌人`);
          if (cfg.difficulty) parts.push(`难度 ${cfg.difficulty}`);
          if ((cfg.enemies || []).some(e => e && (e.is_boss || e.phases))) parts.push('含 BOSS');
          if (Array.isArray(cfg.banter) && cfg.banter.length) parts.push(`${cfg.banter.length} 条台词`);
          if (hint) {
            hint.innerHTML = `<span style="color:var(--accent)">✓ 配置有效${parts.length ? '：' + parts.join('，') : ''}</span>`;
          }
          return true;
        } catch (e) {
          if (hint) hint.innerHTML = `<span style="color:var(--red)">JSON 错误：${e.message}</span>`;
          return false;
        }
      };

      const TPLS = {
        basic: {
          enemies: [{ character_id: 2, level_mode: 'match' }],
          difficulty: 1.0, allow_flee: true, exp_multiplier: 1.0,
        },
        boss: {
          enemies: [{
            character_id: 2, level_mode: 'match', is_boss: true, power: 1.35,
            phases: [{
              hp_below: 50, name: '狂暴', line: '它发出震耳的咆哮！',
              buff: { key: 'atk_up', name: '狂暴', stat: 'attack', value: 40, turns: 99 },
            }],
            drops: [{ item_id: 1, quantity: 1, chance: 100 }],
          }],
          difficulty: 1.15, allow_flee: false, exp_multiplier: 1.5,
          banter: [{ trigger: 'battle_start', speaker: '???', line: '又一个不知死活的家伙。' }],
        },
        group: {
          enemies: [
            { character_id: 2, level_mode: 'match' },
            { character_id: 3, level_mode: 'match', power: 0.85 },
          ],
          difficulty: 1.0, allow_flee: true, exp_multiplier: 1.2,
        },
      };

      ta.addEventListener('input', validate);
      document.querySelectorAll('.modal-body [data-btpl]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tpl = TPLS[btn.dataset.btpl];
          if (!tpl) return;
          ta.value = JSON.stringify(tpl, null, 2);
          validate();
        });
      });
      document.getElementById('btn-battle-from-npc')?.addEventListener('click', () => {
        let rows = [];
        try { rows = collectDialogueRows() || []; } catch (e) { rows = []; }
        const ids = [...new Set(rows.map(r => r.speaker_id).filter(Boolean))];
        if (!ids.length) { Admin.toast('节点里还没有登场人物', 'info'); return; }
        let cfg = {};
        try { cfg = JSON.parse(ta.value || '{}') || {}; } catch (e) { cfg = {}; }
        if (typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
        cfg.enemies = ids.map(id => ({ character_id: id, level_mode: 'match' }));
        ta.value = JSON.stringify(cfg, null, 2);
        validate();
        Admin.toast(`已按登场人物生成 ${ids.length} 个敌人`, 'success');
      });
      validate();
    }

    Admin.showModal(isEdit ? '编辑节点' : '新建节点', bodyHtml, async () => {
      // ===== 人物 / 内容 已从对话列表合并而来 =====
      // 同场人物 = 对话列表里出现过的角色（去重，最多6人），旧字段同步保持可用
      const dlgAll = collectDialogueRows();
      const seen = new Set();
      const charsData = [];
      for (const d of dlgAll) {
        if (!d.speaker_id || seen.has(d.speaker_id)) continue;
        seen.add(d.speaker_id);
        if (charsData.length >= 6) break;
        charsData.push({
          speaker_id: d.speaker_id,
          expression: d.expression || '',
          position: legacyPosOf(d.pos_x),
          animation_effect_id: d.animation_effect_id || null,
        });
      }
      document.getElementById('multi-char-json').value = JSON.stringify(charsData);
      // 节点 content / speaker 取对话列表第一句（兼容旧渲染与节点列表展示）
      const firstLine = dlgAll.find(d => d.content || d.speaker_id);
      const contentInput = document.getElementById('node-content-input');
      if (contentInput) contentInput.value = (firstLine && firstLine.content) || '';

      // 收集表单数据
      const formData = Admin.getFormData('.modal-body');
      formData.chapter_id = currentChapterId;
      // 第一人物作为主 speaker（兼容旧字段）
      if (charsData.length > 0) {
        formData.speaker_id = charsData[0].speaker_id;
        formData.expression = charsData[0].expression;
        formData.position = charsData[0].position;
      } else {
        formData.speaker_id = null;
        formData.expression = null;
        formData.position = null;
      }

      const pendingDialogues = collectDialogueRows();

      try {
        if (isEdit) {
          await Admin.put(`/story/nodes/${data.id}`, formData);
          Admin.toast('节点已更新', 'success');
        } else {
          const created = await Admin.post('/story/nodes', formData);
          // 新节点：把对话列表补写进去
          for (const d of pendingDialogues) {
            const payload = { ...d };
            delete payload.id;
            await Admin.post(`/story/nodes/${created.id}/dialogues`, payload);
          }
          Admin.toast('节点已创建', 'success');
        }
        Admin.closeModal();
        await loadNodes(currentChapterId);
      } catch (e) {
        Admin.toast('保存失败: ' + e.message, 'error');
      }
    }, { size: 'xl' });

    // ===== 绑定事件（弹窗打开后） =====
    setTimeout(() => {
      initBattleConfigEditor();

      // Tab切换
      document.querySelectorAll('.char-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          if (e.target.closest('.remove-char')) return;
          const idx = tab.dataset.index;
          document.querySelectorAll('.char-tab').forEach(t => {
            t.className = 'btn btn-sm btn-outline char-tab';
          });
          tab.className = 'btn btn-sm btn-gold char-tab';
          document.querySelectorAll('.char-panel').forEach(p => p.style.display = 'none');
          const panel = document.querySelector(`.char-panel[data-index="${idx}"]`);
          if (panel) panel.style.display = '';
        });
      });

      // 删除人物
      document.querySelectorAll('.remove-char').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.index);
          const panels = document.querySelectorAll('.char-panel');
          if (panels.length <= 1) {
            Admin.toast('至少需要保留一个人物', 'info');
            return;
          }
          const panel = document.querySelector(`.char-panel[data-index="${idx}"]`);
          if (panel) panel.remove();
          rebuildMultiCharUI();
          Admin.toast('人物已移除', 'info');
        });
      });

      // 添加人物
      document.getElementById('add-char-btn')?.addEventListener('click', () => {
        const panels = document.querySelectorAll('.char-panel');
        if (panels.length >= 6) {
          Admin.toast('最多6个人物', 'info');
          return;
        }
        const newIdx = panels.length;
        const panelHtml = buildCharPanel(newIdx, { speaker_id: '', expression: '', position: 'center' });
        document.getElementById('multi-char-panels').insertAdjacentHTML('beforeend', panelHtml);
        rebuildMultiCharUI();
        const newTab = document.querySelector(`.char-tab[data-index="${newIdx}"]`);
        if (newTab) newTab.click();
        Admin.toast(`已添加人物${newIdx+1}，请选择说话者`, 'info');
      });

      // 说话者变更 → 加载表情
      document.querySelectorAll('.char-speaker').forEach(sel => {
        sel.addEventListener('change', async () => {
          const idx = sel.dataset.index;
          const charId = parseInt(sel.value);
          const area = document.querySelector(`.char-expr-area[data-index="${idx}"]`);
          if (!area) return;
          if (!charId) {
            area.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px">请先选择说话者</div>';
            return;
          }
          try {
            const char = await Admin.get(`/characters/${charId}`);
            const exprs = char.expressions ? JSON.parse(char.expressions) : {};
            const selectedExp = document.querySelector(`.char-expression-input[data-index="${idx}"]`)?.value || '';
            area.innerHTML = buildExprGrid(exprs, selectedExp);
            // 表情点击选择
            area.querySelectorAll('.exp-option').forEach(el => {
              el.addEventListener('click', () => {
                area.querySelectorAll('.exp-option').forEach(e => {
                  e.style.borderColor = 'var(--border)';
                  e.classList.remove('selected');
                });
                el.style.borderColor = 'var(--gold)';
                el.classList.add('selected');
                const input = document.querySelector(`.char-expression-input[data-index="${idx}"]`);
                if (input) input.value = el.dataset.exp;
              });
            });
          } catch (e) {
            area.innerHTML = '<div style="font-size:11px;color:var(--red);padding:4px">加载失败</div>';
          }
        });
      });

      // 初始加载各面板的表情数据
      document.querySelectorAll('.char-speaker').forEach(sel => {
        if (sel.value) {
          sel.dispatchEvent(new Event('change'));
        }
      });

      // ===== 对话列表 =====
      renderDialogueRows();

      document.getElementById('btn-add-dialogue')?.addEventListener('click', () => {
        dlgRows = collectDialogueRows();
        dlgRows.push({
          id: null, speaker_id: null, content: '', expression: 'normal',
          pos_x: 50, pos_y: 0, scale: 1, crop_top: 0, crop_bottom: 100,
          flip: 0, z_index: 1, animation_effect_id: null,
        });
        renderDialogueRows();
        const box = document.getElementById('dialogue-list');
        if (box) box.scrollTop = box.scrollHeight;
        if (isEdit) saveDialogues();
      });

      document.getElementById('btn-dlg-from-node')?.addEventListener('click', async () => {
        if (!isEdit) {
          Admin.toast('请先保存节点，再导入', 'info');
          return;
        }
        try {
          dlgRows = await Admin.post(`/story/nodes/${data.id}/dialogues/from-node`, {});
          Admin.toast('已导入当前内容', 'success');
          renderDialogueRows();
        } catch (e) {
          Admin.toast('导入失败: ' + e.message, 'error');
        }
      });

      // 音乐试听
      document.getElementById('btn-preview-music')?.addEventListener('click', () => {
        const bgmVal = document.getElementById('node-bgm-select').value;
        if (!bgmVal) { Admin.toast('请先选择音乐', 'info'); return; }
        const existing = document.getElementById('music-preview-player');
        if (existing) existing.remove();
        const player = document.createElement('div');
        player.id = 'music-preview-player';
        player.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:12px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.5)';
        player.innerHTML = `<audio controls autoplay style="width:240px;height:36px"><source src="${bgmVal}"></audio>`;
        document.body.appendChild(player);
        setTimeout(() => { if (player.parentNode) player.remove(); }, 60000);
      });

      // 场景背景图片选择器（大图预览 + 转场动效 + 同步舞台预览）
      setupBgPicker();

      // 初始化背景转场动效选中值
      if (data?.bg_animation_effect_id) {
        const bgAnimSelect = document.querySelector('select[name="bg_animation_effect_id"]');
        if (bgAnimSelect) bgAnimSelect.value = data.bg_animation_effect_id;
      }

      // 初始化各人物表情动效选中值
      if (multiChars.length > 0) {
        document.querySelectorAll('.char-anim-effect').forEach(sel => {
          const idx = parseInt(sel.dataset.index);
          const chData = multiChars[idx];
          if (chData && chData.animation_effect_id) {
            sel.value = chData.animation_effect_id;
          }
        });
      }
    }, 100);
  }

  // ===== 重建多人同场UI索引 =====
  function rebuildMultiCharUI() {
    const panels = document.querySelectorAll('.char-panel');
    const tabBar = document.getElementById('multi-char-tabs');
    if (!tabBar) return;

    // 重建索引
    panels.forEach((panel, i) => {
      panel.dataset.index = i;
      panel.querySelectorAll('[data-index]').forEach(el => {
        el.dataset.index = i;
      });
    });

    // 重建tab按钮
    let tabHtml = '';
    for (let i = 0; i < panels.length; i++) {
      tabHtml += `<button class="btn btn-sm char-tab ${i === 0 ? 'btn-gold' : 'btn-outline'}" data-index="${i}" style="padding:3px 10px;font-size:11px">人物${i+1}${i > 0 ? ' <span class="remove-char" data-index="'+i+'" style="margin-left:4px;color:var(--red);cursor:pointer">&times;</span>' : ''}</button>`;
    }

    const addBtnHtml = panels.length < 6
      ? '<button class="btn btn-outline btn-sm" id="add-char-btn" style="font-size:11px;padding:3px 10px">+ 添加人物</button>'
      : '';

    tabBar.innerHTML = tabHtml + addBtnHtml;

    // 只显示第一个面板
    panels.forEach((p, i) => { p.style.display = i === 0 ? '' : 'none'; });

    // 重新绑定tab事件
    document.querySelectorAll('.char-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        if (e.target.closest('.remove-char')) return;
        const idx = tab.dataset.index;
        document.querySelectorAll('.char-tab').forEach(t => {
          t.className = 'btn btn-sm btn-outline char-tab';
        });
        tab.className = 'btn btn-sm btn-gold char-tab';
        document.querySelectorAll('.char-panel').forEach(p => p.style.display = 'none');
        const panel = document.querySelector(`.char-panel[data-index="${idx}"]`);
        if (panel) panel.style.display = '';
      });
    });

    // 重新绑定删除
    document.querySelectorAll('.remove-char').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        const curPanels = document.querySelectorAll('.char-panel');
        if (curPanels.length <= 1) {
          Admin.toast('至少需要保留一个人物', 'info');
          return;
        }
        const panel = document.querySelector(`.char-panel[data-index="${idx}"]`);
        if (panel) panel.remove();
        rebuildMultiCharUI();
        Admin.toast('人物已移除', 'info');
      });
    });

    // 重新绑定添加人物
    const addBtn = document.getElementById('add-char-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const curPanels = document.querySelectorAll('.char-panel');
        if (curPanels.length >= 6) {
          Admin.toast('最多6个人物', 'info');
          return;
        }
        const newIdx = curPanels.length;
        // 从showNodeForm闭包中无法直接访问buildCharPanel，
        // 改为手动构建HTML
        const blankHtml = `
          <div class="char-panel" data-index="${newIdx}" style="display:none">
            <div class="form-row">
              <div class="form-group" style="flex:1">
                <label>说话者</label>
                <select class="char-speaker" data-index="${newIdx}" style="width:100%">
                  <option value="">-- 无 --</option>
                  ${nodeFormChars.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group" style="flex:0 0 160px">
                <label>位置</label>
                <select class="char-position" data-index="${newIdx}" style="width:100%">
                  ${positionOptions('center')}
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>表情（点击选择）</label>
              <input type="hidden" class="char-expression-input" data-index="${newIdx}" value="">
              <div class="char-expr-area" data-index="${newIdx}">
                <div style="font-size:11px;color:var(--text-muted);padding:4px">请先选择说话者</div>
              </div>
            </div>
            <div class="form-group">
              <label>表情动效</label>
              <select class="char-anim-effect" data-index="${newIdx}" style="width:100%;padding:6px 10px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:12px">
                <option value="">-- 无动效 --</option>
                ${animOptions || ''}
              </select>
            </div>
          </div>
        `;
        document.getElementById('multi-char-panels').insertAdjacentHTML('beforeend', blankHtml);
        rebuildMultiCharUI();
        const newTab = document.querySelector(`.char-tab[data-index="${newIdx}"]`);
        if (newTab) newTab.click();
        Admin.toast(`已添加人物${newIdx+1}，请选择说话者`, 'info');
      });
    }

    // 重新绑定speaker变更
    document.querySelectorAll('.char-speaker').forEach(sel => {
      const newSel = sel.cloneNode(true);
      sel.parentNode.replaceChild(newSel, sel);
      newSel.addEventListener('change', async () => {
        const idx = newSel.dataset.index;
        const charId = parseInt(newSel.value);
        const area = document.querySelector(`.char-expr-area[data-index="${idx}"]`);
        if (!area) return;
        if (!charId) {
          area.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px">请先选择说话者</div>';
          return;
        }
        try {
          const char = await Admin.get(`/characters/${charId}`);
          const exprs = char.expressions ? JSON.parse(char.expressions) : {};
          const selectedExp = document.querySelector(`.char-expression-input[data-index="${idx}"]`)?.value || '';
          area.innerHTML = buildExprGrid ? buildExprGrid(exprs, selectedExp) : '';
          area.querySelectorAll('.exp-option').forEach(el => {
            el.addEventListener('click', () => {
              area.querySelectorAll('.exp-option').forEach(e => {
                e.style.borderColor = 'var(--border)';
                e.classList.remove('selected');
              });
              el.style.borderColor = 'var(--gold)';
              el.classList.add('selected');
              const input = document.querySelector(`.char-expression-input[data-index="${idx}"]`);
              if (input) input.value = el.dataset.exp;
            });
          });
        } catch (e) {
          area.innerHTML = '<div style="font-size:11px;color:var(--red);padding:4px">加载失败</div>';
        }
      });
    });
  }

  // ===== 节点操作 =====
  async function editNode(id) {
    try {
      const full = await Admin.get(`/story/nodes/${id}/full`);
      showNodeForm(full.node);
    } catch (e) {
      Admin.toast('加载失败', 'error');
    }
  }

  async function manageChoices(nodeId) {
    let choices = [];
    let editingChoiceId = null; // 当前正在编辑的选项ID，null表示新增模式

    async function reloadChoices() {
      choices = await Admin.get(`/story/nodes/${nodeId}/choices`);
      renderChoicesList();
    }

    function renderChoicesList() {
      const listEl = document.getElementById('choices-list');
      if (!listEl) return;
      if (choices.length === 0) {
        listEl.innerHTML = '<tr><td colspan="5" class="table-empty">暂无选项</td></tr>';
        return;
      }
      listEl.innerHTML = choices.map(c => `
        <tr>
          <td>${c.id}</td>
          <td>${c.choice_text}</td>
          <td>${c.next_node_id ? `#${c.next_node_id}` : '-'}</td>
          <td>${(c.effects || '').substring(0, 30)}</td>
          <td>
            <div class="action-btns">
              <button class="btn-edit-choice" data-id="${c.id}">编辑</button>
              <button class="btn-del-choice" data-id="${c.id}" style="color:var(--red)">删除</button>
            </div>
          </td>
        </tr>
      `).join('');

      // 绑定编辑
      listEl.querySelectorAll('.btn-edit-choice').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = parseInt(btn.dataset.id);
          const choice = choices.find(c => c.id === id);
          if (!choice) return;
          editingChoiceId = id;
          document.getElementById('new-choice-text').value = choice.choice_text || '';
          document.getElementById('new-choice-effects').value = choice.effects || '';
          // 切换按钮为修改模式
          const addBtn = document.getElementById('btn-add-choice');
          if (addBtn) {
            addBtn.textContent = '修改选项';
            addBtn.classList.add('btn-gold');
            addBtn.classList.remove('btn-primary');
          }
          const cancelBtn = document.getElementById('btn-cancel-edit');
          if (cancelBtn) cancelBtn.style.display = '';
          document.getElementById('new-choice-text')?.focus();

          // 设置章节和节点选择器
          const chapterSelect = document.getElementById('choice-chapter-select');
          const nodeSelect = document.getElementById('choice-node-select');
          if (choice.next_node_id) {
            try {
              // 查询目标节点所属章节
              const targetNode = await Admin.get(`/story/nodes/${choice.next_node_id}`);
              if (targetNode && targetNode.chapter_id) {
                chapterSelect.value = String(targetNode.chapter_id);
                // 触发 change 加载该章节的节点列表
                chapterSelect.dispatchEvent(new Event('change'));
                // 等待节点列表加载后选中目标节点
                setTimeout(() => {
                  nodeSelect.value = String(choice.next_node_id);
                }, 300);
              }
            } catch (e) {
              // 查询失败，回退到直接填ID
              chapterSelect.value = '';
              chapterSelect.dispatchEvent(new Event('change'));
            }
          } else {
            chapterSelect.value = '';
            chapterSelect.dispatchEvent(new Event('change'));
          }
        });
      });

      // 绑定删除
      listEl.querySelectorAll('.btn-del-choice').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = parseInt(btn.dataset.id);
          // 使用独立浮层确认，避免覆盖管理选项弹窗
          const confirmed = await new Promise((resolve) => {
            const confOverlay = document.createElement('div');
            confOverlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center';
            confOverlay.innerHTML = `
              <div style="background:var(--bg-card);border-radius:10px;max-width:380px;width:90%;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,0.5)">
                <h3 style="font-size:15px;margin-bottom:12px">确认操作</h3>
                <p style="font-size:13px;margin-bottom:16px">确定要删除该选项吗？</p>
                <div style="display:flex;justify-content:flex-end;gap:8px">
                  <button class="btn btn-outline btn-sm" id="conf-no">取消</button>
                  <button class="btn btn-danger btn-sm" id="conf-yes">确认</button>
                </div>
              </div>
            `;
            document.body.appendChild(confOverlay);
            const cleanup = (val) => { confOverlay.remove(); resolve(val); };
            confOverlay.querySelector('#conf-yes').addEventListener('click', () => cleanup(true));
            confOverlay.querySelector('#conf-no').addEventListener('click', () => cleanup(false));
            confOverlay.addEventListener('click', (e) => { if (e.target === confOverlay) cleanup(false); });
          });
          if (!confirmed) return;
          try {
            await Admin.del(`/story/choices/${id}`);
            Admin.toast('选项已删除', 'success');
            // 如果正在编辑被删除的选项，重置表单
            if (editingChoiceId === id) resetForm();
            await reloadChoices();
          } catch (e) {
            Admin.toast('删除失败: ' + e.message, 'error');
          }
        });
      });
    }

    function resetForm() {
      editingChoiceId = null;
      document.getElementById('new-choice-text').value = '';
      document.getElementById('new-choice-effects').value = '';
      // 重置章节和节点选择器
      const chapterSelect = document.getElementById('choice-chapter-select');
      const nodeSelect = document.getElementById('choice-node-select');
      if (chapterSelect) {
        chapterSelect.value = '';
        chapterSelect.dispatchEvent(new Event('change'));
      }
      const addBtn = document.getElementById('btn-add-choice');
      if (addBtn) {
        addBtn.textContent = '添加选项';
        addBtn.classList.remove('btn-gold');
        addBtn.classList.add('btn-primary');
      }
      const cancelBtn = document.getElementById('btn-cancel-edit');
      if (cancelBtn) cancelBtn.style.display = 'none';
    }

    const bodyHtml = `
      <div class="table-container" style="margin-bottom:16px">
        <table>
          <thead><tr><th>ID</th><th>选项文本</th><th>下一节点</th><th>效果</th><th>操作</th></tr></thead>
          <tbody id="choices-list"></tbody>
        </table>
      </div>
      <div style="border:1px solid var(--border);padding:16px;border-radius:6px">
        <h4 style="font-size:13px;margin-bottom:12px" id="choice-form-title">添加新选项</h4>
        <div class="form-group">
          <label>选项文本</label>
          <input id="new-choice-text" placeholder="如: 【战斗】来吧！">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>跳转章节</label>
            <select id="choice-chapter-select" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px">
              <option value="">-- 不跳转（按顺序播放） --</option>
            </select>
          </div>
          <div class="form-group">
            <label>目标节点</label>
            <select id="choice-node-select" style="width:100%;padding:8px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text-primary);font-size:13px" disabled>
              <option value="">-- 请先选择章节 --</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>效果（JSON）</label>
          <input id="new-choice-effects" placeholder='{"flag":"xxx"}'>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" id="btn-add-choice">添加选项</button>
          <button class="btn btn-outline btn-sm" id="btn-cancel-edit" style="display:none">取消编辑</button>
        </div>
      </div>
    `;

    Admin.showModal('管理选项', bodyHtml, async () => {
      Admin.closeModal();
      await loadNodes(currentChapterId);
    });

    // 禁用默认保存按钮（选项管理不需要整体保存）
    setTimeout(() => {
      const saveBtn = document.getElementById('modal-save-btn');
      if (saveBtn) {
        saveBtn.textContent = '完成';
        saveBtn.classList.remove('btn-primary');
        saveBtn.classList.add('btn-outline');
      }
    }, 0);

    // 加载选项列表
    await reloadChoices();

    // 加载章节列表到选择器
    setTimeout(async () => {
      try {
        const chapters = await Admin.get('/story/chapters');
        const chapterSelect = document.getElementById('choice-chapter-select');
        if (chapterSelect && chapters.length > 0) {
          // 保留第一个选项（不跳转），追加章节选项
          chapters.forEach(ch => {
            const opt = document.createElement('option');
            opt.value = String(ch.id);
            opt.textContent = `${ch.title} (ID:${ch.id})`;
            chapterSelect.appendChild(opt);
          });
        }
      } catch (e) { /* ignore */ }
    }, 50);

    // 章节选择变更时加载对应节点列表
    setTimeout(() => {
      const chapterSelect = document.getElementById('choice-chapter-select');
      const nodeSelect = document.getElementById('choice-node-select');
      if (chapterSelect) {
        chapterSelect.addEventListener('change', async () => {
          const chId = chapterSelect.value;
          if (!chId) {
            nodeSelect.innerHTML = '<option value="">-- 请先选择章节 --</option>';
            nodeSelect.disabled = true;
            return;
          }
          nodeSelect.disabled = true;
          nodeSelect.innerHTML = '<option value="">加载中...</option>';
          try {
            const nodes = await Admin.get(`/story/nodes?chapter_id=${chId}`);
            nodeSelect.innerHTML = '<option value="">-- 选择节点 --</option>';
            nodes.forEach(n => {
              const opt = document.createElement('option');
              opt.value = String(n.id);
              opt.textContent = `#${n.id} ${n.title || n.content?.substring(0, 30) || '(无标题)'}`;
              nodeSelect.appendChild(opt);
            });
            nodeSelect.disabled = false;
          } catch (e) {
            nodeSelect.innerHTML = '<option value="">加载失败</option>';
          }
        });
      }
    }, 50);

    // 绑定添加/修改按钮
    setTimeout(() => {
      document.getElementById('btn-add-choice')?.addEventListener('click', async () => {
        const text = document.getElementById('new-choice-text')?.value.trim();
        if (!text) {
          Admin.toast('请输入选项文本', 'info');
          return;
        }
        const nodeSelect = document.getElementById('choice-node-select');
        const nextNodeId = nodeSelect && nodeSelect.value ? parseInt(nodeSelect.value) : null;
        const payload = {
          node_id: nodeId,
          choice_text: text,
          next_node_id: nextNodeId,
          effects: document.getElementById('new-choice-effects')?.value || null,
        };
        try {
          if (editingChoiceId) {
            // 修改模式
            await Admin.put(`/story/choices/${editingChoiceId}`, payload);
            Admin.toast('选项已修改', 'success');
          } else {
            // 新增模式
            await Admin.post('/story/choices', payload);
            Admin.toast('选项已添加', 'success');
          }
          resetForm();
          await reloadChoices();
        } catch (e) {
          Admin.toast('操作失败: ' + e.message, 'error');
        }
      });

      document.getElementById('btn-cancel-edit')?.addEventListener('click', resetForm);
    }, 100);
  }

  async function deleteNode(id) {
    const confirmed = await Admin.confirm('确定要删除该节点吗？');
    if (!confirmed) return;
    try {
      await Admin.del(`/story/nodes/${id}`);
      Admin.toast('节点已删除', 'success');
      await loadNodes(currentChapterId);
    } catch (e) {
      Admin.toast('删除失败: ' + e.message, 'error');
    }
  }

  container.innerHTML = '<div class="table-empty">加载中...</div>';
  await loadArcs();
});