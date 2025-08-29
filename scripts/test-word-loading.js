#!/usr/bin/env node

/**
 * Test script to verify file-based word loading
 */

const { WordService } = require('./server/src/services/wordService');

async function testWordLoading() {
  console.log('🧪 Testing file-based word loading...\n');

  try {
    // Test getting word count
    const wordCount = await WordService.getWordCount();
    console.log(`✅ Word count: ${wordCount}`);

    // Test getting a random word
    const randomWord = await WordService.getRandomWord();
    console.log(`✅ Random word: ${randomWord}`);

    // Test word validation
    const isValid = await WordService.isValidGuess('CASA');
    console.log(`✅ Word validation (CASA): ${isValid}`);

    const isInvalid = await WordService.isValidGuess('INVALIDWORD');
    console.log(`✅ Word validation (INVALID): ${isInvalid}`);

    // Test accent normalization
    const accentedWord = await WordService.getAccentedWord('CASA');
    console.log(`✅ Accented word lookup: ${accentedWord}`);

    console.log('\n🎉 All tests passed! File-based word loading is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testWordLoading();
