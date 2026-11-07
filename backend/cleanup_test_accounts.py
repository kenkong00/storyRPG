"""一次性清理：删除除 kong(id=2) 外的全部测试账号及其关联数据。

保留：
  - 用户 kong(id=2) 及其 user_characters 实例
  - characters 角色模板表（6 个，不动）
  - 其余业务表（故事/战斗/卡牌等）不受影响

删除顺序（依赖 user_id / user_character_id）：
  child(按 user_character_id): card_battles, battles,
      user_character_equipments, user_character_inventory, user_character_skill_books
  user_characters(按 user_id)
  user_game_library(按 user_id)
  users(按 id, 除 kong)
"""
import sqlite3
import os

DB = os.path.join(os.path.dirname(__file__), "data", "rpg_game.db")
KEEP_USER_ID = 2  # kong


def cnt(c, sql, args=()):
    return c.execute(sql, args).fetchone()[0]


def main():
    c = sqlite3.connect(DB)
    c.execute("PRAGMA foreign_keys=ON")

    # 受影响的账号
    test_ids = [r[0] for r in c.execute(
        "SELECT id FROM users WHERE id <> ?", (KEEP_USER_ID,))]
    print(f"待删除测试账号数: {len(test_ids)}  (保留 kong id={KEEP_USER_ID})")

    if not test_ids:
        print("无需删除，退出。")
        return

    ph = ",".join("?" * len(test_ids))

    # 这些账号名下的 user_character id
    uc_ids = [r[0] for r in c.execute(
        f"SELECT id FROM user_characters WHERE user_id IN ({ph})", test_ids)]
    print(f"待删除 user_characters(玩家实例)数: {len(uc_ids)}")

    print("\n=== 删除前计数 ===")
    print("users:", cnt(c, "SELECT COUNT(*) FROM users"))
    print("user_characters:", cnt(c, "SELECT COUNT(*) FROM user_characters"))
    print("kong 的 user_characters:",
          cnt(c, "SELECT COUNT(*) FROM user_characters WHERE user_id=?", (KEEP_USER_ID,)))

    # 1) 子表（按 user_character_id）
    if uc_ids:
        uph = ",".join("?" * len(uc_ids))
        # 这些账号名下的战斗 id（battles 引用 user_characters）
        battle_ids = [r[0] for r in c.execute(
            f"SELECT id FROM battles WHERE user_character_id IN ({uph})", uc_ids)]
        bph = ",".join("?" * len(battle_ids)) if battle_ids else None

        # 1a) 先删 battle_turns（它引用 battles.battle_id，是 battles 的子表）
        if battle_ids:
            n = c.execute(
                f"DELETE FROM battle_turns WHERE battle_id IN ({bph})", battle_ids)
            print(f"  删除 battle_turns: {n.rowcount} 行")

        # 1b) 其余按 user_character_id 的子表
        for t in ("card_battles", "battles",
                  "user_character_equipments", "user_character_inventory",
                  "user_character_skill_books"):
            n = c.execute(
                f"DELETE FROM {t} WHERE user_character_id IN ({uph})", uc_ids)
            print(f"  删除 {t}: {n.rowcount} 行")

    # 2) user_characters（按 user_id）
    n = c.execute(
        f"DELETE FROM user_characters WHERE user_id IN ({ph})", test_ids)
    print(f"  删除 user_characters: {n.rowcount} 行")

    # 3) user_game_library（按 user_id）
    n = c.execute(
        f"DELETE FROM user_game_library WHERE user_id IN ({ph})", test_ids)
    print(f"  删除 user_game_library: {n.rowcount} 行")

    # 4) users（除 kong）
    n = c.execute(
        f"DELETE FROM users WHERE id IN ({ph})", test_ids)
    print(f"  删除 users: {n.rowcount} 行")

    c.commit()

    print("\n=== 删除后计数 ===")
    print("users:", cnt(c, "SELECT COUNT(*) FROM users"))
    print("user_characters:", cnt(c, "SELECT COUNT(*) FROM user_characters"))
    print("kong 的 user_characters:",
          cnt(c, "SELECT COUNT(*) FROM user_characters WHERE user_id=?", (KEEP_USER_ID,)))
    print("characters(模板,应不变):", cnt(c, "SELECT COUNT(*) FROM characters"))
    print("\n清理完成。")


if __name__ == "__main__":
    main()
