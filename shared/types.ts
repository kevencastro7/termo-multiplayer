export type TileStatus = 'correct' | 'present' | 'absent';
export interface GuessView { word: string; result: TileStatus[] }
export interface PublicPlayer {
  id: string; name: string; attempts: number; status: 'playing' | 'won' | 'lost' | 'waiting';
  isHost: boolean;
  guessesUsed?: number; elapsedMs?: number;
}
export interface MatchView {
  code: string; phase: 'lobby' | 'playing' | 'finished'; players: PublicPlayer[];
  guesses: GuessView[]; endsAt: number | null; remainingMs: number;
  solution?: string; ranking?: PublicPlayer[]; me: string;
}
export interface ServerToClientEvents {
  'match:state': (match: MatchView) => void;
  'match:error': (message: string) => void;
  'match:notice': (message: string) => void;
}
export interface ClientToServerEvents {
  'room:create': (payload: { name: string }, callback: (result: { code?: string; playerId?: string; resumeToken?: string; error?: string }) => void) => void;
  'room:join': (payload: { code: string; name: string }, callback: (result: { playerId?: string; resumeToken?: string; error?: string }) => void) => void;
  'room:resume': (payload: { playerId: string; resumeToken: string }, callback: (result: { state?: MatchView; error?: string }) => void) => void;
  'match:start': () => void;
  'room:return-lobby': () => void;
  'guess:submit': (payload: { word: string }) => void;
  'room:leave': () => void;
}