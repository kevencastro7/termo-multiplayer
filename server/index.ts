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
interface Player { id: string; name: string; socketId: string | null; resumeToken: string; disconnectTimer?: NodeJS.Timeout; attempts: number; guesses: Guess[]; status: 'playing' | 'won' | 'lost' | 'waiting'; elapsedMs?: number; wins: number; returnedToLobby: boolean; wordsSolved: number; wordIndex: number; sequenceStartedAt?: number; sequenceElapsedMs?: number; currentSolution?: string; sequenceWords: string[]; sequenceProgress: SequenceWordState[] }
interface Room { code: string; hostId: string; solution: string; solutions: string[]; players: Map<string, Player>; phase: 'lobby' | 'playing' | 'finished'; gameMode: GameMode; durationMinutes: number; sequenceLength: number; endsAt: number | null; timer?: NodeJS.Timeout }
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
function publicPlayer(player: Player, reveal = false, roundStartedAt?: number): PublicPlayer {
  return { id: player.id, name: player.name, attempts: player.attempts, status: player.status, wins: player.wins, returnedToLobby: player.returnedToLobby,
    wordsSolved: player.wordsSolved, wordIndex: player.wordIndex,
    isHost: false,
    ...(player.status === 'won' || (reveal && player.status !== 'playing') ? { guessesUsed: player.attempts, elapsedMs: player.elapsedMs ?? (roundStartedAt ? Date.now() - roundStartedAt : undefined) } : {}) };
}
function guessLimitFor(mode: GameMode): number { return mode === 'QUARTETO' ? 9 : mode === 'DUETO' ? 7 : 6; }
function solvedBoardCount(player: Player, boardCount: number): number {
  return Array.from({ length: boardCount }, (_, boardIndex) => player.guesses.some((guess) => {
    const results = guess.results ?? [guess.result];
    return results[boardIndex]?.every((tile) => tile === 'correct') === true;
  })).filter(Boolean).length;
}
function state(room: Room, playerId: string): MatchView {
  const player = room.players.get(playerId)!;
  const reveal = room.phase === 'finished';
  const roundStartedAt = room.endsAt ? room.endsAt - room.durationMinutes * 60 * 1000 : undefined;
  const guessLimit = guessLimitFor(room.gameMode);
  const boardCount = room.gameMode === 'QUARTETO' ? 4 : room.gameMode === 'DUETO' ? 2 : 1;
  const rankedPlayers = [...room.players.values()].filter((participant) => participant.status !== 'waiting').sort((a, b) => {
    const aSolved = a.status === 'won'; const bSolved = b.status === 'won';
    if (room.gameMode === 'SEQUENCIA') return b.wordsSolved - a.wordsSolved || (a.sequenceElapsedMs ?? Infinity) - (b.sequenceElapsedMs ?? Infinity);
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
        if (room.gameMode === 'SEQUENCIA') return participant.wordsSolved === previous!.wordsSolved && participant.sequenceElapsedMs === previous!.sequenceElapsedMs;
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
  const ranking = reveal ? rankedPlayers.map((participant) => ({ ...publicPlayer(participant, true, roundStartedAt), ...(room.gameMode === 'SEQUENCIA' ? { elapsedMs: participant.sequenceElapsedMs } : {}), isHost: participant.id === room.hostId, rank: finalRanks.get(participant.id)! })) : undefined;
  const winsRanking = [...room.players.values()].map((participant) => ({ ...publicPlayer(participant), isHost: participant.id === room.hostId })).sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
  return {
    code: room.code, phase: room.phase, gameMode: room.gameMode, durationMinutes: room.durationMinutes, sequenceLength: room.sequenceLength, guessLimit,
    players: [...rankedPlayers, ...(player.status === 'waiting' ? [player] : [])].map((participant) => ({ ...publicPlayer(participant, reveal, roundStartedAt), isHost: participant.id === room.hostId, ...(reveal ? { rank: finalRanks.get(participant.id) } : participant.status === 'won' ? { rank: rankedPlayers.filter((candidate) => candidate.status === 'won').findIndex((candidate) => candidate.id === participant.id) + 1 } : {}) })),
    guesses: player.guesses.map((g) => ({ ...g })), ...(room.gameMode === 'SEQUENCIA' ? { sequenceProgress: player.sequenceProgress.map((word) => ({ guesses: word.guesses.map((guess) => ({ ...guess })), attempts: word.attempts, solved: word.solved })) } : {}), endsAt: room.endsAt,
    remainingMs: room.endsAt ? Math.max(0, room.endsAt - Date.now()) : room.durationMinutes * 60 * 1000, winsRanking,
    me: playerId, ...(reveal ? { solution: room.gameMode === 'SEQUENCIA' ? room.solutions.at(-1) : room.solution, ...(room.gameMode !== 'TERMO' ? { solutions: [...room.solutions] } : {}), ranking } : {}),
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
  const ranked = [...room.players.values()].filter((player) => player.status !== 'waiting').sort((a, b) => room.gameMode === 'SEQUENCIA'
    ? b.wordsSolved - a.wordsSolved || (a.sequenceElapsedMs ?? Infinity) - (b.sequenceElapsedMs ?? Infinity)
    : Number(b.status === 'won') - Number(a.status === 'won') || a.attempts - b.attempts || (a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity));
  const leader = ranked[0];
  const runnerUp = ranked[1];
  const tied = leader && runnerUp && (room.gameMode === 'SEQUENCIA'
    ? leader.wordsSolved === runnerUp.wordsSolved && leader.sequenceElapsedMs === runnerUp.sequenceElapsedMs
    : leader.status === runnerUp.status && leader.attempts === runnerUp.attempts && leader.elapsedMs === runnerUp.elapsedMs);
  if (leader && !tied) leader.wins++;
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
  socket.on('room:create', ({ name, gameMode, durationMinutes, sequenceLength }, callback) => {
    if (gameMode !== 'TERMO' && gameMode !== 'DUETO' && gameMode !== 'QUARTETO' && gameMode !== 'SEQUENCIA') return callback({ error: 'Modo de jogo inválido.' });
    if (!Number.isInteger(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) return callback({ error: 'A duração deve ser de 1 a 10 minutos.' });
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
    const room: Room = { code: roomCode, hostId: playerId, solution: '', solutions: [], players: new Map(), phase: 'lobby', gameMode, durationMinutes, sequenceLength: requestedSequenceLength, endsAt: null };
    const player: Player = { id: playerId, resumeToken, name: name.trim().slice(0, 18) || 'Jogador', socketId: socket.id, attempts: 0, guesses: [], status: 'playing', wins: 0, returnedToLobby: false, wordsSolved: 0, wordIndex: 0, sequenceWords: [], sequenceProgress: [] };
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
    const player: Player = { id: playerId, resumeToken, name: name.trim().slice(0, 18) || 'Jogador', socketId: socket.id, attempts: 0, guesses: [], status: joinedDuringRound ? 'waiting' : 'playing', wins: 0, returnedToLobby: false, wordsSolved: 0, wordIndex: 0, sequenceWords: [], sequenceProgress: [] };
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
  socket.on('room:update-settings', ({ gameMode, durationMinutes, sequenceLength }) => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const playerId = room && [...room.players.values()].find((player) => player.socketId === socket.id)?.id;
    if (!room || room.phase !== 'lobby' || room.hostId !== playerId) return;
    if (gameMode !== 'TERMO' && gameMode !== 'DUETO' && gameMode !== 'QUARTETO' && gameMode !== 'SEQUENCIA') return socket.emit('match:error', 'Modo de jogo inválido.');
    if (!Number.isInteger(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) return socket.emit('match:error', 'A duração deve ser de 1 a 10 minutos.');
    const nextSequenceLength = sequenceLength ?? room.sequenceLength;
    if (!Number.isInteger(nextSequenceLength) || nextSequenceLength < 2 || nextSequenceLength > 10) return socket.emit('match:error', 'A sequência deve ter de 2 a 10 palavras.');
    room.gameMode = gameMode;
    room.durationMinutes = durationMinutes;
    room.sequenceLength = nextSequenceLength;
    broadcast(room);
    broadcastRooms();
  });
  socket.on('match:start', () => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    if (!room || room.phase !== 'lobby') return;
    const playerId = [...room.players.values()].find((player) => player.socketId === socket.id)?.id;
    if (room.hostId !== playerId) return socket.emit('match:error', 'Somente o anfitrião pode iniciar a partida.');
    room.solutions = room.gameMode === 'SEQUENCIA' ? [] : [WordService.getRandomWord()];
    const boardCount = room.gameMode === 'QUARTETO' ? 4 : room.gameMode === 'DUETO' ? 2 : 1;
    while (room.gameMode !== 'SEQUENCIA' && room.solutions.length < boardCount) {
      const nextWord = WordService.getRandomWord();
      if (!room.solutions.includes(nextWord)) room.solutions.push(nextWord);
    }
    room.solution = room.solutions[0];
    for (const player of room.players.values()) {
      player.attempts = 0; player.guesses = []; player.elapsedMs = undefined;
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
    if (room.gameMode === 'SEQUENCIA' && (player.sequenceProgress[player.wordIndex]?.solved || player.sequenceProgress[player.wordIndex]?.attempts >= guessLimitFor(room.gameMode))) return;
    const guess = word.trim().toLocaleUpperCase('pt-BR');
    if (!WordService.isValidFormat(guess)) return socket.emit('match:error', 'A palavra precisa ter 5 letras.');
    if (!WordService.isValidGuess(guess)) return socket.emit('match:error', 'Essa palavra não está no nosso dicionário.');
    const activeSolutions = room.gameMode === 'SEQUENCIA' ? [player.currentSolution ?? room.solution] : room.solutions;
    const currentWordGuesses = room.gameMode === 'SEQUENCIA' ? player.sequenceProgress[player.wordIndex].guesses : player.guesses;
    const solvedBefore = activeSolutions.map((solution) => currentWordGuesses.some((pastGuess) => {
      const pastResults = pastGuess.results ?? [pastGuess.result];
      return pastResults[activeSolutions.indexOf(solution)]?.every((tile) => tile === 'correct');
    }));
    const results = activeSolutions.map((solution, index) => solvedBefore[index] ? null : WordService.score(guess, solution));
    const firstResult = results.find((result): result is TileStatus[] => result !== null) ?? WordService.score(guess, activeSolutions[0]);
    player.guesses.push({ word: guess, result: firstResult, ...((room.gameMode === 'DUETO' || room.gameMode === 'QUARTETO') ? { results } : {}), revealedWord: WordService.getCanonicalWord(guess) ?? guess }); player.attempts++;
    const solvedNow = activeSolutions.map((_, index) => solvedBefore[index] || results[index]?.every((tile) => tile === 'correct') === true);
    if (room.gameMode === 'SEQUENCIA') {
      const solvedWord = solvedNow.every(Boolean);
      const progress = player.sequenceProgress[player.wordIndex];
      progress.guesses = player.guesses;
      progress.attempts = player.attempts;
      progress.solved = solvedWord;
      player.guesses = progress.guesses;
      player.wordsSolved = player.sequenceProgress.filter((entry) => entry.solved).length;
      if (player.wordsSolved === room.sequenceLength) {
        player.status = 'won';
        player.sequenceElapsedMs = Date.now() - (player.sequenceStartedAt ?? Date.now());
        player.elapsedMs = player.sequenceElapsedMs;
      }
    } else if (solvedNow.every(Boolean)) {
      player.status = 'won'; player.elapsedMs = Date.now() - (room.endsAt! - room.durationMinutes * 60 * 1000);
    } else if (player.attempts >= guessLimitFor(room.gameMode)) player.status = 'lost';
    const activePlayers = [...room.players.values()].filter((p) => p.status !== 'waiting');
    if (activePlayers.length > 0 && activePlayers.every((p) => p.status !== 'playing')) finish(room);
    else broadcast(room);
  });
  socket.on('match:give-up', () => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const player = room && [...room.players.values()].find((candidate) => candidate.socketId === socket.id);
    if (!room || room.phase !== 'playing' || !player || player.status !== 'playing') return;
    if (room.gameMode === 'SEQUENCIA') {
      player.status = 'lost';
    } else player.status = 'lost';
    broadcast(room);
    const activePlayers = [...room.players.values()].filter((participant) => participant.status !== 'waiting');
    if (activePlayers.length > 0 && activePlayers.every((participant) => participant.status !== 'playing')) finish(room);
  });
  socket.on('match:select-word', ({ wordIndex }) => {
    const room = rooms.get(socketRoom.get(socket.id) ?? '');
    const player = room && [...room.players.values()].find((candidate) => candidate.socketId === socket.id);
    if (!room || room.phase !== 'playing' || room.gameMode !== 'SEQUENCIA' || !player || player.status !== 'playing') return;
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
    room.phase = 'lobby'; room.endsAt = null; room.solution = ''; room.solutions = [];
    if (room.timer) clearTimeout(room.timer);
    room.timer = undefined;
    for (const participant of room.players.values()) {
      participant.status = 'playing'; participant.attempts = 0; participant.guesses = []; participant.elapsedMs = undefined;
      participant.returnedToLobby = false;
      participant.wordsSolved = 0; participant.wordIndex = 0; participant.sequenceStartedAt = undefined; participant.sequenceElapsedMs = undefined; participant.sequenceWords = []; participant.currentSolution = undefined; participant.sequenceProgress = [];
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