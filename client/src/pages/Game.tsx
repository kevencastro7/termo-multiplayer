import React, { useEffect, useState } from 'react';
import { useGame } from '../hooks/useGame';
import { useSocket } from '../hooks/useSocket';
import ConnectionScreen from '../components/ConnectionScreen';
import RoomScreen from '../components/RoomScreen';
import GameBoard from '../components/GameBoard';
import ErrorModal from '../components/ErrorModal';
import './Game.css';

const Game: React.FC = () => {
  const { state, actions } = useGame();
  const { connect } = useSocket();
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [cursorPosition, setCursorPosition] = useState<number>(0);

  // Auto-connect on mount
  useEffect(() => {
    connect();
  }, [connect]);

  // Reset cursor to first tile when moving to a new guess
  useEffect(() => {
    if (state.gameStatus === 'playing') {
      setCursorPosition(0); // Always select first tile on new guess
    }
  }, [state.currentRow, state.gameStatus]);

  const handleCreateRoom = (playerName: string, password?: string) => {
    actions.createRoom(playerName, password);
  };

  const handleJoinRoom = (roomCode: string, playerName: string, password?: string) => {
    actions.joinRoom(roomCode, playerName, password);
  };

  const handleStartGame = () => {
    actions.startGame();
  };

  const handleResetGame = () => {
    actions.resetGame();
  };

  const handleKeyPress = (key: string) => {
    if (key === 'ENTER') {
      if (state.currentGuess.length === 5) {
        actions.submitGuess(state.currentGuess);
      }
    } else if (key === 'BACKSPACE') {
      if (cursorPosition >= 0) {
        // Replace character at current cursor position with empty space
        // Pad the current guess to 5 characters to maintain positions
        const paddedGuess = state.currentGuess.padEnd(5, ' ');
        const newGuess = paddedGuess.slice(0, cursorPosition) + ' ' + paddedGuess.slice(cursorPosition + 1);
        actions.updateCurrentGuess(newGuess.trimRight());
        setCursorPosition(Math.max(0, cursorPosition - 1));
      }
    } else if (cursorPosition < 5 && key.match(/^[A-Z]$/)) {
      // Insert character at cursor position - always allow typing at any position
      // Pad the current guess to 5 characters to maintain positions
      const paddedGuess = state.currentGuess.padEnd(5, ' ');
      const newGuess = paddedGuess.slice(0, cursorPosition) + key + paddedGuess.slice(cursorPosition + 1);
      actions.updateCurrentGuess(newGuess.trimRight());
      // Only move cursor if not at the last position
      if (cursorPosition < 4) {
        setCursorPosition(cursorPosition + 1);
      }
    }
  };

  // Show connection screen if not connected
  if (!state.isConnected) {
    return <ConnectionScreen onRetry={connect} />;
  }

  // Show room screen if not in a room
  if (!state.roomId) {
    return (
      <RoomScreen
        playerName={playerName}
        roomCode={roomCode}
        onPlayerNameChange={setPlayerName}
        onRoomCodeChange={setRoomCode}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
        isLoading={state.isLoading}
      />
    );
  }

  return (
    <div className="game-container">
      <div className="game-header">
        <div className="room-info">
          <h2>Sala: {state.roomCode}</h2>
          <p>Jogadores: {state.playerCount}</p>
          {state.isLeader && <span className="leader-badge">Líder</span>}
        </div>

      </div>

      <div className="game-content">
        {state.gameStatus === 'waiting' && state.isLeader && (
          <div className="waiting-screen">
            <h3>Aguardando jogadores...</h3>
            <p>Convide seus amigos para a sala: <strong>{state.roomCode}</strong></p>
            <button
              onClick={handleStartGame}
              disabled={state.players.length < 2}
              className="start-button"
            >
              {state.players.length < 2 ? 'Aguardando mais jogadores' : 'Iniciar Jogo'}
            </button>
          </div>
        )}

        {state.gameStatus === 'waiting' && !state.isLeader && (
          <div className="waiting-screen">
            <h3>Aguardando o líder iniciar o jogo...</h3>
            <div className="loading-spinner"></div>
          </div>
        )}

        {(state.gameStatus === 'playing' || state.gameStatus === 'finished') && (
          <>
            {state.validationMessage && (
              <div className="validation-message">
                {state.validationMessage}
              </div>
            )}
            <GameBoard
              guesses={state.guesses}
              currentGuess={state.currentGuess}
              currentRow={state.currentRow}
              gameStatus={state.gameStatus}
              onKeyPress={handleKeyPress}
              cursorPosition={cursorPosition}
              onTileClick={setCursorPosition}
            />
          </>
        )}

        {state.gameStatus === 'finished' && (
          <div className="finished-screen">
            <h3>Jogo Finalizado!</h3>

            {/* Rankings Display */}
            {state.rankings.length > 0 && (
              <div className="rankings-section">
                <h4>Classificação Final</h4>
                <div className="rankings-list">
                  {state.rankings.map((ranking, _index) => (
                    <div
                      key={ranking.playerId}
                      className={`ranking-item ${ranking.playerId === state.currentPlayer?.id ? 'current-player' : ''}`}
                    >
                      <div className="rank-position">
                        {ranking.rank === 1 && '🥇'}
                        {ranking.rank === 2 && '🥈'}
                        {ranking.rank === 3 && '🥉'}
                        {ranking.rank > 3 && `#${ranking.rank}`}
                      </div>
                      <div className="player-info">
                        <span className="player-name">{ranking.playerName}</span>
                        <span className="player-stats">
                          {ranking.guessesUsed} tentativas • {ranking.status === 'won' ? 'Venceu' : 'Perdeu'}
                        </span>
                      </div>
                      <div className="rank-badge">
                        {ranking.status === 'won' ? '🏆' : '❌'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {state.isLeader && (
              <button onClick={handleResetGame} className="reset-button">
                Jogar Novamente
              </button>
            )}
          </div>
        )}
      </div>

      {/* Player List at Bottom */}
      <div className="players-list-bottom">
        {state.players.map(player => (
          <div key={player.id} className={`player-item ${player.isLeader ? 'leader' : ''}`}>
            <span className="player-name">{player.name}</span>
            {player.isLeader && <span className="crown">👑</span>}
            {state.gameStatus === 'playing' && player.currentRow !== undefined && (
              <span className="player-progress">
                {player.status === 'won' ? '✅' : player.status === 'lost' ? '❌' : `Tentativa ${player.currentRow + 1}`}
              </span>
            )}
          </div>
        ))}
      </div>

      {state.showError && (
        <ErrorModal
          message={state.errorMessage}
          onClose={actions.clearError}
        />
      )}
    </div>
  );
};

export default Game;
