# -*- coding: utf-8 -*-
"""剧情批量导入的留档。

为什么单独一张表：
    导入是「一次性粘贴 → 拆成几十个节点」的动作。以前导完就只剩节点，
    原文丢了 —— 发现第三段台词写歪了，只能整章删掉重新导一遍，还会
    把已经在节点上手动改过的表情 / 站位一起冲掉。

现在每次导入留一条批次记录：
  · source_text / source_json —— 当时粘进来的原文，回来能原样改；
  · spec_json                 —— 解析出的剧本结构（人物 / 场景声明都在里面）；
  · node_ids                  —— 这次导入生成了哪几个节点，替换时按它删；
  · chapter_id                —— 导入到哪个章节。
节点侧的 `story_nodes.import_batch_id` 是反查用的钩子。
"""

from datetime import datetime

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class StoryImportBatch(Base):
    __tablename__ = "story_import_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    story_arc_id: Mapped[int | None] = mapped_column(Integer, index=True)
    chapter_id: Mapped[int | None] = mapped_column(Integer, index=True)

    title: Mapped[str | None] = mapped_column(String(200))
    # 输入原文：剧本格式存在 source_text，JSON 格式存在 source_json
    source_text: Mapped[str | None] = mapped_column(Text)
    source_json: Mapped[str | None] = mapped_column(Text)
    # 解析出的结构（人物 / 场景声明 / 节点 / 对话），留着给「重新编辑」预填
    spec_json: Mapped[str | None] = mapped_column(Text)
    # 产物：{"node_ids": [...], "created_characters": [...], "created_scenes": [...]}
    result_json: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
    updated_at: Mapped[str] = mapped_column(String(30), default=lambda: datetime.now().isoformat())
