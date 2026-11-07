from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from .config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI 依赖注入：获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _run_migrations():
    """对已存在的表追加新列（create_all 不会修改已存在的表）"""
    insp = inspect(engine)
    with engine.connect() as conn:
        # skills 表添加 image 列
        if "skills" in insp.get_table_names():
            columns = {c["name"] for c in insp.get_columns("skills")}
            if "image" not in columns:
                conn.execute(text("ALTER TABLE skills ADD COLUMN image VARCHAR(500)"))
                conn.commit()

        # story_nodes 表添加 multi_characters 列
        if "story_nodes" in insp.get_table_names():
            columns = {c["name"] for c in insp.get_columns("story_nodes")}
            if "multi_characters" not in columns:
                conn.execute(text("ALTER TABLE story_nodes ADD COLUMN multi_characters TEXT"))
                conn.commit()

        # story_nodes 表添加 bg_animation_effect_id 列
        if "story_nodes" in insp.get_table_names():
            columns = {c["name"] for c in insp.get_columns("story_nodes")}
            if "bg_animation_effect_id" not in columns:
                conn.execute(text("ALTER TABLE story_nodes ADD COLUMN bg_animation_effect_id INTEGER"))
                conn.commit()

        # scene_images：记录这次出图用的是哪一套场景外观配置
        if "scene_images" in insp.get_table_names():
            columns = {c["name"] for c in insp.get_columns("scene_images")}
            if "appearance_id" not in columns:
                conn.execute(text("ALTER TABLE scene_images ADD COLUMN appearance_id INTEGER"))
                conn.commit()
            if "appearance_name" not in columns:
                conn.execute(text("ALTER TABLE scene_images ADD COLUMN appearance_name VARCHAR(60)"))
                conn.commit()

        # animation_effects 表添加 tags 列
        if "animation_effects" in insp.get_table_names():
            columns = {c["name"] for c in insp.get_columns("animation_effects")}
            if "tags" not in columns:
                conn.execute(text("ALTER TABLE animation_effects ADD COLUMN tags TEXT"))
                conn.commit()

        # story_nodes 表添加 tags 列
        if "story_nodes" in insp.get_table_names():
            columns = {c["name"] for c in insp.get_columns("story_nodes")}
            if "tags" not in columns:
                conn.execute(text("ALTER TABLE story_nodes ADD COLUMN tags TEXT"))
                conn.commit()

        # story_chapters 表添加 cover_animation_effect_id 列
        if "story_chapters" in insp.get_table_names():
            columns = {c["name"] for c in insp.get_columns("story_chapters")}
            if "cover_animation_effect_id" not in columns:
                conn.execute(text("ALTER TABLE story_chapters ADD COLUMN cover_animation_effect_id INTEGER"))
                conn.commit()

        # ===== story_node_dialogues 表追加 disappear_after 列（角色说完该句后从舞台消失） =====
        if "story_node_dialogues" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("story_node_dialogues")}
            if "disappear_after" not in cols:
                conn.execute(text("ALTER TABLE story_node_dialogues ADD COLUMN disappear_after INTEGER DEFAULT 0"))
                conn.commit()
                print("[OK] story_node_dialogues 表已添加 disappear_after 列")
            # 动作追加词（`台词 | 动作 xxx` 或预览里手填）
            if "pose_extra" not in cols:
                conn.execute(text("ALTER TABLE story_node_dialogues ADD COLUMN pose_extra TEXT"))
                conn.commit()
                print("[OK] story_node_dialogues 表已添加 pose_extra 列")

        # comic_cells 表添加 effects 列（漫画特效叠加层：符号/速度线/方向线）
        if "comic_cells" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("comic_cells")}
            if "effects" not in cols:
                conn.execute(text("ALTER TABLE comic_cells ADD COLUMN effects TEXT"))
                conn.commit()
                print("[OK] comic_cells 表已添加 effects 列")

        # comic_cells 表添加格子底色列（bg_enabled=0 表示不要背景）
        if "comic_cells" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("comic_cells")}
            if "bg_enabled" not in cols:
                conn.execute(text("ALTER TABLE comic_cells ADD COLUMN bg_enabled INTEGER DEFAULT 1"))
                conn.commit()
                print("[OK] comic_cells 表已添加 bg_enabled 列")
            if "bg_color" not in cols:
                conn.execute(text("ALTER TABLE comic_cells ADD COLUMN bg_color VARCHAR(20) DEFAULT '#ffffff'"))
                conn.commit()
                print("[OK] comic_cells 表已添加 bg_color 列")

        # comic_cell_versions 表添加版本名字列（可给版本重新起名）
        if "comic_cell_versions" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("comic_cell_versions")}
            if "name" not in cols:
                conn.execute(text("ALTER TABLE comic_cell_versions ADD COLUMN name VARCHAR(120) DEFAULT ''"))
                conn.commit()
                print("[OK] comic_cell_versions 表已添加 name 列")
            if "characters" not in cols:
                conn.execute(text("ALTER TABLE comic_cell_versions ADD COLUMN characters TEXT"))
                conn.commit()
                print("[OK] comic_cell_versions 表已添加 characters 列")
            # 版本配方：前置 / 后置自定义内容 + 高级整段覆盖。
            # 老版本这三列为 NULL（走 prompt_positive 历史成品），新版本为 ''（走配方拼装），据此区分。
            for col in ("prompt_prefix", "prompt_suffix", "prompt_override"):
                if col not in cols:
                    conn.execute(text(f"ALTER TABLE comic_cell_versions ADD COLUMN {col} TEXT"))
                    conn.commit()
                    print(f"[OK] comic_cell_versions 表已添加 {col} 列")

        # character_equipments 表：将唯一约束从 (character_id, slot) 迁移为 (character_id, slot, equipment_id)
        # SQLite 不支持直接删除约束，需要重建表
        if "character_equipments" in insp.get_table_names():
            # 检测是否存在旧唯一约束 uq_character_slot
            indexes = insp.get_indexes("character_equipments")
            uniques = insp.get_unique_constraints("character_equipments")
            has_old_constraint = any(u.get("name") == "uq_character_slot" for u in uniques)
            has_new_constraint = any(u.get("name") == "uq_character_slot_equipment" for u in uniques)
            if has_old_constraint and not has_new_constraint:
                # 重建表：备份 → 删除旧表 → 创建新表 → 恢复数据
                conn.execute(text("CREATE TABLE _character_equipments_backup AS SELECT * FROM character_equipments"))
                conn.execute(text("DROP TABLE character_equipments"))
                conn.execute(text("""
                    CREATE TABLE character_equipments (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        character_id INTEGER NOT NULL REFERENCES characters(id),
                        equipment_id INTEGER NOT NULL REFERENCES equipments(id),
                        slot VARCHAR(20) NOT NULL,
                        CONSTRAINT uq_character_slot_equipment UNIQUE (character_id, slot, equipment_id)
                    )
                """))
                conn.execute(text("INSERT INTO character_equipments (id, character_id, equipment_id, slot) SELECT id, character_id, equipment_id, slot FROM _character_equipments_backup"))
                conn.execute(text("DROP TABLE _character_equipments_backup"))
                conn.commit()
                print("[OK] character_equipments 表已迁移：唯一约束改为 (character_id, slot, equipment_id)")

        # ===== 为各资源表追加 category_path 列（自定义分类） =====
        # 除 realms（境界等级）外的所有栏目都支持自定义分类
        RESOURCE_TABLES_FOR_CATEGORY = [
            "characters", "equipments", "equipment_affixes", "items",
            "scenes", "skills", "animation_effects", "sounds",
            "story_arcs", "story_chapters", "story_nodes", "tags",
            "games", "character_states",
        ]
        for table_name in RESOURCE_TABLES_FOR_CATEGORY:
            if table_name in insp.get_table_names():
                cols = {c["name"] for c in insp.get_columns(table_name)}
                if "category_path" not in cols:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN category_path VARCHAR(300)"))
                    conn.commit()
                    print(f"[OK] {table_name} 表已添加 category_path 列")

        # ===== characters 表追加 is_activated 列（player 类型激活后才可被用户选择） =====
        if "characters" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("characters")}
            if "is_activated" not in cols:
                conn.execute(text("ALTER TABLE characters ADD COLUMN is_activated INTEGER DEFAULT 0"))
                conn.commit()
                print("[OK] characters 表已添加 is_activated 列")

        # ===== games 表追加 protagonist_character_id 列（单主角制：本作唯一可扮演角色） =====
        if "games" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("games")}
            if "protagonist_character_id" not in cols:
                conn.execute(text("ALTER TABLE games ADD COLUMN protagonist_character_id INTEGER"))
                conn.commit()
                print("[OK] games 表已添加 protagonist_character_id 列")

        # ===== character_equipments 表追加 slot_index 列（多槽位：配饰2/法器3） =====
        if "character_equipments" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("character_equipments")}
            if "slot_index" not in cols:
                conn.execute(text("ALTER TABLE character_equipments ADD COLUMN slot_index INTEGER DEFAULT 1"))
                conn.commit()
                print("[OK] character_equipments 表已添加 slot_index 列")

        # ===== users 表追加 session_token 列（登录令牌） =====
        if "users" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("users")}
            if "session_token" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN session_token VARCHAR(200)"))
                conn.commit()
                print("[OK] users 表已添加 session_token 列")

        # ===== 战斗系统 v2：skills 表扩充（数据驱动效果/怒气/绝招/多段/冷却） =====
        if "skills" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("skills")}
            skill_new_cols = [
                ("effects", "TEXT"),          # JSON 效果列表
                ("rage_cost", "INTEGER DEFAULT 0"),
                ("is_ultimate", "INTEGER DEFAULT 0"),
                ("hits", "INTEGER DEFAULT 1"),
                ("cooldown", "INTEGER DEFAULT 0"),
                ("auto_learn", "INTEGER DEFAULT 0"),
            ]
            for col, ddl in skill_new_cols:
                if col not in cols:
                    conn.execute(text(f"ALTER TABLE skills ADD COLUMN {col} {ddl}"))
                    conn.commit()
                    print(f"[OK] skills 表已添加 {col} 列")

        # ===== 战斗系统 v2：story_nodes 追加 battle_config 列 =====
        if "story_nodes" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("story_nodes")}
            if "battle_config" not in cols:
                conn.execute(text("ALTER TABLE story_nodes ADD COLUMN battle_config TEXT"))
                conn.commit()
                print("[OK] story_nodes 表已添加 battle_config 列")

        # ===== 战斗系统 v2：battles 表追加服务端权威状态与结算字段 =====
        if "battles" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("battles")}
            battle_new_cols = [
                ("user_character_id", "INTEGER"),
                ("state", "TEXT"),
                ("config", "TEXT"),
                ("round", "INTEGER DEFAULT 1"),
                ("exp_gained", "INTEGER DEFAULT 0"),
                ("coin_gained", "INTEGER DEFAULT 0"),
                ("drops", "TEXT"),
                ("rewards", "TEXT"),
            ]
            for col, ddl in battle_new_cols:
                if col not in cols:
                    conn.execute(text(f"ALTER TABLE battles ADD COLUMN {col} {ddl}"))
                    conn.commit()
                    print(f"[OK] battles 表已添加 {col} 列")

        # ===== 战斗系统 v2：battle_turns 表追加 uid/结果字段 =====
        if "battle_turns" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("battle_turns")}
            turn_new_cols = [
                ("actor_uid", "VARCHAR(20)"),
                ("target_uids", "TEXT"),
                ("skill_name", "VARCHAR(100)"),
                ("result", "TEXT"),
            ]
            for col, ddl in turn_new_cols:
                if col not in cols:
                    conn.execute(text(f"ALTER TABLE battle_turns ADD COLUMN {col} {ddl}"))
                    conn.commit()
                    print(f"[OK] battle_turns 表已添加 {col} 列")

        # ===== 角色语音：characters 表追加性别与语音主播配置列 =====
        if "characters" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("characters")}
            char_voice_cols = [
                ("gender", "VARCHAR(10) DEFAULT 'unknown'"),
                ("tts_engine", "VARCHAR(32) DEFAULT 'edge'"),
                ("tts_voice", "VARCHAR(64)"),
                ("tts_rate", "INTEGER DEFAULT 0"),
                ("tts_pitch", "INTEGER DEFAULT 0"),
                ("tts_volume", "INTEGER DEFAULT 0"),
            ]
            for col, ddl in char_voice_cols:
                if col not in cols:
                    conn.execute(text(f"ALTER TABLE characters ADD COLUMN {col} {ddl}"))
                    conn.commit()
                    print(f"[OK] characters 表已添加 {col} 列")

        # ===== 统一背包：character_inventory 追加 item_kind 列（item=物品 / equipment=装备） =====
        # 让「模板人物」的背包和「玩家运行时角色」一样，能装武器/装备/技能书，保证前后台一致
        if "character_inventory" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("character_inventory")}
            if "item_kind" not in cols:
                conn.execute(text("ALTER TABLE character_inventory ADD COLUMN item_kind VARCHAR(20) DEFAULT 'item'"))
                conn.commit()
                print("[OK] character_inventory 表已添加 item_kind 列")

        # ===== 战斗系统 v2：items 表追加 effects 列（战斗中可用的道具效果） =====
        if "items" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("items")}
            if "effects" not in cols:
                conn.execute(text("ALTER TABLE items ADD COLUMN effects TEXT"))
                conn.commit()
                print("[OK] items 表已添加 effects 列")

        # ===== 人物外观拼装：characters 表追加 appearance_json 列（多维外观定义） =====
        if "characters" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("characters")}
            if "appearance_json" not in cols:
                conn.execute(text("ALTER TABLE characters ADD COLUMN appearance_json TEXT"))
                conn.commit()
                print("[OK] characters 表已添加 appearance_json 列")

        # ===== 动作表情的自定义追加词（只作用于这个人的动作 / 表情出图） =====
        if "characters" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("characters")}
            if "pose_extra_prompt" not in cols:
                conn.execute(text("ALTER TABLE characters ADD COLUMN pose_extra_prompt TEXT"))
                conn.commit()
                print("[OK] characters 表已添加 pose_extra_prompt 列")

        # ===== 导入留档：节点记住自己来自哪一次批量导入（便于回来改 / 整批替换） =====
        if "story_nodes" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("story_nodes")}
            if "import_batch_id" not in cols:
                conn.execute(text("ALTER TABLE story_nodes ADD COLUMN import_batch_id INTEGER"))
                conn.commit()
                print("[OK] story_nodes 表已添加 import_batch_id 列")

        # ===== 动作表情图：追加实际像素尺寸（预览面板显示「高 × 宽」） =====
        if "character_pose_images" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("character_pose_images")}
            for col in ("width", "height"):
                if col not in cols:
                    conn.execute(text(f"ALTER TABLE character_pose_images ADD COLUMN {col} INTEGER"))
                    conn.commit()
                    print(f"[OK] character_pose_images 表已添加 {col} 列")

        # ===== 多套外观：动作表情图记录「用的是哪一套外观 / 全身还是半身」 =====
        if "character_pose_images" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("character_pose_images")}
            pose_new_cols = [
                ("appearance_id", "INTEGER"),
                ("appearance_name", "VARCHAR(60)"),
                ("framing", "VARCHAR(10) DEFAULT 'full'"),
            ]
            for col, ddl in pose_new_cols:
                if col not in cols:
                    conn.execute(text(f"ALTER TABLE character_pose_images ADD COLUMN {col} {ddl}"))
                    conn.commit()
                    print(f"[OK] character_pose_images 表已添加 {col} 列")

        # ===== 场景拼装 / 场景出图：scenes 表追加提示词与拼装配置 =====
        if "scenes" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("scenes")}
            scene_new_cols = [
                ("appearance_json", "TEXT"),
                ("prompt_text", "TEXT"),
                ("negative_prompt", "TEXT"),
            ]
            for col, ddl in scene_new_cols:
                if col not in cols:
                    conn.execute(text(f"ALTER TABLE scenes ADD COLUMN {col} {ddl}"))
                    conn.commit()
                    print(f"[OK] scenes 表已添加 {col} 列")

        # ===== 合成图配置：追加边界框布局（画框版提示词） =====
        if "compose_configs" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("compose_configs")}
            if "layout_json" not in cols:
                conn.execute(text("ALTER TABLE compose_configs ADD COLUMN layout_json TEXT"))
                conn.commit()
                print("[OK] compose_configs 表已添加 layout_json 列")

        # ===== 卡牌外观拼装：职业英雄 / 卡牌角色 各加一份完整外观（appearance_json） =====
        # 与「人物外观拼装」共用同一套维度定义，可自由增删改参数。
        if "card_classes" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("card_classes")}
            if "appearance_json" not in cols:
                conn.execute(text("ALTER TABLE card_classes ADD COLUMN appearance_json TEXT"))
                conn.commit()
                print("[OK] card_classes 表已添加 appearance_json 列")
        if "card_character_profiles" in insp.get_table_names():
            cols = {c["name"] for c in insp.get_columns("card_character_profiles")}
            if "appearance_json" not in cols:
                conn.execute(text("ALTER TABLE card_character_profiles ADD COLUMN appearance_json TEXT"))
                conn.commit()
                print("[OK] card_character_profiles 表已添加 appearance_json 列")


