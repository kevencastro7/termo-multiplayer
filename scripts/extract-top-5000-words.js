#!/usr/bin/env node

/**
 * Extract Top 5000 Most Common Portuguese 5-Letter Words
 * Uses ICF (Inverse Corpus Frequency) data to select most common words
 */

const https = require('https');
const fs = require('fs');

const GITHUB_URL = 'https://raw.githubusercontent.com/fserb/pt-br/refs/heads/master/icf';
const TOP_WORDS_COUNT = 5000;

/**
 * Download file from URL
 */
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    console.log('📥 Downloading Portuguese word frequency data...');

    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        resolve(data);
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Parse CSV data and extract 5-letter words
 */
function parseAndFilterWords(csvText) {
  console.log('🔧 Parsing and filtering words...');

  const lines = csvText.split('\n').filter(line => line.trim().length > 0);
  const fiveLetterWords = [];

  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length === 2) {
      const word = parts[0].trim();
      const icf = parseFloat(parts[1].trim());

      if (word && word.length === 5 && !isNaN(icf)) {
        fiveLetterWords.push({
          word: word.toUpperCase(),
          icf: icf
        });
      }
    }
  }

  return fiveLetterWords;
}

/**
 * Sort by ICF (lower = more common) and take top N
 */
function getTopWords(words, count) {
  console.log(`🎯 Selecting top ${count} most common words...`);

  return words
    .sort((a, b) => a.icf - b.icf) // Lower ICF = more common
    .slice(0, count);
}

/**
 * Generate WordService integration
 */
function generateWordServiceIntegration(words) {
  const wordStrings = words.map(word => `  '${word.word}'`);

  return `// Portuguese words with accents (top ${words.length} most common 5-letter words)
// Generated from ICF frequency data: https://raw.githubusercontent.com/fserb/pt-br/refs/heads/master/icf
// Sorted by frequency (lower ICF = more common)
// Generated on: ${new Date().toISOString()}

const ACCENTED_WORDS = [
${wordStrings.join(',\n')}
];

const VALID_GUESSES = [
  ...ACCENTED_WORDS
];

export class WordService {
  private static words: string[] = ACCENTED_WORDS;
  private static validGuesses: Set<string> = new Set(VALID_GUESSES);
  private static normalizedMap: Map<string, string> = new Map();

  // Initialize normalized map
  private static initializeNormalizedMap() {
    if (this.normalizedMap.size === 0) {
      this.words.forEach(word => {
        const normalized = this.normalizeWord(word);
        this.normalizedMap.set(normalized, word);
      });
    }
  }

  /**
   * Get a random word for the game
   */
  static getRandomWord(): string {
    const randomIndex = Math.floor(Math.random() * this.words.length);
    return this.words[randomIndex].toUpperCase();
  }

  /**
   * Check if a word is valid for guessing (supports accent normalization)
   */
  static isValidGuess(word: string): boolean {
    const normalizedInput = this.normalizeWord(word);
    this.initializeNormalizedMap();
    return this.normalizedMap.has(normalizedInput);
  }

  /**
   * Get the accented version of a word from normalized input
   */
  static getAccentedWord(normalizedWord: string): string | null {
    this.initializeNormalizedMap();
    return this.normalizedMap.get(normalizedWord.toUpperCase()) || null;
  }

  /**
   * Check if a word is in the solution dictionary
   */
  static isValidSolution(word: string): boolean {
    return this.words.includes(word.toLowerCase());
  }

  /**
   * Get all valid words (for debugging)
   */
  static getAllWords(): string[] {
    return [...this.words];
  }

  /**
   * Get word count
   */
  static getWordCount(): number {
    return this.words.length;
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
      .replace(/[\\u0300-\\u036f]/g, ''); // Remove accents
  }
}`;
}

/**
 * Generate statistics
 */
function generateStats(words) {
  console.log('\n📊 Top 5000 Words Statistics:');
  console.log(`Total words: ${words.length}`);
  console.log(`ICF range: ${words[0].icf.toFixed(2)} - ${words[words.length - 1].icf.toFixed(2)}`);
  console.log(`Average ICF: ${(words.reduce((sum, word) => sum + word.icf, 0) / words.length).toFixed(2)}`);

  console.log('\n📝 Sample words:');
  console.log('First 10:', words.slice(0, 10).map(w => w.word).join(', '));
  console.log('Last 10:', words.slice(-10).map(w => w.word).join(', '));

  // Count accented words
  const accentedWords = words.filter(word =>
    /[ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ]/.test(word.word)
  );
  console.log(`Words with accents: ${accentedWords.length} (${((accentedWords.length / words.length) * 100).toFixed(1)}%)`);
}

/**
 * Save files
 */
function saveFiles(words, wordServiceCode) {
  // Save word list
  const wordList = words.map(w => w.word).join('\n');
  fs.writeFileSync('top-5000-portuguese-words.txt', wordList, 'utf8');
  console.log('💾 Saved word list to top-5000-portuguese-words.txt');

  // Save WordService integration
  fs.writeFileSync('wordService-top-5000.ts', wordServiceCode, 'utf8');
  console.log('💾 Saved WordService integration to wordService-top-5000.ts');
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('🇵🇹 Top 5000 Portuguese 5-Letter Words Extractor');
    console.log('=================================================\n');

    // Download data
    const csvData = await downloadFile(GITHUB_URL);

    // Parse and filter
    const fiveLetterWords = parseAndFilterWords(csvData);
    console.log(`✅ Found ${fiveLetterWords.length} five-letter words`);

    // Get top 5000 most common
    const topWords = getTopWords(fiveLetterWords, TOP_WORDS_COUNT);
    console.log(`✅ Selected top ${topWords.length} most common words`);

    // Generate WordService code
    const wordServiceCode = generateWordServiceIntegration(topWords);

    // Save files
    saveFiles(topWords, wordServiceCode);

    // Generate statistics
    generateStats(topWords);

    console.log('\n✅ Extraction complete!');
    console.log('📁 Files generated:');
    console.log('  • top-5000-portuguese-words.txt');
    console.log('  • wordService-top-5000.ts');
    console.log('\n🚀 Ready to integrate into your Termo game!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  downloadFile,
  parseAndFilterWords,
  getTopWords,
  generateWordServiceIntegration
};
