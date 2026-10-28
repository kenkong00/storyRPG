import os
import uuid
import json
from datetime import datetime
from typing import Optional

import aiofiles
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

router = APIRouter(prefix="/api/upload", tags=["文件上传"])

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

# 内置系统分类（不可删除）
SYSTEM_CATEGORIES = {
    "characters/portrait":  {"label": "人物形象", "group": "人物类", "is_system": True},
    "characters/expression": {"label": "人物表情", "group": "人物类", "is_system": True},
    "characters/action":     {"label": "人物动作", "group": "人物类", "is_system": True},
    "items":                 {"label": "互动物品", "group": "物品类", "is_system": True},
    "scenes/cutscene":       {"label": "人物过场", "group": "场景类", "is_system": True},
    "icons/skill":           {"label": "技能图标", "group": "图标类", "is_system": True},
    "icons/ui":              {"label": "UI图标",   "group": "图标类", "is_system": True},
    "icons/item":            {"label": "物品图标", "group": "图标类", "is_system": True},
    "animation/expression":  {"label": "动效表情", "group": "动效类", "is_system": True},
    "animation/cutscene":    {"label": "动效过场", "group": "动效类", "is_system": True},
}

# 向后兼容：保留 CATEGORIES 名称
CATEGORIES = SYSTEM_CATEGORIES

# upload.py 位于 backend/app/routers/，向上三级到 backend/，再定位到 frontend/images/
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
IMAGES_DIR = os.path.join(_BACKEND_DIR, "..", "frontend", "images")
META_FILE = os.path.join(IMAGES_DIR, "_meta.json")
CATEGORIES_FILE = os.path.join(IMAGES_DIR, "_categories.json")


