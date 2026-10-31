from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
import os

from .database import init_db
from .routers import character, relationship, skill, scene, story, story_arc, battle, event, item, upload, animation, sound, realm, tag, equipment
from .routers import resource_categories
from .routers import games, users, character_states
from .routers import admin_user_chars
from .routers import skill_book
from .routers import tts
from .routers import character_appearance, comfyui, pose_library, jobs_api, generated_images
from .routers import assets
from .routers import scene_gen
from .routers import comic
from .config import TTS_CACHE_DIR, DATA_DIR

app = FastAPI(title="RPG故事游戏 API", version="0.7.0")


# 禁用静态文件缓存中间件（开发环境），确保 JS/CSS 修改后浏览器立即获取最新版本
@app.middleware("http")
async def disable_cache_for_static(request: Request, call_next):
    response = await call_next(request)
    # 对前端所有 HTML/JS/CSS 禁用缓存（包括 /admin 和根路径前端）
    path = request.url.path
    if path.startswith("/tts-cache/"):
        # 语音内容由 md5(文本+音色+语速) 决定，同一条 URL 的内容永不变，
        # 交给浏览器长期缓存：多周目重玩时连 HTTP 请求都不用发。
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response
    if path == "/" or path.startswith("/admin") or path.startswith("/js/") or path.startswith("/css/"):
        if path.endswith("/") or any(path.endswith(ext) for ext in (".js", ".css", ".html", ".json")):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
    return response


@app.on_event("startup")
def on_startup():
    """应用启动时初始化数据库表 + 战斗系统基础数据"""
    init_db()
    print("[OK] 数据库表已初始化")
    try:
        from .database import SessionLocal
        from .services.battle_seed import seed_battle_data
        db = SessionLocal()
        try:
            report = seed_battle_data(db)
            print(f"[OK] 战斗系统数据就绪：技能 +{report['skills']}、物品 +{report['items']}、"
                  f"等级表 +{report['levels']}、角色技能 +{report['char_skills']}、"
                  f"初始背包 +{report['inventory']}、战斗节点配置 +{report['battle_configs']}")
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001
        print("[WARN] 战斗系统数据初始化失败：", exc)

    # 漫画出图队列是进程内内存对象，重启后任务全丢 → 把残留的"渲染中"状态复位
    try:
        from .services.comic_gen import recover_stuck_cells
        n = recover_stuck_cells()
        if n:
            print(f"[OK] 漫画队列已恢复：复位 {n} 个中断的格子任务")
    except Exception as exc:  # noqa: BLE001
        print("[WARN] 漫画队列恢复失败：", exc)

    # 素材库：把磁盘上已有的图（AI 出的 + 本地上传的老图）收进 assets，
    # 只补漏不删记录 —— 所以每次启动都跑一遍是安全的。
    try:
        from .database import SessionLocal
        from .services.asset_store import sync_from_disk, backfill_from_generated_images
        db = SessionLocal()
        try:
            rpt = sync_from_disk(db)
            merged = backfill_from_generated_images(db)
            print(f"[OK] 素材库就绪：扫到 {rpt['scanned']} 个文件，新增 {rpt['added']}，"
                  f"合并历史 AI 图 {merged}")
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001
        print("[WARN] 素材库同步失败：", exc)

# CORS 配置，允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册所有路由
app.include_router(character.router)
app.include_router(relationship.router)
app.include_router(skill.router)
app.include_router(scene.router)
app.include_router(story.router)
app.include_router(story_arc.router)
app.include_router(battle.router)
app.include_router(event.router)
app.include_router(item.router)
app.include_router(upload.router)
app.include_router(animation.router)
app.include_router(sound.router)
app.include_router(realm.router)
app.include_router(tag.router)
app.include_router(equipment.router)
app.include_router(resource_categories.router)
app.include_router(games.router)
app.include_router(users.router)
app.include_router(character_states.router)
app.include_router(admin_user_chars.router)
app.include_router(skill_book.router)
app.include_router(tts.router)
app.include_router(character_appearance.router)
app.include_router(character_appearance.char_router)
app.include_router(character_appearance.admin_router)
app.include_router(pose_library.router)
app.include_router(pose_library.char_router)
app.include_router(comfyui.router)
app.include_router(jobs_api.router)
app.include_router(generated_images.router)
app.include_router(assets.router)
app.include_router(scene_gen.router)
app.include_router(comic.router)
app.include_router(comic.public_router)

# 语音缓存静态托管：合成好的 MP3 从这里被 <audio> 直接拉取。
# 这部分必须设较长缓存——同一句音频内容永远不会变，
# 让浏览器存着，多周目重玩时连 HTTP 请求都不用发。
os.makedirs(TTS_CACHE_DIR, exist_ok=True)
app.mount("/tts-cache", StaticFiles(directory=TTS_CACHE_DIR), name="tts-cache")

# 生成的角色形象 / 表情 / 动作图片从这里被 <img> 直接拉取。
GENERATED_DIR = os.path.join(DATA_DIR, "generated")
os.makedirs(GENERATED_DIR, exist_ok=True)
app.mount("/generated", StaticFiles(directory=GENERATED_DIR), name="generated")

# 漫画格子图（每个格子一个目录，多版本并存）
COMIC_MEDIA_DIR = os.path.join(DATA_DIR, "comic")
os.makedirs(COMIC_MEDIA_DIR, exist_ok=True)
app.mount("/comic-media", StaticFiles(directory=COMIC_MEDIA_DIR), name="comic-media")

# 前端静态文件 —— 挂载子目录，避免根路径挂载拦截 API 路由
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "frontend")
if os.path.exists(frontend_dir):
    app.mount("/css", StaticFiles(directory=os.path.join(frontend_dir, "css")), name="css")
    app.mount("/js", StaticFiles(directory=os.path.join(frontend_dir, "js")), name="js")

    images_dir = os.path.join(frontend_dir, "images")
    os.makedirs(images_dir, exist_ok=True)
    app.mount("/images", StaticFiles(directory=images_dir), name="images")

    admin_dir = os.path.join(frontend_dir, "admin")
    os.makedirs(admin_dir, exist_ok=True)
    app.mount("/admin", StaticFiles(directory=admin_dir, html=True), name="admin")

    @app.get("/", response_class=HTMLResponse)
    async def serve_index():
        index_path = os.path.join(frontend_dir, "index.html")
        if os.path.exists(index_path):
            with open(index_path, "r", encoding="utf-8") as f:
                return HTMLResponse(content=f.read())
        return HTMLResponse(content="<h1>Frontend not found</h1>", status_code=404)

    def _serve_comic():
        page = os.path.join(frontend_dir, "comic.html")
        if os.path.exists(page):
            with open(page, "r", encoding="utf-8") as f:
                resp = HTMLResponse(content=f.read())
                resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
                return resp
        return HTMLResponse(content="<h1>comic.html not found</h1>", status_code=404)

    @app.get("/comic", response_class=HTMLResponse)
    async def serve_comic():
        return _serve_comic()

    @app.get("/comic.html", response_class=HTMLResponse)
    async def serve_comic_html():
        return _serve_comic()
