# -*- coding: utf-8 -*-
"""剧情内容批量导入：一段小说 / 剧本 / AI 生成的 JSON → 章节 + 节点 + 对话行。

为什么要这个东西：
    手动一条一条加对话是「几十次点击换一段剧情」。写故事本来该是一次粘贴，
    剩下的（说话者是谁、什么表情、站哪、背景是哪张图）能自动推的就别让人点。

支持两种输入，都在这一个入口里：

1) 剧本格式（人写、AI 写都行，最省事）
       # 节点标题
       @背景 飘渺森林          ← 按名字去场景库找封面，找不到留空待你选
       @音乐 雨声
       旁白：风从破窗灌进来，火堆将熄。
       李慕白（愤怒）：你这个叛徒！
       苏小小：我不是……我只是没有选择。
   规则：`#` 开新节点、`@` 是指令、`名字（表情）：台词` 是对话、
   不带冒号的行当旁白。冒号左边认不出、又以「说/道/问」结尾的，也当旁白。

2) JSON（给 AI 用的固定格式，见 /template）
       {"title":..., "characters":[...], "nodes":[{"title":..., "dialogues":[...]}]}

两个接口分工：
    POST /parse  —— 只解析不落库，返回预览（谁匹配上了、谁要新建、台词几条）
    POST /apply  —— 按预览（用户可在前端改过的）真正写库；
                    可选「缺的人物自动建」「顺手出一条立绘/表情」「顺手批量配音」
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import jobs
from ..database import SessionLocal, get_db
from ..models.character import Character
from ..models.scene import Scene
from ..models.sound import Sound
from ..models.narration_voice import NarrationVoice
from ..models.story import StoryChapter, StoryNode, StoryNodeDialogue
from ..models.story_import import StoryImportBatch
from ..appearance import generator
from ..routers import pose_library

router = APIRouter(prefix="/api/story/import", tags=["剧情内容导入"])

# ---------------------------------------------------------------------------
# 表情：中文口语 → 游戏里的动作 id
# ---------------------------------------------------------------------------
# 对话行里存的 expression 既可能是旧表情键（angry），也可能是动作 id（emo_angry）。
# 现在表情已经并进「动作表情」，所以优先写动作 id —— 这样打开对话行时表情选择器
# 能正确高亮，缩略图也直接取得到。
LEGACY_ALIAS = {
    "平静": "normal", "正常": "normal", "无表情": "normal", "淡定": "normal",
    "微笑": "happy", "高兴": "happy", "开心": "happy", "笑": "happy", "温柔": "happy",
    "愤怒": "angry", "生气": "angry", "怒": "angry", "恼火": "angry",
    "悲伤": "sad", "难过": "sad", "哀伤": "sad", "失落": "sad",
    "惊讶": "surprised", "吃惊": "surprised", "诧异": "surprised",
    "狂傲": "arrogant", "傲慢": "arrogant", "得意": "arrogant", "嚣张": "arrogant",
    "战败": "defeated", "疲惫": "defeated", "虚脱": "defeated",
    "妒忌": "jealous", "嫉妒": "jealous",
    "悔恨": "regretful", "懊悔": "regretful", "内疚": "regretful",
    "哭泣": "crying", "哭": "crying", "流泪": "crying",
    "求饶": "begging", "哀求": "begging",
    "自信": "confident", "冷峻": "confident", "冷静": "confident", "冷笑": "confident",
    "震惊": "shocked",
    "恐惧": "fear", "害怕": "fear", "惊恐": "fear",
    "绝望": "desperate", "痛苦": "desperate", "崩溃": "desperate",
    "坚定": "determined", "决然": "determined", "认真": "determined",
    "害羞": "shy", "脸红": "shy", "羞涩": "shy",
}
# 旧表情键 → 动作 id（动作库里有这个动作才用，没有就退回旧键）
POSE_OF_LEGACY = {
    "normal": "idle_stand", "happy": "emo_smile", "angry": "emo_angry",
    "sad": "emo_sad", "surprised": "emo_surprise", "crying": "emo_cry",
    "shocked": "emo_surprise", "fear": "emo_fear",
    "determined": "emo_determined", "arrogant": "emo_smug",
    "confident": "emo_cold", "desperate": "emo_pain", "defeated": "emo_tired",
}
# 自动出图时默认出这几个表情（够对话用，又不至于一上来就排几十张）
DEFAULT_CAST_POSES = ["idle_stand", "emo_smile", "emo_angry", "emo_sad", "emo_surprise"]
POS_X = [22.0, 50.0, 78.0, 35.0, 65.0, 50.0]
# 冒号左边出现这些词就不是人名（小说里常见的「他说：」和无信息的标签行）
_NOT_NAME = ("他说", "她说", "我说", "他问", "她问", "问道", "说道", "答道", "回答",
             "心想", "暗道", "低声", "冷笑", "笑道", "沉声", "系统", "提示",
             "时间", "地点", "注意", "备注", "说明", "画面", "镜头", "旁白", "出场")
_SPEECH_VERBS = ("说", "道", "问", "答", "喊", "叫", "想", "笑", "叹")


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def _pose_index() -> tuple[set[str], dict[str, str]]:
    """动作库的 (id 集合, 中文名→id 映射)。

    名字映射很关键：用户写「冷漠」「抱臂而立」这种，其实就是在说动作库里的名字，
    直接按 id 匹配是匹配不到的，会白白丢表情。
    """
    global _POSE_IDX
    if _POSE_IDX is None:
        try:
            opts = pose_library._pose_dim().get("options") or []
            _POSE_IDX = ({p["id"] for p in opts},
                         {str(p.get("name") or "").strip(): p["id"]
                          for p in opts if p.get("name")})
        except Exception:  # noqa: BLE001
            _POSE_IDX = (set(), {})
    return _POSE_IDX


_POSE_IDX: tuple[set[str], dict[str, str]] | None = None


def _pose_ids() -> set[str]:
    return _pose_index()[0]


def _expr(raw: str, poses: set[str] | None = None) -> str:
    """把「愤怒」「angry」「emo_angry」统一成一个能直接存进对话行的值。"""
    t = (raw or "").strip()
    if not t:
        return ""
    ids, by_name = _pose_index()
    poses = poses or ids
    low = t.lower()
    if low in poses:
        return low
    # 先按动作库里的中文名匹配（「冷漠」→ emo_cold）。用户括号里写的多半就是名字。
    if t in by_name:
        return by_name[t]
    # 「愤怒地」「冷冷道」这类带修饰的写法：按包含关系取最长的那个名字
    for nm in sorted(by_name, key=len, reverse=True):
        if nm and len(nm) > 1 and nm in t:
            return by_name[nm]

    # 「愤怒地」这类带修饰的写法：按包含关系取最长的那个别名
    legacy = LEGACY_ALIAS.get(t)
    if not legacy:
        for k in sorted(LEGACY_ALIAS, key=len, reverse=True):
            if k in t:
                legacy = LEGACY_ALIAS[k]
                break
    if not legacy:
        # 直接写了英文旧键
        legacy = low if low in POSE_OF_LEGACY else ""
    if not legacy:
        return ""
    pose = POSE_OF_LEGACY.get(legacy)
    if pose and pose in poses:
        return pose
    return legacy


def _legacy_pos(x: float) -> str:
    if x <= 18:
        return "left-1"
    if x <= 31:
        return "left-2"
    if x <= 44:
        return "left-3"
    if x <= 57:
        return "center"
    if x <= 69:
        return "right-3"
    if x <= 82:
        return "right-2"
    return "right-1"


# ---------------------------------------------------------------------------
# 剧本格式解析
# ---------------------------------------------------------------------------
_AT_RE = re.compile(r"^[@＠]\s*([^\s:：]+)\s*[：:]?\s*(.*)$")
_HEAD_RE = re.compile(r"^#{1,3}\s*(.+)$")
_NARRATION_TAG = re.compile(r"^[【\[]\s*(旁白|画外音|内心|独白|系统)\s*[】\]]\s*[：:]?\s*(.*)$")
_LINE_RE = re.compile(r"^([^：:]{1,14})[：:]\s*(.+)$")


def _clean(s: str) -> str:
    return (s or "").strip().strip("　")


def _split_pipe(val: str) -> list:
    """`名字 | 描述` → ['名字', '描述']。全角竖线也认。"""
    return [p.strip() for p in re.split(r"[|｜]", val or "")]


_ACTION_TAG = re.compile(r"^(动作|姿态|姿势|action|pose)\s*[：:]?\s*", re.I)
_PIPE_RE = re.compile(r"[|｜]")


def _gender_of(val: str) -> str:
    """单独一段是性别词才算性别，`男装女子` 这种描述不会误判。"""
    t = (val or "").strip().lower()
    if t in ("男", "男性", "男生", "male", "m"):
        return "male"
    if t in ("女", "女性", "女生", "female", "f"):
        return "female"
    return ""


def _split_action(text: str) -> tuple:
    """`你终于肯露面了 | 抬剑指着他` → ('你终于肯露面了', '抬剑指着他')。

    竖线右边**一律**当动作追加词，写不写「动作」两个字都行 —— 带了前缀就
    顺手剥掉。只按第一个竖线切，动作描述里再出现竖线也不会被截断。
    """
    s = (text or "").strip()
    m = _PIPE_RE.search(s)
    if not m:
        return s, ""
    body = s[:m.start()].strip()
    act = _ACTION_TAG.sub("", s[m.end():].strip()).strip()
    return body, act


def parse_script(text: str) -> dict:
    """剧本/小说文本 → {title, characters:[], scenes:[], nodes:[…]}（还没匹配 id）。

    除了人物，`@场景 名字 | 画面描述` 也会被收集：描述就是这一场景的
    「自定义场景追加词」，导入时写进 scenes.prompt_text 并标记「只用追加词」
    —— 出图不叠加随机拼装维度，画面只按你写的那句话来。
    """
    nodes: list = []
    chars: list = []
    scenes: list = []
    cur: dict | None = None
    title = ""

    def new_node(t: str = "") -> dict:
        n = {"title": t, "node_type": "dialogue", "background": "", "music": "",
             "scene_prompt": "", "dialogues": []}
        nodes.append(n)
        return n

    def add_dlg(content: str, speaker: str = "", expr: str = "",
                pose_extra: str = "") -> None:
        nonlocal cur
        if cur is None:
            cur = new_node()
        cur["dialogues"].append({"speaker": speaker, "expression": expr,
                                 "content": _clean(content),
                                 "pose_extra": _clean(pose_extra)})

    def add_char(name: str, gender: str = "", prompt: str = "") -> None:
        name = _clean(name)
        if not name:
            return
        for c in chars:
            if c["name"] == name:
                # 先出现台词、后补声明：把后补的描述合并进来，别丢
                if gender and not c.get("gender"):
                    c["gender"] = gender
                if prompt and not c.get("prompt"):
                    c["prompt"] = prompt
                    c["appearance"] = c.get("appearance") or prompt
                    c["random"] = False
                return
        chars.append({"name": name, "gender": gender, "role": "",
                      "appearance": prompt, "prompt": prompt,
                      "random": not bool(prompt)})

    def add_scene(name: str, prompt: str = "") -> None:
        name = _clean(name)
        if not name:
            return
        for sc in scenes:
            if sc["name"] == name:
                if prompt and not sc.get("prompt"):
                    sc["prompt"] = prompt
                    sc["random"] = False
                return
        scenes.append({"name": name, "prompt": _clean(prompt),
                       "random": not bool(_clean(prompt))})

    def set_background(val: str) -> None:
        """`@背景 破庙` 或 `@背景 破庙 | 残破古庙，屋顶漏雨`。"""
        nonlocal cur
        parts = _split_pipe(val)
        name = _clean(parts[0]) if parts else ""
        prompt = _clean(parts[1]) if len(parts) > 1 else ""
        if not name:
            return
        if prompt:
            add_scene(name, prompt)
        else:
            add_scene(name, "")
        if cur is None:
            cur = new_node()
        cur["background"] = name
        if prompt:
            cur["scene_prompt"] = prompt

    # AI 经常会自作主张套一层 ``` 代码块或先说一句「以下是改写结果」。
    # 这几行对解析毫无意义，先剥掉，省得用户还得手动删。
    cleaned = []
    for ln in (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        t = ln.strip()
        # 代码块围栏、纯分隔线
        if t.startswith("```") or re.fullmatch(r"[-*_=]{3,}", t):
            continue
        # 开头那句「以下是改写后的剧本：」—— 还没开节点时才当包装剥掉，
        # 免得不小心吃掉正文里的正常台词
        if not cleaned and re.match(
                r"^(以下是|下面是|这是|好的|这是按|已按要求).{0,24}(剧本|结果|改写|输出|版本)",
                t):
            continue
        cleaned.append(ln)

    for raw_ln in cleaned:
        ln = _clean(raw_ln)
        if not ln:
            continue
        if ln.startswith("//") or ln.startswith(";;"):
            continue

        m = _HEAD_RE.match(ln)
        if m:
            cur = new_node(_clean(m.group(1)))
            continue

        m = _AT_RE.match(ln)
        if m:
            key, val = _clean(m.group(1)), _clean(m.group(2))
            if key in ("人物", "角色", "出场人物"):
                # @人物 李慕白 | 青衫剑客，长发束起，眉目冷峻，腰悬长剑
                # 竖线后面**整段都是提示词**；中间若单独写了性别（旧写法
                # `@人物 李慕白 | 男 | 描述`）会自动摘出来，不算进描述。
                parts = _split_pipe(val)
                name = _clean(parts[0]) if parts else ""
                rest = [p for p in parts[1:] if p]
                gender = ""
                if rest:
                    gi = next((i for i, p in enumerate(rest) if _gender_of(p)), None)
                    if gi is not None:
                        gender = _gender_of(rest[gi])
                        rest = rest[:gi] + rest[gi + 1:]
                prompt = _clean("，".join(rest))
                add_char(name, gender, prompt)
                continue
            if key in ("场景", "场景图", "地点", "场景声明"):
                # @场景 破庙 | 残破古庙，屋顶漏雨，佛像蒙尘
                parts = _split_pipe(val)
                name = _clean(parts[0]) if parts else ""
                prompt = _clean("，".join(p for p in parts[1:] if p)) if len(parts) > 1 else ""
                add_scene(name, prompt)
                # 场景声明写在节点里 = 这一段就用这个场景
                if cur is not None and not cur.get("background"):
                    cur["background"] = name
                    cur["scene_prompt"] = prompt
                continue
            if key in ("标题", "节点"):
                if cur is None or cur["dialogues"]:
                    cur = new_node(val)
                else:
                    cur["title"] = val
                continue
            if key in ("背景", "背景图", "bg", "scene"):
                set_background(val)
                continue
            if key in ("音乐", "bgm", "配乐"):
                if cur is None:
                    cur = new_node()
                cur["music"] = val
                continue
            if key in ("类型", "node"):
                if cur is None:
                    cur = new_node()
                t = {"对话": "dialogue", "选择": "choice",
                     "战斗": "battle", "过场": "cutscene"}.get(val, "dialogue")
                cur["node_type"] = t
                continue
            if key in ("书名", "故事", "标题名"):
                title = val
                continue
            # 其它 @xxx 当注释忽略
            continue

        m = _NARRATION_TAG.match(ln)
        if m:
            body, _act = _split_action(m.group(2))
            add_dlg(body)
            continue

        m = _LINE_RE.match(ln)
        if m:
            left, right = _clean(m.group(1)), _clean(m.group(2))
            expr = ""
            em = re.match(r"^([^（(]{1,12})\s*[（(]([^）)]{0,20})[）)]$", left)
            if em:
                left, expr = _clean(em.group(1)), _clean(em.group(2))
            # `台词 | 动作描述` —— 竖线后面就是这一句的动作追加词（前缀「动作」可写可不写）
            right, pose_extra = _split_action(right)
            if left in ("旁白", "画外音", "系统", "Narrator", "narrator"):
                add_dlg(right, "", "", pose_extra)
                continue
            bad = (left in _NOT_NAME or left.endswith(_SPEECH_VERBS)
                   or len(left) > 8)
            if not bad:
                add_char(left)
                add_dlg(right, left, expr, pose_extra)
                continue
            # 认不出说话人 → 整行当旁白，别把「他低声道」当成人名建出来
            add_dlg(ln)
            continue

        add_dlg(ln)

    if not nodes:
        nodes = [new_node()]
    for i, n in enumerate(nodes):
        if not n["title"]:
            n["title"] = f"节点 {i + 1}"
    return {"title": title, "characters": chars, "scenes": scenes, "nodes": nodes}


def parse_json_spec(data: dict) -> dict:
    """AI 常用的结构化格式。字段容错：dialogues 里也可以直接写字符串。"""
    chars = []
    for c in (data.get("characters") or []):
        if isinstance(c, str):
            chars.append({"name": c, "gender": "", "role": "", "appearance": ""})
            continue
        prompt = (c.get("prompt") or c.get("free_text") or "").strip()
        chars.append({
            "name": (c.get("name") or "").strip(),
            "gender": (c.get("gender") or "").strip(),
            "role": (c.get("role") or c.get("type") or "").strip(),
            "appearance": (c.get("appearance") or c.get("look") or prompt).strip(),
            "prompt": prompt,
            "random": bool(c.get("random", not prompt)),
            "voice": c.get("voice") or "",
        })
    nodes = []
    for n in (data.get("nodes") or data.get("chapters") or []):
        dlg_rows = []
        for d in (n.get("dialogues") or n.get("lines") or []):
            if isinstance(d, str):
                body, act = _split_action(d)
                dlg_rows.append({"speaker": "", "expression": "", "content": body,
                                 "pose_extra": act})
            else:
                raw = (d.get("content") or d.get("text") or "").strip()
                body, act_from_text = _split_action(raw)
                dlg_rows.append({
                    "speaker": (d.get("speaker") or d.get("name") or "").strip(),
                    "expression": (d.get("expression") or d.get("emotion") or "").strip(),
                    "content": body,
                    "pose_extra": (d.get("pose_extra") or d.get("action")
                                   or d.get("pose") or act_from_text or "").strip(),
                })
        nodes.append({
            "title": (n.get("title") or "").strip(),
            "node_type": {"对话": "dialogue", "选择": "choice",
                          "战斗": "battle", "过场": "cutscene"}.get(
                              n.get("type") or n.get("node_type") or "", "dialogue"),
            "background": (n.get("background") or n.get("scene") or "").strip(),
            "music": (n.get("music") or n.get("bgm") or "").strip(),
            "scene_prompt": (n.get("scene_prompt") or "").strip(),
            "dialogues": dlg_rows,
        })
    # 顶层 scenes 也可以直接声明（AI 写 JSON 时更省字）
    scenes = []
    for sc in (data.get("scenes") or []):
        if isinstance(sc, str):
            scenes.append({"name": sc.strip(), "prompt": "", "random": True})
            continue
        prompt = (sc.get("prompt") or sc.get("free_text") or "").strip()
        scenes.append({"name": (sc.get("name") or "").strip(), "prompt": prompt,
                       "random": bool(sc.get("random", not prompt))})
    for n in nodes:
        if n["background"] and not any(_norm(x["name"]) == _norm(n["background"]) for x in scenes):
            scenes.append({"name": n["background"], "prompt": n.get("scene_prompt") or "",
                           "random": not bool(n.get("scene_prompt")),
                           "from_node": True})
        elif n.get("scene_prompt"):
            for x in scenes:
                if _norm(x["name"]) == _norm(n["background"]) and not x.get("prompt"):
                    x["prompt"] = n["scene_prompt"]
                    x["random"] = False
    return {"title": (data.get("title") or "").strip(), "characters": chars,
            "scenes": scenes, "nodes": nodes}


# ---------------------------------------------------------------------------
# 解析 + 预览
# ---------------------------------------------------------------------------
def _match_scene(db: Session, keyword: str) -> dict:
    """按名字找场景封面。「破庙雨夜」找「破庙」也算命中（包含匹配）。"""
    kw = _clean(keyword)
    if not kw:
        return {}
    if kw.startswith("/") or kw.startswith("http"):
        return {"background": kw, "scene_id": None, "matched": ""}
    rows = db.query(Scene).all()
    hit = next((s for s in rows if _norm(s.name) == _norm(kw)), None)
    if not hit:
        hit = next((s for s in rows if _norm(kw) in _norm(s.name)
                    or _norm(s.name) in _norm(kw)), None)
    if hit:
        return {"background": hit.background_image or "",
                "scene_id": hit.id, "matched": hit.name}
    return {}


def _match_sound(db: Session, keyword: str) -> dict:
    kw = _clean(keyword)
    if not kw:
        return {}
    if kw.startswith("/") or kw.startswith("http"):
        return {"bgm": kw, "matched": ""}
    rows = db.query(Sound).all()
    hit = next((s for s in rows if _norm(s.name) == _norm(kw)), None)
    if not hit:
        hit = next((s for s in rows if _norm(kw) in _norm(s.name)), None)
    return {"bgm": hit.file_url if hit else "", "matched": hit.name if hit else ""}


def build_preview(db: Session, spec: dict) -> dict:
    poses = _pose_ids()
    chars = db.query(Character).all()
    by_name = {_norm(c.name): c for c in chars}

    char_out = []
    for c in spec.get("characters") or []:
        nm = (c.get("name") or "").strip()
        if not nm:
            continue
        hit = by_name.get(_norm(nm))
        prompt = (c.get("prompt") or "").strip()
        gender = (c.get("gender") or (getattr(hit, "gender", "") if hit else "") or "")
        if gender not in ("male", "female"):
            gender = ""
        char_out.append({
            "name": nm,
            "exists": bool(hit),
            "id": hit.id if hit else None,
            "gender": gender,
            "role": c.get("role") or "",
            "appearance": c.get("appearance") or "",
            # 分隔符 | 后面那段描述：前端直接塞进「自定义追加词」并勾上「只用追加词」
            "prompt": prompt,
            "random": bool(c.get("random", True)) if not prompt else False,
            # reset = 外观参数全部回默认（等价于外观设置里的「重置」）：
            # 题材 / 性别 / 年龄 / 国族 都不再写进提示词，只剩名字 + 追加词
            "reset": bool(prompt),
        })

    # 场景：声明过但没有记录的，导入时按「只用追加词」新建
    scene_rows = db.query(Scene).all()
    scene_out = []
    for sc in spec.get("scenes") or []:
        nm = (sc.get("name") or "").strip()
        if not nm:
            continue
        hit = next((x for x in scene_rows if _norm(x.name) == _norm(nm)), None)
        if not hit:
            hit = next((x for x in scene_rows if _norm(nm) in _norm(x.name)), None)
        prompt = (sc.get("prompt") or "").strip()
        scene_out.append({
            "name": nm,
            "exists": bool(hit),
            "id": hit.id if hit else None,
            "prompt": prompt or ((hit.prompt_text or "") if hit else ""),
            "random": False if prompt else bool(sc.get("random", True)),
            "background": (hit.background_image if hit else "") or "",
            "matched": (hit.name if hit else ""),
        })

    declared_scene = {_norm(x["name"]): x for x in scene_out}
    nodes_out = []
    warnings: list[str] = []
    dlg_total = 0
    speak_order: dict[str, int] = {}
    for n in spec.get("nodes") or []:
        scene = _match_scene(db, n.get("background") or "")
        snd = _match_sound(db, n.get("music") or "")
        bg_name = (n.get("background") or "").strip()
        if bg_name and not scene.get("background"):
            d = declared_scene.get(_norm(bg_name))
            if d and d.get("prompt"):
                # 已经声明过描述，场景列表那边会提示「将新建」，这里不再重复
                pass
            elif d and not d.get("exists"):
                warnings.append(
                    f"背景「{bg_name}」还没有场景记录，导入时会新建（暂时没有封面图）。")
            else:
                warnings.append(f"背景「{bg_name}」在场景库里没找到，导入后请在节点里手动选图。")
        if (n.get("music") or "") and not snd.get("bgm"):
            warnings.append(f"音乐「{n.get('music')}」在声音库里没找到，已留空。")

        dlg_out = []
        for d in (n.get("dialogues") or []):
            content = _clean(d.get("content") or "")
            if not content:
                continue
            sp = _clean(d.get("speaker") or "")
            sid = None
            if sp:
                hit = by_name.get(_norm(sp))
                if hit:
                    sid = hit.id
                else:
                    warnings.append(f"说话者「{sp}」还没有人物记录"
                                    + ("（导入时会自动新建）" if True else "") + "。")
            if sp and sp not in speak_order:
                speak_order[sp] = len(speak_order)
            x = POS_X[speak_order.get(sp, 0) % len(POS_X)] if sp else 50.0
            dlg_out.append({
                "speaker": sp,
                "speaker_id": sid,
                "expression": _expr(d.get("expression") or "", poses),
                "content": content,
                "pos_x": x,
                # `| 动作描述` 解析出来的动作追加词：只作用于这一句的姿态
                "pose_extra": _clean(d.get("pose_extra") or ""),
            })
            dlg_total += 1
        nodes_out.append({
            "title": n.get("title") or "",
            "node_type": n.get("node_type") or "dialogue",
            "background": n.get("background") or "",
            "background_url": scene.get("background") or "",
            "scene_id": scene.get("scene_id"),
            "music": n.get("music") or "",
            "bgm": snd.get("bgm") or "",
            "scene_prompt": n.get("scene_prompt") or "",
            "dialogues": dlg_out,
        })

    # 同一个警告只留一条
    seen = set()
    uniq = []
    for w in warnings:
        if w in seen:
            continue
        seen.add(w)
        uniq.append(w)
    missing = [c["name"] for c in char_out if not c["exists"]]
    new_scenes = [x["name"] for x in scene_out if not x["exists"]]
    return {
        "title": spec.get("title") or "",
        "characters": char_out,
        "scenes": scene_out,
        "nodes": nodes_out,
        "warnings": uniq,
        "stats": {
            "nodes": len(nodes_out),
            "dialogues": dlg_total,
            "characters": len(char_out),
            "missing_characters": missing,
            "scenes": len(scene_out),
            "new_scenes": new_scenes,
        },
    }


# ---------------------------------------------------------------------------
# 接口：解析预览
# ---------------------------------------------------------------------------
@router.post("/parse")
def parse_import(payload: dict, db: Session = Depends(get_db)):
    """只解析，不落库。前端把结果显示成预览，用户确认后再 /apply。"""
    text = payload.get("text") or ""
    raw_json = payload.get("json")
    spec = None
    if raw_json:
        if isinstance(raw_json, str):
            try:
                raw_json = json.loads(raw_json)
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"JSON 解析失败：{exc}"}
        if isinstance(raw_json, dict):
            spec = parse_json_spec(raw_json)
    if spec is None:
        if not (text or "").strip():
            return {"ok": False, "error": "没有内容：请粘贴剧本，或贴 JSON"}
        spec = parse_script(text)
    preview = build_preview(db, spec)
    preview["ok"] = True
    preview["source"] = "json" if raw_json else "script"
    preview["spec"] = spec           # 原样带回去，apply 时不用再解析一遍
    return preview


# ---------------------------------------------------------------------------
# 接口：真正写库
# ---------------------------------------------------------------------------
def _skeleton_appearance(theme: str, gender: str | None, age: str | None,
                         nationality: str | None, bare: bool = False) -> dict:
    """只保留骨架的外观：题材 / 性别 / 年龄 / 国族 / 取景。

    给「我已经写好自定义追加词，别再加随机细节」的情况用。
    `bare=True` 就是外观设置里的「重置」：连题材 / 性别 / 年龄 / 国族都不写，
    提示词里只剩名字 + 自定义追加词，空值在拼提示词时会被跳过。
    """
    c: dict = {"mode": "default", "nudity": "none", "framing": "full"}
    if theme:
        c["theme"] = theme
    if gender:
        c["gender"] = gender
    elif not bare:
        c["gender"] = "male"
    if age:
        c["age"] = str(age)
    if nationality:
        c["nationality"] = nationality
    return c


def _ensure_character(db: Session, name: str, hint: dict, theme: str) -> Character:
    """缺的人物自动建一个。

    hint["appearance_spec"] 是前端「导入 → 输出」里给这个人物锁定的外观约束：
      theme / gender / age / nationality / framing / nudity / free_text / random
    没给 spec 就按题材纯随机（老行为，保持不变）。
    """
    spec = hint.get("appearance_spec")
    if not isinstance(spec, dict):
        spec = {}

    t = (spec.get("theme") or theme or "wuxia").strip()
    gender = (spec.get("gender") or hint.get("gender") or "").strip()
    if gender not in ("male", "female"):
        gender = None
    age = str(spec.get("age") or "").strip() or None
    nat = (spec.get("nationality") or "").strip() or None

    # 没显式给 random 时：写了追加词就默认「只用追加词」（用户要的可控行为），
    # 没写才走随机。这样 AI 直接调接口也能得到和界面一致的结果。
    random_flag = spec.get("random")
    if random_flag is None:
        random_flag = not bool((spec.get("free_text") or "").strip())
    # random=False：不随机，只留骨架 + 用户自己的追加词
    # reset=True（写了描述）：骨架也不要，等价于外观设置里的「重置」——
    # 用户手动改过的项（theme / age / nationality / gender）照样带上。
    if random_flag is False:
        if spec.get("reset"):
            appearance = _skeleton_appearance(
                (spec.get("theme") or "").strip() or None, gender,
                str(spec.get("age") or "").strip() or None,
                (spec.get("nationality") or "").strip() or None, bare=True)
        else:
            appearance = _skeleton_appearance(t, gender, age, nat)
    else:
        appearance = generator.random_appearance(
            gender=gender, age=age, theme=t, nationality=nat,
            include_sensitive=False)

    # 下面三项随机器不管（framing / nudity）或要覆盖（free_text），按用户选定写死
    if spec.get("framing"):
        appearance["framing"] = spec["framing"]
    if spec.get("nudity"):
        appearance["nudity"] = spec["nudity"]
    free = (spec.get("free_text") or "").strip()
    if free:
        appearance["free_text"] = free
    if hint.get("appearance"):
        appearance["hint"] = hint["appearance"]
    role = (hint.get("role") or "").strip()
    ctype = "player" if role in ("主角", "玩家", "player", "protagonist") else "npc"
    ch = Character(
        name=name,
        character_type=ctype,
        gender=appearance.get("gender") if appearance.get("gender") in ("male", "female") else "unknown",
        appearance_json=json.dumps(appearance, ensure_ascii=False),
        background_story=(hint.get("appearance") or "").strip() or None,
        tts_engine="edge",
    )
    # 注意：导入面板挑的音色「仅本次导入用」，不写进角色档案 tts_voice。
    # 本批整章配音要用的音色另走 id_voice（按名匹配），用完即弃，不污染角色档案。
    db.add(ch)
    db.commit()
    db.refresh(ch)
    try:
        from .tag import ensure_character_name_tag
        ensure_character_name_tag(db, ch.id, ch.name)
    except Exception:  # noqa: BLE001
        pass
    return ch


def _apply_existing_appearance(db: Session, ch: Character, hint: dict) -> None:
    """导入记录里给「已存在」人物重新写了外观 → 更新其外观（未锁定时）。

    只有用户真的改了东西才动库，避免每次导入都把人物外观冲回默认：
      · appearance_spec.free_text 非空 → 该人物外观重置为「骨架 + 这段描述」
        （等价于外观设置里点一次重置，再填自定义追加词）；
      · 否则不动。
    """
    spec = hint.get("appearance_spec")
    if not isinstance(spec, dict):
        return
    free = (spec.get("free_text") or "").strip()
    if not free:
        return
    gender = (spec.get("gender") or "").strip()
    if gender not in ("male", "female"):
        gender = None
    appearance = _skeleton_appearance(
        (spec.get("theme") or "").strip() or None, gender,
        str(spec.get("age") or "").strip() or None,
        (spec.get("nationality") or "").strip() or None, bare=True)
    if spec.get("framing"):
        appearance["framing"] = spec["framing"]
    if spec.get("nudity"):
        appearance["nudity"] = spec["nudity"]
    appearance["free_text"] = free
    ch.appearance_json = json.dumps(appearance, ensure_ascii=False)
    if gender:
        ch.gender = gender
    db.commit()


def _find_scene(db: Session, name: str):
    """按名字找场景：先精确、再包含（「破庙雨夜」能对上「破庙」）。"""
    kw = _clean(name)
    if not kw:
        return None
    rows = db.query(Scene).all()
    hit = next((x for x in rows if _norm(x.name) == _norm(kw)), None)
    if not hit:
        hit = next((x for x in rows if _norm(kw) in _norm(x.name)
                    or _norm(x.name) in _norm(kw)), None)
    return hit


def _ensure_scene(db: Session, name: str, prompt: str) -> tuple:
    """场景：有就补追加词，没有就按「只用追加词」建一条。返回 (scene, created)。"""
    prompt = (prompt or "").strip()
    hit = _find_scene(db, name)
    if hit:
        # 只在原来没写过提示词时补，别覆盖用户手改过的
        if prompt and not (hit.prompt_text or "").strip():
            hit.prompt_text = prompt
            if not (hit.description or "").strip():
                hit.description = prompt
            db.commit()
        return hit, False
    sc = Scene(name=_clean(name) or "未命名场景",
               scene_type="wilderness",
               description=prompt or None,
               prompt_text=prompt or None)
    db.add(sc)
    db.commit()
    db.refresh(sc)
    return sc, True


def _start_scene_art(scene_ids: list[int]) -> list[str]:
    """给「只用追加词」新建出来的场景排一张场景图。

    走的是场景拼装那套执行器，但 appearance 传空、prompt_override 直接给追加词
    —— 画面只按文本描述来，不叠加随机维度。出完写回 scenes.background_image。
    """
    from . import scene_gen

    db = SessionLocal()
    job_ids: list[str] = []
    try:
        for sid in scene_ids:
            sc = db.query(Scene).filter(Scene.id == sid).first()
            if not sc or not (sc.prompt_text or "").strip():
                continue
            try:
                gp = {}
                from ..comfyui.config_store import ComfyUIConfigStore
                gp = ComfyUIConfigStore().get_gen_params("scenes") or {}
            except Exception:  # noqa: BLE001
                gp = {}
            req = scene_gen.SceneGenReq(
                scene_id=sid, appearance={},
                free_prompt=sc.prompt_text,
                prompt_override=sc.prompt_text,
                width=gp.get("width") or 1344, height=gp.get("height") or 768,
                model_preset=gp.get("model_preset") or None,
                use_active_model_preset=not bool(gp.get("model_preset")),
                save_to_scene=True,
                title=f"场景 · {sc.name} · 剧情导入",
            )
            job = jobs.create("scene_render", f"剧情场景 · {sc.name}",
                              page="scenes", total=1,
                              focus={"scene_id": sid, "tab": "assembly"},
                              message="排队中…")
            jobs.spawn(jobs.guard, job["id"], scene_gen._scene_job, job["id"], req)
            job_ids.append(job["id"])
    finally:
        db.close()
    return job_ids


def _start_cast_art(char_ids: list[int], poses: list[str]) -> list[str]:
    """给刚建的人物排一批「立绘 + 表情」出图任务（复用动作表情那套执行器）。

    出图参数读 scope="characters" —— 和「人物管理」共用同一套人物出图配置，
    这样用户在人物管理里调好的尺寸 / 模型方案，导入立绘也跟着生效，不再各配各的。
    场景则走独立的 scope="scenes"，两者互不串扰。
    """
    from .pose_library import PoseGenReq

    gp: dict = {}
    try:
        from ..comfyui.config_store import ComfyUIConfigStore
        gp = ComfyUIConfigStore().get_gen_params("characters") or {}
    except Exception:  # noqa: BLE001  读不到就退回全局，不能因此不出图
        gp = {}

    db = SessionLocal()
    job_ids: list[str] = []
    try:
        for cid in char_ids:
            ch = db.query(Character).filter(Character.id == cid).first()
            if not ch:
                continue
            try:
                appearance = json.loads(ch.appearance_json or "{}")
            except Exception:  # noqa: BLE001
                appearance = {}
            if not appearance:
                continue
            framing = appearance.get("framing") or "full"
            appearance = {**appearance, "framing": framing}
            req = PoseGenReq(
                pose_ids=poses, page="story", framing=framing,
                include_sensitive=False,
                width=gp.get("width") or None,
                height=gp.get("height") or None,
                model_preset=(gp.get("model_preset") or None),
                title=f"{ch.name} · 剧本出场")
            job = jobs.create(
                "story_cast", f"剧本人物 · {ch.name} · {len(poses)} 张",
                page="characters", total=len(poses),
                focus={"character_id": cid, "tab": "pose", "character_name": ch.name},
                message="排队中…")
            jobs.spawn(jobs.guard, job["id"], _run_cast_pose, job["id"], cid,
                       ch.name, appearance, poses, req)
            job_ids.append(job["id"])
    finally:
        db.close()
    return job_ids


def _run_cast_pose(job_id: str, cid: int, name: str, appearance: dict,
                   poses: list[str], req) -> None:
    """跑一批动作图；跑完把最像「立绘」的那张设成人物头像。"""
    pose_library._run_pose_batch(job_id, cid, name, appearance, poses, req, "默认外观")
    db = SessionLocal()
    try:
        ch = db.query(Character).filter(Character.id == cid).first()
        if not ch or ch.portrait_image:
            return
        try:
            faces = json.loads(ch.expressions or "{}")
        except Exception:  # noqa: BLE001
            faces = {}
        for pid in ("idle_stand",) + tuple(poses):
            if faces.get(pid):
                ch.portrait_image = faces[pid]
                db.commit()
                break
    finally:
        db.close()


def _start_dialogue_art(items: list[dict]) -> list[str]:
    """按台词逐句出图：每句有「情绪标签」或「动作追加词」的对话各出一张动作图。

    规则（用户要求）：
      · 有情绪标签 → 情绪对应的动作提示词 + 动作追加词组合；
      · 无情绪标签 → 只用动作追加词（pose 用 idle_stand 兜底）。
    items: [{"character_id", "pose_id", "pose_extra", "order"}, ...]
    按人物分组，一个人物一个任务，任务里逐句出图。
    """
    from ..comfyui.config_store import ComfyUIConfigStore
    from .pose_library import PoseGenReq

    gp: dict = {}
    try:
        gp = ComfyUIConfigStore().get_gen_params("characters") or {}
    except Exception:  # noqa: BLE001
        gp = {}

    db = SessionLocal()
    job_ids: list[str] = []
    try:
        # 按人物分组，保持台词顺序
        by_char: dict[int, dict] = {}
        order: list[int] = []
        for it in items:
            cid = it["character_id"]
            if cid not in by_char:
                by_char[cid] = {"name": "", "appearance": {}, "items": []}
                order.append(cid)
            by_char[cid]["items"].append(it)
        # 补人物名与外观
        for cid in by_char:
            ch = db.query(Character).filter(Character.id == cid).first()
            if not ch:
                continue
            by_char[cid]["name"] = ch.name
            try:
                by_char[cid]["appearance"] = json.loads(ch.appearance_json or "{}")
            except Exception:  # noqa: BLE001
                by_char[cid]["appearance"] = {}

        for cid in order:
            grp = by_char[cid]
            name = grp["name"]
            grp_items = grp["items"]
            if not name or not grp["appearance"]:
                continue
            framing = grp["appearance"].get("framing") or "full"
            appearance = {**grp["appearance"], "framing": framing}
            req = PoseGenReq(
                pose_ids=None, page="story", framing=framing,
                include_sensitive=False,
                width=gp.get("width") or None,
                height=gp.get("height") or None,
                model_preset=(gp.get("model_preset") or None),
                title=f"{name} · 剧本台词")
            job = jobs.create(
                "story_cast", f"剧本台词 · {name} · {len(grp_items)} 句",
                page="characters", total=len(grp_items),
                focus={"character_id": cid, "tab": "pose", "character_name": name},
                message="排队中…")
            jobs.spawn(jobs.guard, job["id"], _run_dialogue_batch, job["id"],
                       cid, name, appearance, grp_items, req)
            job_ids.append(job["id"])
    finally:
        db.close()
    return job_ids


def _run_dialogue_batch(job_id: str, cid: int, name: str, appearance: dict,
                        items: list[dict], req) -> None:
    """后台线程：按台词逐句出图（每句独立的动作 + 动作追加词）。"""
    from . import comfyui as comfyui_router
    from ..database import SessionLocal
    from ..models.character_pose import CharacterPoseImage
    from .pose_library import _sync_expression, _pose_dim

    db = SessionLocal()
    ok_count = 0
    try:
        all_poses = {p["id"]: p for p in (_pose_dim().get("options") or [])}
        ch = db.query(Character).filter(Character.id == cid).first()
        for it in items:
            pid = it.get("pose_id") or "idle_stand"
            extra = (it.get("pose_extra") or "").strip()
            pose = all_poses.get(pid) or {"id": pid, "name": pid, "cat": ""}
            ap = {**appearance, "pose": pid, "poseCategory": pose.get("cat") or "",
                  "name": name}
            if extra:
                base_free = (ap.get("free_text") or "").strip()
                ap["free_text"] = (base_free + "\n" + extra).strip() if base_free else extra
            payload = comfyui_router.GenerateReq(
                appearance=ap, mode="t2i", include_sensitive=False,
                prompt_lang="cn", width=req.width, height=req.height,
                batch_size=1, filename_prefix=f"dlg_{cid}_{pid}",
                model_preset=req.model_preset,
                use_active_model_preset=req.use_active_model_preset,
                random_seed=True, timeout_sec=req.timeout_sec,
                ctx={"source": "dialogue_art", "character_id": cid,
                     "character_name": name, "pose_id": pid,
                     "pose_name": pose.get("name"), "category": pose.get("cat") or "",
                     "job_id": job_id})

            resp = None
            while True:
                jobs.gate(job_id)
                try:
                    resp = comfyui_router.generate(payload)
                    break
                except Exception as e:  # noqa: BLE001
                    db.rollback()
                    if jobs.abort_now(job_id):
                        if jobs.is_canceled(job_id):
                            raise jobs.JobCanceled()
                        continue
                    detail = getattr(e, "detail", None) or str(e)
                    jobs.step(job_id, ok=False,
                              result={"pose_id": pid, "ok": False, "error": str(detail)},
                              message=f"{name}：{pose.get('name') or pid} 失败")
                    break
            if resp is None:
                continue
            try:
                url = (resp.get("images") or [None])[0]
                if not url:
                    jobs.step(job_id, ok=False,
                              result={"pose_id": pid, "ok": False, "error": "未返回图片"})
                    continue
                meta = (resp.get("meta") or [{}])[0]
                # 覆盖式写入：同一角色 + 同一动作 + 同一取景，只保留最新一张，
                # 重导 / 重生成时不会越攒越多（旧的留在库里既占地方，又会让
                # 播放器同一位置上叠出多张图）。
                _fr = appearance.get("framing") or "full"
                existing = (db.query(CharacterPoseImage)
                            .filter(CharacterPoseImage.character_id == cid,
                                    CharacterPoseImage.pose_id == pid,
                                    CharacterPoseImage.framing == _fr)
                            .order_by(CharacterPoseImage.id.desc()).first())
                if existing:
                    existing.image_url = url
                    existing.prompt = resp.get("positive")
                    existing.pose_name = pose.get("name")
                    existing.category = pose.get("cat") or ""
                    existing.appearance_id = None
                    existing.appearance_name = "默认外观"
                    existing.model_preset = req.model_preset
                    existing.width = meta.get("width") or resp.get("width")
                    existing.height = meta.get("height") or resp.get("height")
                    db.commit()
                    db.refresh(existing)
                    img = existing
                else:
                    img = CharacterPoseImage(
                        character_id=cid, pose_id=pid,
                        pose_name=pose.get("name"), category=pose.get("cat") or "",
                        image_url=url, prompt=resp.get("positive"),
                        appearance_id=None, appearance_name="默认外观",
                        framing=_fr,
                        model_preset=req.model_preset,
                        width=meta.get("width") or resp.get("width"),
                        height=meta.get("height") or resp.get("height"))
                    db.add(img)
                    db.commit()
                    db.refresh(img)
                if ch:
                    _sync_expression(ch, pid, url, db)
                ok_count += 1
                jobs.step(job_id, ok=True, image=url,
                          result={"pose_id": pid, "pose_name": pose.get("name"),
                                  "ok": True, "image": url,
                                  "width": img.width, "height": img.height,
                                  "prompt": img.prompt},
                          message=f"{name}：{pose.get('name') or pid}")
            except jobs.JobCanceled:
                raise
            except Exception as e:  # noqa: BLE001
                db.rollback()
                jobs.step(job_id, ok=False,
                          result={"pose_id": pid, "ok": False, "error": str(e)})
        if ok_count == len(items):
            jobs.finish(job_id, status="done", message=f"完成 {ok_count} 张")
        elif ok_count:
            jobs.finish(job_id, status="partial", message=f"成功 {ok_count}/{len(items)} 张")
        else:
            jobs.finish(job_id, status="error", message="全部失败")
    finally:
        db.close()


@router.post("/apply")
def apply_import(payload: dict, db: Session = Depends(get_db)):
    """把预览结果写进章节。payload.nodes 可以带用户在前端改过的内容。

    三种玩法：
      · 首次导入 —— 落库 + 留一条批次记录，节点记住 batch_id；
      · 回来重导（传 batch_id + mode=replace）—— 先删掉这批节点再按新内容重建，
        位置沿用原来的序号，不会把整章顺序打乱；
      · 追加同一批（mode=append）—— 只往后加。
    """
    nodes = payload.get("nodes") or []
    if not nodes:
        return {"ok": False, "error": "没有节点可导入"}

    # ---- 0) 批次：先把「替换」的旧节点删掉 ----
    replace = (payload.get("mode") or "append") == "replace"
    batch = None
    if payload.get("batch_id"):
        batch = (db.query(StoryImportBatch)
                 .filter(StoryImportBatch.id == int(payload["batch_id"])).first())
    replace_start = None
    if batch and replace:
        old_nodes = (db.query(StoryNode)
                     .filter(StoryNode.import_batch_id == batch.id).all())
        if old_nodes:
            replace_start = min((o.order_index or 0) for o in old_nodes)
        for o in old_nodes:
            db.delete(o)
        db.commit()

    # ---- 1) 章节：用现成的，或新建 ----
    chapter_id = payload.get("chapter_id") or (batch.chapter_id if batch else None)
    chapter_title = (payload.get("chapter_title") or "").strip()
    if chapter_id:
        chapter = db.query(StoryChapter).filter(StoryChapter.id == int(chapter_id)).first()
        if not chapter:
            return {"ok": False, "error": "目标章节不存在"}
    else:
        arc_id = payload.get("arc_id")
        max_order = 0
        if arc_id:
            row = (db.query(StoryChapter)
                   .filter(StoryChapter.story_arc_id == int(arc_id))
                   .order_by(StoryChapter.chapter_order.desc()).first())
            max_order = (row.chapter_order if row else 0) or 0
        chapter = StoryChapter(
            title=chapter_title or ("导入剧情 · " + datetime.now().strftime("%m-%d %H:%M")),
            story_arc_id=int(arc_id) if arc_id else None,
            chapter_order=max_order + 1,
            description="由「剧情导入」自动生成",
            is_main_story=1,
        )
        db.add(chapter)
        db.commit()
        db.refresh(chapter)
    chapter_id = chapter.id

    # ---- 2) 场景：声明的补追加词，没的按「只用追加词」新建 ----
    theme = (payload.get("theme") or "wuxia").strip()
    scene_map: dict = {}
    created_scenes: list = []
    for sc in (payload.get("scenes") or []):
        nm = (sc.get("name") or "").strip()
        if not nm:
            continue
        # 锁定：保持原样，不新建也不补追加词
        if sc.get("locked"):
            row = _find_scene(db, nm)
            if row:
                scene_map[_norm(nm)] = row
            continue
        row, is_new = _ensure_scene(db, nm, sc.get("prompt") or "")
        scene_map[_norm(nm)] = row
        if is_new:
            created_scenes.append({"id": row.id, "name": row.name,
                                   "prompt": (row.prompt_text or "")})

    # ---- 3) 人物：先按名字对上，缺的可选自动建 ----
    create_missing = bool(payload.get("create_missing_characters", True))
    hints = {_norm((c.get("name") or "")): c for c in (payload.get("characters") or [])}
    by_norm = {_norm(c.name): c for c in db.query(Character).all()}
    char_map: dict[str, int] = {}
    created: list[dict] = []
    missing: list[str] = []
    for n in nodes:
        for d in (n.get("dialogues") or []):
            nm = _clean(d.get("speaker") or "")
            if not nm or _norm(nm) in char_map:
                continue
            hit = by_norm.get(_norm(nm))
            if hit:
                char_map[_norm(nm)] = hit.id
                # 已存在人物：未锁定且用户改了外观（appearance_spec 里写了描述/维度）→ 更新外观；
                # 锁定（locked=True）→ 保持原样，什么都不动。
                hint = hints.get(_norm(nm)) or {}
                if not hint.get("locked"):
                    _apply_existing_appearance(db, hit, hint)
                continue
            if create_missing:
                ch = _ensure_character(db, nm, hints.get(_norm(nm)) or {}, theme)
                char_map[_norm(nm)] = ch.id
                created.append({"id": ch.id, "name": ch.name})
            else:
                missing.append(nm)

    # ---- 4) 批次记录（先建，节点创建时就能挂上 id） ----
    source = payload.get("source") or {}
    spec_in = payload.get("spec") or {}
    if batch is None:
        batch = StoryImportBatch(
            story_arc_id=int(payload["arc_id"]) if payload.get("arc_id") else None,
            chapter_id=chapter_id,
            title=(payload.get("batch_title") or spec_in.get("title")
                   or chapter_title or chapter.title),
        )
        db.add(batch)
        db.commit()
        db.refresh(batch)
    batch.chapter_id = chapter_id
    if source.get("text") is not None:
        batch.source_text = source.get("text")
    if source.get("json") is not None:
        batch.source_json = (source.get("json") if isinstance(source.get("json"), str)
                             else json.dumps(source.get("json"), ensure_ascii=False))
    if payload.get("source_text") is not None:
        batch.source_text = payload.get("source_text")
    if spec_in:
        batch.spec_json = json.dumps(spec_in, ensure_ascii=False)
    batch.updated_at = datetime.now().isoformat()
    db.commit()

    # ---- 5) 节点 + 对话 ----
    if replace_start:
        next_idx = replace_start
    else:
        max_idx = (db.query(StoryNode)
                   .filter(StoryNode.chapter_id == chapter_id)
                   .order_by(StoryNode.order_index.desc()).first())
        next_idx = ((max_idx.order_index if max_idx else 0) or 0) + 1

    node_ids: list[int] = []
    dlg_for_voice: list[dict] = []
    # 整章配音用：预先知道哪些发言角色配了音色。优先用导入面板里手动挑的音色
    # （character 的 voice 字段），挑了就用，没挑的回落到角色档案 tts_voice。
    # 没配音色的角色不配音、也不回退默认音色（否则一堆随机音对不上人物）。
    # 旁白同理：导入面板若指定了旁白音色就优先用，否则用系统旁白配置（且要开启）。
    _char_voice_by_name = {}
    for _h in (payload.get("characters") or []):
        _v = (str(_h.get("voice") or "").strip())
        if _v:
            _char_voice_by_name[_norm(str(_h.get("name") or ""))] = _v
    # 把「面板挑的音色」映射到每个已解析角色（含本批新建的）：char_map 同时含
    # 已存在 + 新建角色，by_norm 只有已存在的，所以必须用 char_map 才不会漏掉新建角色。
    # 面板没挑 → 回落到角色档案 tts_voice（仅已存在角色能在 by_norm 查到，新建角色没有档案音色就不配）；
    # 任何情况下都不回退默认音色（否则一堆随机音对不上人物）。
    id_voice: dict[int, str] = {}
    for _nm, _cid in char_map.items():
        _pv = _char_voice_by_name.get(_nm)
        if _pv:
            id_voice[_cid] = _pv
        else:
            _ch = by_norm.get(_nm)
            if _ch and (_ch.tts_voice or "").strip():
                id_voice[_cid] = (_ch.tts_voice or "").strip()
    _narr_row = db.query(NarrationVoice).filter(NarrationVoice.id == 1).first()
    _narr_override = (str(payload.get("narration_voice") or "").strip())
    narr_voice_ok = bool(_narr_override) or bool(_narr_row and _narr_row.voice_id and _narr_row.enabled)
    used_exprs: set = set()  # 脚本里实际用到的表情 pose_id，批量出图时一并生成
    # 逐句出图清单：每句有「情绪标签」或「动作追加词」的台词各出一张图。
    # 规则（用户要求）：有情绪标签 → 情绪动作 + 动作追加词组合；无情绪标签 → 只用动作追加词。
    # 旁白（speaker 为空）与两者都无的句子不出图。
    dialogue_art_items: list[dict] = []
    for n in nodes:
        # 背景：优先用已经配好的场景记录，其次按名字现找 / 现建
        sc = scene_map.get(_norm(n.get("background") or ""))
        if sc is None and (n.get("background") or "").strip():
            sc, is_new = _ensure_scene(db, n["background"], n.get("scene_prompt") or "")
            scene_map[_norm(n["background"])] = sc
            if is_new:
                created_scenes.append({"id": sc.id, "name": sc.name,
                                       "prompt": (sc.prompt_text or "")})
        scene_id = n.get("scene_id") or (sc.id if sc else None)
        bg = n.get("background_url") or ((sc.background_image or "") if sc else "")

        dlg_rows = n.get("dialogues") or []
        speakers: list[int] = []
        for d in dlg_rows:
            sid = d.get("speaker_id") or char_map.get(_norm(d.get("speaker") or ""))
            if sid and sid not in speakers:
                speakers.append(sid)
        # 一个节点里出现多个角色时，按"出场顺序"给每个角色分配一个分散的默认站位，
        # 避免导入后所有立绘都堆在舞台正中互相遮挡（女性常压住男性，看着像"没出现"）。
        # 只在没手动指定 pos_x 时生效；单角色节点仍居中。
        _pos_map: dict = {}
        if len(speakers) > 1:
            for _i, _sid in enumerate(speakers):
                _pos_map[_sid] = POS_X[min(_i, len(POS_X) - 1)]
        # 收集本节点对话里用到的表情，待会儿合并进批量出图清单
        for d in dlg_rows:
            ex = (d.get("expression") or "").strip()
            if ex:
                used_exprs.add(ex)
        first = dlg_rows[0] if dlg_rows else {}
        multi = [{"speaker_id": sid,
                  "expression": (next((d.get("expression") for d in dlg_rows
                                       if (d.get("speaker_id") or char_map.get(
                                           _norm(d.get("speaker") or ""))) == sid), "") or ""),
                  "position": _legacy_pos(float(next(
                      (d.get("pos_x") for d in dlg_rows
                       if (d.get("speaker_id") or char_map.get(_norm(d.get("speaker") or ""))) == sid),
                      50.0)))}
                 for sid in speakers[:6]]
        node = StoryNode(
            chapter_id=chapter_id,
            node_type=n.get("node_type") or "dialogue",
            title=(n.get("title") or "").strip() or None,
            speaker_id=(char_map.get(_norm(first.get("speaker") or ""))
                        or first.get("speaker_id") or None),
            content=first.get("content") or None,
            expression=first.get("expression") or None,
            position=_legacy_pos(float(first.get("pos_x") or 50.0)),
            multi_characters=json.dumps(multi, ensure_ascii=False) if multi else None,
            background_change=bg or None,
            scene_id=scene_id,
            bgm=n.get("bgm") or None,
            order_index=next_idx,
            import_batch_id=batch.id,
        )
        db.add(node)
        db.commit()
        db.refresh(node)
        node_ids.append(node.id)
        next_idx += 1

        for i, d in enumerate(dlg_rows):
            sid = d.get("speaker_id") or char_map.get(_norm(d.get("speaker") or ""))
            row = StoryNodeDialogue(
                node_id=node.id, order_index=i, speaker_id=sid,
                content=_clean(d.get("content") or ""),
                expression=d.get("expression") or None,
                pose_extra=(d.get("pose_extra") or "").strip() or None,
                pos_x=float(d.get("pos_x") or _pos_map.get(sid) or 50.0), pos_y=0.0, scale=1.0,
                crop_top=0.0, crop_bottom=100.0, flip=0, z_index=1,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            if row.content:
                # 整章配音：只给配了音色的角色 / 旁白配音；没配的不配、也不回退默认音色。
                # 导入面板手动挑的音色（row 上的 voice_id）会压过档案 / 旁白默认，
                # 但只用于这次批量生成，不改写角色档案或系统旁白。
                if sid:
                    _vid = id_voice.get(int(sid))
                    if _vid:
                        dlg_for_voice.append({"dialogue_id": row.id, "speaker_id": sid,
                                              "content": row.content, "voice_id": _vid})
                elif narr_voice_ok:
                    dlg_for_voice.append({"dialogue_id": row.id, "speaker_id": None,
                                          "content": row.content,
                                          "voice_id": _narr_override or (_narr_row.voice_id if _narr_row else "")})
            # 逐句出图清单：有情绪标签或动作追加词的台词各出一张动作图
            # 锁定（重新编辑时用户锁住、不想重出的图）跳过，保留原图。
            if d.get("locked"):
                continue
            _pose_extra = (d.get("pose_extra") or "").strip()
            _expr = (d.get("expression") or "").strip()
            if sid and (_pose_extra or _expr):
                dialogue_art_items.append({
                    "character_id": sid,
                    "pose_id": _expr or "idle_stand",   # 无情绪标签 → 用待机动作兜底
                    "pose_extra": _pose_extra,
                    "order": row.order_index,
                })

    # ---- 6) 批次结果回填（回来重导时知道这批都包含了什么） ----
    # 「这次新建了谁」在替换重导时通常为空（人物已经在了），所以和上一版合并去重，
    # 否则记录上会显示「0 新人物」，看不出这批到底带进了谁。
    try:
        prev = json.loads(batch.result_json or "{}")
    except Exception:  # noqa: BLE001
        prev = {}

    def _merge(old_rows, new_rows, key="id"):
        out, seen = [], set()
        for row in list(old_rows or []) + list(new_rows or []):
            k = row.get(key)
            if k in seen:
                continue
            seen.add(k)
            out.append(row)
        return out

    batch.result_json = json.dumps({
        "node_ids": node_ids,
        "created_characters": _merge(prev.get("created_characters"), created),
        "created_scenes": _merge(prev.get("created_scenes"), created_scenes),
        "dialogues": len(dlg_for_voice),
    }, ensure_ascii=False)
    db.commit()

    # ---- 7) 可选：立绘 + 逐句动作图 ----
    art_job_ids: list[str] = []
    if payload.get("generate_art"):
        # 7.1 新建角色先出一张立绘（idle_stand，作为头像），不再默认铺 5 张表情
        #     —— 表情/动作图改为「按台词逐句出」，见 7.2。
        if created:
            art_job_ids += _start_cast_art([c["id"] for c in created], ["idle_stand"])
        # 7.2 逐句出图：每句有情绪标签或动作追加词的台词各出一张。
        #     有情绪标签 → 情绪动作 + 动作追加词组合；无情绪标签 → 只用动作追加词。
        if dialogue_art_items:
            art_job_ids += _start_dialogue_art(dialogue_art_items)

    # ---- 8) 可选：给新建的场景出背景图（只用追加词） ----
    scene_job_ids: list[str] = []
    if payload.get("generate_scene") and created_scenes:
        pick = [c["id"] for c in created_scenes if (c.get("prompt") or "").strip()]
        if pick:
            scene_job_ids = _start_scene_art(pick)

    # ---- 9) 可选：顺手把整章的对话排上配音 ----
    voice_job_id = None
    if payload.get("generate_voice") and dlg_for_voice:
        job = jobs.create("voice_dialogue",
                          f"剧情语音 · {chapter.title} · {len(dlg_for_voice)} 句",
                          page="story", total=len(dlg_for_voice),
                          focus={"chapter_id": chapter_id, "node_id": node_ids[0] if node_ids else None},
                          message="排队中，逐句合成…")
        rows = [{"speaker_id": d["speaker_id"], "content": d["content"],
                 "dialogue_id": d["dialogue_id"]} for d in dlg_for_voice]
        from .voice_gen import _run_dialogue_job
        jobs.spawn(jobs.guard, job["id"], _run_dialogue_job, job["id"],
                   {"rows": rows, "pack_path": f"剧情语音/{chapter.title}"})
        voice_job_id = job["id"]

    return {
        "ok": True,
        "batch_id": batch.id,
        "replaced": bool(replace and replace_start is not None),
        "chapter_id": chapter_id,
        "chapter_title": chapter.title,
        "node_ids": node_ids,
        "created_characters": created,
        "created_scenes": created_scenes,
        "missing_characters": missing,
        "art_job_ids": art_job_ids,
        "scene_job_ids": scene_job_ids,
        "voice_job_id": voice_job_id,
        "dialogues": len(dlg_for_voice),
    }


# ---------------------------------------------------------------------------
# 给 AI 用的格式说明（前端「复制给 AI」直接拿这段）
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 导入留档：列出 / 回读 / 删除
# ---------------------------------------------------------------------------
def _batch_item(db: Session, b) -> dict:
    result = {}
    try:
        result = json.loads(b.result_json or "{}")
    except Exception:  # noqa: BLE001
        result = {}
    node_ids = result.get("node_ids") or []
    alive = 0
    if node_ids:
        alive = (db.query(StoryNode)
                 .filter(StoryNode.id.in_(node_ids)).count())
    chapter = (db.query(StoryChapter).filter(StoryChapter.id == b.chapter_id).first()
               if b.chapter_id else None)
    return {
        "id": b.id,
        "title": b.title or "",
        "chapter_id": b.chapter_id,
        "chapter_title": chapter.title if chapter else "",
        "created_at": b.created_at,
        "updated_at": b.updated_at,
        "node_count": alive,
        "nodes_total": len(node_ids),
        "characters": [c.get("name") for c in (result.get("created_characters") or [])],
        "scenes": [c.get("name") for c in (result.get("created_scenes") or [])],
        "dialogues": result.get("dialogues") or 0,
        "has_source": bool((b.source_text or "").strip() or (b.source_json or "").strip()),
    }


@router.get("/batches")
def list_batches(chapter_id: Optional[int] = None, arc_id: Optional[int] = None,
                 limit: int = 50, db: Session = Depends(get_db)):
    """这次/以前导入过什么。节点列表上用它在节点旁边标「来源」。"""
    q = db.query(StoryImportBatch)
    if chapter_id:
        q = q.filter(StoryImportBatch.chapter_id == chapter_id)
    if arc_id:
        q = q.filter(StoryImportBatch.story_arc_id == arc_id)
    rows = q.order_by(StoryImportBatch.id.desc()).limit(max(1, min(limit, 200))).all()
    return {"ok": True, "items": [_batch_item(db, b) for b in rows]}


@router.get("/batches/{batch_id}")
def get_batch(batch_id: int, db: Session = Depends(get_db)):
    b = db.query(StoryImportBatch).filter(StoryImportBatch.id == batch_id).first()
    if not b:
        return {"ok": False, "error": "导入记录不存在"}
    item = _batch_item(db, b)
    try:
        result = json.loads(b.result_json or "{}")
    except Exception:  # noqa: BLE001
        result = {}
    try:
        spec = json.loads(b.spec_json or "{}")
    except Exception:  # noqa: BLE001
        spec = {}
    return {"ok": True, "batch": item, "source_text": b.source_text or "",
            "source_json": b.source_json or "", "spec": spec, "result": result}


@router.delete("/batches/{batch_id}")
def delete_batch(batch_id: int, delete_nodes: int = 1, db: Session = Depends(get_db)):
    b = db.query(StoryImportBatch).filter(StoryImportBatch.id == batch_id).first()
    if not b:
        return {"ok": False, "error": "导入记录不存在"}
    removed = 0
    if delete_nodes:
        rows = db.query(StoryNode).filter(StoryNode.import_batch_id == batch_id).all()
        for r in rows:
            db.delete(r)
            removed += 1
    db.delete(b)
    db.commit()
    return {"ok": True, "nodes_removed": removed}


# ---------------------------------------------------------------------------
# 给 AI 用的格式说明（前端「复制给 AI」直接拿这段）
# ---------------------------------------------------------------------------
@router.get("/template")
def import_template():
    script = """# 破庙雨夜
