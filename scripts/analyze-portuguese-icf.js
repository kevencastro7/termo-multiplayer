#!/usr/bin/env node

/**
 * Portuguese Word ICF (Inverse Corpus Frequency) Analyzer
 * Downloads word frequency data and analyzes 5-letter words by ICF ranges
 */

const https = require('https');
const fs = require('fs');

const GITHUB_URL = 'https://raw.githubusercontent.com/fserb/pt-br/refs/heads/master/icf';
const OUTPUT_FILE = 'portuguese-icf-analysis.txt';

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
 * Parse CSV data (word,icf format)
 */
function parseCSVData(csvText) {
  console.log('🔧 Parsing CSV data...');

  const lines = csvText.split('\n').filter(line => line.trim().length > 0);
  const words = [];

  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length === 2) {
      const word = parts[0].trim();
      const icf = parseFloat(parts[1].trim());

      if (word && !isNaN(icf)) {
        words.push({
          word: word.toLowerCase(),
          icf: icf,
          length: word.length
        });
      }
    }
  }

  return words;
}

/**
 * Filter for 5-letter words
 */
function filterFiveLetterWords(words) {
  return words.filter(word => word.length === 5);
}

/**
 * Analyze ICF ranges
 */
function analyzeICFRanges(words) {
  const ranges = [
    { min: 0, max: 5, label: '0-5', description: 'Very common' },
    { min: 5, max: 10, label: '5-10', description: 'Common' },
    { min: 10, max: 15, label: '10-15', description: 'Moderately common' },
    { min: 15, max: 20, label: '15-20', description: 'Less common' },
    { min: 20, max: Infinity, label: '20+', description: 'Rare' }
  ];

  const analysis = {};

  ranges.forEach(range => {
    const count = words.filter(word =>
      word.icf >= range.min && word.icf < range.max
    ).length;

    const percentage = ((count / words.length) * 100).toFixed(1);

    analysis[range.label] = {
      count,
      percentage,
      description: range.description,
      words: words
        .filter(word => word.icf >= range.min && word.icf < range.max)
        .sort((a, b) => a.icf - b.icf)
        .slice(0, 5) // Top 5 examples
    };
  });

  return analysis;
}

/**
 * Generate statistics report
 */
function generateReport(words, analysis) {
  let report = '';

  report += '🇵🇹 Portuguese 5-Letter Word ICF Analysis\n';
  report += '=' .repeat(50) + '\n\n';

  report += `📊 Total 5-letter words analyzed: ${words.length}\n\n`;

  report += '📈 ICF Range Distribution:\n';
  report += '-'.repeat(30) + '\n';

  Object.entries(analysis).forEach(([range, data]) => {
    report += `${range} ICF: ${data.count} words (${data.percentage}%) - ${data.description}\n`;

    if (data.words.length > 0) {
      report += `  Examples: ${data.words.map(w => `${w.word}(${w.icf.toFixed(1)})`).join(', ')}\n`;
    }
    report += '\n';
  });

  // Additional statistics
  report += '📋 Additional Statistics:\n';
  report += '-'.repeat(25) + '\n';

  const avgICF = (words.reduce((sum, word) => sum + word.icf, 0) / words.length).toFixed(2);
  const minICF = Math.min(...words.map(w => w.icf)).toFixed(2);
  const maxICF = Math.max(...words.map(w => w.icf)).toFixed(2);

  report += `Average ICF: ${avgICF}\n`;
  report += `Minimum ICF: ${minICF}\n`;
  report += `Maximum ICF: ${maxICF}\n\n`;

  // Recommendations
  report += '🎯 Recommendations for Termo Game:\n';
  report += '-'.repeat(35) + '\n';
  report += '• Use 5-15 ICF range for balanced difficulty\n';
  report += '• Avoid 0-5 range (too common/easy)\n';
  report += '• Consider 10-20 range for challenging gameplay\n';
  report += '• Mix ranges for varied difficulty levels\n';

  return report;
}

/**
 * Save analysis to file
 */
function saveAnalysis(report, filename) {
  fs.writeFileSync(filename, report, 'utf8');
  console.log(`💾 Analysis saved to ${filename}`);
}

/**
 * Main execution
 */
async function main() {
  try {
    console.log('🇵🇹 Portuguese Word ICF Analyzer');
    console.log('=================================\n');

    // Download data
    const csvData = await downloadFile(GITHUB_URL);

    // Parse and filter
    const allWords = parseCSVData(csvData);
    const fiveLetterWords = filterFiveLetterWords(allWords);

    console.log(`✅ Downloaded ${allWords.length} total words`);
    console.log(`✅ Found ${fiveLetterWords.length} five-letter words`);

    // Analyze ICF ranges
    const analysis = analyzeICFRanges(fiveLetterWords);

    // Generate report
    const report = generateReport(fiveLetterWords, analysis);

    // Save to file
    saveAnalysis(report, OUTPUT_FILE);

    // Display summary
    console.log('\n📊 Quick Summary:');
    console.log(`Total 5-letter words: ${fiveLetterWords.length}`);

    Object.entries(analysis).forEach(([range, data]) => {
      console.log(`${range} ICF: ${data.count} words (${data.percentage}%)`);
    });

    console.log('\n✅ Analysis complete!');
    console.log(`📁 Full report saved to: ${OUTPUT_FILE}`);

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
  parseCSVData,
  filterFiveLetterWords,
  analyzeICFRanges,
  generateReport
};
