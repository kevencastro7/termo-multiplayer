import React from 'react';
import { GameProvider } from './hooks/useGame';
import { SocketProvider } from './hooks/useSocket';
import Game from './pages/Game';
import './styles/global.css';

function App() {
  return (
    <SocketProvider>
      <GameProvider>
        <div className="app">
          <Game />
        </div>
      </GameProvider>
    </SocketProvider>
  );
}

export default App;
