# 🛡️ Seguro - Security-First AI Coding Assistant

**Seguro** is a world-class, security-first AI coding assistant delivered as a VS Code extension. It provides secure-by-default code suggestions, real-time vulnerability detection, spec-based code generation, and an intelligent chat interface - all powered by a secure cloud architecture.

## ✨ Key Features

### 🔍 **Real-time Security Analysis**
- Continuous vulnerability scanning as you code
- Detection of XSS, SQL injection, hardcoded secrets, and more
- CWE-mapped security issues with detailed explanations
- Inline diagnostics with severity-based highlighting

### 🤖 **AI-Powered Code Completions**
- Security-aware inline completions (like Cursor/Copilot)
- Context-aware suggestions based on project structure
- Secure-by-default coding patterns
- Debounced completions to optimize performance

### 💬 **"Ask Seguro" Chat Interface**
- Dedicated sidebar chat for security questions
- Context-aware responses based on current file
- Code generation from natural language specs
- Security best practices guidance

### 🔧 **Vulnerability Management**
- One-click vulnerability fixes
- Detailed vulnerability reports with CWE references
- Tree view of all security issues by severity
- Export and history tracking

### 📊 **Developer Insights**
- Usage analytics and performance metrics
- Security scan history with detailed logs
- Project-wide security health dashboard
- Opt-in telemetry for continuous improvement

## 🏗️ Architecture

### Frontend (VS Code Extension)
- **TypeScript-based** extension with modular architecture
- **Secure authentication** via OAuth2 with token management
- **API client** for secure backend communication
- **Context management** for project-aware AI suggestions
- **Telemetry system** with privacy-first design

### Backend (Planned)
- **Rust-based API** (Axum/Actix-web) for performance and security
- **ModelService abstraction** supporting OpenAI GPT-4, Claude, Together AI
- **PostgreSQL database** for user data and analytics
- **Secure token handling** with JWT and refresh tokens
- **Rate limiting and audit logging** for enterprise security

### Security & Privacy
- **No local LLM inference** - fully cloud-powered MVP
- **Code sanitization** - no sensitive data leaves your environment
- **TLS encryption** for all API communications
- **Secure token storage** using VS Code secrets and keytar
- **Opt-in telemetry** with data anonymization

## 🚀 Quick Start

### Prerequisites
- VS Code 1.74.0 or higher
- Node.js 16+ and npm
- TypeScript 4.8+

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/seguro-vscode.git
   cd seguro-vscode
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run compile
   ```

4. **Launch in development**
   - Press `F5` in VS Code to open Extension Development Host
   - Or run: `npm run watch` for continuous compilation

### First Run

1. **Authenticate with Seguro**
   - Run command: `Seguro: Login`
   - Complete OAuth2 flow in your browser
   - Extension will securely store your authentication token

2. **Configure your preferences**
   - Open VS Code settings (`Ctrl+,`)
   - Search for "Seguro" to customize:
     - Auto-scanning behavior
     - Inline completion settings
     - Telemetry preferences
     - API endpoint (for enterprise users)

3. **Start coding securely**
   - Open any supported file (JS, TS, Python, etc.)
   - See inline completions and security warnings
   - Use `Ctrl+Shift+P` → "Ask Seguro" for the chat panel

## 📋 Commands

| Command | Description | Shortcut |
|---------|-------------|----------|
| `Seguro: Login` | Authenticate with Seguro cloud | - |
| `Seguro: Logout` | Sign out and clear tokens | - |
| `Seguro: Analyze Current File` | Scan active file for vulnerabilities | `Ctrl+Shift+A` |
| `Seguro: Scan Workspace` | Full workspace security scan | `Ctrl+Shift+W` |
| `Seguro: Generate Secure Code` | Generate code from comment spec | `Ctrl+Shift+G` |
| `Seguro: Fix Vulnerability` | Auto-fix detected security issue | `Ctrl+Shift+F` |
| `Seguro: Ask Seguro` | Open chat sidebar | `Ctrl+Shift+S` |
| `Seguro: Toggle Inline Completions` | Enable/disable AI completions | - |

## ⚙️ Configuration

Access via VS Code Settings (`Ctrl+,`) → Search "Seguro":

### Core Settings
```json
{
  "seguro.apiEndpoint": "https://api.seguro.ai",
  "seguro.enableAutoScan": true,
  "seguro.enableInlineCompletions": true,
  "seguro.enableTelemetry": false,
  "seguro.maxContextLines": 50,
  "seguro.securityRules": {
    "severity": "medium",
    "enabledRules": ["xss", "sqli", "secrets", "eval"]
  }
}
```

### Advanced Settings
```json
{
  "seguro.completion.debounceMs": 300,
  "seguro.completion.maxSuggestions": 3,
  "seguro.scan.batchSize": 10,
  "seguro.scan.excludePatterns": ["node_modules/**", "*.min.js"],
  "seguro.telemetry.sessionTimeout": 3600000
}
```

## 🔧 Development

### Project Structure
```
seguro-vscode/
├── src/
│   ├── extension.ts          # Main extension entry point
│   ├── auth/
│   │   └── authManager.ts    # OAuth2 authentication
│   ├── api/
│   │   └── apiClient.ts      # Backend API communication
│   ├── completion/
│   │   └── inlineProvider.ts # AI-powered completions
│   ├── security/
│   │   └── securityAnalyzer.ts # Vulnerability detection
│   ├── chat/
│   │   └── chatProvider.ts   # Chat sidebar webview
│   ├── context/
│   │   └── contextManager.ts # Project context tracking
│   ├── telemetry/
│   │   └── telemetryManager.ts # Analytics and metrics
│   └── views/
│       ├── vulnerabilityProvider.ts # Security issues tree
│       └── historyProvider.ts # Action history tree
├── package.json              # Extension manifest
├── tsconfig.json            # TypeScript configuration
└── README.md               # This file
```

### Building & Testing

```bash
# Development build with watch mode
npm run watch

