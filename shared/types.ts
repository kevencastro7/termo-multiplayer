export type TileStatus = 'correct' | 'present' | 'absent';
export type GameMode = 'TERMO' | 'DUETO' | 'QUARTETO' | 'QUARTETO_SEQUENCIAL' | 'SEQUENCIA' | (string & {});
export interface GuessView { word: string; result: TileStatus[]; results?: Array<TileStatus[] | null>; revealedWord?: string }
export interface PublicPlayer {
  id: string; name: string; attempts: number; status: 'playing' | 'won' | 'lost' | 'waiting';
  isHost: boolean; rank?: number; wins: number; returnedToLobby?: boolean;
  guessesUsed?: number; elapsedMs?: number; wordsSolved?: number; wordIndex?: number; wordCount?: number;
}
export interface MatchView {
  code: string; phase: 'lobby' | 'playing' | 'finished'; players: PublicPlayer[];
  gameMode: GameMode; durationMinutes: number; sequenceLength: number;
  quartetoRevealedBoards?: number;
  guesses: GuessView[]; sequenceProgress?: Array<{ guesses: GuessView[]; attempts: number; solved: boolean }>; endsAt: number | null; remainingMs: number; winsRanking: PublicPlayer[]; guessLimit: number;
  solution?: string; solutions?: string[]; ranking?: PublicPlayer[]; me: string;
}
export interface RoomSummary { code: string; playerCount: number; capacity: number; phase: RoomPhase; gameMode: GameMode; durationMinutes: number }
export type RoomPhase = MatchView['phase'];
export interface ServerToClientEvents {
  'match:state': (match: MatchView) => void;
  'match:error': (message: string) => void;
  'match:notice': (message: string) => void;
  'rooms:state': (rooms: RoomSummary[]) => void;
}
export interface ClientToServerEvents {
  'rooms:list': (callback: (rooms: RoomSummary[]) => void) => void;
  'room:create': (payload: { name: string; gameMode: GameMode; durationMinutes: number; sequenceLength?: number }, callback: (result: { code?: string; playerId?: string; resumeToken?: string; error?: string }) => void) => void;
  'room:join': (payload: { code: string; name: string }, callback: (result: { playerId?: string; resumeToken?: string; error?: string }) => void) => void;
  'room:update-settings': (payload: { gameMode: GameMode; durationMinutes: number; sequenceLength?: number }) => void;
  'room:resume': (payload: { playerId: string; resumeToken: string }, callback: (result: { state?: MatchView; error?: string }) => void) => void;
  'match:start': () => void;
  'match:give-up': () => void;
  'match:select-word': (payload: { wordIndex: number }) => void;
  'room:return-lobby': () => void;
  'guess:submit': (payload: { word: string }) => void;
  'room:leave': () => void;
}