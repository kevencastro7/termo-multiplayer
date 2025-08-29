import React from 'react';

interface GuessResult {
  guess: string;
  result: Array<{ letter: string; status: 'correct' | 'present' | 'absent' }>;
}

interface VirtualKeyboardProps {
  onKeyPress: (key: string) => void;
  guesses: GuessResult[];
}

const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({ onKeyPress, guesses }) => {
  // Calculate the best status for each letter across all guesses
  const getLetterStatus = (letter: string): 'correct' | 'present' | 'absent' | 'unused' => {
    let bestStatus: 'correct' | 'present' | 'absent' | 'unused' = 'unused';

    for (const guess of guesses) {
      for (const result of guess.result) {
        if (result.letter === letter) {
          if (result.status === 'correct') {
            return 'correct'; // Best status, return immediately
          } else if (result.status === 'present') {
            if (bestStatus === 'unused') {
              bestStatus = 'present';
            }
            // Keep present if it was already present, don't downgrade to absent
          } else if (result.status === 'absent') {
            if (bestStatus === 'unused') {
              bestStatus = 'absent';
            }
            // Don't change if already present or correct
          }
        }
      }
    }

    return bestStatus;
  };
  const rows = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACKSPACE']
  ];

  const handleKeyClick = (key: string) => {
    onKeyPress(key);
  };

  const getKeyClass = (key: string) => {
    if (key === 'ENTER') return 'key enter';
    if (key === 'BACKSPACE') return 'key backspace';

    const status = getLetterStatus(key);
    return `key letter ${status}`;
  };

  return (
    <div className="virtual-keyboard">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="keyboard-row">
          {row.map((key) => (
            <button
              key={key}
              className={getKeyClass(key)}
              onClick={() => handleKeyClick(key)}
              type="button"
            >
              {key === 'BACKSPACE' ? '⌫' : key}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

export default VirtualKeyboard;