# Production build
npm run compile

# Run tests
npm test

# Lint code
npm run lint

# Package for distribution
npm run package
```

### Adding New Security Rules

1. **Update SecurityAnalyzer** (`src/security/securityAnalyzer.ts`)
2. **Add rule patterns** to the detection logic
3. **Update API client** if backend changes needed
4. **Add tests** for the new rule
5. **Update documentation**

## 🛡️ Security & Privacy

### Data Handling
- **Code Analysis**: Only metadata and patterns sent to API, never full source
- **Completions**: Context-aware but sanitized before transmission
- **Chat**: Messages processed securely with no persistent storage
- **Telemetry**: Fully anonymized usage metrics (opt-in only)

### Authentication
- **OAuth2 flow** with secure token refresh
- **Token storage** via VS Code SecretStorage and keytar fallback
- **Session management** with automatic expiration
- **Multi-factor authentication** support (enterprise)

### Compliance
- **SOC 2 Type II** compliance (planned)
- **GDPR compliant** data processing
- **Enterprise SSO** integration available
- **Audit logging** for all security-sensitive operations

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Run the test suite: `npm test`
5. Submit a pull request

### Reporting Issues
- **Security vulnerabilities**: Please email security@seguro.ai
- **Bug reports**: Use GitHub Issues with the bug template
- **Feature requests**: Use GitHub Issues with the feature template

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- **Website**: [https://seguro.ai](https://seguro.ai)
- **Documentation**: [https://docs.seguro.ai](https://docs.seguro.ai)
- **API Reference**: [https://api.seguro.ai/docs](https://api.seguro.ai/docs)
- **Support**: [support@seguro.ai](mailto:support@seguro.ai)
- **Security**: [security@seguro.ai](mailto:security@seguro.ai)

---

**Made with ❤️ by the Seguro Team**

*Secure coding shouldn't be an afterthought. Make it your default.*

## Development

### Project Structure

```
src/
├── extension.ts          # Main extension entry point
└── security/
    ├── analyzer.ts       # Core security analysis logic
    └── provider.ts       # UI and diagnostic provider
```

### Building

```bash
npm run compile    # Compile TypeScript
npm run watch      # Watch mode for development
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new security rules
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Roadmap

- [ ] Add more security rules
- [ ] Support for more programming languages
- [ ] Integration with external security tools
- [ ] Custom rule configuration
- [ ] Security report export
- [ ] CI/CD integration