@场景 破庙 | 塌了半边的古庙，雨水从屋顶漏下，佛像蒙尘，火光摇晃
@背景 破庙
@人物 李慕白 | 三十岁上下的男子，青衫长剑，长发束起，眉目冷峻，衣襟带雨
@人物 苏小小 | 二十出头的白衣女子，素白衣裙，鬓边一支银簪，眼神倔强
旁白：雨点砸在瓦上，火堆快熄了。
李慕白（冷漠）：你终于肯露面了。 | 抬剑指着门口
苏小小：我不是来跟你打的。 | 背过身去，握紧袖口

# 火堆将熄
@背景 破庙
旁白：火光一跳，照出两个人各不相同的脸色。
李慕白（震惊）：你身上怎么会有那道印记？
"""
    spec = {
        "title": "故事标题",
        "scenes": [
            {"name": "破庙", "prompt": "塌了半边的古庙，雨水从屋顶漏下，佛像蒙尘，火光摇晃"}
        ],
        "characters": [
            {"name": "李慕白",
             "prompt": "三十岁上下的男子，青衫长剑，长发束起，眉目冷峻，衣襟带雨",
             "role": "主角"},
            {"name": "苏小小",
             "prompt": "二十出头的白衣女子，素白衣裙，鬓边一支银簪，眼神倔强"},
        ],
        "nodes": [
            {"title": "破庙雨夜", "background": "破庙",
             "dialogues": [
                 {"speaker": "", "content": "雨点砸在瓦上，火堆快熄了。"},
                 {"speaker": "李慕白", "expression": "冷漠",
                  "content": "你终于肯露面了。", "pose_extra": "抬剑指着门口"},
                 {"speaker": "苏小小", "expression": "平静",
                  "content": "我不是来跟你打的。", "pose_extra": "背过身去，握紧袖口"},
             ]},
        ],
    }
    prompt = (
        "你是一个 RPG 剧情脚本改写器。把故事原文改写成下面的「剧本格式」，"
        "只输出剧本文本，不要解释、不要代码块、不要任何额外说明。\n\n"
        "【输出格式】\n"
        "# 节点标题\n"
        "@场景 场景名 | 这个场景的画面描述\n"
        "@背景 场景名\n"
        "@音乐 声音名\n"
        "@人物 角色名 | 这个角色的外貌描述\n"
        "旁白：环境或心理描写（没有具体说话人）\n"
        "角色名（表情）：台词\n"
        "角色名：台词 | 这一句的姿态动作\n\n"
        "【规则】\n"
        "1. 每个 `# 标题` 开一段（一个节点），一段只演一个连续场景；每段 4～10 句台词，"
        "不要把整章塞进一段。\n"
        "2. 人物第一次出现时用 `@人物 名字 | 外貌描述` 声明一次，之后只写台词。"
        "竖线后面**整段都是这个人的外观提示词**：引擎不会再补任何外观参数，"
        "所以必须一次写全——性别与年龄段、长相、发型、衣着、气质、随身物件，25～45 字，"
        "用逗号分隔。不要单独占一段写「男」「女」，不要写动作、剧情、情绪变化，"
        "也不要写「随机」「高清」「杰作」这类词。\n"
        "3. 场景第一次出现时用 `@场景 名字 | 画面描述` 声明一次；当前这段用哪个场景，"
        "用 `@背景 名字` 指定（写成 `@背景 名字 | 画面描述` 也可以）。"
        "场景描述只写环境：地点、光线、天气、陈设、氛围，20～40 字。\n"
        "4. 同一个人的名字必须前后完全一致，不要用简称、不要写别名。\n"
        "5. 表情只能从这份名单里选一个，写在名字后面的圆括号里："
        "平静 / 微笑 / 愤怒 / 悲伤 / 惊讶 / 震惊 / 狂傲 / 哭泣 / 坚定 / 自信 / 绝望 / "
        "冷漠 / 害羞 / 疲惫 / 求饶 / 悔恨 / 妒忌。不想指定表情时就不写圆括号。\n"
        "6. 动作可选：想指定这一句的姿态时，在台词后面接 ` | 动作描述`，"
        "竖线后面写什么都会被当成这一句的动作追加词，不用以「动作」二字开头，"
        "例如 `李慕白（冷漠）：你终于肯露面了。 | 抬剑指着门口`。"
        "台词本身不要出现竖线。动作只写身体姿态与手部动作（握剑、背过身、后退半步、抬手挡雨），"
        "不要重复情绪词、不要写镜头和光影。动作可以和表情同时用。\n"
        "7. 旁白一律写成 `旁白：…`；不要写「他说：」「她低声道：」这类没有名字的行。\n"
        "8. 只输出剧本，不要 JSON、不要 `//` 注释、不要总结段落。\n"
        "9. 台词要口语化、贴合人物身份，写具体说出口的话，不要概括剧情"
        "（不要写「两人争吵一番」，要写他们各自说了什么）。\n\n"
        "【示例】\n"
        "# 破庙雨夜\n"
        "@场景 破庙 | 塌了半边的古庙，雨水从屋顶漏下，佛像蒙尘，火光摇晃\n"
        "@背景 破庙\n"
        "@人物 李慕白 | 三十岁上下的男子，青衫长剑，长发束起，眉目冷峻，衣襟带雨\n"
        "@人物 苏小小 | 二十出头的白衣女子，素白衣裙，鬓边一支银簪，眼神倔强\n"
        "旁白：雨点砸在瓦上，火堆快熄了。\n"
        "李慕白（冷漠）：你终于肯露面了。 | 抬剑指着门口\n"
        "苏小小：我不是来跟你打的。 | 背过身去，握紧袖口\n\n"
        "【现在改写下面这段故事】\n"
    )
    return {"ok": True, "script_example": script, "json_example": spec,
            "ai_prompt": prompt}
