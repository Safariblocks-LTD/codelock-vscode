import * as vscode from 'vscode';
import { ApiClient, SecurityIssue, CodeContext } from '../api/apiClient';
import * as path from 'path';

export class SecurityAnalyzer {
    private apiClient: ApiClient;

    constructor(apiClient: ApiClient) {
        this.apiClient = apiClient;
    }

    async analyzeDocument(
        document: vscode.TextDocument,
        context?: CodeContext,
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
        token?: vscode.CancellationToken
    ): Promise<SecurityIssue[]> {
        try {
            progress?.report({ message: 'Preparing code analysis...' });

            const code = document.getText();
            const fileContext: CodeContext = context || {
                language: document.languageId,
                fileName: path.basename(document.fileName),
                projectType: this.detectProjectType(document.fileName),
                ...this.extractCodeContext(document)
            };

            progress?.report({ message: 'Analyzing code for security issues...', increment: 30 });

            const cancelToken = token ? this.createCancelToken(token) : undefined;
            const issues = await this.apiClient.analyzeCode(code, fileContext, cancelToken);

            progress?.report({ message: 'Analysis complete', increment: 70 });

            return issues;
        } catch (error: any) {
            if (error.message?.includes('cancelled')) {
                throw new Error('Analysis was cancelled');
            }
            throw error;
        }
    }

    async scanWorkspace(
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
        token?: vscode.CancellationToken
    ): Promise<SecurityIssue[]> {
        try {
            if (!vscode.workspace.workspaceFolders) {
                throw new Error('No workspace folder open');
            }

            progress?.report({ message: 'Finding files to scan...' });

            const files = await this.findFilesToScan();
            if (files.length === 0) {
                return [];
            }

            progress?.report({ message: `Found ${files.length} files to scan`, increment: 10 });

            const allIssues: SecurityIssue[] = [];
            const cancelToken = token ? this.createCancelToken(token) : undefined;

            // Scan files in batches to avoid overwhelming the API
            const batchSize = 5;
            for (let i = 0; i < files.length; i += batchSize) {
                if (token?.isCancellationRequested) {
                    throw new Error('Workspace scan was cancelled');
                }

                const batch = files.slice(i, i + batchSize);
                const batchProgress = Math.round(((i + batch.length) / files.length) * 80);
                
                progress?.report({ 
                    message: `Scanning files ${i + 1}-${Math.min(i + batch.length, files.length)} of ${files.length}`,
                    increment: batchProgress - (i > 0 ? Math.round((i / files.length) * 80) : 10)
                });

                const batchIssues = await this.scanFileBatch(batch, cancelToken);
                allIssues.push(...batchIssues);
            }

            progress?.report({ message: 'Workspace scan complete', increment: 10 });

            return allIssues;
        } catch (error: any) {
            if (error.message?.includes('cancelled')) {
                throw new Error('Workspace scan was cancelled');
            }
            throw error;
        }
    }

    private async findFilesToScan(): Promise<string[]> {
        const supportedExtensions = [
            '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs', '.cpp', '.c', '.php', '.rb', '.go', '.rs'
        ];

        const excludePatterns = [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/out/**',
            '**/.git/**',
            '**/coverage/**',
            '**/*.min.js',
            '**/*.bundle.js'
        ];

        const files: string[] = [];
        
        for (const folder of vscode.workspace.workspaceFolders!) {
            for (const ext of supportedExtensions) {
                const pattern = new vscode.RelativePattern(folder, `**/*${ext}`);
                const foundFiles = await vscode.workspace.findFiles(pattern, `{${excludePatterns.join(',')}}`);
                files.push(...foundFiles.map((f: vscode.Uri) => f.fsPath));
            }
        }

        return files;
    }