def _backfill_appearance_presets():
    """老数据升级：

    1) 每个人物已有的 appearance_json → 一条名为「默认外观」的配置；
    2) 动作表情图 → 回写 characters.expressions[pose_id]，
       这样对话 / 战斗按动作 id 取图时不会只认旧的 normal/happy 键。
    """
    from .models.character import Character
    from .models.character_appearance import CharacterAppearance
    from .models.character_pose import CharacterPoseImage

    db = SessionLocal()
    try:
        changed = False
        chars = db.query(Character).all()
        for ch in chars:
            if ch.appearance_json:
                exists = db.query(CharacterAppearance).filter(
                    CharacterAppearance.character_id == ch.id).count()
                if not exists:
                    db.add(CharacterAppearance(
                        character_id=ch.id, name="默认外观",
                        appearance_json=ch.appearance_json, is_default=1, sort=0))
                    changed = True
        if changed:
            db.commit()
            print("[OK] 已为老人物补齐「默认外观」配置")

        import json as _json
        synced = 0
        tagged = 0
        for ch in chars:
            rows = (db.query(CharacterPoseImage)
                    .filter(CharacterPoseImage.character_id == ch.id)
                    .order_by(CharacterPoseImage.id).all())
            if not rows:
                continue
            # 老动作图没记外观配置 → 归到默认配置，这样按配置筛图时不会消失
            default = (db.query(CharacterAppearance)
                       .filter(CharacterAppearance.character_id == ch.id)
                       .order_by(CharacterAppearance.is_default.desc(),
                                 CharacterAppearance.sort, CharacterAppearance.id).first())
            if default:
                for r in rows:
                    if not r.appearance_id:
                        r.appearance_id = default.id
                        r.appearance_name = r.appearance_name or default.name
                        tagged += 1
            try:
                faces = _json.loads(ch.expressions) if ch.expressions else {}
                if not isinstance(faces, dict):
                    faces = {}
            except Exception:
                faces = {}
            touched = False
            for r in rows:
                if r.pose_id and r.image_url and faces.get(r.pose_id) != r.image_url:
                    faces[r.pose_id] = r.image_url
                    touched = True
            if touched:
                ch.expressions = _json.dumps(faces, ensure_ascii=False)
                synced += 1
        if synced or tagged:
            db.commit()
            if synced:
                print(f"[OK] 已回写 {synced} 个人物的动作表情图索引")
            if tagged:
                print(f"[OK] 已把 {tagged} 张老动作图归到默认外观配置")

        # 历史 AI 图被标成「本地上传」的修正：这几个 source 只可能是 AI 出图
        try:
            from .models.asset import Asset
            n = (db.query(Asset)
                 .filter(Asset.source.in_(["pose_batch", "appearance_render",
                                           "scene_render", "compose"]),
                         Asset.origin != "ai")
                 .update({Asset.origin: "ai"}, synchronize_session=False))
            if n:
                db.commit()
                print(f"[OK] 已修正 {n} 张 AI 图的来源标记")
        except Exception:
            db.rollback()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print("[WARN] 外观配置回填失败：", exc)
    finally:
        db.close()


