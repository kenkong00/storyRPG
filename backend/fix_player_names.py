"""一次性脚本：把玩家运行时角色(user_characters)的 custom_name 还原为对应模板人物(characters)的名字。

背景：之前允许玩家在扮演角色时自定义改名，造成玩家显示名与剧情/称呼不一致。
现改为「强制使用角色名、禁止改名」。本脚本负责把历史已改名的记录改回角色名。

用法（在 backend 目录下执行）：
    python fix_player_names.py
"""
import os
import sqlite3

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "rpg_game.db")


def main():
    if not os.path.exists(DB):
        print("未找到数据库文件:", DB)
        return

    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA busy_timeout=5000")  # 后端可能在跑，等待其释放写锁
    cur = conn.cursor()

    rows = cur.execute(
        "SELECT uc.id, uc.custom_name, uc.base_character_id FROM user_characters uc"
    ).fetchall()

    updated = 0
    skipped_no_base = 0
    for uc_id, cur_name, base_id in rows:
        if not base_id:
            skipped_no_base += 1
            continue
        res = cur.execute("SELECT name FROM characters WHERE id=?", (base_id,)).fetchone()
        base_name = res[0] if res else None
        if not base_name:
            # 模板角色已不存在，保留原值，不强行改
            continue
        if base_name != cur_name:
            print(f"  uc#{uc_id}: 旧名 '{cur_name}' -> 角色名 '{base_name}'")
            cur.execute(
                "UPDATE user_characters SET custom_name=? WHERE id=?",
                (base_name, uc_id),
            )
            updated += 1

    conn.commit()
    conn.close()
    print(f"完成：更新 {updated} 条；跳过 {skipped_no_base} 条（无 base_character_id）。")


if __name__ == "__main__":
    main()
