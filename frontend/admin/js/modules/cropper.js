// ========== Canvas 图片裁剪器 ==========
// 使用方式: ImageCropper.open({ file, onCrop, aspectRatio, category })
const ImageCropper = {
  _state: null,

  open(options = {}) {
    const { file, onCrop, aspectRatio = 0, category = '', title = '裁剪图片' } = options;

    // 裁剪器使用独立浮层，不替换 modal-container 内容
    const cropperId = 'cropper-' + Date.now();
    const overlay = document.createElement('div');
    overlay.id = `${cropperId}-overlay`;
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10001;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div class="modal" style="max-width:900px;width:95%">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" id="${cropperId}-close-btn">&times;</button>
        </div>
        <div class="modal-body" style="padding:12px;display:flex;flex-direction:column;gap:12px;align-items:center">
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center">
            <label style="font-size:12px;color:var(--text-muted)">比例:</label>
            <button class="btn btn-outline btn-sm cropper-ratio" data-ratio="0">自由</button>
            <button class="btn btn-outline btn-sm cropper-ratio" data-ratio="1">1:1</button>
            <button class="btn btn-outline btn-sm cropper-ratio" data-ratio="4/3">4:3</button>
            <button class="btn btn-outline btn-sm cropper-ratio" data-ratio="16/9">16:9</button>
            <button class="btn btn-outline btn-sm cropper-ratio" data-ratio="3/4">3:4</button>
            <button class="btn btn-outline btn-sm cropper-ratio" data-ratio="9/16">9:16</button>
          </div>
          <div id="${cropperId}-canvas-wrap" style="position:relative;display:inline-block;max-width:100%;overflow:hidden;border:1px solid var(--border);border-radius:4px;cursor:crosshair">
            <canvas id="${cropperId}-canvas"></canvas>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-outline btn-sm" id="${cropperId}-reset">重置选择</button>
            <span style="font-size:11px;color:var(--text-muted);line-height:2">拖拽选择区域，拖动边角调整大小</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="${cropperId}-cancel-btn">取消</button>
          <button class="btn btn-primary" id="${cropperId}-confirm">确认裁剪</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 关闭按钮和取消按钮
    document.getElementById(`${cropperId}-close-btn`).addEventListener('click', () => {
      overlay.remove();
    });
    document.getElementById(`${cropperId}-cancel-btn`).addEventListener('click', () => {
      overlay.remove();
    });

    // 加载图片
    const reader = new FileReader();
    reader.onload = (e) => {
      this._initCropper(cropperId, e.target.result, aspectRatio, (blob) => {
        // 只移除裁剪器浮层，不触碰底层表单
        const el = document.getElementById(`${cropperId}-overlay`);
        if (el) el.remove();
        if (onCrop) onCrop(blob);
      });
    };
    reader.readAsDataURL(file);

    // 裁剪器不允许点击背景关闭，必须点取消或确认按钮
  },

  _initCropper(cropperId, imageSrc, initialRatio, onConfirm) {
    const canvas = document.getElementById(`${cropperId}-canvas`);
    const wrap = document.getElementById(`${cropperId}-canvas-wrap`);
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.onload = () => {
      // 限制显示尺寸
      const maxW = Math.min(img.width, 800);
      const maxH = Math.min(img.height, 500);
      let displayW = img.width;
      let displayH = img.height;
      if (displayW > maxW || displayH > maxH) {
        const scale = Math.min(maxW / displayW, maxH / displayH);
        displayW = Math.round(displayW * scale);
        displayH = Math.round(displayH * scale);
      }

      canvas.width = displayW;
      canvas.height = displayH;
      const scaleX = img.width / displayW;
      const scaleY = img.height / displayH;

      // 初始选择区域（居中，占60%）
      let sel = {
        x: displayW * 0.2,
        y: displayH * 0.2,
        w: displayW * 0.6,
        h: displayH * 0.6,
      };

      // 保持比例
      function constrainRatio(selObj, ratio) {
        if (ratio <= 0) return;
        const r = typeof ratio === 'number' ? ratio : eval(ratio);
        if (selObj.w / selObj.h > r) {
          selObj.w = selObj.h * r;
        } else {
          selObj.h = selObj.w / r;
        }
        // 确保不超出边界
        if (selObj.x + selObj.w > displayW) selObj.x = displayW - selObj.w;
        if (selObj.y + selObj.h > displayH) selObj.y = displayH - selObj.h;
        if (selObj.x < 0) { selObj.x = 0; selObj.w = Math.min(selObj.w, displayW); }
        if (selObj.y < 0) { selObj.y = 0; selObj.h = Math.min(selObj.h, displayH); }
      }

      constrainRatio(sel, initialRatio);
      let currentRatio = initialRatio;

      let dragging = false;
      let dragType = ''; // 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e'
      let startX = 0, startY = 0;
      let startSel = {};

      const HANDLE_SIZE = 8;

      function getDragType(mx, my) {
        const margin = 8;
        const { x, y, w, h } = sel;
        const onLeft = Math.abs(mx - x) < HANDLE_SIZE + margin;
        const onRight = Math.abs(mx - (x + w)) < HANDLE_SIZE + margin;
        const onTop = Math.abs(my - y) < HANDLE_SIZE + margin;
        const onBottom = Math.abs(my - (y + h)) < HANDLE_SIZE + margin;
        const inside = mx > x + margin && mx < x + w - margin && my > y + margin && my < y + h - margin;

        if (inside) return 'move';
        if (onLeft && onTop) return 'nw';
        if (onRight && onTop) return 'ne';
        if (onLeft && onBottom) return 'sw';
        if (onRight && onBottom) return 'se';
        if (onTop) return 'n';
        if (onBottom) return 's';
        if (onLeft) return 'w';
        if (onRight) return 'e';
        return '';
      }

      function getCursor(dt) {
        const map = { move: 'move', nw: 'nw-resize', ne: 'ne-resize', sw: 'sw-resize', se: 'se-resize', n: 'n-resize', s: 's-resize', w: 'w-resize', e: 'e-resize' };
        return map[dt] || 'crosshair';
      }

      function draw() {
        // 背景 + 半透明遮罩
        ctx.clearRect(0, 0, displayW, displayH);
        ctx.drawImage(img, 0, 0, displayW, displayH);

        // 遮罩
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, displayW, displayH);

        // 裁剪区域（清除遮罩后从原图高分辨率重绘）
        ctx.clearRect(sel.x, sel.y, sel.w, sel.h);
        ctx.drawImage(img, sel.x * scaleX, sel.y * scaleY, sel.w * scaleX, sel.h * scaleY, sel.x, sel.y, sel.w, sel.h);

        // 边框
        ctx.strokeStyle = '#c9a84c';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
        ctx.setLineDash([]);

        // 四角手柄
        ctx.fillStyle = '#c9a84c';
        const handles = [
          [sel.x, sel.y], [sel.x + sel.w, sel.y],
          [sel.x, sel.y + sel.h], [sel.x + sel.w, sel.y + sel.h],
        ];
        handles.forEach(([hx, hy]) => {
          ctx.fillRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        });

        // 尺寸标签
        const realW = Math.round(sel.w * scaleX);
        const realH = Math.round(sel.h * scaleY);
        ctx.fillStyle = '#fff';
        ctx.font = '11px "Microsoft YaHei", sans-serif';
        const label = `${realW} x ${realH}`;
        const tw = ctx.measureText(label).width;
        const lx = sel.x + sel.w / 2 - tw / 2;
        const ly = sel.y - 8 > 16 ? sel.y - 8 : sel.y + sel.h + 18;
        ctx.fillText(label, lx, ly);
      }

      function clamp() {
        if (sel.x < 0) sel.x = 0;
        if (sel.y < 0) sel.y = 0;
        if (sel.x + sel.w > displayW) sel.x = displayW - sel.w;
        if (sel.y + sel.h > displayH) sel.y = displayH - sel.h;
        if (sel.w < 20) sel.w = 20;
        if (sel.h < 20) sel.h = 20;
      }

      canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        // 计算 CSS 显示尺寸与 canvas 内部分辨率的缩放比例
        const cssScaleX = displayW / rect.width;
        const cssScaleY = displayH / rect.height;
        const mx = (e.clientX - rect.left) * cssScaleX;
        const my = (e.clientY - rect.top) * cssScaleY;

        dragType = getDragType(mx, my);
        if (dragType) {
          dragging = true;
          startX = mx;
          startY = my;
          startSel = { ...sel };
          e.preventDefault();
        } else {
          // 点击外部：重新开始选择
          sel = { x: mx - 50, y: my - 50, w: 100, h: 100 };
          constrainRatio(sel, currentRatio);
          clamp();
          draw();
        }
      });

      canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const cssScaleX = displayW / rect.width;
        const cssScaleY = displayH / rect.height;
        const mx = (e.clientX - rect.left) * cssScaleX;
        const my = (e.clientY - rect.top) * cssScaleY;

        if (dragging) {
          const dx = mx - startX;
          const dy = my - startY;

          switch (dragType) {
            case 'move':
              sel.x = startSel.x + dx;
              sel.y = startSel.y + dy;
              break;
            case 'nw': sel.x = startSel.x + dx; sel.y = startSel.y + dy; sel.w = startSel.w - dx; sel.h = startSel.h - dy; break;
            case 'ne': sel.y = startSel.y + dy; sel.w = startSel.w + dx; sel.h = startSel.h - dy; break;
            case 'sw': sel.x = startSel.x + dx; sel.w = startSel.w - dx; sel.h = startSel.h + dy; break;
            case 'se': sel.w = startSel.w + dx; sel.h = startSel.h + dy; break;
            case 'n': sel.y = startSel.y + dy; sel.h = startSel.h - dy; break;
            case 's': sel.h = startSel.h + dy; break;
            case 'w': sel.x = startSel.x + dx; sel.w = startSel.w - dx; break;
            case 'e': sel.w = startSel.w + dx; break;
          }

          // 处理负值翻转
          if (sel.w < 0) { sel.x += sel.w; sel.w = -sel.w; }
          if (sel.h < 0) { sel.y += sel.h; sel.h = -sel.h; }

          constrainRatio(sel, currentRatio);
          clamp();
          draw();
        } else {
          const dt = getDragType(mx, my);
          canvas.style.cursor = getCursor(dt);
        }
      });

      canvas.addEventListener('mouseup', () => {
        if (dragging) {
          dragging = false;
          clamp();
          draw();
        }
      });

      canvas.addEventListener('mouseleave', () => {
        if (dragging) {
          dragging = false;
          clamp();
          draw();
        }
      });

      // 比例按钮
      document.querySelectorAll(`.cropper-ratio`).forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll(`.cropper-ratio`).forEach(b => b.classList.remove('btn-gold'));
          btn.classList.add('btn-gold');
          currentRatio = eval(btn.dataset.ratio) || 0;
          constrainRatio(sel, currentRatio);
          clamp();
          draw();
        });
      });

      // 默认高亮
      const defaultBtn = document.querySelector(`.cropper-ratio[data-ratio="${initialRatio}"]`);
      if (defaultBtn) defaultBtn.classList.add('btn-gold');

      // 重置
      document.getElementById(`${cropperId}-reset`)?.addEventListener('click', () => {
        sel = { x: displayW * 0.2, y: displayH * 0.2, w: displayW * 0.6, h: displayH * 0.6 };
        constrainRatio(sel, currentRatio);
        clamp();
        draw();
      });

      // 确认裁剪
      document.getElementById(`${cropperId}-confirm`)?.addEventListener('click', () => {
        const cropCanvas = document.createElement('canvas');
        const cropW = Math.round(sel.w * scaleX);
        const cropH = Math.round(sel.h * scaleY);
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(
          img,
          sel.x * scaleX, sel.y * scaleY, cropW, cropH,
          0, 0, cropW, cropH
        );
        cropCanvas.toBlob((blob) => {
          if (blob && onConfirm) {
            // 给 blob 加上文件名，确保上传时后端能识别格式
            const croppedFile = new File([blob], 'cropped.png', { type: 'image/png' });
            onConfirm(croppedFile);
          }
        }, 'image/png');
      });

      draw();
    };
    img.src = imageSrc;
  },

  close() {
    document.getElementById('modal-container').innerHTML = '';
  },
};