def _ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def _load_meta():
    """加载图片元数据"""
    if os.path.exists(META_FILE):
        with open(META_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_meta(meta):
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def _get_relative_path(category: str, filename: str) -> str:
    """获取相对于 images/ 的路径"""
    return f"{category}/{filename}" if category else filename


# ===== 自定义分类管理 =====

def _load_custom_categories():
    """加载自定义分类（含子分类）。
    数据结构: [{ id, name, path, parent_id, is_system, created_at }]
    其中 path 为完整路径，如 "myroot/sub1"
    """
    if os.path.exists(CATEGORIES_FILE):
        try:
            with open(CATEGORIES_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return []


def _save_custom_categories(cats):
    with open(CATEGORIES_FILE, "w", encoding="utf-8") as f:
        json.dump(cats, f, ensure_ascii=False, indent=2)


def _all_categories_map():
    """合并系统分类和自定义分类，返回 {path: info} 映射"""
    result = {}
    # 系统分类
    for path, info in SYSTEM_CATEGORIES.items():
        result[path] = {**info, "path": path}
    # 自定义分类
    for c in _load_custom_categories():
        result[c["path"]] = {
            "label": c["name"],
            "group": c.get("group", "自定义"),
            "is_system": False,
            "path": c["path"],
            "parent_id": c.get("parent_id"),
        }
    return result


def _build_category_tree():
    """构建分类树（支持子分类），返回 {tree: [...]}"""
    all_cats = _all_categories_map()
    # 按 path 构建树
    nodes_by_path = {}
    for path, info in all_cats.items():
        nodes_by_path[path] = {
            "path": path,
            "name": info["label"],
            "group": info.get("group", "自定义"),
            "is_system": info.get("is_system", False),
            "children": [],
        }
    # 按 path 的层级关系构建父子
    roots = []
    for path, node in nodes_by_path.items():
        # 父路径：去掉最后一段
        parts = path.rstrip("/").split("/")
        if len(parts) <= 1:
            roots.append(node)
        else:
            parent_path = "/".join(parts[:-1])
            parent = nodes_by_path.get(parent_path)
            if parent and parent_path != path:
                parent["children"].append(node)
            else:
                roots.append(node)
    # 按分组排序
    roots.sort(key=lambda x: (x.get("group", ""), x["name"]))
    return {"tree": roots, "flat": list(nodes_by_path.values())}


def _is_valid_category(category: str) -> bool:
    """判断分类路径是否有效（系统分类或自定义分类）"""
    if not category:
        return False
    if category in SYSTEM_CATEGORIES:
        return True
    return any(c["path"] == category for c in _load_custom_categories())


@router.get("/categories")
async def list_categories():
    """获取所有图片分类（扁平结构，向后兼容）"""
    return {"categories": {p: {"label": i["label"], "group": i.get("group", "自定义")}
                           for p, i in _all_categories_map().items()}}


@router.get("/categories-tree")
async def list_categories_tree():
    """获取分类树（含子分类）"""
    return _build_category_tree()


class CategoryCreate(BaseModel):
    name: str
    parent_path: str = ""  # 父分类路径，空字符串表示根分类


@router.post("/categories")
async def create_custom_category(data: CategoryCreate):
    """新建自定义分类（支持子分类）"""
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="分类名称不能为空")
    # 生成 path
    parent = data.parent_path.strip()
    # path 只允许字母数字/中文/下划线/横线
    import re
    safe_name = re.sub(r"[^\w\u4e00-\u9fa5\-]", "_", name)
    if not safe_name:
        safe_name = "cat_" + uuid.uuid4().hex[:6]
    path = f"{parent}/{safe_name}" if parent else safe_name
    # 检查重复
    cats = _load_custom_categories()
    if any(c["path"] == path for c in cats):
        raise HTTPException(status_code=400, detail=f"分类已存在: {path}")
    if path in SYSTEM_CATEGORIES:
        raise HTTPException(status_code=400, detail="与系统分类冲突")
    # 检查父分类是否存在
    if parent and not _is_valid_category(parent):
        raise HTTPException(status_code=400, detail=f"父分类不存在: {parent}")
    new_cat = {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "path": path,
        "parent_path": parent,
        "group": "自定义",
        "is_system": False,
        "created_at": datetime.now().isoformat(),
    }
    cats.append(new_cat)
    _save_custom_categories(cats)
    # 创建物理目录
    _ensure_dir(os.path.join(IMAGES_DIR, path))
    return new_cat


class CategoryUpdate(BaseModel):
    name: Optional[str] = None


@router.put("/categories/{cat_path:path}")
async def update_custom_category(cat_path: str, data: CategoryUpdate):
    """重命名自定义分类"""
    cats = _load_custom_categories()
    target = None
    for c in cats:
        if c["path"] == cat_path:
            target = c
            break
    if not target:
        raise HTTPException(status_code=404, detail="分类不存在或为系统分类")
    if data.name and data.name.strip():
        target["name"] = data.name.strip()
    _save_custom_categories(cats)
    return target


@router.delete("/categories/{cat_path:path}")
async def delete_custom_category(cat_path: str):
    """删除自定义分类（若分类下有图片，会拒绝删除）"""
    cats = _load_custom_categories()
    target = None
    for c in cats:
        if c["path"] == cat_path:
            target = c
            break
    if not target:
        raise HTTPException(status_code=404, detail="分类不存在或为系统分类不可删除")
    # 检查是否有子分类
    children = [c for c in cats if c.get("parent_path") == cat_path]
    if children:
        raise HTTPException(status_code=400, detail=f"该分类下有 {len(children)} 个子分类，请先删除子分类")
    # 检查是否有图片（排除回收站中的软删除图片）
    cat_dir = os.path.join(IMAGES_DIR, cat_path)
    if os.path.exists(cat_dir):
        meta = _load_meta()
        active_files = []
        for f in os.listdir(cat_dir):
            if os.path.splitext(f)[1].lower() not in ALLOWED_EXTENSIONS:
                continue
            info = meta.get(f, {})
            if not info.get("is_deleted"):
                active_files.append(f)
        if active_files:
            raise HTTPException(status_code=400, detail=f"该分类下有 {len(active_files)} 张图片，请先移动或删除图片")
    # 删除
    cats = [c for c in cats if c["path"] != cat_path]
    _save_custom_categories(cats)
    # 删除空目录（含软删除的物理文件时一并清理回收站残留）
    if os.path.exists(cat_dir):
        try:
            # 先尝试删除目录中残留的软删除图片物理文件
            meta = _load_meta()
            changed = False
            for f in list(os.listdir(cat_dir)):
                full = os.path.join(cat_dir, f)
                if os.path.isfile(full) and os.path.splitext(f)[1].lower() in ALLOWED_EXTENSIONS:
                    info = meta.get(f, {})
                    if info.get("is_deleted"):
                        try:
                            os.remove(full)
                            if f in meta:
                                del meta[f]
                                changed = True
                        except OSError:
                            pass
            if changed:
                _save_meta(meta)
            os.rmdir(cat_dir)
        except OSError:
            pass
    return {"detail": f"分类 {cat_path} 已删除"}


@router.post("/image")
async def upload_image(
    file: UploadFile = File(...),
    category: str = Form(default="", description="图片分类路径，如 characters/portrait 或自定义分类"),
):
    """上传图片，按分类保存到对应子目录（支持自定义分类）"""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式：{ext}。仅支持 {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"文件大小超过限制（最大 10MB），当前大小：{len(contents) / 1024 / 1024:.1f}MB",
        )

    # 确定目标目录：支持自定义分类
    if category and _is_valid_category(category):
        target_dir = os.path.join(IMAGES_DIR, category)
    else:
        # 允许任意子目录路径（向后兼容）
        if category and ".." not in category and not category.startswith("/"):
            target_dir = os.path.join(IMAGES_DIR, category)
        else:
            target_dir = IMAGES_DIR
            category = ""

    _ensure_dir(target_dir)

    unique_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(target_dir, unique_name)

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(contents)

    # 保存元数据
    relative_path = _get_relative_path(category, unique_name)
    meta = _load_meta()
    meta[unique_name] = {
        "original_name": file.filename,
        "category": category,
        "relative_path": relative_path,
        "size": len(contents),
        "uploaded_at": datetime.now().isoformat(),
    }
    _save_meta(meta)

    # 同步进统一素材库（选择器靠 assets 一处就能看到所有图，不用再分「上传/生成」两套）
    url = f"/images/{relative_path}"
    try:
        from ..services import asset_store
        from ..database import SessionLocal
        _db = SessionLocal()
        try:
            asset_store.ingest(_db, url=url, origin="upload", source="upload",
                               category=category,
                               name=os.path.splitext(file.filename or unique_name)[0],
                               status="final")
            _db.commit()
        finally:
            _db.close()
    except Exception as _e:  # noqa: BLE001
        print(f"[WARN] 素材入库失败：{_e}")

    return {
        "filename": unique_name,
        "url": url,
        "category": category,
        "size": len(contents),
    }


@router.get("/images")
async def list_images(
    category: Optional[str] = Query(None, description="按分类筛选，传 __uncategorized__ 表示未分类；支持子分类筛选"),
    tag_ids: Optional[str] = Query(None, description="按标签筛选，逗号分隔的标签ID"),
    tag_match: str = Query(default="any", description="any=任一匹配, all=全部匹配"),
):
    """列出所有已上传的图片，支持按分类和标签筛选。
    - category=__uncategorized__ 时筛选未分类图片（category 为空的图片）
    - 传入具体分类路径时，会同时筛选该分类及其所有子分类下的图片
    - 自动排除已移入回收站的图片（meta 中 is_deleted=1）
    """
    meta = _load_meta()
    all_cats_map = _all_categories_map()
    files = []
    filter_uncategorized = category == "__uncategorized__"

    # 计算当前分类及其所有子分类路径集合
    target_paths = set()
    if category and not filter_uncategorized:
        target_paths.add(category)
        # 找出所有以 category/ 开头的子分类路径
        for p in all_cats_map.keys():
            if p.startswith(category + "/"):
                target_paths.add(p)

    # 标签筛选：先算出符合标签条件的文件名集合
    tag_filter_filenames = None
    if tag_ids:
        from ..models.tag import Tag, ImageTag
        from ..database import SessionLocal
        ids = [int(x) for x in tag_ids.split(",") if x.strip()]
        if ids:
            db = SessionLocal()
            try:
                query = db.query(ImageTag).filter(ImageTag.tag_id.in_(ids))
                if tag_match == "all":
                    from collections import Counter
                    rows = query.all()
                    counter = Counter(r.image_filename for r in rows)
                    tag_filter_filenames = {fn for fn, cnt in counter.items() if cnt == len(ids)}
                else:
                    tag_filter_filenames = {r.image_filename for r in query.all()}
            finally:
                db.close()

    def _scan_dir(base_dir: str, prefix: str = ""):
        for name in os.listdir(base_dir):
            full_path = os.path.join(base_dir, name)
            if os.path.isfile(full_path):
                ext = os.path.splitext(name)[1].lower()
                if ext in ALLOWED_EXTENSIONS:
                    info = meta.get(name, {})
                    # 回收站中的图片不在正常列表中显示
                    if info.get("is_deleted"):
                        continue
                    rel_path = f"{prefix}/{name}" if prefix else name
                    cat = info.get("category", prefix)
                    # 未分类筛选：只保留 category 为空的
                    if filter_uncategorized:
                        if cat:
                            continue
                    elif category and cat not in target_paths:
                        continue
                    # 标签筛选
                    if tag_filter_filenames is not None and name not in tag_filter_filenames:
                        continue
                    cat_info = all_cats_map.get(cat, {})
                    files.append({
                        "filename": name,
                        "url": f"/images/{rel_path}",
                        "category": cat,
                        "category_label": cat_info.get("label", "未分类"),
                        "category_group": cat_info.get("group", "未分类"),
                        "size": os.path.getsize(full_path),
                        "original_name": info.get("original_name", name),
                        "uploaded_at": info.get("uploaded_at", ""),
                    })
            elif os.path.isdir(full_path) and name != "__pycache__" and not name.startswith("_"):
                _scan_dir(full_path, f"{prefix}/{name}" if prefix else name)

    _ensure_dir(IMAGES_DIR)
    _scan_dir(IMAGES_DIR)

    # 按上传时间倒序
    files.sort(key=lambda x: x.get("uploaded_at", ""), reverse=True)
    return {"images": files, "count": len(files)}


# ===== 回收站 =====

def _find_image_file(filename: str, all_cats=None) -> Optional[str]:
    """在所有分类目录及根目录中查找图片，返回绝对路径。找不到返回 None。"""
    if all_cats is None:
        all_cats = _all_categories_map()
    for cat in all_cats:
        candidate = os.path.join(IMAGES_DIR, cat, filename)
        if os.path.exists(candidate):
            return candidate
    root_candidate = os.path.join(IMAGES_DIR, filename)
    if os.path.exists(root_candidate):
        return root_candidate
    return None


@router.get("/recycle-bin")
async def list_recycle_bin():
    """列出回收站中的图片（按删除时间倒序）"""
    meta = _load_meta()
    all_cats = _all_categories_map()
    items = []
    for filename, info in meta.items():
        if not info.get("is_deleted"):
            continue
        # 查找物理文件（可能已被外部移除，需容错）
        file_path = _find_image_file(filename, all_cats)
        cat = info.get("category", "")
        cat_info = all_cats.get(cat, {})
        size = info.get("size", 0)
        if file_path and os.path.exists(file_path):
            try:
                size = os.path.getsize(file_path)
            except OSError:
                pass
        rel_path = f"{cat}/{filename}" if cat else filename
        items.append({
            "filename": filename,
            "url": f"/images/{rel_path}",
            "category": cat,
            "category_label": cat_info.get("label", "未分类") if cat else "未分类",
            "size": size,
            "original_name": info.get("original_name", filename),
            "uploaded_at": info.get("uploaded_at", ""),
            "deleted_at": info.get("deleted_at", ""),
            "file_exists": bool(file_path and os.path.exists(file_path)),
        })
    items.sort(key=lambda x: x.get("deleted_at", ""), reverse=True)
    return {"items": items, "count": len(items)}


@router.post("/recycle-bin/restore")
async def restore_images(filenames: list[str]):
    """从回收站恢复图片（清除软删除标记）"""
    meta = _load_meta()
    restored = []
    not_found = []
    for filename in filenames:
        fn = filename.strip()
        if not fn:
            continue
        if fn in meta and meta[fn].get("is_deleted"):
            meta[fn]["is_deleted"] = 0
            meta[fn].pop("deleted_at", None)
            restored.append(fn)
        else:
            not_found.append(fn)
    _save_meta(meta)
    return {"restored": restored, "not_found": not_found, "count": len(restored)}


@router.post("/recycle-bin/purge")
async def purge_images(filenames: list[str]):
    """彻底删除回收站中的图片（删除物理文件 + 元数据）"""
    meta = _load_meta()
    all_cats = _all_categories_map()
    purged = []
    not_found = []
    for filename in filenames:
        fn = filename.strip()
        if not fn:
            continue
        # 删除物理文件
        file_path = _find_image_file(fn, all_cats)
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError as e:
                not_found.append(f"{fn}: {e}")
                continue
        # 删除元数据
        if fn in meta:
            del meta[fn]
        purged.append(fn)
    _save_meta(meta)
    return {"purged": purged, "not_found": not_found, "count": len(purged)}


@router.delete("/recycle-bin/empty")
async def empty_recycle_bin():
    """清空回收站（彻底删除所有软删除的图片）"""
    meta = _load_meta()
    all_cats = _all_categories_map()
    to_purge = [fn for fn, info in meta.items() if info.get("is_deleted")]
    purged = []
    for fn in to_purge:
        file_path = _find_image_file(fn, all_cats)
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        if fn in meta:
            del meta[fn]
        purged.append(fn)
    _save_meta(meta)
    return {"purged": purged, "count": len(purged)}


@router.delete("/image/{filename}")
async def delete_image(
    filename: str,
    category: str = Query(default="", description="图片所属分类"),
    force: bool = Query(default=False, description="true=彻底删除（不进回收站），false=软删除进回收站"),
):
    """删除指定图片。
    - 默认软删除（移入回收站，可恢复）
    - force=true 时彻底删除物理文件和元数据
    """
    all_cats = _all_categories_map()
    file_path = _find_image_file(filename, all_cats)
    if not file_path:
        # 兼容旧逻辑：明确传入 category 时也尝试该路径
        if category and category in all_cats:
            candidate = os.path.join(IMAGES_DIR, category, filename)
            if os.path.exists(candidate):
                file_path = candidate
        if not file_path:
            raise HTTPException(status_code=404, detail=f"图片不存在：{filename}")

    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式：{ext}")

    meta = _load_meta()
    now = datetime.now().isoformat()

    if force:
        # 彻底删除：物理删除文件 + 删除元数据
        try:
            os.remove(file_path)
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"删除文件失败: {e}")
        if filename in meta:
            del meta[filename]
            _save_meta(meta)
        return {"detail": f"图片 {filename} 已彻底删除", "force": True}
    else:
        # 软删除：仅更新元数据，物理文件保留，URL 不变，调用的地方不受影响
        if filename in meta:
            meta[filename]["is_deleted"] = 1
            meta[filename]["deleted_at"] = now
        else:
            # 元数据缺失时补一份（按物理文件信息）
            try:
                size = os.path.getsize(file_path)
            except OSError:
                size = 0
            meta[filename] = {
                "original_name": filename,
                "category": category,
                "size": size,
                "uploaded_at": now,
                "is_deleted": 1,
                "deleted_at": now,
            }
        _save_meta(meta)
        return {"detail": f"图片 {filename} 已移入回收站", "force": False}


