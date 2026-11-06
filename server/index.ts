import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, GameMode, MatchView, PublicPlayer, RoomSummary, ServerToClientEvents, TileStatus } from '../shared/types';
import { WordService } from './wordService';

const PORT = Number(process.env.PORT ?? 3001);
const MIN_DURATION_MINUTES = 1;
const MAX_DURATION_MINUTES = 10;
const app = express();
app.use(cors());
app.get('/health', (_req, res) => res.json({ ok: true }));
const clientDist = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: { origin: true } });

interface Guess { word: string; result: TileStatus[]; results?: Array<TileStatus[] | null>; revealedWord: string }
interface SequenceWordState { guesses: Guess[]; attempts: number; solved: boolean }
interface Player { id: string; name: string; socketId: string | null; resumeToken: string; disconnectTimer?: NodeJS.Timeout; attempts: number; guesses: Guess[]; status: 'playing' | 'won' | 'lost' | 'waiting'; eliminationRound?: number; battleOutOfGuesses?: boolean; elapsedMs?: number; wins: number; returnedToLobby: boolean; wordsSolved: number; wordIndex: number; quartetoWordIndex: number; sequenceStartedAt?: number; sequenceElapsedMs?: number; currentSolution?: string; sequenceWords: string[]; sequenceProgress: SequenceWordState[] }
interface Room { code: string; hostId: string; solution: string; solutions: string[]; players: Map<string, Player>; phase: 'lobby' | 'playing' | 'finished'; gameMode: GameMode; durationMinutes: number; sequenceLength: number; dueloTurnSeconds: number; endsAt: number | null; dueloTurnPlayerId?: string; roundWinnerId?: string; roundWinnerIds?: string[]; battleRound: number; battlePlacements: Map<string, number>; battleUsedWords: Set<string>; timer?: NodeJS.Timeout }
const rooms = new Map<string, Room>();
const socketRoom = new Map<string, string>();
const RECONNECT_GRACE_MS = 2 * 60 * 1000;
function roomSummaries(): RoomSummary[] {
  return [...rooms.values()].map((room) => ({ code: room.code, playerCount: room.players.size, capacity: room.gameMode === 'DUELO' ? 2 : 12, phase: room.phase, gameMode: room.gameMode, durationMinutes: room.durationMinutes }));
}
function broadcastRooms(): void { io.emit('rooms:state', roomSummaries()); }

