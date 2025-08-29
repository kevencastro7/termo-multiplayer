import { Player, Guess, LetterResult, PlayerRanking } from '../models/Player';
import { Game } from '../models/Room';
import { WordService } from './wordService';

export class GameService {
  /**
   * Validate a guess and return the result
   */
  static validateGuess(guess: string, targetWord: string): LetterResult[] {
    const normalizedGuess = WordService.normalizeWord(guess);
    const normalizedTarget = WordService.normalizeWord(targetWord);

    if (!WordService.isValidGuess(guess)) {
      throw new Error('Palavra inválida');
    }

    const result: LetterResult[] = [];
    const targetLetters = normalizedTarget.split('');
    const guessLetters = normalizedGuess.split('');
    const originalGuessLetters = guess.split('');

    // First pass: mark correct positions (using normalized comparison)
    const remainingTargetLetters: string[] = [];
    const remainingGuessLetters: string[] = [];
    const remainingPositions: number[] = [];

    for (let i = 0; i < 5; i++) {
      if (guessLetters[i] === targetLetters[i]) {
        result[i] = { letter: originalGuessLetters[i], status: 'correct' };
      } else {
        remainingTargetLetters.push(targetLetters[i]);
        remainingGuessLetters.push(guessLetters[i]);
        remainingPositions.push(i);
        result[i] = { letter: originalGuessLetters[i], status: 'absent' };
      }
    }

    // Second pass: mark present letters (using normalized comparison)
    for (let i = 0; i < remainingGuessLetters.length; i++) {
      const guessLetter = remainingGuessLetters[i];
      const position = remainingPositions[i];
      const targetIndex = remainingTargetLetters.indexOf(guessLetter);

      if (targetIndex !== -1) {
        // Mark as present and remove from remaining letters
        result[position].status = 'present';
        remainingTargetLetters.splice(targetIndex, 1);
      }
    }

    return result;
  }

  /**
   * Check if a player has won
   */
  static hasPlayerWon(guessResult: LetterResult[]): boolean {
    return guessResult.every(letter => letter.status === 'correct');
  }

  /**
   * Check if a player has lost (used all guesses)
   */
  static hasPlayerLost(player: Player): boolean {
    return player.guesses.length >= 6 && !this.hasPlayerWon(player.guesses[player.guesses.length - 1]?.result || []);
  }

  /**
   * Calculate rankings for all players
   */
  static calculateRankings(players: Player[], gameStartTime: Date): PlayerRanking[] {
    const rankings: PlayerRanking[] = players.map(player => {
      const guessesUsed = player.guesses.length;
      const timeTaken = player.finishTime
        ? player.finishTime.getTime() - gameStartTime.getTime()
        : undefined;

      return {
        playerId: player.id,
        playerName: player.name,
        guessesUsed,
        timeTaken,
        status: player.status === 'won' ? 'won' : 'lost',
        rank: 0 // Will be set after sorting
      };
    });

    // Sort by status (winners first), then by guesses, then by time
    rankings.sort((a, b) => {
      // Winners before losers
      if (a.status === 'won' && b.status === 'lost') return -1;
      if (a.status === 'lost' && b.status === 'won') return 1;

      // If both won or both lost, compare by guesses
      if (a.guessesUsed !== b.guessesUsed) {
        return a.guessesUsed - b.guessesUsed;
      }

      // If same guesses, compare by time (if both finished)
      if (a.timeTaken && b.timeTaken) {
        return a.timeTaken - b.timeTaken;
      }

      // If one finished and other didn't, finished player ranks higher
      if (a.timeTaken && !b.timeTaken) return -1;
      if (!a.timeTaken && b.timeTaken) return 1;

      return 0;
    });

    // Assign ranks
    rankings.forEach((ranking, index) => {
      ranking.rank = index + 1;
    });

    return rankings;
  }

  /**
   * Check if the game should end
   */
  static shouldGameEnd(players: Player[]): boolean {
    return players.every(player =>
      player.status === 'won' || player.status === 'lost'
    );
  }

  /**
   * Create a new guess object
   */
  static createGuess(word: string, result: LetterResult[]): Guess {
    return {
      word: word.toUpperCase(),
      result,
      timestamp: new Date()
    };
  }

  /**
   * Update player after a guess
   */
  static updatePlayerAfterGuess(player: Player, guess: Guess): Player {
    const updatedPlayer = { ...player };
    updatedPlayer.guesses = [...player.guesses, guess];
    updatedPlayer.currentRow = player.guesses.length + 1;

    if (this.hasPlayerWon(guess.result)) {
      updatedPlayer.status = 'won';
      updatedPlayer.finishTime = new Date();
    } else if (updatedPlayer.guesses.length >= 6) {
      updatedPlayer.status = 'lost';
      updatedPlayer.finishTime = new Date();
    }

    return updatedPlayer;
  }

  /**
   * Get game statistics
   */
  static getGameStats(game: Game) {
    const totalPlayers = game.players.length;
    const finishedPlayers = game.players.filter(p => p.status === 'won' || p.status === 'lost').length;
    const winners = game.players.filter(p => p.status === 'won').length;

    return {
      totalPlayers,
      finishedPlayers,
      winners,
      isComplete: this.shouldGameEnd(game.players)
    };
  }
}
