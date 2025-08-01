import * as vscode from 'vscode';
import { ApiClient, CompletionRequest, CodeContext } from '../api/apiClient';
import { ContextManager } from '../context/contextManager';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private apiClient: ApiClient;
    private contextManager: ContextManager;
    private lastRequestTime = 0;
    private readonly debounceMs = 300;

    constructor(apiClient: ApiClient, contextManager: ContextManager) {
        this.apiClient = apiClient;
        this.contextManager = contextManager;
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[]> {
        try {
            // Check if inline completions are enabled
            const config = vscode.workspace.getConfiguration('seguro');
            if (!config.get('enableInlineCompletions', true)) {
                return [];
            }

            // Debounce requests to avoid overwhelming the API
            const now = Date.now();
            if (now - this.lastRequestTime < this.debounceMs) {
                return [];
            }
            this.lastRequestTime = now;

            // Get text before and after cursor
            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            const lineSuffix = document.lineAt(position).text.substring(position.character);
            
            // Don't provide completions for very short prefixes or in comments
            if (linePrefix.trim().length < 2 || this.isInComment(linePrefix)) {
                return [];
            }

            // Get broader context around the cursor
            const contextLines = this.getContextLines(document, position);
            const prefix = contextLines.before.join('\n') + linePrefix;
            const suffix = lineSuffix + '\n' + contextLines.after.join('\n');

            // Build completion request
            const fileContext = this.contextManager.getFileContext(document);
            const completionRequest: CompletionRequest = {
                prefix: prefix.trim(),
                suffix: suffix.trim(),
                language: document.languageId,
                context: fileContext,
                maxTokens: 150 // Keep completions concise
            };

            // Create cancel token for the API request
            const source = require('axios').CancelToken.source();
            token.onCancellationRequested(() => {
                source.cancel('Completion cancelled');
            });

            // Get completions from API
            const response = await this.apiClient.getInlineCompletions(
                completionRequest,
                source.token
            );

            // Convert API response to VS Code completion items
            return response.completions.map((completion, index) => {
                const item = new vscode.InlineCompletionItem(
                    completion,
                    new vscode.Range(position, position)
                );
                
                // Add security-focused command for the completion
                item.command = {
                    command: 'codelock.acceptCompletion',
                    title: 'Accept Secure Completion',
                    arguments: [completion, fileContext.language]
                };

                return item;
            });

        } catch (error: any) {
            if (error.message?.includes('cancelled')) {
                return [];
            }
            
            console.warn('Inline completion failed:', error);
            return [];
        }
    }

    private getContextLines(document: vscode.TextDocument, position: vscode.Position): {
        before: string[];
        after: string[];
    } {
        const config = vscode.workspace.getConfiguration('seguro');
        const maxContextLines = Math.min(config.get('maxContextLines', 100), 50); // Limit for completions
        
        const contextLineCount = Math.floor(maxContextLines / 2);
        const startLine = Math.max(0, position.line - contextLineCount);
        const endLine = Math.min(document.lineCount - 1, position.line + contextLineCount);

        const before: string[] = [];
        const after: string[] = [];

        // Get lines before cursor
        for (let i = startLine; i < position.line; i++) {
            before.push(document.lineAt(i).text);
        }

        // Get lines after cursor
        for (let i = position.line + 1; i <= endLine; i++) {
            after.push(document.lineAt(i).text);
        }

        return { before, after };
    }

    private isInComment(linePrefix: string): boolean {
        const trimmed = linePrefix.trim();
        
        // Check for common comment patterns
        const commentPatterns = [
            /^\/\//, // JavaScript/TypeScript single line
            /^\/\*/, // JavaScript/TypeScript multi-line start
            /^\*/, // JavaScript/TypeScript multi-line continuation
            /^#/, // Python, Shell, etc.
            /^<!--/, // HTML
            /^--/, // SQL, Lua
            /^;/, // Assembly, Lisp
            /^%/, // LaTeX, MATLAB
        ];

        return commentPatterns.some(pattern => pattern.test(trimmed));
    }

    // Register command to track completion acceptance
    static registerCommands(context: vscode.ExtensionContext): void {
        const acceptCompletionCommand = vscode.commands.registerCommand(
            'codelock.acceptCompletion',
            (completion: string, language: string) => {
                // Track completion acceptance for telemetry
                console.log(`Accepted completion for ${language}: ${completion.substring(0, 50)}...`);
                
                // Could send telemetry here if enabled
                const config = vscode.workspace.getConfiguration('codelock');
                if (config.get('enableTelemetry', false)) {
                    // Send anonymous telemetry about completion acceptance
                }
            }
        );

        context.subscriptions.push(acceptCompletionCommand);
    }
}