function code(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let i = 0; i < 5; i++) value += alphabet[randomInt(alphabet.length)];
  return value;
}
function publicPlayer(player: Player, reveal = false, roundStartedAt?: number): PublicPlayer {
  return { id: player.id, name: player.name, attempts: player.attempts, status: player.status, eliminationRound: player.eliminationRound, wins: player.wins, returnedToLobby: player.returnedToLobby,
    wordsSolved: player.wordsSolved, wordIndex: player.wordIndex,
    isHost: false,
    ...(player.status === 'won' || (reveal && player.status !== 'playing') ? { guessesUsed: player.attempts, elapsedMs: player.elapsedMs ?? (roundStartedAt ? Date.now() - roundStartedAt : undefined) } : {}) };
}
function guessLimitFor(mode: GameMode): number { return mode === 'QUARTETO_SEQUENCIAL' ? 12 : mode === 'QUARTETO' ? 9 : mode === 'DUETO' ? 7 : 6; }
function sequenceGuessesUsed(player: Player): number {
  return player.sequenceProgress.reduce((total, word) => total + word.attempts, 0);
}
function solvedBoardCount(player: Player, boardCount: number): number {
  return Array.from({ length: boardCount }, (_, boardIndex) => player.guesses.some((guess) => {
    const results = guess.results ?? [guess.result];
    return results[boardIndex]?.every((tile) => tile === 'correct') === true;
  })).filter(Boolean).length;
}
function state(room: Room, playerId: string): MatchView {
  const player = room.players.get(playerId)!;
  const reveal = room.phase === 'finished';
  const roundStartedAt = room.endsAt ? room.endsAt - (room.gameMode === 'DUELO' ? room.dueloTurnSeconds * 1000 : room.durationMinutes * 60 * 1000) : undefined;
  const guessLimit = guessLimitFor(room.gameMode);
  const boardCount = room.gameMode === 'QUARTETO' || room.gameMode === 'QUARTETO_SEQUENCIAL' ? 4 : room.gameMode === 'DUETO' ? 2 : 1;
  const rankedPlayers = [...room.players.values()].filter((participant) => participant.status !== 'waiting').sort((a, b) => {
    if (room.gameMode === 'BATTLE_ROYALE') {
      if (!reveal) {
        const aEliminated = a.status === 'lost';
        const bEliminated = b.status === 'lost';
        if (aEliminated !== bEliminated) return aEliminated ? 1 : -1;
        if (aEliminated && bEliminated) return (b.eliminationRound ?? 0) - (a.eliminationRound ?? 0);
        return 0;
      }
      return (room.battlePlacements.get(a.id) ?? (a.status === 'won' ? 1 : 999)) - (room.battlePlacements.get(b.id) ?? (b.status === 'won' ? 1 : 999)) || a.name.localeCompare(b.name);
    }
    const aSolved = a.status === 'won'; const bSolved = b.status === 'won';
    if (room.gameMode === 'SEQUENCIA') {
      const solvedDifference = b.wordsSolved - a.wordsSolved;
      if (solvedDifference !== 0) return solvedDifference;
      if (a.status === 'won' && b.status === 'won') return (a.sequenceElapsedMs ?? Infinity) - (b.sequenceElapsedMs ?? Infinity);
      if (a.status !== 'won' && b.status !== 'won') return sequenceGuessesUsed(a) - sequenceGuessesUsed(b);
      return a.status === 'won' ? -1 : 1;
    }
    if (aSolved !== bSolved) return aSolved ? -1 : 1;
    if (aSolved && bSolved) return a.attempts - b.attempts || (a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity);
    if (room.gameMode === 'TERMO') return 0;
    return solvedBoardCount(b, boardCount) - solvedBoardCount(a, boardCount);
  });
  const finalRanks = new Map<string, number>();
  if (reveal) {
    let previous: Player | undefined;
    let previousRank = 0;
    rankedPlayers.forEach((participant, index) => {
      const tied = previous !== undefined && (() => {
        if (room.gameMode === 'BATTLE_ROYALE') return room.battlePlacements.get(participant.id) === room.battlePlacements.get(previous!.id);
        if (room.gameMode === 'SEQUENCIA') {
          if (participant.wordsSolved !== previous!.wordsSolved) return false;
          if (participant.status === 'won' && previous!.status === 'won') return participant.sequenceElapsedMs === previous!.sequenceElapsedMs;
          if (participant.status !== 'won' && previous!.status !== 'won') return sequenceGuessesUsed(participant) === sequenceGuessesUsed(previous!);
          return false;
        }
        if (participant.status === 'won' && previous!.status === 'won') return participant.attempts === previous!.attempts && participant.elapsedMs === previous!.elapsedMs;
        if (participant.status !== 'won' && previous!.status !== 'won') return room.gameMode === 'TERMO' || solvedBoardCount(participant, boardCount) === solvedBoardCount(previous!, boardCount);
        return false;
      })();
      const rank = tied ? previousRank : index + 1;
      finalRanks.set(participant.id, rank);
      previous = participant;
      previousRank = rank;
    });
  }
  const ranking = reveal ? rankedPlayers.map((participant) => ({ ...publicPlayer(participant, true, roundStartedAt), ...(room.gameMode === 'SEQUENCIA' ? { sequenceGuessesUsed: sequenceGuessesUsed(participant), elapsedMs: participant.sequenceElapsedMs } : room.gameMode === 'QUARTETO_SEQUENCIAL' ? { wordsSolved: participant.wordsSolved } : room.gameMode === 'DUETO' || room.gameMode === 'QUARTETO' ? { wordsSolved: solvedBoardCount(participant, boardCount) } : {}), isHost: participant.id === room.hostId, rank: finalRanks.get(participant.id)! })) : undefined;
  const winsRanking = [...room.players.values()].map((participant) => ({ ...publicPlayer(participant), isHost: participant.id === room.hostId })).sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
  return {
    code: room.code, phase: room.phase, gameMode: room.gameMode, durationMinutes: room.durationMinutes, battleRound: room.gameMode === 'BATTLE_ROYALE' ? room.battleRound : undefined, sequenceLength: room.sequenceLength, dueloTurnSeconds: room.dueloTurnSeconds, dueloTurnPlayerId: room.gameMode === 'DUELO' ? room.dueloTurnPlayerId : undefined, roundWinnerId: reveal ? room.roundWinnerId : undefined, roundWinnerIds: reveal ? room.roundWinnerIds : undefined, quartetoRevealedBoards: room.gameMode === 'QUARTETO_SEQUENCIAL' ? (reveal ? 4 : Math.min(4, player.quartetoWordIndex + 1)) : undefined, guessLimit,
    players: [...rankedPlayers, ...(player.status === 'waiting' ? [player] : [])].map((participant) => ({ ...publicPlayer(participant, reveal, roundStartedAt), isHost: participant.id === room.hostId, ...(reveal ? { rank: finalRanks.get(participant.id) } : participant.status === 'won' ? { rank: rankedPlayers.filter((candidate) => candidate.status === 'won').findIndex((candidate) => candidate.id === participant.id) + 1 } : {}) })),
    guesses: player.guesses.map((g) => ({ ...g, results: g.results?.map((result) => result ? [...result] : null) })), ...(room.gameMode === 'SEQUENCIA' ? { sequenceProgress: player.sequenceProgress.map((word) => ({ guesses: word.guesses.map((guess) => ({ ...guess })), attempts: word.attempts, solved: word.solved })) } : {}), endsAt: room.endsAt,
    remainingMs: room.endsAt ? Math.max(0, room.endsAt - Date.now()) : room.gameMode === 'DUELO' ? room.dueloTurnSeconds * 1000 : room.durationMinutes * 60 * 1000, winsRanking,
    me: playerId, ...(reveal ? { solution: room.gameMode === 'SEQUENCIA' ? room.solutions.at(-1) : room.solution, ...(room.gameMode !== 'TERMO' ? { solutions: [...room.solutions] } : {}), ranking } : {}),
  };
}
function broadcast(room: Room): void {
  for (const player of room.players.values()) if (player.socketId) io.to(player.socketId).emit('match:state', state(room, player.id));
}
function startDueloTurn(room: Room, playerId: string): void {
  if (room.timer) clearTimeout(room.timer);
  room.dueloTurnPlayerId = playerId;
  room.endsAt = Date.now() + room.dueloTurnSeconds * 1000;
  room.timer = setTimeout(() => {
    if (room.phase !== 'playing' || room.gameMode !== 'DUELO') return;
    const nextPlayerId = [...room.players.keys()].find((id) => id !== room.dueloTurnPlayerId);
    if (!nextPlayerId) return finish(room);
    startDueloTurn(room, nextPlayerId);
    broadcast(room);
  }, room.dueloTurnSeconds * 1000);
}
function startBattleRound(room: Room, advanceRound = true): void {
  if (room.timer) clearTimeout(room.timer);
  const nextSolution = WordService.getRandomWordExcluding(room.battleUsedWords);
  if (!nextSolution) { finish(room); return; }
  if (advanceRound) room.battleRound++;
  room.solution = nextSolution;
  room.battleUsedWords.add(nextSolution);
  room.solutions = [room.solution];
  for (const player of room.players.values()) {
    if (player.status === 'lost' || player.status === 'waiting') continue;
    player.status = 'playing'; player.battleOutOfGuesses = false; player.attempts = 0; player.guesses = []; player.elapsedMs = undefined;
  }
  room.endsAt = Date.now() + room.durationMinutes * 60 * 1000;
  room.timer = setTimeout(() => resolveBattleRound(room, true), room.durationMinutes * 60 * 1000);
  broadcast(room);
}
function resolveBattleRound(room: Room, timedOut = false): void {
  if (room.phase !== 'playing' || room.gameMode !== 'BATTLE_ROYALE') return;
  if (room.timer) clearTimeout(room.timer);
  const active = [...room.players.values()].filter((player) => player.status !== 'lost' && player.status !== 'waiting');
  const solved = active.filter((player) => player.status === 'won');
  const unsolved = active.filter((player) => player.status !== 'won');
  if (solved.length === 0 && (timedOut || unsolved.every((player) => player.battleOutOfGuesses))) { startBattleRound(room, false); return; }
  const eliminated: Player[] = [];
  if (solved.length > 0 && unsolved.length === 1 && active.length > 1) {
    unsolved[0].status = 'lost'; unsolved[0].eliminationRound = room.battleRound; room.battlePlacements.set(unsolved[0].id, active.length);
    eliminated.push(unsolved[0]);
  } else if (timedOut && solved.length > 0) {
    for (const player of unsolved) { player.status = 'lost'; player.eliminationRound = room.battleRound; room.battlePlacements.set(player.id, active.length); eliminated.push(player); }
  }
  for (const player of eliminated) io.to(room.code).emit('match:notice', `${player.name} foi eliminado no round ${room.battleRound}.`);
  const remaining = [...room.players.values()].filter((player) => player.status !== 'lost' && player.status !== 'waiting');
  if (remaining.length <= 1) {
    if (remaining[0]) room.battlePlacements.set(remaining[0].id, 1);
    finish(room); return;
  }
  startBattleRound(room);
}
function finish(room: Room): void {
  if (room.phase !== 'playing') return;
  const finishedAt = Date.now();
  room.phase = 'finished';
  if (room.timer) clearTimeout(room.timer);
  room.endsAt = room.gameMode === 'DUELO' ? finishedAt : null;
  for (const player of room.players.values()) if (player.status === 'playing') player.status = 'lost';
  room.roundWinnerId = undefined;
  room.roundWinnerIds = [];
  const boardCount = room.gameMode === 'QUARTETO' || room.gameMode === 'QUARTETO_SEQUENCIAL' ? 4 : room.gameMode === 'DUETO' ? 2 : 1;
  const ranked = [...room.players.values()].filter((player) => player.status !== 'waiting').sort((a, b) => {
    if (room.gameMode === 'BATTLE_ROYALE') return (room.battlePlacements.get(a.id) ?? (a.status === 'won' ? 1 : 999)) - (room.battlePlacements.get(b.id) ?? (b.status === 'won' ? 1 : 999));
    if (room.gameMode === 'SEQUENCIA') {
      const solvedDifference = b.wordsSolved - a.wordsSolved;
      if (solvedDifference !== 0) return solvedDifference;
      if (a.status === 'won' && b.status === 'won') return (a.sequenceElapsedMs ?? Infinity) - (b.sequenceElapsedMs ?? Infinity);
      if (a.status !== 'won' && b.status !== 'won') return sequenceGuessesUsed(a) - sequenceGuessesUsed(b);
      return a.status === 'won' ? -1 : 1;
    }
    const aSolved = a.status === 'won';
    const bSolved = b.status === 'won';
    if (aSolved !== bSolved) return aSolved ? -1 : 1;
    if (aSolved && bSolved) return a.attempts - b.attempts || (a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity);
    if (room.gameMode === 'TERMO') return 0;
    return solvedBoardCount(b, boardCount) - solvedBoardCount(a, boardCount);
  });
  const leader = ranked[0];
  const sameRankAsLeader = (player: Player): boolean => {
    if (!leader) return false;
    if (room.gameMode === 'BATTLE_ROYALE') return room.battlePlacements.get(player.id) === room.battlePlacements.get(leader.id);
    if (room.gameMode === 'SEQUENCIA') {
      if (player.wordsSolved !== leader.wordsSolved) return false;
      if (player.status === 'won' && leader.status === 'won') return player.sequenceElapsedMs === leader.sequenceElapsedMs;
      if (player.status !== 'won' && leader.status !== 'won') return sequenceGuessesUsed(player) === sequenceGuessesUsed(leader);
      return false;
    }
    if (player.status !== leader.status) return false;
    if (player.status === 'won') return player.attempts === leader.attempts && player.elapsedMs === leader.elapsedMs;
    return room.gameMode === 'TERMO' || solvedBoardCount(player, boardCount) === solvedBoardCount(leader, boardCount);
  };
  room.roundWinnerIds = leader ? ranked.filter(sameRankAsLeader).map((player) => player.id) : [];
  for (const player of ranked) {
    if (!room.roundWinnerIds.includes(player.id)) continue;
    player.wins++;
  }
  room.roundWinnerId = room.roundWinnerIds[0];
  broadcast(room);
  broadcastRooms();
}
function removePlayerById(roomCode: string, playerId: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;
    const player = room.players.get(playerId)!;
  if (!player) return;
  if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
  if (player.socketId) {
    socketRoom.delete(player.socketId);
    io.sockets.sockets.get(player.socketId)?.leave(roomCode);
  }
  room.players.delete(playerId);
  if (room.hostId === playerId && room.players.size) room.hostId = room.players.keys().next().value!;
  if (!room.players.size) {
    if (room.timer) clearTimeout(room.timer);
    rooms.delete(roomCode);
  } else broadcast(room);
  broadcastRooms();
}
function removePlayer(socket: Socket<ClientToServerEvents, ServerToClientEvents>): void {
  const roomCode = socketRoom.get(socket.id);
  if (!roomCode) return;
  socketRoom.delete(socket.id);
  const room = rooms.get(roomCode);
  if (!room) return;
  const player = [...room.players.values()].find((p) => p.socketId === socket.id);
  if (!player) return;
  player.socketId = null;
  player.disconnectTimer = setTimeout(() => removePlayerById(roomCode, player.id), RECONNECT_GRACE_MS);
  broadcast(room);
  broadcastRooms();
}

