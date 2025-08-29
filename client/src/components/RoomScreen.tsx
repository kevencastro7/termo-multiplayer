import React, { useState, useEffect } from 'react';

interface PublicRoomInfo {
  id: string;
  code: string;
  playerCount: number;
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'finished';
  isPrivate: boolean;
  createdAt: Date;
}

interface RoomScreenProps {
  playerName: string;
  roomCode: string;
  onPlayerNameChange: (name: string) => void;
  onRoomCodeChange: (code: string) => void;
  onCreateRoom: (playerName: string, password?: string) => void;
  onJoinRoom: (roomCode: string, playerName: string, password?: string) => void;
  isLoading: boolean;
}

const RoomScreen: React.FC<RoomScreenProps> = ({
  playerName,
  roomCode,
  onPlayerNameChange,
  onRoomCodeChange,
  onCreateRoom,
  onJoinRoom,
  isLoading
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [publicRooms, setPublicRooms] = useState<PublicRoomInfo[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<PublicRoomInfo | null>(null);
  const [joinPassword, setJoinPassword] = useState('');

  // Fetch public rooms on mount
  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/rooms');
        if (response.ok) {
          const rooms = await response.json();
          setPublicRooms(rooms);
        }
      } catch (error) {
        console.error('Failed to fetch rooms:', error);
      }
    };

    fetchRooms();
  }, []);

  const handleSubmit = (e: React.FormEvent, action: () => void) => {
    e.preventDefault();
    action();
  };

  const handleCreateRoom = () => {
    onCreateRoom(playerName.trim(), showPassword ? password : undefined);
  };

  const handleJoinRoom = () => {
    onJoinRoom(roomCode.trim().toUpperCase(), playerName.trim());
  };

  const handleRoomClick = (room: PublicRoomInfo) => {
    if (room.isPrivate) {
      setSelectedRoom(room);
      setJoinPassword('');
    } else {
      onRoomCodeChange(room.code);
      onJoinRoom(room.code, playerName.trim());
    }
  };

  const handlePrivateRoomJoin = () => {
    if (selectedRoom && joinPassword.trim()) {
      onJoinRoom(selectedRoom.code, playerName.trim(), joinPassword.trim());
      setSelectedRoom(null);
      setJoinPassword('');
    }
  };

  // Validation
  const isNameValid = playerName.trim().length > 0 && playerName.trim().length <= 20;
  const nameError = !playerName.trim() ? 'Nome é obrigatório' :
                   playerName.length > 20 ? 'Nome muito longo (máx. 20 caracteres)' : '';

  return (
    <div className="room-screen">
      <div className="room-content">
        <h1>Termo Multiplayer</h1>
        <p>Desafie seus amigos neste jogo de palavras!</p>

        {/* Unified Name Input */}
        <div className="name-section">
          <label htmlFor="playerName" className="name-label">Seu Nome</label>
          <input
            id="playerName"
            type="text"
            placeholder="Digite seu nome"
            value={playerName}
            onChange={(e) => onPlayerNameChange(e.target.value)}
            maxLength={20}
            className={`name-input ${!isNameValid && playerName ? 'error' : isNameValid ? 'valid' : ''}`}
            disabled={isLoading}
            autoFocus
          />
          {nameError && <span className="name-error">{nameError}</span>}
        </div>

        <div className="room-forms">
          <form onSubmit={(e) => handleSubmit(e, handleCreateRoom)} className="room-form">
            <h3>Criar Nova Sala</h3>

            <div className="password-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                  disabled={isLoading || !isNameValid}
                />
                Sala privada (com senha)
              </label>
            </div>

            {showPassword && (
              <input
                type="password"
                placeholder="Senha da sala"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={20}
                disabled={isLoading || !isNameValid}
              />
            )}

            <button
              type="submit"
              disabled={!isNameValid || isLoading}
              className="create-button"
            >
              {isLoading ? 'Criando...' : 'Criar Sala'}
            </button>
          </form>

          <div className="divider">
            <span>OU</span>
          </div>

          <div className="room-form">
            <h3>Entrar em Sala</h3>

            <div className="room-input-group">
              <input
                type="text"
                placeholder="Código da sala (ex: ABC123)"
                value={roomCode}
                onChange={(e) => onRoomCodeChange(e.target.value.toUpperCase())}
                maxLength={6}
                pattern="[A-Z0-9]{6}"
                disabled={isLoading || !isNameValid}
              />
            </div>

            <button
              onClick={handleJoinRoom}
              disabled={!isNameValid || !roomCode.trim() || roomCode.length !== 6 || isLoading}
              className="join-button"
            >
              {isLoading ? 'Entrando...' : 'Entrar na Sala'}
            </button>
          </div>
        </div>

        {/* Always Visible Room List */}
        <div className="room-list">
          <h4>Salas Disponíveis</h4>
          {publicRooms.length === 0 ? (
            <p className="no-rooms">Nenhuma sala disponível no momento</p>
          ) : (
            <div className="room-items">
              {publicRooms.map((room) => (
                <div
                  key={room.id}
                  className={`room-item ${room.isPrivate ? 'private' : 'public'} ${!isNameValid ? 'disabled' : ''}`}
                  onClick={() => isNameValid && handleRoomClick(room)}
                >
                  <div className="room-info">
                    <span className="room-code">{room.code}</span>
                    {room.isPrivate && <span className="lock-icon">🔒</span>}
                    <span className="room-status">{room.status}</span>
                  </div>
                  <div className="room-details">
                    <span>{room.playerCount}/{room.maxPlayers} jogadores</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="game-rules">
          <h4>Como Jogar:</h4>
          <ul>
            <li>Adivinhe a palavra de 5 letras em até 6 tentativas</li>
            <li>🟢 Verde = letra correta na posição certa</li>
            <li>🟡 Amarelo = letra existe, mas posição errada</li>
            <li>⚫ Cinza = letra não existe na palavra</li>
            <li>Jogador com menos tentativas vence!</li>
          </ul>
        </div>
      </div>

      {/* Password Modal for Private Rooms */}
      {selectedRoom && (
        <div className="modal-overlay" onClick={() => setSelectedRoom(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Entrar na Sala Privada</h3>
            <p>Sala: {selectedRoom.code}</p>
            <input
              type="password"
              placeholder="Digite a senha"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              maxLength={20}
              autoFocus
            />
            <div className="modal-buttons">
              <button onClick={() => setSelectedRoom(null)}>Cancelar</button>
              <button
                onClick={handlePrivateRoomJoin}
                disabled={!joinPassword.trim()}
                className="join-button"
              >
                Entrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomScreen;