def _backfill_scene_appearances():
    """老场景只有一份 appearance_json → 补成一条「默认配置」。

    和人物那边一个道理：以前想出「白天的教室 / 下雨的教室」只能来回覆盖同一份配置，
    覆盖完就找不回来了。拆表后先把老数据搬过来，保证升级后画面不变。
    """
    from .models.scene import Scene
    from .models.scene_appearance import SceneAppearance

    db = SessionLocal()
    try:
        n = 0
        for sc in db.query(Scene).all():
            exists = db.query(SceneAppearance).filter(
                SceneAppearance.scene_id == sc.id).count()
            if exists:
                continue
            if not (sc.appearance_json or sc.prompt_text or sc.negative_prompt):
                continue
            db.add(SceneAppearance(
                scene_id=sc.id, name="默认配置",
                appearance_json=sc.appearance_json,
                prompt_text=sc.prompt_text,
                negative_prompt=sc.negative_prompt,
                is_default=1, sort=0))
            n += 1
        if n:
            db.commit()
            print(f"[OK] 已为 {n} 个老场景补齐「默认配置」外观配置")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print("[WARN] 场景外观配置回填失败：", exc)
    finally:
        db.close()


def _migrate_card_art_sets():
    """卡面套装：给老的 card_arts 补 set_code，并保证一定有一套「默认套装」。

    老数据里同一张卡可能已经被覆盖过好几轮（is_active 只有一版算数），
    这里把现存的所有版本一律归进 default 套，激活哪套就写回哪套的图，
    没写到的卡保留现状 —— 升级后画面一帧都不变。
    """
    insp = inspect(engine)
    if "card_arts" not in insp.get_table_names():
        return
    with engine.connect() as conn:
        cols = {c["name"] for c in insp.get_columns("card_arts")}
        if "set_code" not in cols:
            conn.execute(text(
                "ALTER TABLE card_arts ADD COLUMN set_code VARCHAR(48) DEFAULT 'default'"))
            conn.execute(text(
                "UPDATE card_arts SET set_code = 'default' "
                "WHERE set_code IS NULL OR set_code = ''"))
            conn.commit()

    from .models.cardgame import CardArtSet
    db = SessionLocal()
    try:
        if db.query(CardArtSet).count() == 0:
            db.add(CardArtSet(code="default", name="默认套装", note="升级时自动创建，装已有卡面",
                              is_active=1, sort=0, enabled=1))
            db.commit()
            print("[OK] 已创建「默认套装」，并把已有卡面归入其中")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        print("[WARN] 默认卡面套装创建失败：", exc)
    finally:
        db.close()


