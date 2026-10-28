from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models.realm import CharacterRealm
from ..schemas.realm import (
    CharacterRealmCreate, CharacterRealmUpdate, CharacterRealmResponse,
)

router = APIRouter(prefix="/api/realms", tags=["人物境界"])


def _generate_default_realms():
    """生成默认的 40 个境界等级数据（10大境界 × 4小境界）。
    算法：以练气期初期为基准，小境界间 ×1.5，大境界间 ×2.5。
    """
    REALMS = [
        ("练气期", 100, "寿命约百岁，身体比凡人强壮，可使用低阶灵气法术，但尚未脱离凡人范畴。练气三层以上可催动低阶灵器和符箓，但无法御剑飞行。无神识，仅靠肉体和眼睛感知世界。差距三层以上实力明显不同。"),
        ("筑基期", 500, "体内灵气结成金丹，晋升需渡雷劫，寿命可达五百年左右。可长时间御剑飞行，操控法器，威压可致凡人重伤。本命法宝多在此阶段选定。"),
        ("金丹期", 550, "丹田灵气凝结成固体金丹，真元由气态变液态，可炼制本命法宝，不借助法器飞行。寿命约500-600岁，实力远超筑基期修士。"),
        ("元婴期", 1200, "金丹孕育元婴，可脱离肉身行动，寿命约1000-1200岁。元婴可夺舍重生，对天地元气感应敏锐，战斗力和修炼速度大幅提升。"),
        ("化神期", 2500, "元婴成长为幼年状态，向元神过渡，可调动天地灵气作战，但消耗寿元。寿命约2000-2500岁。"),
        ("真仙期", 5000, "需领悟法则之力，未领悟法则者为散仙、地仙等低级仙人。寿命和法力大幅提升。"),
        ("金仙期", 10000, "需渡过天人五衰的最后两衰（魂衰和煞衰），可凝聚法则之丝，施展基础灵域力量，打开108个仙窍后可进阶太乙。"),
        ("太乙期", 50000, "肉身变为法力无限的玉体，可更好凝聚和施展法则之力，领悟一种法则可掌握一方天地，灵域可演化成小世界。"),
        ("大罗期", 500000, "进阶道祖需斩三次尸魂，禁断尘缘根念，法体神魂不灭，灵域化界可演化小世界，形成最纯粹的法则本源。"),
        ("道祖期", 1000000, "融合三千大道，成为法则至尊，在天地间无敌，除非遇到同样达到道祖实力的人。"),
    ]
    SUB_LEVELS = ["初期", "中期", "后期", "大圆满"]

    base_hp, base_mp, base_atk, base_def, base_spd, base_luck = 100, 50, 10, 5, 5, 5
    realm_mult = 1.0
    realms = []
    level = 1
    for r_idx, (r_name, lifespan, desc) in enumerate(REALMS):
        sub_mult = 1.0
        for s_idx, s_name in enumerate(SUB_LEVELS):
            total_mult = realm_mult * sub_mult
            realms.append(CharacterRealm(
                level=level,
                realm_name=r_name,
                sub_level=s_name,
                full_name=f"{r_name}{s_name}",
                realm_index=r_idx,
                sub_index=s_idx,
                max_hp=round(base_hp * total_mult),
                max_mp=round(base_mp * total_mult),
                attack=round(base_atk * total_mult),
                defense=round(base_def * total_mult),
                speed=round(base_spd * total_mult),
                luck=base_luck + r_idx,
                lifespan=lifespan,
                description=desc,
            ))
            level += 1
            sub_mult *= 1.5
        realm_mult *= 2.5
    return realms


@router.get("/", response_model=list[CharacterRealmResponse])
def list_realms(
    realm_name: Optional[str] = Query(None, description="按大境界筛选"),
    db: Session = Depends(get_db),
):
    """列出所有境界等级。若数据库为空则自动初始化默认数据。"""
    count = db.query(CharacterRealm).count()
    if count == 0:
        # 自动初始化
        defaults = _generate_default_realms()
        db.add_all(defaults)
        db.commit()
    query = db.query(CharacterRealm)
    if realm_name:
        query = query.filter(CharacterRealm.realm_name == realm_name)
    return query.order_by(CharacterRealm.level).all()


@router.get("/{level}", response_model=CharacterRealmResponse)
def get_realm(level: int, db: Session = Depends(get_db)):
    """获取指定等级的境界数据"""
    realm = db.query(CharacterRealm).filter(CharacterRealm.level == level).first()
    if not realm:
        raise HTTPException(status_code=404, detail=f"境界等级 {level} 不存在")
    return realm


@router.post("/", response_model=CharacterRealmResponse, status_code=201)
def create_realm(data: CharacterRealmCreate, db: Session = Depends(get_db)):
    existing = db.query(CharacterRealm).filter(CharacterRealm.level == data.level).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"等级 {data.level} 已存在")
    realm = CharacterRealm(**data.model_dump())
    db.add(realm)
    db.commit()
    db.refresh(realm)
    return realm


@router.put("/{level}", response_model=CharacterRealmResponse)
def update_realm(level: int, data: CharacterRealmUpdate, db: Session = Depends(get_db)):
    realm = db.query(CharacterRealm).filter(CharacterRealm.level == level).first()
    if not realm:
        raise HTTPException(status_code=404, detail=f"境界等级 {level} 不存在")
    for key, value in data.model_dump().items():
        if value is not None:
            setattr(realm, key, value)
    db.commit()
    db.refresh(realm)
    return realm


@router.delete("/{level}", status_code=204)
def delete_realm(level: int, db: Session = Depends(get_db)):
    realm = db.query(CharacterRealm).filter(CharacterRealm.level == level).first()
    if not realm:
        raise HTTPException(status_code=404, detail=f"境界等级 {level} 不存在")
    db.delete(realm)
    db.commit()


@router.post("/init", response_model=list[CharacterRealmResponse])
def init_default_realms(db: Session = Depends(get_db)):
    """初始化/重置默认境界数据（仅当表为空时初始化）"""
    count = db.query(CharacterRealm).count()
    if count > 0:
        return db.query(CharacterRealm).order_by(CharacterRealm.level).all()
    defaults = _generate_default_realms()
    db.add_all(defaults)
    db.commit()
    return defaults
