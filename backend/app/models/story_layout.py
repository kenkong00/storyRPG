from datetime import datetime

from sqlalchemy import Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class StoryLayout(Base):
    """蓝图视图里节点卡片的位置（按 kind + ref_id 唯一）。

    只存"画布上摆在哪"，不碰剧情本身的数据 —— 蓝图的增删改仍然全部走
    /api/story 那套接口，所以列表视图和蓝图视图读写的永远是同一份数据。
    """

    __tablename__ = "story_layouts"
    __table_args__ = (
        UniqueConstraint("kind", "ref_id", name="uq_story_layout_kind_ref"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # arc = 故事 / chapter = 章节 / node = 剧情节点
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    ref_id: Mapped[int] = mapped_column(Integer, nullable=False)
    x: Mapped[float] = mapped_column(Float, default=0.0)
    y: Mapped[float] = mapped_column(Float, default=0.0)
    collapsed: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[str] = mapped_column(
        String(30), default=lambda: datetime.now().isoformat()
    )