def _migrate_card_art_templates():
    """卡牌拼装迁移：出厂占位符模板（花括号那套）→ 清空，改走「外观维度」自由拼装。

    只清出厂默认的两份原文；用户手写过别的模板一律保留（compose 里仍按模板拼）。
    """
    legacy = [
        ("{style}\n【人物】{name}，{gender}{age}{head}\n【服装】{outfit}\n"
         "【动作】{action}\n【表情】{expression}\n\n"),
        ("{style}\n【人物】{name}，{gender}{age}{head}\n【服装】{outfit}\n"
         "【动作】{action}\n【表情】{expression}\n"
         "【构图】半身像，竖版 2:3，人物居中，头部位于画面上三分之一，"
         "深色渐变背景，边缘金色描边辉光，卡牌插画规格\n"
         "【画质】厚涂笔触，电影级侧逆光，材质与金属高光清晰，"
         "细节锐利，无文字，无水印，无边框"),
    ]
    insp = inspect(engine)
    if "card_settings" not in insp.get_table_names():
        return
    with engine.connect() as conn:
        for tpl in legacy:
            conn.execute(
                text("UPDATE card_settings SET value='' "
                     "WHERE key='art_template' AND value = :tpl"),
                {"tpl": tpl})
        conn.commit()
    print("[OK] 卡牌出厂占位符模板已迁移为「外观维度自由拼装」")


