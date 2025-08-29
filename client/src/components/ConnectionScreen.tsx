import React from 'react';

interface ConnectionScreenProps {
  onRetry: () => void;
}

const ConnectionScreen: React.FC<ConnectionScreenProps> = ({ onRetry }) => {
  return (
    <div className="connection-screen">
      <div className="connection-content">
        <div className="connection-icon">🔌</div>
        <h2>Conectando ao servidor...</h2>
        <p>Tentando estabelecer conexão com o servidor de jogos.</p>
        <div className="loading-spinner"></div>
        <button onClick={onRetry} className="retry-button">
          Tentar Novamente
        </button>
      </div>
    </div>
  );
};

export default ConnectionScreen;
