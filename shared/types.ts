export type TileStatus = 'correct' | 'present' | 'absent';
export interface GuessView { word: string; result: TileStatus[]; revealedWord?: string }
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
export interface RoomSummary { code: string; playerCount: number; capacity: number; phase: RoomPhase }
export type RoomPhase = MatchView['phase'];
export interface ServerToClientEvents {
  'match:state': (match: MatchView) => void;
  'match:error': (message: string) => void;
  'match:notice': (message: string) => void;
  'rooms:state': (rooms: RoomSummary[]) => void;
}
export interface ClientToServerEvents {
  'rooms:list': (callback: (rooms: RoomSummary[]) => void) => void;
  'room:create': (payload: { name: string }, callback: (result: { code?: string; playerId?: string; resumeToken?: string; error?: string }) => void) => void;
  'room:join': (payload: { code: string; name: string }, callback: (result: { playerId?: string; resumeToken?: string; error?: string }) => void) => void;
  'room:resume': (payload: { playerId: string; resumeToken: string }, callback: (result: { state?: MatchView; error?: string }) => void) => void;
  'match:start': () => void;
  'room:return-lobby': () => void;
  'guess:submit': (payload: { word: string }) => void;
  'room:leave': () => void;
}