def _migrate_card_emotion_prompts():
    """角色情感表现：补「前缀拼接 / 后缀拼接 / 外观配置」三列。

    老数据没有这三列，存的是「只能填动作+神情」的旧结构；
    补成空串/0 后，提示词拼装与原来等价，不会改变任何已生成的图。
    """
    insp = inspect(engine)
    if "card_character_emotions" not in insp.get_table_names():
        return
    with engine.connect() as conn:
        cols = {c["name"] for c in insp.get_columns("card_character_emotions")}
        adds = []
        if "prefix_prompt" not in cols:
            adds.append("ALTER TABLE card_character_emotions ADD COLUMN prefix_prompt TEXT DEFAULT ''")
        if "suffix_prompt" not in cols:
            adds.append("ALTER TABLE card_character_emotions ADD COLUMN suffix_prompt TEXT DEFAULT ''")
        if "appearance_id" not in cols:
            adds.append("ALTER TABLE card_character_emotions ADD COLUMN appearance_id INTEGER DEFAULT 0")
        if "prompt_text" not in cols:
            # 情感与表现页的独立提示词（不走卡牌模板）。老数据补空串 = 继续用原来的拼装。
            adds.append("ALTER TABLE card_character_emotions ADD COLUMN prompt_text TEXT DEFAULT ''")
        if adds:
            for sql in adds:
                conn.execute(text(sql))
            conn.commit()