@router.delete("/batch")
async def batch_delete_images(
    filenames: str = Query(..., description="逗号分隔的文件名列表"),
    category: str = Query(default="", description="图片所属分类"),
    force: bool = Query(default=False, description="true=彻底删除，false=软删除进回收站"),
):
    """批量删除图片（默认软删除进回收站）"""
    all_cats = _all_categories_map()
    meta = _load_meta()
    now = datetime.now().isoformat()
    deleted = []
    errors = []
    for filename in filenames.split(","):
        filename = filename.strip()
        if not filename:
            continue
        file_path = _find_image_file(filename, all_cats)
        if not file_path:
            errors.append(f"{filename}: 不存在")
            continue
        try:
            if force:
                # 彻底删除
                os.remove(file_path)
                if filename in meta:
                    del meta[filename]
            else:
                # 软删除
                if filename in meta:
                    meta[filename]["is_deleted"] = 1
                    meta[filename]["deleted_at"] = now
                else:
                    try:
                        size = os.path.getsize(file_path)
                    except OSError:
                        size = 0
                    meta[filename] = {
                        "original_name": filename,
                        "category": category,
                        "size": size,
                        "uploaded_at": now,
                        "is_deleted": 1,
                        "deleted_at": now,
                    }
            deleted.append(filename)
        except Exception as e:
            errors.append(f"{filename}: {str(e)}")
    _save_meta(meta)
    return {"deleted": deleted, "errors": errors, "count": len(deleted), "force": force}


