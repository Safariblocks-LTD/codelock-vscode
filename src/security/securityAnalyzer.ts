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
            '**/target/**',
            '**/.git/**',
            '**/vendor/**',
            '**/*.min.js',
            '**/*.bundle.js'
        ];

        const files: string[] = [];
        
        for (const ext of supportedExtensions) {
            const pattern = `**/*${ext}`;
            const foundFiles = await vscode.workspace.findFiles(
                pattern,
                `{${excludePatterns.join(',')}}`
            );
            files.push(...foundFiles.map((f: vscode.Uri) => f.fsPath));
        }

        return files;
    }

    private async scanFileBatch(
        filePaths: string[],
        cancelToken?: any
    ): Promise<SecurityIssue[]> {
        const issues: SecurityIssue[] = [];

        for (const filePath of filePaths) {
            try {
                const document = await vscode.workspace.openTextDocument(filePath);
                const fileIssues = await this.analyzeDocument(document, undefined, undefined, undefined);
                issues.push(...fileIssues);
            } catch (error) {
                console.warn(`Failed to scan file ${filePath}:`, error);
                // Continue with other files
            }
        }

        return issues;
    }

    private detectProjectType(fileName: string): string | undefined {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return undefined;

        // Check for common project files
        const projectFiles = [
            { file: 'package.json', type: 'nodejs' },
            { file: 'requirements.txt', type: 'python' },
            { file: 'pom.xml', type: 'java-maven' },
            { file: 'build.gradle', type: 'java-gradle' },
            { file: 'Cargo.toml', type: 'rust' },
            { file: 'go.mod', type: 'go' },
            { file: '*.csproj', type: 'dotnet' },
            { file: 'composer.json', type: 'php' },
            { file: 'Gemfile', type: 'ruby' }
        ];

        for (const { file, type } of projectFiles) {
            try {
                const filePath = path.join(workspaceRoot, file);
                const fs = require('fs');
                if (fs.existsSync(filePath)) {
                    return type;
                }
            } catch (error) {
                // Continue checking other files
            }
        }

        return undefined;
    }

    private extractCodeContext(document: vscode.TextDocument): Partial<CodeContext> {
        const text = document.getText();
        const context: Partial<CodeContext> = {
            imports: [],
            functions: [],
            classes: []
        };

        // Extract imports/requires
        const importRegex = /^\s*(import|require|from|#include)\s+([^\n;]+)/gm;
        let match;
        while ((match = importRegex.exec(text)) !== null) {
            context.imports?.push(match[2].trim());
        }

        // Extract function definitions
        const functionRegex = /^\s*(function|def|fn|func|public|private|protected)?\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm;
        while ((match = functionRegex.exec(text)) !== null) {
            context.functions?.push(match[2]);
        }

        // Extract class definitions
        const classRegex = /^\s*(class|struct|interface)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm;
        while ((match = classRegex.exec(text)) !== null) {
            context.classes?.push(match[2]);
        }

        return context;
    }

    private createCancelToken(vscodeToken: vscode.CancellationToken): any {
        // Create an axios cancel token from VS Code cancellation token
        const axios = require('axios');
        const source = axios.CancelToken.source();
        
        vscodeToken.onCancellationRequested(() => {
            source.cancel('Operation cancelled by user');
        });

        return source.token;
    }
}
