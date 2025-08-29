import { Player, PlayerRanking } from './Player';

export interface Room {
  id: string;
  code: string;
  players: Player[];
  game?: Game;
  status: 'waiting' | 'playing' | 'finished';
  createdAt: Date;
  maxPlayers: number;
  password?: string; // Optional password for private rooms
  isPrivate: boolean;
}

export interface Game {
  id: string;
  roomId: string;
  targetWord: string;
  players: Player[];
  status: 'waiting' | 'playing' | 'finished';
  startTime?: Date;
  endTime?: Date;
  rankings: PlayerRanking[];
  timeLimit?: number; // in seconds
}

export interface RoomSettings {
  maxPlayers: number;
  timeLimit?: number;
  wordLength: number;
  maxGuesses: number;
}

export interface CreateRoomRequest {
  playerName: string;
  password?: string;
  settings?: Partial<RoomSettings>;
}

export interface JoinRoomRequest {
  roomCode: string;
  playerName: string;
  password?: string;
}

export interface RoomState {
  id: string;
  code: string;
  players: Player[];
  status: 'waiting' | 'playing' | 'finished';
  game?: Game;
  isLeader: boolean;
  playerCount: number;
}

export interface PublicRoomInfo {
  id: string;
  code: string;
  playerCount: number;
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'finished';
  isPrivate: boolean;
  createdAt: Date;
}
