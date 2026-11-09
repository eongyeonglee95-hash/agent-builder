"""Migration inventory stays independent of large local market observations."""
import base64
import sqlite3

from backend import shared_data_source, storage
from tests.test_shared_data import (
    ROOT, client, data_env, invited, migrate, preview, setup, signing_material,
)


def test_large_observations_preserved_without_blocking_household_migration(client, data_env, monkeypatch):
    limit = 128 * 1024
    monkeypatch.setattr(shared_data_source, "MAX_FINANCIAL_SNAPSHOT_BYTES", limit)
    with sqlite3.connect(storage.DB_PATH) as source:
        source.execute("CREATE TABLE property_obs (id INTEGER PRIMARY KEY, payload BLOB)")
        source.execute("INSERT INTO property_obs VALUES (1,zeroblob(?))", (limit * 4,))
        source.execute("INSERT INTO asset_history VALUES (9,'synthetic','create','{}',1,'2026-01-01')")
        source.execute("INSERT INTO asset_history VALUES (19,'synthetic','delete','{}',2,'2026-01-01')")
        source.execute("DELETE FROM asset_history WHERE event_id=19")
        source.execute("CREATE INDEX history_asset ON asset_history(asset_id)")
    original = storage.DB_PATH.read_bytes()
    assert len(original) > limit
    plan = preview(client, data_env)
    assert storage.DB_PATH.read_bytes() == original
    assert data_env.fake.writes == 0
    archive = data_env.data_store.load_backup(plan["preview_id"])["archive"]
    snapshot = base64.b64decode(archive["financial.sqlite3"])
    assert len(snapshot) <= limit
    with sqlite3.connect(":memory:") as restored:
        restored.deserialize(snapshot)
        names = {r[0] for r in restored.execute("SELECT name FROM sqlite_master")}
        assert "property_obs" not in names
        assert set(shared_data_source.FINANCIAL_TABLES) <= names
        assert "history_asset" in names
        assert restored.execute("SELECT event_id FROM asset_history").fetchall() == [(9,)]
        assert restored.execute("SELECT seq FROM sqlite_sequence WHERE name='asset_history'").fetchone() == (19,)
    # Market collection after review is not a change to the household being moved.
    with sqlite3.connect(storage.DB_PATH) as source:
        source.execute("INSERT INTO property_obs VALUES (2,zeroblob(?))", (limit * 4,))
    after_collection = storage.DB_PATH.read_bytes()
    result, _ = migrate(client, data_env, plan)
    assert result["summary"] == plan["proposed"]
    assert storage.DB_PATH.read_bytes() == after_collection
    assert data_env.fake.writes == 1


def test_oversized_financial_history_still_fails_before_backup_or_remote_write(client, data_env, monkeypatch):
    limit = 128 * 1024
    monkeypatch.setattr(shared_data_source, "MAX_FINANCIAL_SNAPSHOT_BYTES", limit)
    with sqlite3.connect(storage.DB_PATH) as source:
        source.execute("INSERT INTO asset_history VALUES (1,'synthetic','create',zeroblob(?),1,'2026-01-01')",
                       (limit * 2,))
    original = storage.DB_PATH.read_bytes()
    r = client.post(ROOT + "/migration/preview", headers=data_env.headers)
    assert r.status_code == 409
    assert "가계 자료와 이력" in r.json()["detail"]
    assert storage.DB_PATH.read_bytes() == original
    assert data_env.fake.writes == 0
    assert data_env.data_store.backup_list() == []


def test_snapshot_reads_one_wal_version_even_if_financial_rows_change_mid_copy(tmp_path):
    path = tmp_path / "source.sqlite3"
    with sqlite3.connect(path) as writer, sqlite3.connect(":memory:", uri=True) as snapshot:
        writer.execute("PRAGMA journal_mode=WAL")
        writer.execute("CREATE TABLE assets (id INTEGER PRIMARY KEY, value TEXT)")
        writer.execute("CREATE TABLE family (id INTEGER PRIMARY KEY, value TEXT)")
        writer.execute("INSERT INTO assets VALUES (1,'before')")
        writer.execute("INSERT INTO family VALUES (1,'before')")
        writer.commit()
        changed = []

        def during_copy(sql):
            if sql.startswith('INSERT INTO main."family"'):
                with writer:
                    writer.execute("UPDATE assets SET value='after'")
                    writer.execute("UPDATE family SET value='after'")
                changed.append(True)

        snapshot.set_trace_callback(during_copy)
        shared_data_source.financial_snapshot(snapshot, path)
        assert changed == [True]
        for table in ("assets", "family"):
            assert snapshot.execute(f"SELECT value FROM {table}").fetchone() == ("before",)
            assert writer.execute(f"SELECT value FROM {table}").fetchone() == ("after",)
