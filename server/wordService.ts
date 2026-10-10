import fs from 'node:fs';
import path from 'node:path';

const WORDS_FILE_PATH = path.resolve(process.cwd(), 'filtered-portuguese-words.txt');

export class WordService {
  private static allWords: string[] | null = null;
  private static targetWords: string[] | null = null;
  private static normalizedMap: Map<string, string> | null = null;

  private static load(): void {
    if (this.allWords) return;
    const words = fs.readFileSync(WORDS_FILE_PATH, 'utf8').split(/\r?\n/)
      .map((word) => word.trim().toLocaleUpperCase('pt-BR'))
      .filter((word) => [...word].length === 5 && this.isValidFormat(word));
    if (!words.length) throw new Error(`No valid words found at ${WORDS_FILE_PATH}`);
    this.allWords = [...new Set(words)];
    this.targetWords = this.allWords.slice(0, 2000);
    this.normalizedMap = new Map(this.allWords.map((word) => [this.normalizeWord(word), word]));
    console.info(`Loaded ${this.allWords.length} guess words; ${this.targetWords.length} target words.`);
  }

  static normalizeWord(word: string): string {
    return word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('pt-BR');
  }
  static isValidFormat(word: string): boolean {
    return [...word].length === 5 && /^[A-ZÀ-ÖØ-Þ]+$/iu.test(word);
  }
  static isValidGuess(word: string): boolean {
    this.load();
    return !!this.normalizedMap?.has(this.normalizeWord(word));
  }
  static getCanonicalWord(word: string): string | undefined {
    this.load();
    return this.normalizedMap?.get(this.normalizeWord(word));
  }
  static getRandomWord(): string {
    this.load();
    const words = this.targetWords!;
    return words[Math.floor(Math.random() * words.length)];
  }
  static score(guess: string, solution: string): ('correct' | 'present' | 'absent')[] {
    const g = [...this.normalizeWord(guess)];
    const s = [...this.normalizeWord(solution)];
    const result: ('correct' | 'present' | 'absent')[] = Array(5).fill('absent');
    const remaining = new Map<string, number>();
    for (let i = 0; i < 5; i++) {
      if (g[i] === s[i]) result[i] = 'correct';
      else remaining.set(s[i], (remaining.get(s[i]) ?? 0) + 1);
    }
    for (let i = 0; i < 5; i++) {
      if (result[i] === 'correct') continue;
      const count = remaining.get(g[i]) ?? 0;
      if (count > 0) { result[i] = 'present'; remaining.set(g[i], count - 1); }
    }
    return result;
  }
}