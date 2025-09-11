export interface Player {
  id: string;
  name: string;
  socketId: string;
  roomId: string;
  isLeader: boolean;
  guesses: Guess[];
  status: 'waiting' | 'playing' | 'won' | 'lost';
  joinTime: Date;
  finishTime?: Date;
  currentRow: number;
  disconnectedAt?: Date; // Track when player disconnected
  isDisconnected?: boolean; // Flag for temporary disconnection
}

export interface Guess {
  word: string;
  result: LetterResult[];
  timestamp: Date;
}

export interface LetterResult {
  letter: string;
  status: 'correct' | 'present' | 'absent';
}

export interface PlayerRanking {
  playerId: string;
  playerName: string;
  guessesUsed: number;
  timeTaken?: number;
  status: 'won' | 'lost';
  rank: number;
}
