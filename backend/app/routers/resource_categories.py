"""通用资源分类管理路由

为各类资源（人物/装备/物品/词条/场景/技能/动效/声音/故事/标签）提供统一的
自定义分类 CRUD + 树形结构接口。前端通过 resource_type 区分不同资源的分类。

资源类型常量：
  character / equipment / item / affix / scene / skill / animation / sound / story_arc / chapter / node / tag
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from ..database import get_db
from ..models.resource_category import ResourceCategory

router = APIRouter(prefix="/api/resource-categories", tags=["resource-categories"])

# 允许的资源类型
ALLOWED_RESOURCE_TYPES = {
    "character", "equipment", "item", "affix", "scene",
    "skill", "animation", "sound", "story_arc", "chapter", "node", "tag",
    "game", "character_state",
}


class CategoryCreate(BaseModel):
    name: str
    parent_path: Optional[str] = ""


class CategoryUpdate(BaseModel):
    name: Optional[str] = None


class CategoryOut(BaseModel):
    id: int
    resource_type: str
    name: str
    path: str
    parent_path: str
    is_system: bool
    system_key: Optional[str] = None
    sort_order: int = 0

    class Config:
        from_attributes = True


def _validate_type(resource_type: str) -> None:
    if resource_type not in ALLOWED_RESOURCE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的资源类型: {resource_type}，允许: {', '.join(sorted(ALLOWED_RESOURCE_TYPES))}",
        )


def _build_tree(rows: List[ResourceCategory]) -> dict:
    """把扁平记录构建为树形结构。"""
    nodes_by_path = {}
    for r in rows:
        nodes_by_path[r.path] = {
            "id": r.id,
            "resource_type": r.resource_type,
            "name": r.name,
            "path": r.path,
            "parent_path": r.parent_path or "",
            "is_system": bool(r.is_system),
            "system_key": r.system_key,
            "sort_order": r.sort_order,
            "children": [],
        }
    roots = []
    for path, node in nodes_by_path.items():
        parent = node["parent_path"]
        if parent and parent in nodes_by_path:
            nodes_by_path[parent]["children"].append(node)
        else:
            roots.append(node)
    # 排序：系统分类在前，再按 sort_order、id
    def sort_key(n):
        return (0 if n["is_system"] else 1, n["sort_order"], n["id"])
    roots.sort(key=sort_key)
    for n in nodes_by_path.values():
        n["children"].sort(key=sort_key)
    return {"tree": roots, "flat": list(nodes_by_path.values())}


@router.get("/{resource_type}/tree")
def get_category_tree(resource_type: str, db: Session = Depends(get_db)):
    """获取指定资源类型的分类树（含子分类）"""
    _validate_type(resource_type)
    rows = (
        db.query(ResourceCategory)
        .filter(ResourceCategory.resource_type == resource_type)
        .order_by(ResourceCategory.is_system.desc(), ResourceCategory.sort_order, ResourceCategory.id)
        .all()
    )
    return _build_tree(rows)


@router.post("/{resource_type}", response_model=CategoryOut, status_code=201)
def create_category(resource_type: str, data: CategoryCreate, db: Session = Depends(get_db)):
    """新建自定义分类（支持子分类）

    请求体: { name: "分类名", parent_path: "父分类路径"（可为空） }
    """
    _validate_type(resource_type)
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="分类名称不能为空")
    if "/" in name:
        raise HTTPException(status_code=400, detail="分类名称不能包含 /")

    parent_path = (data.parent_path or "").strip()
    if parent_path:
        # 校验父分类存在
        parent = db.query(ResourceCategory).filter(
            ResourceCategory.resource_type == resource_type,
            ResourceCategory.path == parent_path,
        ).first()
        if not parent:
            raise HTTPException(status_code=404, detail=f"父分类不存在: {parent_path}")
        if parent.is_system:
            raise HTTPException(status_code=400, detail="不能在系统分类下创建子分类")

    new_path = f"{parent_path}/{name}" if parent_path else name
    # 唯一性校验
    exist = db.query(ResourceCategory).filter(
        ResourceCategory.resource_type == resource_type,
        ResourceCategory.path == new_path,
    ).first()
    if exist:
        raise HTTPException(status_code=400, detail=f"分类已存在: {new_path}")

    cat = ResourceCategory(
        resource_type=resource_type,
        name=name,
        path=new_path,
        parent_path=parent_path,
        is_system=0,
        sort_order=0,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.put("/{resource_type}/{cat_path:path}", response_model=CategoryOut)
def update_category(resource_type: str, cat_path: str, data: CategoryUpdate, db: Session = Depends(get_db)):
    """重命名自定义分类（不能改系统分类）

    注意：重命名会同步更新所有子分类的路径前缀。
    """
    _validate_type(resource_type)
    cat = db.query(ResourceCategory).filter(
        ResourceCategory.resource_type == resource_type,
        ResourceCategory.path == cat_path,
    ).first()
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    if cat.is_system:
        raise HTTPException(status_code=400, detail="系统分类不可修改")

    new_name = (data.name or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="新名称不能为空")
    if "/" in new_name:
        raise HTTPException(status_code=400, detail="分类名称不能包含 /")

    old_path = cat.path
    parent = cat.parent_path or ""
    new_path = f"{parent}/{new_name}" if parent else new_name

    # 唯一性校验（排除自己）
    dup = db.query(ResourceCategory).filter(
        ResourceCategory.resource_type == resource_type,
        ResourceCategory.path == new_path,
        ResourceCategory.id != cat.id,
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail=f"目标分类已存在: {new_path}")

    cat.name = new_name
    cat.path = new_path

    # 同步更新所有子分类的路径前缀
    children = db.query(ResourceCategory).filter(
        ResourceCategory.resource_type == resource_type,
        ResourceCategory.parent_path.like(f"{old_path}/%"),
    ).all()
    for c in children:
        c.path = new_path + c.path[len(old_path):]
        # 更新 parent_path
        if c.parent_path == old_path:
            c.parent_path = new_path
        elif c.parent_path and c.parent_path.startswith(old_path + "/"):
            c.parent_path = new_path + c.parent_path[len(old_path):]
    # 更新直接子分类的 parent_path
    direct_children = db.query(ResourceCategory).filter(
        ResourceCategory.resource_type == resource_type,
        ResourceCategory.parent_path == old_path,
    ).all()
    for c in direct_children:
        c.parent_path = new_path

    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/{resource_type}/{cat_path:path}")
def delete_category(resource_type: str, cat_path: str, db: Session = Depends(get_db)):
    """删除自定义分类（若有子分类则拒绝）"""
    _validate_type(resource_type)
    cat = db.query(ResourceCategory).filter(
        ResourceCategory.resource_type == resource_type,
        ResourceCategory.path == cat_path,
    ).first()
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    if cat.is_system:
        raise HTTPException(status_code=400, detail="系统分类不可删除")

    # 检查子分类
    children = db.query(ResourceCategory).filter(
        ResourceCategory.resource_type == resource_type,
        ResourceCategory.parent_path == cat_path,
    ).count()
    if children > 0:
        raise HTTPException(status_code=400, detail=f"该分类下有 {children} 个子分类，请先删除子分类")

    db.delete(cat)
    db.commit()
    return {"detail": f"分类 {cat_path} 已删除"}


@router.get("/{resource_type}/all")
def list_all_categories(resource_type: str, db: Session = Depends(get_db)):
    """获取指定资源类型的所有分类（扁平列表，方便下拉选择）"""
    _validate_type(resource_type)
    rows = (
        db.query(ResourceCategory)
        .filter(ResourceCategory.resource_type == resource_type)
        .order_by(ResourceCategory.is_system.desc(), ResourceCategory.sort_order, ResourceCategory.id)
        .all()
    )
    return [
        {
            "id": r.id,
            "resource_type": r.resource_type,
            "name": r.name,
            "path": r.path,
            "parent_path": r.parent_path,
            "is_system": bool(r.is_system),
            "system_key": r.system_key,
        }
        for r in rows
    ]
