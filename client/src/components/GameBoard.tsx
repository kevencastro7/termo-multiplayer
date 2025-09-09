import React, { useEffect } from 'react';
import VirtualKeyboard from './VirtualKeyboard';

interface GuessResult {
  guess: string;
  result: Array<{ letter: string; status: 'correct' | 'present' | 'absent' }>;
}

interface GameBoardProps {
  guesses: GuessResult[];
  currentGuess: string;
  currentRow: number;
  gameStatus: 'waiting' | 'playing' | 'finished';
  onKeyPress: (key: string, cursorPosition?: number) => void;
  cursorPosition: number;
  onTileClick: (position: number) => void;
}

const GameBoard: React.FC<GameBoardProps> = ({
  guesses,
  currentGuess,
  currentRow,
  gameStatus,
  onKeyPress,
  cursorPosition,
  onTileClick
}) => {
  // Handle tile click to set cursor position
  const handleTileClick = (position: number) => {
    if (gameStatus === 'playing') {
      onTileClick(position);
    }
  };

  // Handle physical keyboard input
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (gameStatus !== 'playing') return;

      const key = event.key.toUpperCase();

      // Allow A-Z and accented Portuguese characters for input
      if (key.match(/^[A-ZÇÃÕÂÊÔÎÛÁÉÍÓÚÀÈÌÒÙÄËÏÖÜáàãâäéèêëíìîïóòõôöúùûüç]$/)) {
        onKeyPress(key);
      }
      // Handle backspace
      else if (key === 'BACKSPACE' && currentGuess.length > 0) {
        onKeyPress('BACKSPACE');
      }
      // Handle enter
      else if (key === 'ENTER' && currentGuess.length === 5) {
        onKeyPress('ENTER');
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [gameStatus, currentGuess.length, onKeyPress]);
  // Create the 6x5 grid
  const renderGrid = () => {
    const rows = [];

    for (let row = 0; row < 6; row++) {
      const cells = [];

      for (let col = 0; col < 5; col++) {
        let letter = '';
        let status: 'correct' | 'present' | 'absent' | 'empty' | 'current' = 'empty';

        if (row < guesses.length) {
          // Completed row
          const guess = guesses[row];
          letter = guess.guess[col];
          status = guess.result[col].status;
        } else if (row === currentRow && gameStatus === 'playing') {
          // Current row being typed
          letter = currentGuess[col] || '';
          status = letter ? 'current' : 'empty';
        }

        const isSelected = row === currentRow && col === cursorPosition && gameStatus === 'playing';
        
        cells.push(
          <div
            key={`${row}-${col}`}
            className={`cell ${status} ${isSelected ? 'selected' : ''}`}
            onClick={() => handleTileClick(col)}
          >
            {letter}
          </div>
        );
      }

      rows.push(
        <div key={row} className="row">
          {cells}
        </div>
      );
    }

    return rows;
  };

  return (
    <div className="game-board">
      <div className="board-container">
        <div className="grid">
          {renderGrid()}
        </div>

        {gameStatus === 'playing' && (
          <div className="keyboard-section">
            <div className="keyboard-hint">
              💡 Use o teclado físico ou virtual abaixo
            </div>
            <VirtualKeyboard
              onKeyPress={onKeyPress}
              guesses={guesses}
            />
          </div>
        )}

        {gameStatus === 'finished' && (
          <div className="game-finished-message">
            <h3>Jogo Finalizado!</h3>
            <p>As classificações foram calculadas.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default GameBoard;