io.on('connection', (socket) => {
  socket.on('rooms:list', (callback) => callback(roomSummaries()));
  socket.on('room:create', ({ name, gameMode, durationMinutes, sequenceLength, dueloTurnSeconds }, callback) => {
    if (gameMode !== 'BATTLE_ROYALE' && gameMode !== 'TERMO' && gameMode !== 'DUETO' && gameMode !== 'QUARTETO' && gameMode !== 'QUARTETO_SEQUENCIAL' && gameMode !== 'SEQUENCIA' && gameMode !== 'DUELO') return callback({ error: 'Modo de jogo inválido.' });
    if (!Number.isInteger(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) return callback({ error: 'A duração deve ser de 1 a 10 minutos.' });
    if (dueloTurnSeconds !== undefined && (!Number.isInteger(dueloTurnSeconds) || dueloTurnSeconds < 10 || dueloTurnSeconds > 60 || dueloTurnSeconds % 10 !== 0)) return callback({ error: 'O tempo por jogada no DUELO deve ser de 10 a 60 segundos, em intervalos de 10.' });
    const previousCode = socketRoom.get(socket.id);
    const previousRoom = previousCode && rooms.get(previousCode);
    const previousPlayer = previousRoom && [...previousRoom.players.values()].find((player) => player.socketId === socket.id);
    if (previousCode && previousPlayer) removePlayerById(previousCode, previousPlayer.id);
    let roomCode = code();
    while (rooms.has(roomCode)) roomCode = code();
    const playerId = randomUUID();
    const resumeToken = randomBytes(32).toString('base64url');
    const requestedSequenceLength = sequenceLength ?? 3;
    if (!Number.isInteger(requestedSequenceLength) || requestedSequenceLength < 2 || requestedSequenceLength > 10) return callback({ error: 'A sequência deve ter de 2 a 10 palavras.' });
    const room: Room = { code: roomCode, hostId: playerId, solution: '', solutions: [], players: new Map(), phase: 'lobby', gameMode, durationMinutes, sequenceLength: requestedSequenceLength, dueloTurnSeconds: dueloTurnSeconds ?? 30, endsAt: null, battleRound: 0, battlePlacements: new Map(), battleUsedWords: new Set() };
    const player: Player = { id: playerId, resumeToken, name: name.trim().slice(0, 18) || 'Jogador', socketId: socket.id, attempts: 0, guesses: [], status: 'playing', wins: 0, returnedToLobby: false, wordsSolved: 0, wordIndex: 0, quartetoWordIndex: 0, sequenceWords: [], sequenceProgress: [] };
    room.players.set(player.id, player); rooms.set(roomCode, room); socketRoom.set(socket.id, roomCode); socket.join(roomCode);
    callback({ code: roomCode, playerId, resumeToken }); broadcast(room); broadcastRooms();
  });
  socket.on('room:join', ({ code: requestedCode, name }, callback) => {
    const room = rooms.get(requestedCode.trim().toUpperCase());
    if (!room) return callback({ error: 'Sala não encontrada. Confira o código.' });
    const roomCapacity = room.gameMode === 'DUELO' ? 2 : 12;
    if (room.players.size >= roomCapacity) return callback({ error: 'Esta sala está cheia.' });
    const previousCode = socketRoom.get(socket.id);
    const previousRoom = previousCode && rooms.get(previousCode);
    const previousPlayer = previousRoom && [...previousRoom.players.values()].find((player) => player.socketId === socket.id);
    if (previousCode && previousPlayer) removePlayerById(previousCode, previousPlayer.id);
    const joinedDuringRound = room.phase === 'playing' || room.phase === 'finished';
    const playerId = randomUUID();
    const resumeToken = randomBytes(32).toString('base64url');
    const player: Player = { id: playerId, resumeToken, name: name.trim().slice(0, 18) || 'Jogador', socketId: socket.id, attempts: 0, guesses: [], status: joinedDuringRound ? 'waiting' : 'playing', wins: 0, returnedToLobby: false, wordsSolved: 0, wordIndex: 0, quartetoWordIndex: 0, sequenceWords: [], sequenceProgress: [] };
    room.players.set(player.id, player); socketRoom.set(socket.id, room.code); socket.join(room.code);
    callback({ playerId, resumeToken }); broadcast(room); broadcastRooms();
  });
  socket.on('room:resume', ({ playerId, resumeToken }, callback) => {
    const room = [...rooms.values()].find((candidate) => candidate.players.has(playerId));
    const player = room?.players.get(playerId);
    if (!room || !player || player.resumeToken !== resumeToken) return callback({ error: 'Sua sessão não pode ser restaurada. Entre novamente na sala.' });
    const previousRoomCode = socketRoom.get(socket.id);
    const previousRoom = previousRoomCode && rooms.get(previousRoomCode);
    const previousPlayer = previousRoom && [...previousRoom.players.values()].find((candidate) => candidate.socketId === socket.id);
    if (previousRoomCode && previousPlayer && previousPlayer.id !== player.id) removePlayerById(previousRoomCode, previousPlayer.id);
    if (player.socketId && player.socketId !== socket.id) {
      socketRoom.delete(player.socketId);
      io.sockets.sockets.get(player.socketId)?.leave(room.code);
    }
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = undefined;
    player.socketId = socket.id;
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    const restoredState = state(room, player.id);
    callback({ state: restoredState });
    socket.emit('match:state', restoredState);
    broadcast(room);
    broadcastRooms();
  });
  socket.on('room:update-settings', ({ gameMode, durationMinutes, sequenceLength, dueloTurnSeconds }) => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const playerId = room && [...room.players.values()].find((player) => player.socketId === socket.id)?.id;
    if (!room || room.phase !== 'lobby' || room.hostId !== playerId) return;
    if (gameMode !== 'BATTLE_ROYALE' && gameMode !== 'TERMO' && gameMode !== 'DUETO' && gameMode !== 'QUARTETO' && gameMode !== 'QUARTETO_SEQUENCIAL' && gameMode !== 'SEQUENCIA' && gameMode !== 'DUELO') return socket.emit('match:error', 'Modo de jogo inválido.');
    if (gameMode === 'DUELO' && room.players.size > 2) return socket.emit('match:error', 'DUELO permite no máximo 2 jogadores. Remova jogadores da sala antes de mudar o modo.');
    if (!Number.isInteger(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) return socket.emit('match:error', 'A duração deve ser de 1 a 10 minutos.');
    const nextDueloTurnSeconds = dueloTurnSeconds ?? room.dueloTurnSeconds;
    if (!Number.isInteger(nextDueloTurnSeconds) || nextDueloTurnSeconds < 10 || nextDueloTurnSeconds > 60 || nextDueloTurnSeconds % 10 !== 0) return socket.emit('match:error', 'O tempo por jogada no DUELO deve ser de 10 a 60 segundos, em intervalos de 10.');
    const nextSequenceLength = sequenceLength ?? room.sequenceLength;
    if (!Number.isInteger(nextSequenceLength) || nextSequenceLength < 2 || nextSequenceLength > 10) return socket.emit('match:error', 'A sequência deve ter de 2 a 10 palavras.');
    room.gameMode = gameMode;
    room.durationMinutes = durationMinutes;
    room.dueloTurnSeconds = nextDueloTurnSeconds;
    room.sequenceLength = nextSequenceLength;
    broadcast(room);
    broadcastRooms();
  });
  socket.on('match:start', () => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    if (!room || room.phase !== 'lobby') return;
    const playerId = [...room.players.values()].find((player) => player.socketId === socket.id)?.id;
    if (room.hostId !== playerId) return socket.emit('match:error', 'Somente o anfitrião pode iniciar a partida.');
    if (room.gameMode === 'BATTLE_ROYALE' && room.players.size < 3) return socket.emit('match:error', `BATTLE ROYALE precisa de pelo menos 3 jogadores. Atualmente há ${room.players.size}.`);
    if (room.gameMode === 'DUELO' && room.players.size !== 2) return socket.emit('match:error', `DUELO precisa de exatamente 2 jogadores para começar. Atualmente há ${room.players.size}.`);
    room.battleRound = 0; room.battlePlacements.clear(); room.battleUsedWords.clear();
    room.solutions = room.gameMode === 'SEQUENCIA' ? [] : [WordService.getRandomWord()];
    const boardCount = room.gameMode === 'QUARTETO' || room.gameMode === 'QUARTETO_SEQUENCIAL' ? 4 : room.gameMode === 'DUETO' ? 2 : 1;
    while (room.gameMode !== 'SEQUENCIA' && room.solutions.length < boardCount) {
      const nextWord = WordService.getRandomWord();
      if (!room.solutions.includes(nextWord)) room.solutions.push(nextWord);
    }
    room.solution = room.solutions[0];
    for (const player of room.players.values()) {
      if (room.gameMode === 'BATTLE_ROYALE' && player.status === 'waiting') continue;
      player.eliminationRound = undefined;
      player.attempts = 0; player.guesses = []; player.elapsedMs = undefined; player.quartetoWordIndex = 0;
      player.battleOutOfGuesses = false;
      player.wordsSolved = 0; player.wordIndex = 0; player.sequenceStartedAt = Date.now(); player.sequenceElapsedMs = undefined;
      player.sequenceWords = [];
      player.sequenceProgress = [];
      if (room.gameMode === 'SEQUENCIA') {
        while (room.solutions.length < room.sequenceLength) {
          let nextWord = WordService.getRandomWord();
          while (room.solutions.includes(nextWord)) nextWord = WordService.getRandomWord();
          room.solutions.push(nextWord);
        }
        player.sequenceWords = [...room.solutions];
        player.sequenceProgress = room.solutions.map(() => ({ guesses: [], attempts: 0, solved: false }));
        player.currentSolution = room.solutions[0];
      }
      player.status = 'playing';
      player.returnedToLobby = false;
    }
    const dueloPlayers = room.gameMode === 'DUELO' ? [...room.players.keys()] : [];
    const firstDueloPlayerId = dueloPlayers.length ? dueloPlayers[randomInt(dueloPlayers.length)] : undefined;
    room.dueloTurnPlayerId = firstDueloPlayerId;
    room.roundWinnerId = undefined;
    const roundDurationMs = room.durationMinutes * 60 * 1000;
    room.phase = 'playing'; room.endsAt = Date.now() + (room.gameMode === 'DUELO' ? room.dueloTurnSeconds * 1000 : roundDurationMs);
    if (room.gameMode === 'BATTLE_ROYALE') startBattleRound(room);
    else if (room.gameMode === 'DUELO' && firstDueloPlayerId) startDueloTurn(room, firstDueloPlayerId);
    else room.timer = setTimeout(() => finish(room), roundDurationMs);
    broadcast(room);
    broadcastRooms();
  });
  socket.on('guess:submit', ({ word }) => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const player = room && [...room.players.values()].find((candidate) => candidate.socketId === socket.id);
    if (!room || !player || room.phase !== 'playing' || player.status !== 'playing') return;
    if (room.gameMode === 'DUELO' && room.dueloTurnPlayerId !== player.id) return socket.emit('match:error', 'Aguarde sua vez.');
    if (room.endsAt! <= Date.now()) {
      if (room.gameMode === 'BATTLE_ROYALE') resolveBattleRound(room, true);
      else if (room.gameMode === 'DUELO') {
        const nextPlayerId = [...room.players.keys()].find((id) => id !== room.dueloTurnPlayerId);
        if (nextPlayerId) { startDueloTurn(room, nextPlayerId); broadcast(room); }
        return;
      }
      return finish(room);
    }
    if (room.gameMode === 'SEQUENCIA' && (player.sequenceProgress[player.wordIndex]?.solved || player.sequenceProgress[player.wordIndex]?.attempts >= guessLimitFor(room.gameMode))) return;
    const guess = word.trim().toLocaleUpperCase('pt-BR');
    if (!WordService.isValidFormat(guess)) return socket.emit('match:error', 'A palavra precisa ter 5 letras.');
    if (!WordService.isValidGuess(guess)) return socket.emit('match:error', 'Essa palavra não está no nosso dicionário.');
    if (room.gameMode === 'BATTLE_ROYALE') {
      if (player.battleOutOfGuesses) return;
      if (player.guesses.some((pastGuess) => WordService.normalizeWord(pastGuess.word) === WordService.normalizeWord(guess))) return socket.emit('match:error', 'Você já tentou essa palavra. Escolha outra.');
      player.guesses.push({ word: guess, result: WordService.score(guess, room.solution), revealedWord: WordService.getCanonicalWord(guess) ?? guess });
      player.attempts++;
      if (WordService.normalizeWord(guess) === WordService.normalizeWord(room.solution)) { player.status = 'won'; player.elapsedMs = Date.now() - (room.endsAt! - room.durationMinutes * 60 * 1000); }
      else if (player.attempts >= guessLimitFor(room.gameMode)) player.battleOutOfGuesses = true;
      const active = [...room.players.values()].filter((participant) => participant.status !== 'lost' && participant.status !== 'waiting');
      const solved = active.filter((participant) => participant.status === 'won');
      const stillGuessing = active.filter((participant) => participant.status === 'playing' && !participant.battleOutOfGuesses);
      if (solved.length === 0 && stillGuessing.length === 0) { startBattleRound(room, false); return; }
      if (solved.length > 0 && stillGuessing.length <= 1 && active.length > 1) { resolveBattleRound(room); return; }
      if (solved.length > 0 && stillGuessing.length === 0) { resolveBattleRound(room); return; }
      broadcast(room);
      return;
    }
    const normalizedGuess = WordService.normalizeWord(guess);
    const previousGuesses = room.gameMode === 'SEQUENCIA'
      ? player.sequenceProgress[player.wordIndex].guesses
      : player.guesses;
    if (previousGuesses.some((pastGuess) => WordService.normalizeWord(pastGuess.word) === normalizedGuess)) {
      return socket.emit('match:error', 'Você já tentou essa palavra. Escolha outra.');
    }
    if (room.gameMode === 'DUELO' && player.guesses.length >= guessLimitFor(room.gameMode)) return;
    if (room.gameMode === 'DUELO') {
      if (room.timer) clearTimeout(room.timer);
      const nextPlayerId = [...room.players.keys()].find((id) => id !== player.id);
      if (!nextPlayerId) return finish(room);
      startDueloTurn(room, nextPlayerId);
    }
    const activeSolutions = room.gameMode === 'SEQUENCIA' ? [player.currentSolution ?? room.solution]
      : room.gameMode === 'QUARTETO_SEQUENCIAL' ? [room.solutions[player.quartetoWordIndex]] : room.solutions;
    const currentWordGuesses = room.gameMode === 'SEQUENCIA' ? player.sequenceProgress[player.wordIndex].guesses : player.guesses;
    const solvedBefore = activeSolutions.map((solution) => currentWordGuesses.some((pastGuess) =>
      WordService.normalizeWord(pastGuess.word) === WordService.normalizeWord(solution)));
    const results = room.gameMode === 'QUARTETO_SEQUENCIAL'
      ? room.solutions.map((solution, index) => index === player.quartetoWordIndex ? WordService.score(guess, solution) : null)
      : activeSolutions.map((solution, index) => solvedBefore[index] ? null : WordService.score(guess, solution));
    const firstResult = results.find((result): result is TileStatus[] => result !== null) ?? WordService.score(guess, activeSolutions[0]);
    player.guesses.push({ word: guess, result: firstResult, ...((room.gameMode === 'DUETO' || room.gameMode === 'QUARTETO' || room.gameMode === 'QUARTETO_SEQUENCIAL') ? { results } : {}), revealedWord: WordService.getCanonicalWord(guess) ?? guess }); player.attempts++;
    const solvedNow = activeSolutions.map((_, index) => solvedBefore[index] || results[index]?.every((tile) => tile === 'correct') === true);
    if (room.gameMode === 'DUELO') {
      for (const participant of room.players.values()) {
        if (participant.id === player.id) continue;
        participant.guesses = player.guesses.map((entry) => ({ ...entry }));
        participant.attempts = player.attempts;
      }
      if (solvedNow.every(Boolean)) {
        player.status = 'won';
        player.elapsedMs = Date.now() - (room.endsAt! - room.dueloTurnSeconds * 1000) + (player.attempts - 1) * room.dueloTurnSeconds * 1000;
        for (const participant of room.players.values()) if (participant.id !== player.id) participant.status = 'lost';
        finish(room);
        return;
      }
      if (player.attempts >= guessLimitFor(room.gameMode)) {
        for (const participant of room.players.values()) participant.status = 'lost';
        finish(room);
        return;
      }
      const nextPlayerId = [...room.players.keys()].find((id) => id !== player.id);
      if (!nextPlayerId) return finish(room);
      startDueloTurn(room, nextPlayerId);
      return broadcast(room);
    }
    if (room.gameMode === 'SEQUENCIA') {
      const solvedWord = solvedNow.every(Boolean);
      const progress = player.sequenceProgress[player.wordIndex];
      progress.guesses = player.guesses;
      progress.attempts = player.attempts;
      progress.solved = solvedWord;
      player.guesses = progress.guesses;
      player.wordsSolved = player.sequenceProgress.filter((entry) => entry.solved).length;
      const sequenceFinished = player.wordsSolved === room.sequenceLength;
      if (sequenceFinished) {
        player.status = 'won';
        player.sequenceElapsedMs = Date.now() - (player.sequenceStartedAt ?? Date.now());
        player.elapsedMs = player.sequenceElapsedMs;
      } else if (player.sequenceProgress.every((entry) => entry.solved || entry.attempts >= guessLimitFor(room.gameMode))) {
        player.status = 'lost';
      }
    } else if (room.gameMode === 'QUARTETO_SEQUENCIAL') {
      const matchesSolution = (solution: string) => player.guesses.some((pastGuess) => WordService.normalizeWord(pastGuess.word) === WordService.normalizeWord(solution));
      while (player.quartetoWordIndex < room.solutions.length && matchesSolution(room.solutions[player.quartetoWordIndex])) player.quartetoWordIndex++;
      player.quartetoWordIndex = Math.min(player.quartetoWordIndex, room.solutions.length - 1);
      player.wordIndex = player.quartetoWordIndex;
      for (const pastGuess of player.guesses) {
        pastGuess.results ??= Array<TileStatus[] | null>(room.solutions.length).fill(null);
        if (pastGuess.results[player.quartetoWordIndex] == null) {
          pastGuess.results[player.quartetoWordIndex] = WordService.score(pastGuess.word, room.solutions[player.quartetoWordIndex]);
        }
      }
      if (room.solutions.every(matchesSolution)) {
        player.status = 'won'; player.elapsedMs = Date.now() - (room.endsAt! - room.durationMinutes * 60 * 1000);
      } else if (player.attempts >= guessLimitFor(room.gameMode)) player.status = 'lost';
    } else if (solvedNow.every(Boolean)) {
      player.status = 'won'; player.elapsedMs = Date.now() - (room.endsAt! - room.durationMinutes * 60 * 1000);
    } else if (player.attempts >= guessLimitFor(room.gameMode)) player.status = 'lost';
    const activePlayers = [...room.players.values()].filter((p) => p.status !== 'waiting');
    if (room.gameMode === 'BATTLE_ROYALE') resolveBattleRound(room);
    else if (activePlayers.length > 0 && activePlayers.every((p) => p.status !== 'playing')) finish(room);
    else broadcast(room);
  });
  socket.on('match:give-up', () => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const player = room && [...room.players.values()].find((candidate) => candidate.socketId === socket.id);
    if (!room || room.phase !== 'playing' || !player || player.status !== 'playing') return;
    if (room.gameMode === 'DUELO') {
      const opponent = [...room.players.values()].find((candidate) => candidate.id !== player.id && candidate.status === 'playing');
      player.status = 'lost';
      if (opponent) opponent.status = 'won';
      if (opponent) opponent.elapsedMs = Date.now() - (room.endsAt! - room.dueloTurnSeconds * 1000) + (opponent.attempts * room.dueloTurnSeconds * 1000);
      finish(room);
      return;
    }
    if (room.gameMode === 'SEQUENCIA') {
      player.status = 'lost';
    } else player.status = 'lost';
    if (room.gameMode === 'BATTLE_ROYALE') {
      player.eliminationRound = room.battleRound;
      room.battlePlacements.set(player.id, [...room.players.values()].filter((participant) => participant.status !== 'lost' && participant.status !== 'waiting').length + 1);
      io.to(room.code).emit('match:notice', `${player.name} foi eliminado no round ${room.battleRound}.`);
    }
    broadcast(room);
    const activePlayers = [...room.players.values()].filter((participant) => participant.status !== 'waiting');
    if (room.gameMode === 'BATTLE_ROYALE') resolveBattleRound(room);
    else if (activePlayers.length > 0 && activePlayers.every((participant) => participant.status !== 'playing')) finish(room);
  });
  socket.on('match:select-word', ({ wordIndex }) => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const player = room && [...room.players.values()].find((candidate) => candidate.socketId === socket.id);
    if (!room || room.phase !== 'playing' || room.gameMode !== 'SEQUENCIA' || !player || (player.status !== 'playing' && player.status !== 'won' && player.status !== 'lost')) return;
    if (!Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= room.sequenceLength) return;
    player.wordIndex = wordIndex;
    player.currentSolution = room.solutions[wordIndex];
    player.guesses = player.sequenceProgress[wordIndex].guesses;
    player.attempts = player.sequenceProgress[wordIndex].attempts;
    broadcast(room);
  });
  socket.on('room:return-lobby', () => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const player = room && [...room.players.values()].find((candidate) => candidate.socketId === socket.id);
    if (!room || !player || (room.phase !== 'finished' && !(room.phase === 'lobby' && player.id === room.hostId))) return;
    if (player.id !== room.hostId) {
      if (player.returnedToLobby) return;
      player.returnedToLobby = true;
      broadcast(room);
      return;
    }
    room.phase = 'lobby'; room.endsAt = null; room.battleRound = 0; room.battlePlacements.clear(); room.battleUsedWords.clear(); room.solution = ''; room.solutions = []; room.dueloTurnPlayerId = undefined; room.roundWinnerId = undefined; room.roundWinnerIds = undefined;
    if (room.timer) clearTimeout(room.timer);
    room.timer = undefined;
    for (const participant of room.players.values()) {
    player.status = 'playing'; player.battleOutOfGuesses = false; player.attempts = 0; player.guesses = []; player.elapsedMs = undefined;
      participant.returnedToLobby = false;
      participant.wordsSolved = 0; participant.wordIndex = 0; participant.sequenceStartedAt = undefined; participant.sequenceElapsedMs = undefined; participant.sequenceWords = []; participant.currentSolution = undefined; participant.sequenceProgress = [];
      participant.quartetoWordIndex = 0;
    }
    broadcast(room);
    broadcastRooms();
  });
  socket.on('room:leave', () => {
    const roomCode = socketRoom.get(socket.id);
    const room = roomCode && rooms.get(roomCode);
    const player = room && [...room.players.values()].find((candidate) => candidate.socketId === socket.id);
    if (roomCode && player) removePlayerById(roomCode, player.id);
  });
  socket.on('disconnect', () => removePlayer(socket));
});

httpServer.listen(PORT, () => console.info(`TERMO server listening on http://localhost:${PORT}`));