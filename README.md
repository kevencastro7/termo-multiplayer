# 🎮 Termo Multiplayer - Portuguese Word Game

A real-time multiplayer word guessing game similar to Wordle/Termo, built with React, Node.js, Socket.io, and TypeScript. Features Portuguese language support with 5,000+ scientifically selected words.

## ✨ Features

- 🎯 **Real-time multiplayer** with Socket.io
- 🇵🇹 **Portuguese language** with accent support
- 📱 **Responsive design** for mobile and desktop
- 🎨 **Modern UI** with smooth animations
- 🔒 **Room-based gameplay** with private rooms
- 📊 **Game statistics** and rankings
- 🌐 **PWA ready** for mobile installation

## 🚀 Quick Deploy to Railway

### 1. **Create Railway Account**
```bash
# Visit: https://railway.app
# Sign up with GitHub
```

### 2. **Deploy Your Game**
```bash
# Connect your GitHub repository to Railway
# Railway will auto-detect your setup and deploy
```

### 3. **Set Environment Variables**
```bash
NODE_ENV=production
CLIENT_URL=https://your-app-name.railway.app
```

### 4. **Your Game is Live! 🎉**
```
https://your-app-name.railway.app
```

## 🛠️ Local Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation
```bash
# Clone the repository
git clone <your-repo-url>
cd termo-multiplayer

# Install dependencies
npm install

# Start development servers
npm run dev
```

### Build for Production
```bash
# Build the application
npm run build

# Start production server
npm start
```

## 📁 Project Structure

```
termo-multiplayer/
├── 📂 client/                 # React frontend
│   ├── src/
│   │   ├── components/       # React components
│   │   ├── hooks/           # Custom React hooks
│   │   ├── pages/           # Game pages
│   │   └── styles/          # CSS styles
│   └── dist/                # Built frontend (generated)
├── 📂 server/                 # Node.js backend
│   ├── src/
│   │   ├── services/        # Business logic
│   │   ├── models/          # TypeScript interfaces
│   │   └── server.ts        # Express server
│   └── dist/                # Built backend (generated)
├── 📂 scripts/                # Utility scripts
├── 📄 railway.json           # Railway deployment config
├── 📄 package.json           # Workspace configuration
└── 📄 README.md             # This file
```

## 🎯 Game Features

### Multiplayer Modes
- **Real-time rooms** with up to 8 players
- **Private rooms** with passwords
- **Public lobbies** for quick play
- **Leader controls** for game management

### Portuguese Language
- **5,000+ words** from frequency corpus
- **Accent normalization** (ç, ã, õ, á, é, í, ó, ú)
- **Scientific selection** based on usage frequency
- **Virtual keyboard** with Portuguese keys

### Technical Features
- **WebSocket communication** for real-time updates
- **Responsive design** works on all devices
- **PWA capabilities** for mobile installation
- **TypeScript** for type safety
- **Modern build tools** (Vite, TSC)

## 🔧 Configuration

### Environment Variables
```bash
# Required
NODE_ENV=production
CLIENT_URL=https://your-app.railway.app

# Optional
PORT=3001
```

### Railway Configuration
The `railway.json` file configures:
- Build command: `npm run build`
- Start command: `npm start`
- Health check endpoint: `/health`
- Auto-scaling and restart policies

## 📊 Word Selection

Words are selected from the **Portuguese Frequency Corpus** using:
- **Inverse Corpus Frequency (ICF)** analysis
- **5-letter words only**
- **Scientific frequency ranking**
- **Accent preservation**

### Word Statistics
- **Total words**: 5,000
- **ICF range**: 6.14 - 15.94
- **Words with accents**: 820 (16.4%)
- **Source**: GitHub frequency corpus

## 🎨 Customization

### Adding More Words
```bash
# Run the word extraction script
node scripts/extract-top-5000-words.js

# Or modify the word count
const TOP_WORDS_COUNT = 10000; // in the script
```

### Styling
- **CSS Modules** for component styling
- **Responsive breakpoints** for mobile/desktop
- **Dark/light theme** support ready

### Game Rules
- **6 attempts** per game
- **5-letter words** only
- **Real-time validation**
- **Color-coded feedback**

## 🚀 Deployment Options

### Railway (Recommended)
- ✅ **Free tier** available
- ✅ **WebSocket support**
- ✅ **Auto-scaling**
- ✅ **Git integration**

### Other Platforms
- **Render**: Similar to Railway
- **DigitalOcean**: More control
- **Vercel**: Frontend only (backend needs separate)
- **Heroku**: Traditional option

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

MIT License - feel free to use this project for learning or commercial purposes.

## 🙏 Acknowledgments

- **Portuguese word data** from [fserb/pt-br](https://github.com/fserb/pt-br)
- **Wordle/Termo** game concepts
- **Railway** for hosting platform
- **Socket.io** for real-time communication

---

**🎮 Ready to play? Deploy to Railway and start your multiplayer Termo game!**
