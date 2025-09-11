import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import { RoomService } from './services/roomService';
import { GameService } from './services/gameService';
import { Player } from './models/Player';

const app = express();
const server = createServer(app);
const io = new SocketServer(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? true : process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

// Environment variables
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// Serve static files from client build in production
if (isProduction) {
  app.use(express.static(path.join(__dirname, '../../client/dist')));
}

// Store connected players (socketId -> playerId)
const connectedPlayers = new Map<string, string>();

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Create room
  socket.on('create-room', (data: { playerName: string }) => {
    try {
      const room = RoomService.createRoom(data, socket.id);
      const player = room.players[0];

      connectedPlayers.set(socket.id, player.id);
      socket.join(room.id);

      socket.emit('room-created', {
        room: {
          id: room.id,
          code: room.code,
          players: room.players.map(p => ({ id: p.id, name: p.name, isLeader: p.isLeader })),
          status: room.status,
          playerCount: room.players.length
        },
        player
      });

      console.log(`Room created: ${room.code} by ${player.name}`);
    } catch (error) {
      socket.emit('error', { message: (error as Error).message });
    }
  });

  // Join room
  socket.on('join-room', (data: { roomCode: string; playerName: string }) => {
    try {
      const result = RoomService.joinRoom(data, socket.id);

      if (!result) {
        socket.emit('error', { message: 'Sala não encontrada' });
        return;
      }

      const { room, player } = result;
      connectedPlayers.set(socket.id, player.id);
      socket.join(room.id);

      // Notify all players in room
      io.to(room.id).emit('player-joined', {
        player: { id: player.id, name: player.name, isLeader: player.isLeader },
        players: room.players.map(p => ({ id: p.id, name: p.name, isLeader: p.isLeader })),
        playerCount: room.players.length
      });

      // Send room info to new player
      socket.emit('room-joined', {
        room: {
          id: room.id,
          code: room.code,
          players: room.players.map(p => ({ id: p.id, name: p.name, isLeader: p.isLeader })),
          status: room.status,
          playerCount: room.players.length
        },
        player
      });

      console.log(`Player ${player.name} joined room: ${room.code}`);
    } catch (error) {
      socket.emit('error', { message: (error as Error).message });
    }
  });

  // Start game
  socket.on('start-game', async (data: { roomId: string; playerId: string }) => {
    try {
      const game = await RoomService.startGame(data.roomId, data.playerId);

      if (!game) {
        socket.emit('error', { message: 'Não foi possível iniciar o jogo' });
        return;
      }

      // Notify all players in room
      io.to(data.roomId).emit('game-started', {
        gameId: game.id,
        targetWord: game.targetWord, // Only for debugging, remove in production
        startTime: game.startTime,
        timeLimit: game.timeLimit
      });

      console.log(`Game started in room: ${data.roomId}`);
    } catch (error) {
      socket.emit('error', { message: (error as Error).message });
    }
  });

  // Submit guess
  socket.on('submit-guess', async (data: { roomId: string; playerId: string; guess: string }) => {
    try {
      const room = RoomService.getRoom(data.roomId);
      if (!room || !room.game) {
        socket.emit('error', { message: 'Jogo não encontrado' });
        return;
      }

      const player = room.players.find(p => p.id === data.playerId);
      if (!player) {
        socket.emit('error', { message: 'Jogador não encontrado' });
        return;
      }

      // Validate guess
      const result = await GameService.validateGuess(data.guess, room.game.targetWord);
      const guess = GameService.createGuess(data.guess, result);
      const updatedPlayer = GameService.updatePlayerAfterGuess(player, guess);

      // Update player in room
      RoomService.updatePlayer(data.roomId, updatedPlayer);

      // Send private result to guessing player
      socket.emit('guess-result', {
        guess: data.guess,
        result,
        currentRow: updatedPlayer.currentRow,
        status: updatedPlayer.status
      });

      // Send public progress to all players
      io.to(data.roomId).emit('player-progress', {
        playerId: data.playerId,
        playerName: player.name,
        currentRow: updatedPlayer.currentRow,
        status: updatedPlayer.status,
        isFinished: updatedPlayer.status === 'won' || updatedPlayer.status === 'lost'
      });

      // Check if game should end
      const gameEndResult = RoomService.checkGameEnd(data.roomId);
      if (gameEndResult.shouldEnd) {
        io.to(data.roomId).emit('game-finished', {
          rankings: gameEndResult.rankings
        });
        console.log(`Game finished in room: ${data.roomId}`);
      }

      console.log(`Player ${player.name} guessed: ${data.guess}`);
    } catch (error) {
      socket.emit('validation-message', { message: (error as Error).message });
    }
  });

  // Reset game
  socket.on('reset-game', async (data: { roomId: string; playerId: string }) => {
    try {
      const game = await RoomService.resetGame(data.roomId, data.playerId);

      if (!game) {
        socket.emit('error', { message: 'Não foi possível reiniciar o jogo' });
        return;
      }

      // Notify all players in room
      io.to(data.roomId).emit('game-reset', {
        gameId: game.id
      });

      console.log(`Game reset in room: ${data.roomId}`);
    } catch (error) {
      socket.emit('error', { message: (error as Error).message });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const playerId = connectedPlayers.get(socket.id);
    if (playerId) {
      // Find which room the player was in
      const rooms = RoomService.getAllRooms();
      for (const room of rooms) {
        const player = room.players.find(p => p.id === playerId);
        if (player) {
          const result = RoomService.removePlayer(room.id, playerId);

          if (result.destroyed) {
            // Room was destroyed
            if (result.reason === 'leader_left') {
              // Notify all players in the room that it was destroyed
              io.to(room.id).emit('room-destroyed', {
                reason: 'leader_left',
                message: 'Sala fechada - líder saiu'
              });
              console.log(`Room destroyed because leader left: ${room.code}`);
            }
          } else if (result.room) {
            // Room still exists, normal player left notification
            io.to(room.id).emit('player-left', {
              playerId,
              playerName: player.name,
              players: result.room.players.map(p => ({ id: p.id, name: p.name, isLeader: p.isLeader })),
              playerCount: result.room.players.length,
              newLeader: result.room.players.find(p => p.isLeader)?.name
            });

            // If there's an active game, mark the disconnected player as lost
            if (result.room.game && result.room.game.status === 'playing') {
              const gamePlayerIndex = result.room.game.players.findIndex(p => p.id === playerId);
              if (gamePlayerIndex !== -1) {
                // Mark player as lost in the game
                result.room.game.players[gamePlayerIndex].status = 'lost';
                result.room.game.players[gamePlayerIndex].finishTime = new Date();

                // Check if game should end now
                const gameEndResult = RoomService.checkGameEnd(room.id);
                if (gameEndResult.shouldEnd) {
                  io.to(room.id).emit('game-finished', {
                    rankings: gameEndResult.rankings
                  });
                  console.log(`Game finished after player ${player.name} disconnected: ${room.code}`);
                }
              }
            }
          }
          break;
        }
      }

      connectedPlayers.delete(socket.id);
    }

    console.log(`Player disconnected: ${socket.id}`);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Get room info (for debugging)
app.get('/api/rooms/:code', (req, res) => {
  const room = RoomService.getRoomByCode(req.params.code);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json({
    id: room.id,
    code: room.code,
    players: room.players.length,
    status: room.status
  });
});

// Get public room list
app.get('/api/rooms', (req, res) => {
  const publicRooms = RoomService.getPublicRooms();
  res.json(publicRooms);
});

// Serve React app for all other routes (client-side routing)
if (isProduction) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  });
}

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Client URL: ${process.env.CLIENT_URL || 'http://localhost:3000'}`);
});

// Cleanup inactive rooms every 5 minutes
setInterval(() => {
  RoomService.cleanupInactiveRooms();
}, 5 * 60 * 1000);