    private async scanFileBatch(files: string[], cancelToken?: AbortController): Promise<SecurityIssue[]> {
        const issues: SecurityIssue[] = [];

        for (const file of files) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const fileIssues = await this.analyzeDocument(document, undefined, undefined, 
                    cancelToken ? { isCancellationRequested: cancelToken.signal.aborted } as vscode.CancellationToken : undefined);
                issues.push(...fileIssues);
            } catch (error: any) {
                vscode.window.showWarningMessage(`Failed to scan file ${file}: ${error.message}`);
            }
        }

        return issues;
    }

    private detectProjectType(fileName: string): string {
        const ext = path.extname(fileName).toLowerCase();
        const baseName = path.basename(fileName).toLowerCase();

        // Check for specific files
        if (baseName === 'package.json') return 'node';
        if (baseName === 'requirements.txt' || baseName === 'setup.py') return 'python';
        if (baseName === 'pom.xml' || baseName === 'build.gradle') return 'java';
        if (baseName === 'cargo.toml') return 'rust';
        if (baseName === 'go.mod') return 'go';

        // Check by extension
        switch (ext) {
            case '.js':
            case '.ts':
            case '.jsx':
            case '.tsx':
                return 'javascript';
            case '.py':
                return 'python';
            case '.java':
                return 'java';
            case '.cs':
                return 'csharp';
            case '.cpp':
            case '.c':
            case '.h':
                return 'cpp';
            case '.php':
                return 'php';
            case '.rb':
                return 'ruby';
            case '.go':
                return 'go';
            case '.rs':
                return 'rust';
            default:
                return 'unknown';
        }
    }

    private extractCodeContext(document: vscode.TextDocument): Partial<CodeContext> {
        const text = document.getText();
        const lines = text.split('\n');
        
        // Extract imports/requires
        const imports = lines
            .filter((line: string) => line.trim().match(/^(import|require|from|#include|using)\s/))
            .map((line: string) => line.trim())
            .slice(0, 10); // Limit to first 10 imports

        // Extract function/class names
        const functions = this.extractFunctionNames(text, document.languageId);
        const classes = this.extractClassNames(text, document.languageId);

        return {
            imports,
            functions: functions.slice(0, 20), // Limit to 20 functions
            classes: classes.slice(0, 10)      // Limit to 10 classes
        };
    }

    private extractFunctionNames(text: string, language: string): string[] {
        const patterns: { [key: string]: RegExp } = {
            javascript: /(?:function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)|([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[:=]\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g,
            typescript: /(?:function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)|([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[:=]\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g,
            python: /def\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
            java: /(?:public|private|protected)?\s*(?:static)?\s*(?:[a-zA-Z_$][a-zA-Z0-9_$<>\[\]]*\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g,
            csharp: /(?:public|private|protected|internal)?\s*(?:static)?\s*(?:async)?\s*(?:[a-zA-Z_$][a-zA-Z0-9_$<>\[\]]*\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g
        };

        const pattern = patterns[language] || patterns.javascript;
        const matches = [];
        let match;

        while ((match = pattern.exec(text)) !== null) {
            const functionName = match[1] || match[2];
            if (functionName && !functionName.match(/^(if|for|while|switch|catch)$/)) {
                matches.push(functionName);
            }
        }

        return [...new Set(matches)]; // Remove duplicates
    }

    private extractClassNames(text: string, language: string): string[] {
        const patterns: { [key: string]: RegExp } = {
            javascript: /class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
            typescript: /(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
            python: /class\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
            java: /(?:public|private|protected)?\s*(?:abstract)?\s*class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
            csharp: /(?:public|private|protected|internal)?\s*(?:abstract|sealed)?\s*class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g
        };

        const pattern = patterns[language] || patterns.javascript;
        const matches = [];
        let match;

        while ((match = pattern.exec(text)) !== null) {
            matches.push(match[1]);
        }

        return [...new Set(matches)]; // Remove duplicates
    }

    private createCancelToken(token: vscode.CancellationToken): AbortController {
        const controller = new AbortController();
        
        token.onCancellationRequested(() => {
            controller.abort();
        });

        return controller;
    }

    extractContext(document: vscode.TextDocument): CodeContext {
        return {
            language: document.languageId,
            fileName: path.basename(document.fileName),
            projectType: this.detectProjectType(document.fileName),
            ...this.extractCodeContext(document)
        };
    }
}
