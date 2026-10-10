import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, MatchView, PublicPlayer, ServerToClientEvents, TileStatus } from '../shared/types';
import { WordService } from './wordService';

const PORT = Number(process.env.PORT ?? 3001);
const MATCH_MS = 5 * 60 * 1000;
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

interface Guess { word: string; result: TileStatus[] }
interface Player { id: string; name: string; socketId: string | null; resumeToken: string; disconnectTimer?: NodeJS.Timeout; attempts: number; guesses: Guess[]; status: 'playing' | 'won' | 'lost' | 'waiting'; elapsedMs?: number }
interface Room { code: string; hostId: string; solution: string; players: Map<string, Player>; phase: 'lobby' | 'playing' | 'finished'; endsAt: number | null; timer?: NodeJS.Timeout }
const rooms = new Map<string, Room>();
const socketRoom = new Map<string, string>();
const RECONNECT_GRACE_MS = 2 * 60 * 1000;

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
    code: room.code, phase: room.phase,
    players: [...room.players.values()].map((p) => ({ ...publicPlayer(p, reveal), isHost: p.id === room.hostId })),
    guesses: player.guesses.map((g) => ({ ...g })), endsAt: room.endsAt,
    remainingMs: room.endsAt ? Math.max(0, room.endsAt - Date.now()) : MATCH_MS,
    me: playerId, ...(reveal ? { solution: room.solution, ranking } : {}),
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
}

io.on('connection', (socket) => {
  socket.on('room:create', ({ name }, callback) => {
    const previousCode = socketRoom.get(socket.id);
    const previousRoom = previousCode && rooms.get(previousCode);
    const previousPlayer = previousRoom && [...previousRoom.players.values()].find((player) => player.socketId === socket.id);
    if (previousCode && previousPlayer) removePlayerById(previousCode, previousPlayer.id);
    let roomCode = code();
    while (rooms.has(roomCode)) roomCode = code();
    const playerId = randomUUID();
    const resumeToken = randomBytes(32).toString('base64url');
    const room: Room = { code: roomCode, hostId: playerId, solution: '', players: new Map(), phase: 'lobby', endsAt: null };
    const player: Player = { id: playerId, resumeToken, name: name.trim().slice(0, 18) || 'Jogador', socketId: socket.id, attempts: 0, guesses: [], status: 'playing' };
    room.players.set(player.id, player); rooms.set(roomCode, room); socketRoom.set(socket.id, roomCode); socket.join(roomCode);
    callback({ code: roomCode, playerId, resumeToken }); broadcast(room);
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
    callback({ playerId, resumeToken }); broadcast(room);
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
  });
  socket.on('match:start', () => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    if (!room || room.phase !== 'lobby') return;
    const playerId = [...room.players.values()].find((player) => player.socketId === socket.id)?.id;
    if (room.hostId !== playerId) return socket.emit('match:error', 'Somente o anfitrião pode iniciar a partida.');
    room.solution = WordService.getRandomWord();
    for (const player of room.players.values()) {
      player.attempts = 0; player.guesses = []; player.elapsedMs = undefined;
      player.status = 'playing';
    }
    room.phase = 'playing'; room.endsAt = Date.now() + MATCH_MS;
    room.timer = setTimeout(() => finish(room), MATCH_MS);
    broadcast(room);
  });
  socket.on('guess:submit', ({ word }) => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const player = room && [...room.players.values()].find((candidate) => candidate.socketId === socket.id);
    if (!room || !player || room.phase !== 'playing' || player.status !== 'playing') return;
    if (room.endsAt! <= Date.now()) return finish(room);
    const guess = word.trim().toLocaleUpperCase('pt-BR');
    if (!WordService.isValidFormat(guess)) return socket.emit('match:error', 'A palavra precisa ter 5 letras.');
    if (!WordService.isValidGuess(guess)) return socket.emit('match:error', 'Essa palavra não está no nosso dicionário.');
    const result = WordService.score(guess, room.solution);
    player.guesses.push({ word: guess, result }); player.attempts++;
    if (result.every((tile) => tile === 'correct')) {
      player.status = 'won'; player.elapsedMs = Date.now() - (room.endsAt! - MATCH_MS);
    } else if (player.attempts >= 6) player.status = 'lost';
    broadcast(room);
    const activePlayers = [...room.players.values()].filter((p) => p.status !== 'waiting');
    if (activePlayers.length > 0 && activePlayers.every((p) => p.status !== 'playing')) finish(room);
  });
  socket.on('room:return-lobby', () => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const player = room && [...room.players.values()].find((candidate) => candidate.socketId === socket.id);
    if (!room || !player || room.phase !== 'finished') return;
    room.phase = 'lobby'; room.endsAt = null; room.solution = '';
    for (const participant of room.players.values()) {
      participant.status = 'playing'; participant.attempts = 0; participant.guesses = []; participant.elapsedMs = undefined;
    }
    broadcast(room);
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