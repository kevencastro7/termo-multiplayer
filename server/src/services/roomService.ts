import { v4 as uuidv4 } from 'uuid';
import { Room, Game, CreateRoomRequest, JoinRoomRequest, RoomSettings, PublicRoomInfo } from '../models/Room';
import { Player } from '../models/Player';
import { WordService } from './wordService';
import { GameService } from './gameService';

export class RoomService {
  private static rooms: Map<string, Room> = new Map();
  private static roomCodes: Map<string, string> = new Map(); // code -> roomId

  private static readonly DEFAULT_SETTINGS: RoomSettings = {
    maxPlayers: 8,
    timeLimit: 600, // 10 minutes
    wordLength: 5,
    maxGuesses: 6
  };

  /**
   * Create a new room
   */
  static createRoom(request: CreateRoomRequest, socketId: string): Room {
    const roomId = uuidv4();
    const roomCode = this.generateRoomCode();

    const settings = { ...this.DEFAULT_SETTINGS, ...request.settings };

    const leader: Player = {
      id: uuidv4(),
      name: request.playerName,
      socketId,
      roomId,
      isLeader: true,
      guesses: [],
      status: 'waiting',
      joinTime: new Date(),
      currentRow: 0
    };

    const room: Room = {
      id: roomId,
      code: roomCode,
      players: [leader],
      status: 'waiting',
      createdAt: new Date(),
      maxPlayers: settings.maxPlayers,
      password: request.password,
      isPrivate: !!request.password
    };

    this.rooms.set(roomId, room);
    this.roomCodes.set(roomCode, roomId);

    return room;
  }

  /**
   * Join an existing room
   */
  static joinRoom(request: JoinRoomRequest, socketId: string): { room: Room; player: Player } | null {
    const roomId = this.roomCodes.get(request.roomCode.toUpperCase());
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;

    // Check password for private rooms
    if (room.isPrivate) {
      if (!request.password) {
        throw new Error('Esta sala é privada. Digite a senha.');
      }
      if (request.password !== room.password) {
        throw new Error('Senha incorreta');
      }
    }

    // Check if room is full
    if (room.players.length >= room.maxPlayers) {
      throw new Error('Sala cheia');
    }

    // Check if player name is already taken
    const existingPlayer = room.players.find(p => p.name === request.playerName);
    if (existingPlayer) {
      throw new Error('Nome já está em uso nesta sala');
    }

    const player: Player = {
      id: uuidv4(),
      name: request.playerName,
      socketId,
      roomId,
      isLeader: false,
      guesses: [],
      status: 'waiting',
      joinTime: new Date(),
      currentRow: 0
    };

    room.players.push(player);

    return { room, player };
  }

  /**
   * Remove a player from a room
   */
  static removePlayer(roomId: string, playerId: string): { room: Room | null; destroyed: boolean; reason?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { room: null, destroyed: false };

    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return { room, destroyed: false };

    const removedPlayer = room.players[playerIndex];
    room.players.splice(playerIndex, 1);

    // If room is empty, delete it
    if (room.players.length === 0) {
      this.deleteRoom(roomId);
      return { room: null, destroyed: true, reason: 'empty' };
    }

    // If leader left, destroy the room
    if (removedPlayer.isLeader) {
      this.deleteRoom(roomId);
      return { room: null, destroyed: true, reason: 'leader_left' };
    }

    return { room, destroyed: false };
  }

  /**
   * Start a game in a room
   */
  static async startGame(roomId: string, leaderId: string): Promise<Game | null> {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    // Verify leader
    const leader = room.players.find(p => p.id === leaderId);
    if (!leader || !leader.isLeader) {
      throw new Error('Apenas o líder pode iniciar o jogo');
    }

    // Check minimum players
    if (room.players.length < 2) {
      throw new Error('São necessários pelo menos 2 jogadores');
    }

    const targetWord = await WordService.getRandomWord();

    const game: Game = {
      id: uuidv4(),
      roomId,
      targetWord,
      players: [...room.players],
      status: 'playing',
      startTime: new Date(),
      rankings: [],
      timeLimit: this.DEFAULT_SETTINGS.timeLimit
    };

    // Update room
    room.game = game;
    room.status = 'playing';

    // Update players
    room.players.forEach(player => {
      player.status = 'playing';
      player.guesses = [];
      player.currentRow = 0;
    });

    return game;
  }