@router.put("/image/{filename}/move")
async def move_image(
    filename: str,
    from_category: str = Query(default="", description="当前分类"),
    to_category: str = Query(..., description="目标分类"),
):
    """移动图片到另一个分类（仅更新元数据，不移动物理文件，URL保持不变）"""
    all_cats = _all_categories_map()
    if to_category not in all_cats:
        raise HTTPException(status_code=400, detail=f"无效的目标分类：{to_category}")

    # 确认图片存在（在任意目录中查找）
    found_path = None
    if from_category and from_category in all_cats:
        candidate = os.path.join(IMAGES_DIR, from_category, filename)
        if os.path.exists(candidate):
            found_path = candidate
    if not found_path:
        for cat in all_cats:
            candidate = os.path.join(IMAGES_DIR, cat, filename)
            if os.path.exists(candidate):
                found_path = candidate
                from_category = cat
                break
    if not found_path and os.path.exists(os.path.join(IMAGES_DIR, filename)):
        found_path = os.path.join(IMAGES_DIR, filename)
    if not found_path:
        raise HTTPException(status_code=404, detail=f"图片不存在：{filename}")

    # 仅更新元数据，不移动物理文件
    meta = _load_meta()
    if filename in meta:
        meta[filename]["category"] = to_category
    else:
        meta[filename] = {
            "original_name": filename,
            "category": to_category,
            "size": os.path.getsize(found_path),
            "uploaded_at": datetime.now().isoformat(),
        }
    _save_meta(meta)

    return {
        "filename": filename,
        "from": from_category,
        "to": to_category,
    }


@router.post("/crop")
async def save_cropped_image(
    file: UploadFile = File(...),
    category: str = Form(default=""),
):
    """保存裁剪后的图片（前端裁剪后上传）"""
    return await upload_image(file, category)