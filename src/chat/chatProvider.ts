import * as vscode from 'vscode';
import { ApiClient, ChatRequest, ChatMessage } from '../api/apiClient';

export class ChatProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'Codelock.chat';
    private _view?: vscode.WebviewView;
    private context: vscode.ExtensionContext;
    private apiClient: ApiClient;
    private chatHistory: ChatMessage[] = [];

    constructor(context: vscode.ExtensionContext, apiClient: ApiClient) {
        this.context = context;
        this.apiClient = apiClient;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this.context.extensionUri
            ]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleUserMessage(data.message);
                    break;
                case 'clearChat':
                    this.clearChat();
                    break;
                case 'getContext':
                    await this.sendContextInfo();
                    break;
            }
        });
    }

    private async handleUserMessage(message: string): Promise<void> {
        if (!message.trim()) return;

        // Add user message to history
        const userMessage: ChatMessage = {
            role: 'user',
            content: message,
            timestamp: new Date()
        };
        this.chatHistory.push(userMessage);

        // Update UI with user message
        this._view?.webview.postMessage({
            type: 'addMessage',
            message: userMessage
        });

        // Show typing indicator
        this._view?.webview.postMessage({
            type: 'showTyping'
        });

        try {
            // Get current file context if available
            const activeEditor = vscode.window.activeTextEditor;
            const context = activeEditor ? {
                language: activeEditor.document.languageId,
                fileName: activeEditor.document.fileName,
                // Add more context as needed
            } : undefined;

            // Prepare chat request
            const chatRequest: ChatRequest = {
                messages: this.chatHistory,
                context,
                maxTokens: 500
            };

            // Get response from API
            const response = await this.apiClient.chatWithcodelock(chatRequest);

            // Add assistant response to history
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: response.message,
                timestamp: new Date()
            };
            this.chatHistory.push(assistantMessage);

            // Update UI with assistant response
            this._view?.webview.postMessage({
                type: 'addMessage',
                message: assistantMessage
            });

            // Send suggestions if available
            if (response.suggestions && response.suggestions.length > 0) {
                this._view?.webview.postMessage({
                    type: 'addSuggestions',
                    suggestions: response.suggestions
                });
            }

        } catch (error: any) {
            console.error('Chat error:', error);
            
            const errorMessage: ChatMessage = {
                role: 'assistant',
                content: `Sorry, I encountered an error: ${error.message}. Please try again or check your connection.`,
                timestamp: new Date()
            };

            this._view?.webview.postMessage({
                type: 'addMessage',
                message: errorMessage
            });
        } finally {
            // Hide typing indicator
            this._view?.webview.postMessage({
                type: 'hideTyping'
            });
        }
    }

    private clearChat(): void {
        this.chatHistory = [];
        this._view?.webview.postMessage({
            type: 'clearMessages'
        });
    }

    private async sendContextInfo(): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        const workspaceInfo = vscode.workspace.workspaceFolders?.[0];
        
        const contextInfo = {
            hasActiveFile: !!activeEditor,
            fileName: activeEditor?.document.fileName,
            language: activeEditor?.document.languageId,
            workspaceName: workspaceInfo?.name,
            lineCount: activeEditor?.document.lineCount
        };

        this._view?.webview.postMessage({
            type: 'contextInfo',
            context: contextInfo
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ask CodeLock</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 10px;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .chat-container {
            flex: 1;
            overflow-y: auto;
            margin-bottom: 10px;
            padding: 5px;
        }
        
        .message {
            margin-bottom: 15px;
            padding: 8px 12px;
            border-radius: 8px;
            max-width: 90%;
        }
        
        .user-message {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: auto;
            text-align: right;
        }
        
        .assistant-message {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
        }
        
        .message-content {
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        
        .message-time {
            font-size: 0.8em;
            opacity: 0.7;
            margin-top: 5px;
        }
        
        .typing-indicator {
            display: none;
            padding: 8px 12px;
            font-style: italic;
            opacity: 0.7;
        }
        
        .suggestions {
            margin-top: 10px;
        }
        
        .suggestion-button {
            display: block;
            width: 100%;
            margin: 5px 0;
            padding: 8px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            text-align: left;
        }
        
        .suggestion-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .input-container {
            display: flex;
            gap: 5px;
            align-items: flex-end;
        }
        
        .message-input {
            flex: 1;
            min-height: 20px;
            max-height: 100px;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            resize: vertical;
            font-family: inherit;
        }
        
        .send-button, .clear-button {
            padding: 8px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        
        .send-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .send-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .send-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .clear-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .clear-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .welcome-message {
            text-align: center;
            padding: 20px;
            opacity: 0.7;
        }
        
        .context-info {
            font-size: 0.9em;
            padding: 5px 10px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 4px;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <div class="context-info" id="contextInfo" style="display: none;"></div>
    
    <div class="chat-container" id="chatContainer">
        <div class="welcome-message">
            <h3>🛡️ Ask Codelock</h3>
            <p>Your security-first AI coding assistant</p>
            <p>Ask me about security best practices, code vulnerabilities, or get help with secure coding patterns.</p>
        </div>
    </div>
    
    <div class="typing-indicator" id="typingIndicator">
        Codelock is thinking...
    </div>
    
    <div class="input-container">
        <textarea 
            class="message-input" 
            id="messageInput" 
            placeholder="Ask Codelock about security, vulnerabilities, or coding best practices..."
            rows="1"
        ></textarea>
        <button class="send-button" id="sendButton">Send</button>
        <button class="clear-button" id="clearButton">Clear</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const chatContainer = document.getElementById('chatContainer');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const clearButton = document.getElementById('clearButton');
        const typingIndicator = document.getElementById('typingIndicator');
        const contextInfo = document.getElementById('contextInfo');

        // Auto-resize textarea
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        });

        // Send message on Enter (Shift+Enter for new line)
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        sendButton.addEventListener('click', sendMessage);
        clearButton.addEventListener('click', clearChat);

        function sendMessage() {
            const message = messageInput.value.trim();
            if (!message) return;

            vscode.postMessage({
                type: 'sendMessage',
                message: message
            });

            messageInput.value = '';
            messageInput.style.height = 'auto';
            sendButton.disabled = true;
        }

        function clearChat() {
            vscode.postMessage({
                type: 'clearChat'
            });
        }

        function addMessage(message) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${message.role}-message\`;
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = message.content;
            
            const timeDiv = document.createElement('div');
            timeDiv.className = 'message-time';
            timeDiv.textContent = new Date(message.timestamp).toLocaleTimeString();
            
            messageDiv.appendChild(contentDiv);
            messageDiv.appendChild(timeDiv);
            
            // Remove welcome message if it exists
            const welcomeMessage = chatContainer.querySelector('.welcome-message');
            if (welcomeMessage) {
                welcomeMessage.remove();
            }
            
            chatContainer.appendChild(messageDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        function addSuggestions(suggestions) {
            const suggestionsDiv = document.createElement('div');
            suggestionsDiv.className = 'suggestions';
            
            suggestions.forEach(suggestion => {
                const button = document.createElement('button');
                button.className = 'suggestion-button';
                button.textContent = suggestion;
                button.addEventListener('click', () => {
                    messageInput.value = suggestion;
                    messageInput.focus();
                });
                suggestionsDiv.appendChild(button);
            });
            
            chatContainer.appendChild(suggestionsDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        function showTyping() {
            typingIndicator.style.display = 'block';
            sendButton.disabled = true;
        }

        function hideTyping() {
            typingIndicator.style.display = 'none';
            sendButton.disabled = false;
        }

        function clearMessages() {
            chatContainer.innerHTML = \`
                <div class="welcome-message">
                    <h3>🛡️ Ask Codelock</h3>
                    <p>Your security-first AI coding assistant</p>
                    <p>Ask me about security best practices, code vulnerabilities, or get help with secure coding patterns.</p>
                </div>
            \`;
        }

        function updateContextInfo(context) {
            if (context.hasActiveFile) {
                contextInfo.textContent = \`📄 \${context.fileName} (\${context.language}) - \${context.lineCount} lines\`;
                contextInfo.style.display = 'block';
            } else {
                contextInfo.style.display = 'none';
            }
        }

        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'addMessage':
                    addMessage(message.message);
                    break;
                case 'addSuggestions':
                    addSuggestions(message.suggestions);
                    break;
                case 'showTyping':
                    showTyping();
                    break;
                case 'hideTyping':
                    hideTyping();
                    break;
                case 'clearMessages':
                    clearMessages();
                    break;
                case 'contextInfo':
                    updateContextInfo(message.context);
                    break;
            }
        });

        // Request context info on load
        vscode.postMessage({
            type: 'getContext'
        });
    </script>
</body>
</html>`;
    }
}
