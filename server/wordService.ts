import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const WORDS_FILE_PATH = path.resolve(process.cwd(), 'word-statuses.json');

interface WordStatusEntry {
  word: string;
  status: 'approved' | 'pending' | 'banned';
}

export class WordService {
  private static allWords: string[] | null = null;
  private static targetWords: string[] | null = null;
  private static normalizedMap: Map<string, string> | null = null;
  private static pool: Pool | null = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, ...(process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}) })
    : null;

  static async initialize(): Promise<void> {
    if (this.allWords) return;
    if (process.env.NODE_ENV === 'production' && !this.pool) {
      throw new Error('DATABASE_URL must be configured in production.');
    }
    let entries: unknown;
    if (this.pool) {
      const { rows } = await this.pool.query<{ word: string; status: WordStatusEntry['status'] }>(
        `SELECT word, CASE WHEN decision = 'approved' THEN 'approved' WHEN decision = 'banned' THEN 'banned' ELSE 'pending' END AS status FROM reviewed_words ORDER BY position, word`,
      );
      entries = rows;
    } else {
      entries = JSON.parse(fs.readFileSync(WORDS_FILE_PATH, 'utf8'));
    }
    if (!Array.isArray(entries)) throw new Error(`Expected an array of word statuses at ${WORDS_FILE_PATH}`);

    const validEntries = entries.filter((entry): entry is WordStatusEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const candidate = entry as Partial<WordStatusEntry>;
      return typeof candidate.word === 'string'
        && ['approved', 'pending', 'banned'].includes(candidate.status ?? '')
        && this.isValidFormat(candidate.word.trim().toLocaleUpperCase('pt-BR'));
    });
    if (!validEntries.length) throw new Error(`No valid words found at ${WORDS_FILE_PATH}`);

    const normalizeEntry = ({ word }: WordStatusEntry) => word.trim().toLocaleUpperCase('pt-BR');
    this.allWords = [...new Set(validEntries.map(normalizeEntry))];
    this.targetWords = [...new Set(validEntries
      .filter(({ status }) => status === 'approved')
      .map(normalizeEntry))];
    if (!this.targetWords.length) throw new Error(`No approved target words found at ${WORDS_FILE_PATH}`);
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
    if (!this.normalizedMap) throw new Error('WordService has not been initialized.');
    return this.normalizedMap.has(this.normalizeWord(word));
  }
  static getCanonicalWord(word: string): string | undefined {
    return this.normalizedMap?.get(this.normalizeWord(word));
  }
  static getRandomWord(): string {
    if (!this.targetWords) throw new Error('WordService has not been initialized.');
    const words = this.targetWords!;
    return words[Math.floor(Math.random() * words.length)];
  }
  static getRandomWordExcluding(excludedWords: ReadonlySet<string>): string | undefined {
    if (!this.targetWords) throw new Error('WordService has not been initialized.');
    const available = this.targetWords!.filter((word) => !excludedWords.has(word));
    if (!available.length) return undefined;
    return available[Math.floor(Math.random() * available.length)];
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