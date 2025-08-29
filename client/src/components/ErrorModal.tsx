import React from 'react';

interface ErrorModalProps {
  message: string;
  onClose: () => void;
}

const ErrorModal: React.FC<ErrorModalProps> = ({ message, onClose }) => {
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="error-modal-overlay" onClick={handleOverlayClick}>
      <div className="error-modal">
        <div className="error-icon">⚠️</div>
        <h3>Erro</h3>
        <p>{message}</p>
        <button onClick={onClose} className="error-close-button">
          Fechar
        </button>
      </div>
    </div>
  );
};

export default ErrorModal;
