// Portuguese Word Service - File-based loading
// Loads words from top-5000-portuguese-words.txt at runtime
// Words sourced from ICF frequency data: https://raw.githubusercontent.com/fserb/pt-br/refs/heads/master/icf

import * as fs from 'fs';
import * as path from 'path';

const WORDS_FILE_PATH = path.join(__dirname, '../../filtered-portuguese-words.txt');

export class WordService {
  private static allWords: string[] | null = null; // All words for validation
  private static targetWords: string[] | null = null; // First 2000 words for target selection
  private static validGuesses: Set<string> | null = null;
  private static normalizedMap: Map<string, string> | null = null;
  private static initialized = false;

  /**
   * Load words from file (lazy loading)
   */
  private static async loadWordsFromFile(): Promise<void> {
    if (this.allWords !== null) return; // Already loaded

    try {
      const fileContent = fs.readFileSync(WORDS_FILE_PATH, 'utf8');
      const words = fileContent
        .split('\n')
        .map(word => word.trim())
        .filter(word => word.length === 5 && word.length > 0);

      this.allWords = words;
      this.targetWords = words.slice(0, 2000); // First 2000 words for target selection
      this.validGuesses = new Set(words);
      console.log(`✅ Loaded ${words.length} Portuguese words from file`);
      console.log(`✅ Using first ${this.targetWords.length} words for target selection`);
    } catch (error) {
      console.error('❌ Error loading words file:', error);
      // Fallback to empty arrays
      this.allWords = [];
      this.targetWords = [];
      this.validGuesses = new Set();
    }
  }

  /**
   * Ensure words are loaded before use
   */
  private static async ensureLoaded(): Promise<void> {
    if (!this.initialized) {
      await this.loadWordsFromFile();
      this.initialized = true;
    }
  }

  /**
   * Initialize normalized map
   */
  private static initializeNormalizedMap(): void {
    if (this.normalizedMap !== null) return;

    this.normalizedMap = new Map();
    if (this.allWords) {
      this.allWords.forEach(word => {
        const normalized = this.normalizeWord(word);
        this.normalizedMap!.set(normalized, word);
      });
    }
  }

  /**
   * Get a random word for the game (from first 2000 words only)
   */
  static async getRandomWord(): Promise<string> {
    await this.ensureLoaded();
    if (!this.targetWords || this.targetWords.length === 0) return '';
    const randomIndex = Math.floor(Math.random() * this.targetWords.length);
    return this.targetWords[randomIndex].toUpperCase();
  }

  /**
   * Check if a word is valid for guessing (supports accent normalization, uses all words)
   */
  static async isValidGuess(word: string): Promise<boolean> {
    await this.ensureLoaded();
    const normalizedInput = this.normalizeWord(word);
    this.initializeNormalizedMap();
    return this.normalizedMap?.has(normalizedInput) || false;
  }

  /**
   * Get the accented version of a word from normalized input
   */
  static async getAccentedWord(normalizedWord: string): Promise<string | null> {
    await this.ensureLoaded();
    this.initializeNormalizedMap();
    return this.normalizedMap?.get(normalizedWord.toUpperCase()) || null;
  }

  /**
   * Check if a word is in the solution dictionary (target words only)
   */
  static async isValidSolution(word: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.targetWords?.includes(word.toLowerCase()) || false;
  }

  /**
   * Get all valid words (for debugging)
   */
  static async getAllWords(): Promise<string[]> {
    await this.ensureLoaded();
    return this.allWords ? [...this.allWords] : [];
  }

  /**
   * Get target words (first 2000 words)
   */
  static async getTargetWords(): Promise<string[]> {
    await this.ensureLoaded();
    return this.targetWords ? [...this.targetWords] : [];
  }

  /**
   * Get word count
   */
  static async getWordCount(): Promise<number> {
    await this.ensureLoaded();
    return this.allWords?.length || 0;
  }

  /**
   * Get target word count
   */
  static async getTargetWordCount(): Promise<number> {
    await this.ensureLoaded();
    return this.targetWords?.length || 0;
  }

  /**
   * Validate word format (5 letters, only Portuguese characters)
   */
  static isValidFormat(word: string): boolean {
    if (word.length !== 5) return false;

    // Allow only Portuguese letters (including ç, ã, õ, etc.)
    const portugueseRegex = /^[a-zA-ZçãõâêôîûáéíóúàèìòùäëïöüÇÃÕÂÊÔÎÛÁÉÍÓÚÀÈÌÒÙÄËÏÖÜ]+$/;
    return portugueseRegex.test(word);
  }

  /**
   * Normalize word for comparison (remove accents, convert to uppercase)
   */
  static normalizeWord(word: string): string {
    return word
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // Remove accents
  }
}
