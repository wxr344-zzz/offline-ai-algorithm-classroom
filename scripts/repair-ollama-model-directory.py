"""Repair the inspected Ollama desktop model-directory setting, not chat data.

Run only with the Ollama desktop app stopped. The old setting is backed up;
the conditional UPDATE refuses an intervening settings edit.
"""
import argparse
import json
import sqlite3
from pathlib import Path


def repair(database: Path, directory: Path, backup: Path, *, apply: bool = False):
    if not directory.is_absolute() or not directory.is_dir():
        raise ValueError('Model directory must be an existing absolute directory')
    manifest = directory / 'manifests/registry.ollama.ai/library/qwen2.5-coder/7b'
    if not manifest.is_file():
        raise ValueError('The inspected existing model manifest was not found')
    # URI read-only mode prevents accidentally creating a database at a typo.
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as connection:
        row = connection.execute('SELECT models FROM settings WHERE id=1').fetchone()
    if row != ('OllamaModels',):
        if row == (str(directory),): return {'changed': False, 'directory': str(directory)}
        raise ValueError('Setting differs from the inspected value; refusing to overwrite')
    if not apply: return {'changed': False, 'old': row[0], 'proposed': str(directory)}
    snapshot = {'database': str(database.resolve()), 'id': 1, 'models': row[0]}
    with backup.open('x', encoding='utf-8') as output:
        json.dump(snapshot, output, ensure_ascii=False, indent=2)
    with sqlite3.connect(database.resolve().as_uri() + '?mode=rw', uri=True) as connection:
        connection.execute('BEGIN IMMEDIATE')
        updated = connection.execute('UPDATE settings SET models=? WHERE id=1 AND models=?',
                                     (str(directory), row[0]))
        if updated.rowcount != 1:
            raise ValueError('Concurrent settings change; no repair applied')
    return {'changed': True, 'directory': str(directory), 'backup': str(backup)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    options = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    print(json.dumps(repair(Path.home() / 'AppData/Local/Ollama/db.sqlite',
        Path.home() / 'OllamaModels', root / 'logs/ollama-model-directory-before-20261019.json',
        apply=options.apply), ensure_ascii=True))
