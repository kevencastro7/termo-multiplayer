import React, { createContext, useContext, useEffect, useReducer, useCallback } from 'react';
import { useSocket } from './useSocket';

interface Player {
  id: string;
  name: string;
  isLeader: boolean;
}

interface GuessResult {
  guess: string;
  result: Array<{ letter: string; status: 'correct' | 'present' | 'absent' }>;
}

interface PlayerRanking {
  playerId: string;
  playerName: string;
  guessesUsed: number;
  timeTaken?: number;
  status: 'won' | 'lost';
  rank: number;
}

interface GameState {
  // Connection state
  isConnected: boolean;

  // Room state
  roomId: string | null;
  roomCode: string | null;
  players: Player[];
  playerCount: number;

  // Player state
  currentPlayer: Player | null;
  isLeader: boolean;

  // Game state
  gameStatus: 'waiting' | 'playing' | 'finished';
  currentGuess: string;
  guesses: GuessResult[];
  currentRow: number;

  // Rankings
  rankings: PlayerRanking[];

  // UI state
  showError: boolean;
  errorMessage: string;
  isLoading: boolean;
}

type GameAction =
  | { type: 'CONNECT' }
  | { type: 'DISCONNECT' }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'ROOM_CREATED'; payload: { room: any; player: Player } }
  | { type: 'ROOM_JOINED'; payload: { room: any; player: Player } }
  | { type: 'PLAYER_JOINED'; payload: { player: Player; players: Player[]; playerCount: number } }
  | { type: 'PLAYER_LEFT'; payload: { players: Player[]; playerCount: number; newLeader?: string } }
  | { type: 'ROOM_DESTROYED'; payload: { reason: string; message: string } }
  | { type: 'GAME_STARTED'; payload: { gameId: string; startTime: Date; timeLimit?: number } }
  | { type: 'GUESS_RESULT'; payload: GuessResult & { currentRow: number; status: string } }
  | { type: 'PLAYER_PROGRESS'; payload: { playerId: string; currentRow: number; status: string } }
  | { type: 'GAME_FINISHED'; payload: { rankings: any[] } }
  | { type: 'GAME_ENDED_NO_RESULTS'; payload: { reason: string; message: string } }
  | { type: 'GAME_RESET'; payload: { gameId: string } }
  | { type: 'UPDATE_CURRENT_GUESS'; payload: string };

const initialState: GameState = {
  isConnected: false,
  roomId: null,
  roomCode: null,
  players: [],
  playerCount: 0,
  currentPlayer: null,
  isLeader: false,
  gameStatus: 'waiting',
  currentGuess: '',
  guesses: [],
  currentRow: 0,
  rankings: [],
  showError: false,
  errorMessage: '',
  isLoading: false,
};

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'CONNECT':
      return { ...state, isConnected: true };

    case 'DISCONNECT':
      return { ...initialState };

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'SET_ERROR':
      return {
        ...state,
        showError: true,
        errorMessage: action.payload,
        isLoading: false
      };

    case 'CLEAR_ERROR':
      return { ...state, showError: false, errorMessage: '' };

    case 'ROOM_CREATED':
      return {
        ...state,
        roomId: action.payload.room.id,
        roomCode: action.payload.room.code,
        players: action.payload.room.players,
        playerCount: action.payload.room.playerCount,
        currentPlayer: action.payload.player,
        isLeader: action.payload.player.isLeader,
        isLoading: false,
      };

    case 'ROOM_JOINED':
      return {
        ...state,
        roomId: action.payload.room.id,
        roomCode: action.payload.room.code,
        players: action.payload.room.players,
        playerCount: action.payload.room.playerCount,
        currentPlayer: action.payload.player,
        isLeader: action.payload.player.isLeader,
        isLoading: false,
      };

    case 'PLAYER_JOINED':
      return {
        ...state,
        players: action.payload.players,
        playerCount: action.payload.playerCount,
      };

    case 'PLAYER_LEFT':
      return {
        ...state,
        players: action.payload.players,
        playerCount: action.payload.playerCount,
        isLeader: action.payload.newLeader ? state.currentPlayer?.name === action.payload.newLeader : state.isLeader,
      };

    case 'ROOM_DESTROYED':
      return {
        ...state,
        roomId: null,
        roomCode: null,
        players: [],
        playerCount: 0,
        currentPlayer: null,
        isLeader: false,
        gameStatus: 'waiting',
        currentGuess: '',
        guesses: [],
        currentRow: 0,
        rankings: [],
      };

    case 'GAME_STARTED':
      return {
        ...state,
        gameStatus: 'playing',
        currentGuess: '',
        guesses: [],
        currentRow: 0,
      };

    case 'GUESS_RESULT':
      return {
        ...state,
        guesses: [...state.guesses, action.payload],
        currentGuess: '',
        currentRow: action.payload.currentRow,
      };

    case 'PLAYER_PROGRESS':
      // Update other players' progress (we don't store their guesses, just progress)
      return state;

    case 'GAME_FINISHED':
      return {
        ...state,
        gameStatus: 'finished',
        rankings: action.payload.rankings || [],
      };

    case 'GAME_ENDED_NO_RESULTS':
      return {
        ...state,
        gameStatus: 'finished',
        rankings: [], // No rankings for insufficient players
      };

    case 'GAME_RESET':
      return {
        ...state,
        gameStatus: 'waiting',
        currentGuess: '',
        guesses: [],
        currentRow: 0,
      };

    case 'UPDATE_CURRENT_GUESS':
      return {
        ...state,
        currentGuess: action.payload,
      };

    default:
      return state;
  }
}

