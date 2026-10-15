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
interface Player { id: string; name: string; socketId: string | null; resumeToken: string; disconnectTimer?: NodeJS.Timeout; attempts: number; guesses: Guess[]; status: 'playing' | 'won' | 'lost' | 'waiting'; elapsedMs?: number }
interface Room { code: string; hostId: string; solution: string; solutions: string[]; players: Map<string, Player>; phase: 'lobby' | 'playing' | 'finished'; gameMode: GameMode; durationMinutes: number; endsAt: number | null; timer?: NodeJS.Timeout }
const rooms = new Map<string, Room>();
const socketRoom = new Map<string, string>();
const RECONNECT_GRACE_MS = 2 * 60 * 1000;
function roomSummaries(): RoomSummary[] {
  return [...rooms.values()].map((room) => ({ code: room.code, playerCount: room.players.size, capacity: 12, phase: room.phase, gameMode: room.gameMode, durationMinutes: room.durationMinutes }));
}
function broadcastRooms(): void { io.emit('rooms:state', roomSummaries()); }

function code(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let i = 0; i < 5; i++) value += alphabet[randomInt(alphabet.length)];
  return value;
}
function publicPlayer(player: Player, reveal = false): PublicPlayer {
  return { id: player.id, name: player.name, attempts: player.attempts, status: player.status,
    isHost: false,
    ...(reveal && player.status !== 'playing' ? { guessesUsed: player.attempts, elapsedMs: player.elapsedMs } : {}) };
}
function state(room: Room, playerId: string): MatchView {
  const player = room.players.get(playerId)!;
  const reveal = room.phase === 'finished';
  const ranking = reveal ? [...room.players.values()].filter((player) => player.status !== 'waiting').sort((a, b) => {
    const aSolved = a.status === 'won'; const bSolved = b.status === 'won';
    if (aSolved !== bSolved) return aSolved ? -1 : 1;
    if (aSolved && bSolved) return a.attempts - b.attempts || (a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity);
    return b.attempts - a.attempts || (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0);
  }).map((p) => ({ ...publicPlayer(p, true), isHost: p.id === room.hostId })) : undefined;
  return {
    code: room.code, phase: room.phase, gameMode: room.gameMode, durationMinutes: room.durationMinutes,
    players: [...room.players.values()].map((p) => ({ ...publicPlayer(p, reveal), isHost: p.id === room.hostId })),
    guesses: player.guesses.map((g) => ({ ...g })), endsAt: room.endsAt,
    remainingMs: room.endsAt ? Math.max(0, room.endsAt - Date.now()) : room.durationMinutes * 60 * 1000,
    me: playerId, ...(reveal ? { solution: room.solution, ...(room.gameMode !== 'TERMO' ? { solutions: [...room.solutions] } : {}), ranking } : {}),
  };
}
function broadcast(room: Room): void {
  for (const player of room.players.values()) if (player.socketId) io.to(player.socketId).emit('match:state', state(room, player.id));
}
function finish(room: Room): void {
  if (room.phase !== 'playing') return;
  room.phase = 'finished';
  if (room.timer) clearTimeout(room.timer);
  for (const player of room.players.values()) if (player.status === 'playing') player.status = 'lost';
  broadcast(room);
  broadcastRooms();
}
function removePlayerById(roomCode: string, playerId: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;
  const player = room.players.get(playerId);
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
  socket.on('room:create', ({ name, gameMode, durationMinutes }, callback) => {
    if (gameMode !== 'TERMO' && gameMode !== 'DUETO' && gameMode !== 'QUARTETO') return callback({ error: 'Modo de jogo inválido.' });
    if (!Number.isInteger(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) return callback({ error: 'A duração deve ser de 1 a 10 minutos.' });
    const previousCode = socketRoom.get(socket.id);
    const previousRoom = previousCode && rooms.get(previousCode);
    const previousPlayer = previousRoom && [...previousRoom.players.values()].find((player) => player.socketId === socket.id);
    if (previousCode && previousPlayer) removePlayerById(previousCode, previousPlayer.id);
    let roomCode = code();
    while (rooms.has(roomCode)) roomCode = code();
    const playerId = randomUUID();
    const resumeToken = randomBytes(32).toString('base64url');
    const room: Room = { code: roomCode, hostId: playerId, solution: '', solutions: [], players: new Map(), phase: 'lobby', gameMode, durationMinutes, endsAt: null };
    const player: Player = { id: playerId, resumeToken, name: name.trim().slice(0, 18) || 'Jogador', socketId: socket.id, attempts: 0, guesses: [], status: 'playing' };
    room.players.set(player.id, player); rooms.set(roomCode, room); socketRoom.set(socket.id, roomCode); socket.join(roomCode);
    callback({ code: roomCode, playerId, resumeToken }); broadcast(room); broadcastRooms();
  });
  socket.on('room:join', ({ code: requestedCode, name }, callback) => {
    const room = rooms.get(requestedCode.trim().toUpperCase());
    if (!room) return callback({ error: 'Sala não encontrada. Confira o código.' });
    if (room.players.size >= 12) return callback({ error: 'Esta sala está cheia.' });
    const previousCode = socketRoom.get(socket.id);
    const previousRoom = previousCode && rooms.get(previousCode);
    const previousPlayer = previousRoom && [...previousRoom.players.values()].find((player) => player.socketId === socket.id);
    if (previousCode && previousPlayer) removePlayerById(previousCode, previousPlayer.id);
    const joinedDuringRound = room.phase === 'playing';
    const playerId = randomUUID();
    const resumeToken = randomBytes(32).toString('base64url');
    const player: Player = { id: playerId, resumeToken, name: name.trim().slice(0, 18) || 'Jogador', socketId: socket.id, attempts: 0, guesses: [], status: joinedDuringRound ? 'waiting' : 'playing' };
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
  socket.on('room:update-settings', ({ gameMode, durationMinutes }) => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const playerId = room && [...room.players.values()].find((player) => player.socketId === socket.id)?.id;
    if (!room || room.phase !== 'lobby' || room.hostId !== playerId) return;
    if (gameMode !== 'TERMO' && gameMode !== 'DUETO' && gameMode !== 'QUARTETO') return socket.emit('match:error', 'Modo de jogo inválido.');
    if (!Number.isInteger(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) return socket.emit('match:error', 'A duração deve ser de 1 a 10 minutos.');
    room.gameMode = gameMode;
    room.durationMinutes = durationMinutes;
    broadcast(room);
    broadcastRooms();
  });
  socket.on('match:start', () => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    if (!room || room.phase !== 'lobby') return;
    const playerId = [...room.players.values()].find((player) => player.socketId === socket.id)?.id;
    if (room.hostId !== playerId) return socket.emit('match:error', 'Somente o anfitrião pode iniciar a partida.');
    room.solutions = [WordService.getRandomWord()];
    const boardCount = room.gameMode === 'QUARTETO' ? 4 : room.gameMode === 'DUETO' ? 2 : 1;
    while (room.solutions.length < boardCount) {
      const nextWord = WordService.getRandomWord();
      if (!room.solutions.includes(nextWord)) room.solutions.push(nextWord);
    }
    room.solution = room.solutions[0];
    for (const player of room.players.values()) {
      player.attempts = 0; player.guesses = []; player.elapsedMs = undefined;
      player.status = 'playing';
    }
    const roundDurationMs = room.durationMinutes * 60 * 1000;
    room.phase = 'playing'; room.endsAt = Date.now() + roundDurationMs;
    room.timer = setTimeout(() => finish(room), roundDurationMs);
    broadcast(room);
    broadcastRooms();
  });
  socket.on('guess:submit', ({ word }) => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const player = room && [...room.players.values()].find((candidate) => candidate.socketId === socket.id);
    if (!room || !player || room.phase !== 'playing' || player.status !== 'playing') return;
    if (room.endsAt! <= Date.now()) return finish(room);
    const guess = word.trim().toLocaleUpperCase('pt-BR');
    if (!WordService.isValidFormat(guess)) return socket.emit('match:error', 'A palavra precisa ter 5 letras.');
    if (!WordService.isValidGuess(guess)) return socket.emit('match:error', 'Essa palavra não está no nosso dicionário.');
    const solvedBefore = room.solutions.map((solution) => player.guesses.some((pastGuess) => {
      const pastResults = pastGuess.results ?? [pastGuess.result];
      return pastResults[room.solutions.indexOf(solution)]?.every((tile) => tile === 'correct');
    }));
    const results = room.solutions.map((solution, index) => solvedBefore[index] ? null : WordService.score(guess, solution));
    const firstResult = results.find((result): result is TileStatus[] => result !== null) ?? WordService.score(guess, room.solution);
    player.guesses.push({ word: guess, result: firstResult, ...(room.gameMode !== 'TERMO' ? { results } : {}), revealedWord: WordService.getCanonicalWord(guess) ?? guess }); player.attempts++;
    const solvedNow = room.solutions.map((_, index) => solvedBefore[index] || results[index]?.every((tile) => tile === 'correct') === true);
    if (solvedNow.every(Boolean)) {
      player.status = 'won'; player.elapsedMs = Date.now() - (room.endsAt! - room.durationMinutes * 60 * 1000);
    } else if (player.attempts >= (room.gameMode === 'QUARTETO' ? 9 : room.gameMode === 'DUETO' ? 7 : 6)) player.status = 'lost';
    broadcast(room);
    const activePlayers = [...room.players.values()].filter((p) => p.status !== 'waiting');
    if (activePlayers.length > 0 && activePlayers.every((p) => p.status !== 'playing')) finish(room);
  });
  socket.on('room:return-lobby', () => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const player = room && [...room.players.values()].find((candidate) => candidate.socketId === socket.id);
    if (!room || !player || room.phase !== 'finished') return;
    room.phase = 'lobby'; room.endsAt = null; room.solution = ''; room.solutions = [];
    for (const participant of room.players.values()) {
      participant.status = 'playing'; participant.attempts = 0; participant.guesses = []; participant.elapsedMs = undefined;
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