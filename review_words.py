#!/usr/bin/env python3
"""Remove specified words from filtered-portuguese-words.txt.

Example: python3 review_words.py MUITO MESMO
"""

import argparse
import os
from pathlib import Path
import tempfile


def write_lines_atomically(path, lines):
    """Replace a UTF-8 text file atomically, retaining its newline convention."""
    path = Path(path)
    newline = "\r\n" if path.exists() and b"\r\n" in path.read_bytes() else "\n"
    contents = newline.join(lines)
    if lines:
        contents += newline

    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as temp_file:
            temp_file.write(contents)
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


def remove_words(words_to_remove, words_path, banned_path):
    words_path = Path(words_path)
    banned_path = Path(banned_path)
    words = words_path.read_text(encoding="utf-8-sig").splitlines()
    banned_text = banned_path.read_text(encoding="utf-8-sig") if banned_path.exists() else ""
    banned = [line.strip() for line in banned_text.splitlines() if line.strip()]
    banned_set = {line.upper() for line in banned if not line.startswith("#")}

    requested = {word.strip().upper() for word in words_to_remove if word.strip()}
    removed = [word for word in words if word.strip().upper() in requested]
    remaining = [word for word in words if word.strip().upper() not in requested]

    for word in removed:
        normalized = word.strip().upper()
        if normalized not in banned_set:
            banned.append(word.strip())
            banned_set.add(normalized)

    if removed:
        write_lines_atomically(banned_path, banned)
        write_lines_atomically(words_path, remaining)

    removed_set = {word.strip().upper() for word in removed}
    not_found = sorted(requested - removed_set)
    print(f"Palavras removidas: {len(removed)}")
    if not_found:
        print("Não encontradas: " + ", ".join(not_found))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    base_dir = Path(__file__).resolve().parent
    parser.add_argument(
        "words_to_remove",
        nargs="+",
        metavar="WORD",
        help="palavra(s) a remover da lista",
    )
    parser.add_argument(
        "--words",
        default=str(base_dir / "filtered-portuguese-words.txt"),
        help="arquivo de palavras a revisar",
    )
    parser.add_argument(
        "--banned-words",
        default=str(base_dir / "palavras_proibidas.txt"),
        help="arquivo onde adicionar palavras removidas",
    )
    args = parser.parse_args()
    remove_words(args.words_to_remove, args.words, args.banned_words)


if __name__ == "__main__":
    main()