interface GameContextType {
  state: GameState;
  actions: {
    connect: () => void;
    createRoom: (playerName: string, password?: string) => void;
    joinRoom: (roomCode: string, playerName: string, password?: string) => void;
    startGame: () => void;
    submitGuess: (guess: string) => void;
    resetGame: () => void;
    updateCurrentGuess: (guess: string) => void;
    clearError: () => void;
  };
}

const GameContext = createContext<GameContextType | null>(null);

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
};

interface GameProviderProps {
  children: React.ReactNode;
}

export const GameProvider: React.FC<GameProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const { socket, isConnected, connect } = useSocket();

  // Handle socket connection
  useEffect(() => {
    if (isConnected) {
      dispatch({ type: 'CONNECT' });
    } else {
      dispatch({ type: 'DISCONNECT' });
    }
  }, [isConnected]);

  // Set up socket event listeners
  useEffect(() => {
    if (!socket) return;

    const handleRoomCreated = (data: any) => {
      dispatch({ type: 'ROOM_CREATED', payload: data });
    };

    const handleRoomJoined = (data: any) => {
      dispatch({ type: 'ROOM_JOINED', payload: data });
    };

    const handlePlayerJoined = (data: any) => {
      dispatch({ type: 'PLAYER_JOINED', payload: data });
    };

    const handlePlayerLeft = (data: any) => {
      dispatch({ type: 'PLAYER_LEFT', payload: data });
    };

    const handleRoomDestroyed = (data: any) => {
      dispatch({ type: 'ROOM_DESTROYED', payload: data });
    };

    const handleGameStarted = (data: any) => {
      dispatch({ type: 'GAME_STARTED', payload: data });
    };

    const handleGuessResult = (data: any) => {
      dispatch({ type: 'GUESS_RESULT', payload: data });
    };

    const handlePlayerProgress = (data: any) => {
      dispatch({ type: 'PLAYER_PROGRESS', payload: data });
    };

    const handleGameFinished = (data: any) => {
      dispatch({ type: 'GAME_FINISHED', payload: data });
    };

    const handleGameEndedNoResults = (data: any) => {
      dispatch({ type: 'GAME_ENDED_NO_RESULTS', payload: data });
    };

    const handleGameReset = (data: any) => {
      dispatch({ type: 'GAME_RESET', payload: data });
    };

    const handleError = (data: any) => {
      dispatch({ type: 'SET_ERROR', payload: data.message });
    };

    socket.on('room-created', handleRoomCreated);
    socket.on('room-joined', handleRoomJoined);
    socket.on('player-joined', handlePlayerJoined);
    socket.on('player-left', handlePlayerLeft);
    socket.on('room-destroyed', handleRoomDestroyed);
    socket.on('game-started', handleGameStarted);
    socket.on('guess-result', handleGuessResult);
    socket.on('player-progress', handlePlayerProgress);
    socket.on('game-finished', handleGameFinished);
    socket.on('game-ended-no-results', handleGameEndedNoResults);
    socket.on('game-reset', handleGameReset);
    socket.on('error', handleError);

    return () => {
      socket.off('room-created', handleRoomCreated);
      socket.off('room-joined', handleRoomJoined);
      socket.off('player-joined', handlePlayerJoined);
      socket.off('player-left', handlePlayerLeft);
      socket.off('room-destroyed', handleRoomDestroyed);
      socket.off('game-started', handleGameStarted);
      socket.off('guess-result', handleGuessResult);
      socket.off('player-progress', handlePlayerProgress);
      socket.off('game-finished', handleGameFinished);
      socket.off('game-ended-no-results', handleGameEndedNoResults);
      socket.off('game-reset', handleGameReset);
      socket.off('error', handleError);
    };
  }, [socket]);

  const actions = {
    connect,

    createRoom: useCallback((playerName: string, password?: string) => {
      if (!socket || !isConnected) {
        dispatch({ type: 'SET_ERROR', payload: 'Não conectado ao servidor' });
        return;
      }

      dispatch({ type: 'SET_LOADING', payload: true });
      socket.emit('create-room', { playerName, password });
    }, [socket, isConnected]),

    joinRoom: useCallback((roomCode: string, playerName: string, password?: string) => {
      if (!socket || !isConnected) {
        dispatch({ type: 'SET_ERROR', payload: 'Não conectado ao servidor' });
        return;
      }

      dispatch({ type: 'SET_LOADING', payload: true });
      socket.emit('join-room', { roomCode, playerName, password });
    }, [socket, isConnected]),

    startGame: useCallback(() => {
      if (!socket || !state.roomId || !state.currentPlayer) {
        dispatch({ type: 'SET_ERROR', payload: 'Sala ou jogador não encontrado' });
        return;
      }

      socket.emit('start-game', {
        roomId: state.roomId,
        playerId: state.currentPlayer.id
      });
    }, [socket, state.roomId, state.currentPlayer]),

    submitGuess: useCallback((guess: string) => {
      if (!socket || !state.roomId || !state.currentPlayer) {
        dispatch({ type: 'SET_ERROR', payload: 'Sala ou jogador não encontrado' });
        return;
      }

      if (guess.length !== 5) {
        dispatch({ type: 'SET_ERROR', payload: 'Palavra deve ter 5 letras' });
        return;
      }

      socket.emit('submit-guess', {
        roomId: state.roomId,
        playerId: state.currentPlayer.id,
        guess: guess.toUpperCase()
      });
    }, [socket, state.roomId, state.currentPlayer]),

    resetGame: useCallback(() => {
      if (!socket || !state.roomId || !state.currentPlayer) {
        dispatch({ type: 'SET_ERROR', payload: 'Sala ou jogador não encontrado' });
        return;
      }

      socket.emit('reset-game', {
        roomId: state.roomId,
        playerId: state.currentPlayer.id
      });
    }, [socket, state.roomId, state.currentPlayer]),

    updateCurrentGuess: useCallback((guess: string) => {
      dispatch({ type: 'UPDATE_CURRENT_GUESS', payload: guess });
    }, []),

    clearError: useCallback(() => {
      dispatch({ type: 'CLEAR_ERROR' });
    }, []),
  };

  const value: GameContextType = {
    state,
    actions,
  };

  return (
    <GameContext.Provider value={value}>
      {children}
    </GameContext.Provider>
  );
};