def _migrate_card_voice():
    """卡牌语音：情感台词语音列 + 卡牌角色音色绑定列。"""
    insp = inspect(engine)
    if "card_character_emotions" not in insp.get_table_names():
        return
    with engine.connect() as conn:
        cols = {c["name"] for c in insp.get_columns("card_character_emotions")}
        if "voice_url" not in cols:
            conn.execute(text(
                "ALTER TABLE card_character_emotions "
                "ADD COLUMN voice_url VARCHAR(500) DEFAULT ''"))
        conn.commit()
    if "card_character_profiles" not in insp.get_table_names():
        return
    with engine.connect() as conn:
        cols = {c["name"] for c in insp.get_columns("card_character_profiles")}
        for col, ddl in (
            ("tts_engine", "VARCHAR(30) DEFAULT ''"),
            ("tts_voice_id", "VARCHAR(100) DEFAULT ''"),
            ("tts_rate", "VARCHAR(10) DEFAULT ''"),
            ("tts_pitch", "VARCHAR(10) DEFAULT ''"),
            ("tts_volume", "VARCHAR(10) DEFAULT ''"),
        ):
            if col not in cols:
                conn.execute(text(
                    f"ALTER TABLE card_character_profiles ADD COLUMN {col} {ddl}"))
        conn.commit()


def init_db():
    """创建所有表"""
    from . import models  # noqa: F401  —— 让新模型（外观配置 / 场景图）注册进 metadata
    Base.metadata.create_all(bind=engine)
    _run_migrations()
    _backfill_appearance_presets()
    _backfill_scene_appearances()
    _migrate_card_art_sets()
    _migrate_card_art_templates()
    _migrate_card_emotion_prompts()
    _migrate_card_voice()