  /**
   * Reset game for new round
   */
  static async resetGame(roomId: string, leaderId: string): Promise<Game | null> {
    const room = this.rooms.get(roomId);
    if (!room || !room.game) return null;

    // Verify leader
    const leader = room.players.find(p => p.id === leaderId);
    if (!leader || !leader.isLeader) {
      throw new Error('Apenas o líder pode reiniciar o jogo');
    }

    const targetWord = await WordService.getRandomWord();

    const game: Game = {
      id: uuidv4(),
      roomId,
      targetWord,
      players: room.players.map(p => ({
        ...p,
        guesses: [],
        status: 'waiting' as const,
        currentRow: 0,
        finishTime: undefined
      })),
      status: 'waiting',
      rankings: [],
      timeLimit: this.DEFAULT_SETTINGS.timeLimit
    };

    // Update room
    room.game = game;
    room.status = 'waiting';

    return game;
  }

  /**
   * Get room by ID
   */
  static getRoom(roomId: string): Room | null {
    return this.rooms.get(roomId) || null;
  }

  /**
   * Get room by code
   */
  static getRoomByCode(code: string): Room | null {
    const roomId = this.roomCodes.get(code.toUpperCase());
    return roomId ? this.getRoom(roomId) : null;
  }

  /**
   * Update player in room
   */
  static updatePlayer(roomId: string, updatedPlayer: Player): Room | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const playerIndex = room.players.findIndex(p => p.id === updatedPlayer.id);
    if (playerIndex === -1) return room;

    room.players[playerIndex] = updatedPlayer;

    // Update game if it exists
    if (room.game) {
      const gamePlayerIndex = room.game.players.findIndex(p => p.id === updatedPlayer.id);
      if (gamePlayerIndex !== -1) {
        room.game.players[gamePlayerIndex] = updatedPlayer;
      }
    }

    return room;
  }

  /**
   * Check if game should end and calculate rankings
   */
  static checkGameEnd(roomId: string): { shouldEnd: boolean; rankings: any[] } {
    const room = this.rooms.get(roomId);
    if (!room || !room.game) return { shouldEnd: false, rankings: [] };

    const shouldEnd = GameService.shouldGameEnd(room.game.players);

    if (shouldEnd && room.game.startTime) {
      room.game.rankings = GameService.calculateRankings(room.game.players, room.game.startTime);
      room.game.endTime = new Date();
      room.game.status = 'finished';
      room.status = 'finished';
    }

    return {
      shouldEnd,
      rankings: room.game.rankings
    };
  }

  /**
   * Generate a unique room code
   */
  private static generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code: string;

    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.roomCodes.has(code));

    return code;
  }

  /**
   * Assign new leader to room
   */
  private static assignNewLeader(room: Room): void {
    if (room.players.length === 0) return;

    // Find oldest player (first to join)
    const newLeader = room.players.reduce((oldest, current) =>
      current.joinTime < oldest.joinTime ? current : oldest
    );

    // Update leadership
    room.players.forEach(player => {
      player.isLeader = player.id === newLeader.id;
    });
  }

  /**
   * Delete a room
   */
  private static deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    this.rooms.delete(roomId);
    this.roomCodes.delete(room.code);
  }

  /**
   * Get public room list (without passwords)
   */
  static getPublicRooms(): PublicRoomInfo[] {
    return Array.from(this.rooms.values())
      .filter(room => room.players.length > 0) // Only rooms with players
      .map(room => ({
        id: room.id,
        code: room.code,
        playerCount: room.players.length,
        maxPlayers: room.maxPlayers,
        status: room.status,
        isPrivate: room.isPrivate,
        createdAt: room.createdAt
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Newest first
  }

  /**
   * Get all active rooms (for debugging)
   */
  static getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Clean up inactive rooms (call periodically)
   */
  static cleanupInactiveRooms(): void {
    const now = new Date();
    const timeout = 30 * 60 * 1000; // 30 minutes

    for (const [roomId, room] of this.rooms) {
      if (now.getTime() - room.createdAt.getTime() > timeout && room.players.length === 0) {
        this.deleteRoom(roomId);
      }
    }
  }
}
