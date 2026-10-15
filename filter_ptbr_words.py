#!/usr/bin/env python3
"""Filter common five-letter Brazilian Portuguese words from fserb/pt-br.

Preserves the original ICF file order. If words differ only by accentuation or
cedilla, keeps the spelling with the lowest ICF score (most common); ties keep
the first spelling in the source.
"""
import argparse
from pathlib import Path
import re
import unicodedata
import urllib.request
from urllib.parse import quote

BASE = "https://raw.githubusercontent.com/fserb/pt-br/refs/heads/master/"
URLS = {
    "icf": BASE + "icf",
    # quote() avoids UnicodeEncodeError with accented filenames in HTTP requests.
    "conjugacoes": BASE + quote("conjugações", safe=""),
    "verbos": BASE + "listas/verbos",
}

def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "pt-br-word-filter/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read().decode("utf-8-sig", errors="replace")
    except Exception as exc:
        raise RuntimeError(f"Falha ao baixar URL {url!r}: {exc}") from exc

def parse_icf(text):
    entries = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = re.split(r"[\t,; ]+", line)
        if len(parts) < 2:
            continue
        for word, score in ((parts[0], parts[1]), (parts[-1], parts[0])):
            try:
                value = float(score.replace(",", "."))
            except ValueError:
                continue
            if re.fullmatch(r"[A-Za-zÀ-ÖØ-öø-ÿ]+", word):
                entries.append((word, value))
                break
    return entries

def parse_conjugations(text):
    words = set()
    for line in text.splitlines():
        for token in re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ]+", line):
            words.add(token.casefold())
    return words

def parse_infinitives(text):
    return {
        line.strip().casefold()
        for line in text.splitlines()
        if line.strip()
    }

def spelling_key(word):
    # Strip combining diacritics so ç/c and accented/unaccented forms group.
    normalized = unicodedata.normalize("NFD", word.casefold())
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")

def load_banned_words(path):
    try:
        text = Path(path).read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise RuntimeError(f"Não foi possível ler a lista de palavras proibidas {path!r}: {exc}") from exc
    return {
        spelling_key(line.strip())
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-icf", type=float, default=8.0,
                        help="keep words with ICF <= this value (default: 8)")
    parser.add_argument("--length", type=int, default=5,
                        help="keep words of exactly this many letters (default: 5)")
    parser.add_argument("--output", default="palavras_comuns_5_letras.txt")
    parser.add_argument(
        "--banned-words",
        default=str(Path(__file__).with_name("palavras_proibidas.txt")),
        help="arquivo de palavras a excluir (default: palavras_proibidas.txt ao lado do script)",
    )
    args = parser.parse_args()

    banned_words = load_banned_words(args.banned_words)

    print("Baixando a lista ICF...")
    entries = parse_icf(fetch(URLS["icf"]))
    print("Baixando a lista de conjugações...")
    print(f"URL de conjugações: {URLS['conjugacoes']}")
    conjugations = parse_conjugations(fetch(URLS["conjugacoes"]))
    print("Baixando a lista de verbos no infinitivo...")
    infinitives = parse_infinitives(fetch(URLS["verbos"]))

    # Keep the most common eligible spelling for each accent-insensitive key,
    # while separating ordinary words from prohibited words and conjugations.
    best = {}
    for index, (word, score) in enumerate(entries):
        if len(word) != args.length or score > args.max_icf:
            continue
        key = spelling_key(word)
        is_infinitive = word.casefold() in infinitives
        is_conjugated = word.casefold() in conjugations and not is_infinitive
        is_deprioritized = key in banned_words or is_conjugated
        if key not in best or score < best[key][1]:
            best[key] = (word, score, index, is_deprioritized)

    # Preserve ICF order within each group; prohibited words and conjugations
    # remain available, but are placed after ordinary words.
    ordered = sorted(best.values(), key=lambda item: item[2])
    words = [word.upper() for word, score, index, deprioritized in ordered
             if not deprioritized]
    words.extend(word.upper() for word, score, index, deprioritized in ordered
                 if deprioritized)

    with open(args.output, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(words))
        if words:
            f.write("\n")

    print(f"Arquivo criado: {args.output}")
    print(f"Palavras únicas: {len(words)}")
    print(f"Tamanho exigido: {args.length} letras")
    print(f"Limite ICF: {args.max_icf}")
    print("Palavras proibidas e formas conjugadas foram mantidas no final; infinitivos ficam no grupo principal.")

if __name__ == "__main__":
    main()
