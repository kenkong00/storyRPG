// ========== 人物境界管理模块 ==========
Admin.registerPage('realms', async (container) => {
  let realms = [], selectedIds = new Set();

  async function load() {
    realms = await Admin.get('/realms/');
    selectedIds.clear();
    render();
  }

  function render() {
    const batchAttr = selectedIds.size === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : '';
    const barHtml = `
      <div class="search-bar">
        <span style="color:var(--text-muted);line-height:2">共 ${realms.length} 个境界等级</span>
        <span style="color:var(--gold);line-height:2;margin-left:4px">已选 ${selectedIds.size} 个</span>
        <span style="color:var(--text-muted);margin:0 4px">|</span>
        <button class="btn btn-danger btn-sm" id="btn-del-selected" ${batchAttr}>删除选中</button>
        <button class="btn btn-outline btn-sm" id="btn-clear-selected" ${batchAttr}>取消选择</button>
        <div style="flex:1"></div>
        <button class="btn btn-outline btn-sm" id="btn-init-default">初始化默认境界</button>
        <button class="btn btn-primary btn-sm" id="btn-add">+ 新建境界</button>
      </div>
    `;

    let bodyHtml = '';
    if (realms.length === 0) {
      bodyHtml = '<div class="table-empty">暂无境界数据，点击"初始化默认境界"自动生成40个境界等级</div>';
    } else {
      // 按大境界分组渲染
      const grouped = {};
      realms.forEach(r => {
        const key = r.realm_name;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(r);
      });

      bodyHtml = '<div class="table-container"><table><thead><tr>';
      bodyHtml += '<th style="width:40px"><input type="checkbox" id="select-all" title="全选"></th>';
      bodyHtml += '<th style="width:60px">等级</th><th>大境界</th><th>小境界</th><th>全名</th><th>HP</th><th>MP</th><th>攻击</th><th>防御</th><th>速度</th><th>幸运</th><th>寿命</th><th style="width:120px">操作</th>';
      bodyHtml += '</tr></thead><tbody>';

      realms.forEach(r => {
        const checked = selectedIds.has(r.level) ? 'checked' : '';
        bodyHtml += `
          <tr>
            <td><input type="checkbox" class="item-checkbox" data-level="${r.level}" ${checked} style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>
            <td>${r.level}</td>
            <td><span class="tag tag-${r.realm_index < 2 ? 'npc' : r.realm_index < 5 ? 'ally' : r.realm_index < 8 ? 'player' : 'enemy'}">${r.realm_name}</span></td>
            <td>${r.sub_level}</td>
            <td style="font-weight:500">${r.full_name}</td>
            <td>${r.max_hp}</td>
            <td>${r.max_mp}</td>
            <td>${r.attack}</td>
            <td>${r.defense}</td>
            <td>${r.speed}</td>
            <td>${r.luck}</td>
            <td style="font-size:12px;color:var(--text-muted)">${r.lifespan >= 10000 ? (r.lifespan/10000).toFixed(0)+'万' : r.lifespan}年</td>
            <td>
              <div class="action-btns">
                <button class="btn-edit" data-level="${r.level}">编辑</button>
                <button class="btn-del" data-level="${r.level}" style="color:var(--red)">删除</button>
              </div>
            </td>
          </tr>
        `;
      });
      bodyHtml += '</tbody></table></div>';
    }

    container.innerHTML = barHtml + bodyHtml;
    bindEvents();
  }

  function bindEvents() {
    document.getElementById('btn-add')?.addEventListener('click', () => showForm());
    document.getElementById('btn-init-default')?.addEventListener('click', async () => {
      try {
        await Admin.post('/realms/init', {});
        Admin.toast('默认境界已初始化', 'success');
        await load();
      } catch (e) {
        Admin.toast('初始化失败: ' + e.message, 'error');
      }
    });

    document.getElementById('select-all')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        realms.forEach(r => selectedIds.add(r.level));
      } else {
        selectedIds.clear();
      }
      render();
    });

    document.querySelectorAll('.item-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        const level = parseInt(cb.dataset.level);
        if (cb.checked) selectedIds.add(level);
        else selectedIds.delete(level);
        render();
      });
    });

    document.getElementById('btn-del-selected')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      const confirmed = await Admin.confirm(`确定要删除选中的 ${selectedIds.size} 个境界等级吗？`);
      if (!confirmed) return;
      let success = 0, fail = 0;
      for (const level of selectedIds) {
        try {
          await Admin.del(`/realms/${level}`);
          success++;
        } catch (e) {
          fail++;
        }
      }
      Admin.toast(`删除完成: ${success} 个成功, ${fail} 个失败`, fail > 0 ? 'error' : 'success');
      await load();
    });

    document.getElementById('btn-clear-selected')?.addEventListener('click', () => {
      if (selectedIds.size === 0) return;
      selectedIds.clear();
      render();
    });

    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const realm = realms.find(r => r.level === parseInt(btn.dataset.level));
        if (realm) showForm(realm);
      });
    });

    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const level = parseInt(btn.dataset.level);
        const confirmed = await Admin.confirm('确定要删除该境界等级吗？');
        if (!confirmed) return;
        try {
          await Admin.del(`/realms/${level}`);
          selectedIds.delete(level);
          Admin.toast('境界已删除', 'success');
          await load();
        } catch (e) {
          Admin.toast('删除失败: ' + e.message, 'error');
        }
      });
    });
  }

  function showForm(data = null) {
    const isEdit = !!data;
    const bodyHtml = `
      <div class="form-row">
        <div class="form-group">
          <label>等级 (1-40) *</label>
          <input name="level" type="number" value="${data?.level || realms.length + 1}" ${isEdit ? 'disabled' : 'required'} ${isEdit ? 'style="opacity:0.5"' : ''}>
        </div>
        <div class="form-group">
          <label>大境界名 *</label>
          <input name="realm_name" value="${data?.realm_name || '练气期'}" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>小境界</label>
          <select name="sub_level">
            <option value="初期" ${data?.sub_level === '初期' ? 'selected' : ''}>初期</option>
            <option value="中期" ${data?.sub_level === '中期' ? 'selected' : ''}>中期</option>
            <option value="后期" ${data?.sub_level === '后期' ? 'selected' : ''}>后期</option>
            <option value="大圆满" ${data?.sub_level === '大圆满' ? 'selected' : ''}>大圆满</option>
          </select>
        </div>
        <div class="form-group">
          <label>全名</label>
          <input name="full_name" value="${data?.full_name || ''}" placeholder="如: 练气期初期">
        </div>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>大境界序号 (0-9)</label>
          <input name="realm_index" type="number" value="${data?.realm_index ?? 0}" min="0" max="9">
        </div>
        <div class="form-group">
          <label>小境界序号 (0-3)</label>
          <input name="sub_index" type="number" value="${data?.sub_index ?? 0}" min="0" max="3">
        </div>
        <div class="form-group">
          <label>寿命（年）</label>
          <input name="lifespan" type="number" value="${data?.lifespan ?? 100}">
        </div>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>最大HP</label>
          <input name="max_hp" type="number" value="${data?.max_hp ?? 100}">
        </div>
        <div class="form-group">
          <label>最大MP</label>
          <input name="max_mp" type="number" value="${data?.max_mp ?? 50}">
        </div>
        <div class="form-group">
          <label>攻击力</label>
          <input name="attack" type="number" value="${data?.attack ?? 10}">
        </div>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>防御力</label>
          <input name="defense" type="number" value="${data?.defense ?? 5}">
        </div>
        <div class="form-group">
          <label>速度</label>
          <input name="speed" type="number" value="${data?.speed ?? 5}">
        </div>
        <div class="form-group">
          <label>幸运</label>
          <input name="luck" type="number" value="${data?.luck ?? 5}">
        </div>
      </div>
      <div class="form-group">
        <label>境界特点描述</label>
        <textarea name="description" rows="4">${data?.description || ''}</textarea>
      </div>
    `;

    Admin.showModal(isEdit ? '编辑境界' : '新建境界', bodyHtml, async () => {
      const formData = Admin.getFormData('.modal-body');
      // 自动生成全名（若为空）
      if (!formData.full_name) {
        formData.full_name = formData.realm_name + formData.sub_level;
      }
      try {
        if (isEdit) {
          const { level, ...updateData } = formData;
          await Admin.put(`/realms/${data.level}`, updateData);
          Admin.toast('境界已更新', 'success');
        } else {
          await Admin.post('/realms/', formData);
          Admin.toast('境界已创建', 'success');
        }
        Admin.closeModal();
        await load();
      } catch (e) {
        Admin.toast('保存失败: ' + e.message, 'error');
      }
    });
  }

  container.innerHTML = '<div class="table-empty">加载中...</div>';
  await load();
});
