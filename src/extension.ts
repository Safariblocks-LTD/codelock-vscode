import * as vscode from 'vscode';
import * as path from 'path';
import axios, { CancelTokenSource } from 'axios';
import { AuthManager } from './auth/authManager';
import { ApiClient } from './api/apiClient';
import { SecurityAnalyzer } from './security/securityAnalyzer';
import { InlineCompletionProvider } from './completion/inlineProvider';
import { ChatProvider } from './chat/chatProvider';
import { VulnerabilityProvider } from './views/vulnerabilityProvider';
import { HistoryProvider } from './views/historyProvider';
import { TelemetryManager } from './telemetry/telemetryManager';
import { ContextManager } from './context/contextManager';
// Common types for the extension
interface ScanResult {
    timestamp: Date;
    filePath: string;
    vulnerabilityCount: number;
    type: 'file_scan' | 'workspace_scan';
}

let authManager: AuthManager;
let apiClient: ApiClient;
let securityAnalyzer: SecurityAnalyzer;
let inlineProvider: InlineCompletionProvider;
let chatProvider: ChatProvider;
let vulnerabilityProvider: VulnerabilityProvider;
let historyProvider: HistoryProvider;
let telemetryManager: TelemetryManager;
let contextManager: ContextManager;

export async function activate(extensionContext: vscode.ExtensionContext) {
    console.log('🔒 CodeLock: Security-First AI Coding Agent is activating...');

    // Initialize core services first
    authManager = new AuthManager(extensionContext);
    apiClient = new ApiClient(authManager);
    securityAnalyzer = new SecurityAnalyzer(apiClient);
    contextManager = new ContextManager();
    telemetryManager = new TelemetryManager(extensionContext);
    
    try {
        
        // Initialize providers with extensionContext
        inlineProvider = new InlineCompletionProvider(apiClient, contextManager);
        chatProvider = new ChatProvider(extensionContext, apiClient);
        vulnerabilityProvider = new VulnerabilityProvider(extensionContext);
        historyProvider = new HistoryProvider(extensionContext);

        // Register inline completion provider
        const completionDisposable = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            inlineProvider
        );

        // Register tree data providers
        vscode.window.registerTreeDataProvider('codelock.vulnerabilities', vulnerabilityProvider);
        vscode.window.registerTreeDataProvider('codelock.history', historyProvider);
        
        // Register webview provider for chat
        vscode.window.registerWebviewViewProvider('codelock.chat', chatProvider);

        // Register commands
        const commands = [
            vscode.commands.registerCommand('codelock.login', async () => {
                try {
                    await authManager.login();
                    vscode.window.showInformationMessage('✅ Successfully logged in to CodeLock!');
                    await vscode.commands.executeCommand('setContext', 'codelock.authenticated', true);
                    telemetryManager.track('login', { method: 'oauth' });
                } catch (error) {
                    vscode.window.showErrorMessage(`❌ Failed to login: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    telemetryManager.track('login_failed', { error: error instanceof Error ? error.message : String(error) });
                }
            }),

            vscode.commands.registerCommand('codelock.logout', async () => {
                await authManager.logout();
                vscode.window.showInformationMessage('👋 Logged out from CodeLock');
                await vscode.commands.executeCommand('setContext', 'codelock.authenticated', false);
                telemetryManager.track('logout');
            }),

            vscode.commands.registerCommand('codelock.analyzeFile', async () => {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active file to analyze');
                    return;
                }

                if (!authManager.isAuthenticated()) {
                    const result = await vscode.window.showInformationMessage(
                        'Please login to CodeLock to analyze files',
                        'Login'
                    );
                    if (result === 'Login') {
                        await vscode.commands.executeCommand('codelock.login');
                    }
                    return;
                }
                const document = activeEditor.document;
                const filePath = document.uri.fsPath;
                const languageId = document.languageId;

                try {
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
                    const cancellationSource = new vscode.CancellationTokenSource();
                    const progressOptions = {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Analyzing file...',
                        cancellable: true
                    };

                    const issues = await vscode.window.withProgress(progressOptions, async (progress, token) => {
                        token.onCancellationRequested(() => {
                            cancellationSource.cancel();
                            vscode.window.showInformationMessage('Analysis was cancelled');
                        });
                        
                        return await securityAnalyzer.analyzeDocument(
                            document, 
                            undefined, 
                            progress, 
                            cancellationSource.token
                        );
                    });
                    
                    // Update vulnerabilities view
                    vulnerabilityProvider.updateVulnerabilities(issues);
                    
                    // Add to history
                    historyProvider.addScanHistory(filePath, issues.length, true);
                    
                    if (issues.length > 0) {
                        vscode.window.showWarningMessage(`Found ${issues.length} potential security ${issues.length === 1 ? 'issue' : 'issues'} in ${path.basename(filePath)}`);
                        telemetryManager.track('analysis_complete', { 
                            fileType: languageId,
                            issuesFound: issues.length 
                        });
                    } else {
                        vscode.window.showInformationMessage('No security issues found in the current file');
                        telemetryManager.track('analysis_complete', { 
                            fileType: languageId,
                            issuesFound: 0 
                        });
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to analyze file: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    telemetryManager.track('analysis_failed', { error: error instanceof Error ? error.message : String(error) });
                }
            }),

            vscode.commands.registerCommand('codelock.scanWorkspace', async () => {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    vscode.window.showWarningMessage('No workspace folder is open');
                    return;
                }

                try {
                    let totalIssues = 0;
                    const filePattern = '**/*.{js,ts,jsx,tsx,py,java,cs,cpp,c,php,rb,go,rs}';
                    const excludePattern = '**/node_modules/**,**/dist/**,**/build/**';
                    
                    // Show progress
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Scanning workspace for security issues...',
                        cancellable: true
                    }, async (progress, token) => {
                        for (const folder of workspaceFolders) {
                            const files = await vscode.workspace.findFiles(
                                new vscode.RelativePattern(folder, filePattern),
                                excludePattern
                            );

                            for (let i = 0; i < files.length; i++) {
                                if (token.isCancellationRequested) {
                                    vscode.window.showInformationMessage('Workspace scan was cancelled');
                                    return;
                                }

                                const file = files[i];
                                progress.report({
                                    message: `Scanning ${path.relative(folder.uri.fsPath, file.fsPath)} (${i + 1}/${files.length})`,
                                    increment: (1 / files.length) * 100
                                });

                                try {
                                    const document = await vscode.workspace.openTextDocument(file);
                                    const vulnerabilities = await securityAnalyzer.analyzeDocument(
                                        document,
                                        undefined,
                                        undefined,
                                        token
                                    );
                                    
                                    if (vulnerabilities.length > 0) {
                                        totalIssues += vulnerabilities.length;
                                        vulnerabilityProvider.updateVulnerabilities(vulnerabilities);
                                    }
                                } catch (error) {
                                    console.error(`Error scanning ${file.fsPath}:`, error);
                                }
                            }
                        }
                    });

                    // Add to history
                    historyProvider.addScanHistory('Workspace Scan', totalIssues, true);

                    if (totalIssues > 0) {
                        vscode.window.showWarningMessage(`Found ${totalIssues} potential security ${totalIssues === 1 ? 'issue' : 'issues'} in workspace`);
                        telemetryManager.track('workspace_scan_complete', { 
                            issuesFound: totalIssues,
                            workspaceCount: workspaceFolders.length
                        });
                    } else {
                        vscode.window.showInformationMessage('No security issues found in the workspace');
                        telemetryManager.track('workspace_scan_complete', { 
                            issuesFound: 0,
                            workspaceCount: workspaceFolders.length
                        });
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Failed to scan workspace: ${errorMessage}`);
                    telemetryManager.track('workspace_scan_failed', { 
                        error: errorMessage
                    });
                }
            }),

            vscode.commands.registerCommand('codelock.generateSecureCode', async () => {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active editor');
                    return;
                }

                if (!authManager.isAuthenticated()) {
                    const result = await vscode.window.showInformationMessage(
                        'Please login to CodeLock to generate secure code',
                        'Login'
                    );
                    if (result === 'Login') {
                        await vscode.commands.executeCommand('codelock.login');
                    }
                    return;
                }

                const selection = activeEditor.selection;
                const selectedText = activeEditor.document.getText(selection);
                
                if (!selectedText.trim()) {
                    vscode.window.showWarningMessage('Please select text to generate secure code');
                    return;
                }

                const cancellationSource = new vscode.CancellationTokenSource();
                
                try {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: '🪄 Generating secure code...',
                        cancellable: true
                    }, async (progress, token) => {
                        token.onCancellationRequested(() => {
                            cancellationSource.cancel();
                        });

                        // Create a proper CancelToken for axios
                        const source = axios.CancelToken.source();
                        
                        // Set up cancellation
                        const cancelPromise = new Promise<never>((_, reject) => {
                            token.onCancellationRequested(() => {
                                source.cancel('Operation cancelled by user');
                                reject(new Error('Request was cancelled'));
                            });
                        });

                        try {
                            const codeContext = contextManager.getFileContext(activeEditor.document);
                            const generatedCode = await Promise.race([
                                apiClient.generateSecureCode(selectedText, codeContext, source.token),
                                cancelPromise
                            ]);
                            
                            const edit = new vscode.WorkspaceEdit();
                            edit.replace(activeEditor.document.uri, selection, generatedCode);
                            await vscode.workspace.applyEdit(edit);
                            
                            vscode.window.showInformationMessage('✅ Secure code generated successfully!');
                            telemetryManager.track('code_generated', { 
                                language: activeEditor.document.languageId 
                            });
                            
                            return generatedCode;
                        } catch (error) {
                            if (!token.isCancellationRequested) {
                                throw error;
                            }
                            // Cancellation is handled by the outer catch
                            return;
                        }
                    });
                } catch (error) {
                    if (cancellationSource && !cancellationSource.token.isCancellationRequested) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        vscode.window.showErrorMessage(`❌ Code generation failed: ${errorMessage}`);
                        if (telemetryManager) {
                            telemetryManager.track('code_generation_failed', { 
                                error: errorMessage 
                            });
                        }
                    }
                    return;
                }
            }),

            vscode.commands.registerCommand('codelock.fixVulnerability', async (vulnerability) => {
                if (!authManager.isAuthenticated()) {
                    const result = await vscode.window.showInformationMessage(
                        'Please login to CodeLock to fix vulnerabilities',
                        'Login'
                    );
                    if (result === 'Login') {
                        await vscode.commands.executeCommand('codelock.login');
                    }
                    return;
                }

                const cancellationSource = new vscode.CancellationTokenSource();
                
                try {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: '🔧 Fixing security vulnerability...',
                        cancellable: true
                    }, async (progress, token) => {
                        token.onCancellationRequested(() => {
                            cancellationSource.cancel();
                        });

                        // Create a proper CancelToken for axios
                        const source = axios.CancelToken.source();
                        
                        // Set up cancellation
                        const cancelPromise = new Promise<{ code: string }>((_, reject) => {
                            token.onCancellationRequested(() => {
                                source.cancel('Operation cancelled by user');
                                reject(new Error('Request was cancelled'));
                            });
                        });

                        try {
                            const fix = await Promise.race([
                                apiClient.fixVulnerability(vulnerability, source.token),
                                cancelPromise
                            ]);
                            
                            const document = await vscode.workspace.openTextDocument(vulnerability.file);
                            const editor = await vscode.window.showTextDocument(document);
                            
                            const edit = new vscode.WorkspaceEdit();
                            const range = new vscode.Range(
                                vulnerability.line - 1, 0,
                                vulnerability.line - 1, document.lineAt(vulnerability.line - 1).text.length
                            );
                            edit.replace(document.uri, range, fix.code);
                            await vscode.workspace.applyEdit(edit);
                            
                            vscode.window.showInformationMessage('✅ Vulnerability fixed successfully!');
                            telemetryManager.track('vulnerability_fixed', { type: vulnerability.type });
                        } catch (error) {
                            if (token && !token.isCancellationRequested) {
                                throw error;
                            }
                            // Cancellation is handled by the outer catch
                            return;
                        }
                    });
                } catch (error) {
                    if (cancellationSource && !cancellationSource.token.isCancellationRequested) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        vscode.window.showErrorMessage(`❌ Fix failed: ${errorMessage}`);
                        if (telemetryManager) {
                            telemetryManager.track('vulnerability_fix_failed', { error: errorMessage });
                        }
                    }
                }
            }),

            vscode.commands.registerCommand('codelock.openChat', async () => {
                await vscode.commands.executeCommand('codelock.chat.focus');
            }),

            vscode.commands.registerCommand('codelock.toggleInlineCompletions', async () => {
                const config = vscode.workspace.getConfiguration('codelock');
                const current = config.get('enableInlineCompletions', true);
                await config.update('enableInlineCompletions', !current, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(
                    `Inline completions ${!current ? 'enabled' : 'disabled'}`
                );
                telemetryManager.track('inline_completions_toggled', { enabled: !current });
            })
        ];

        // Auto-scan on file save if enabled
        const onSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
            const config = vscode.workspace.getConfiguration('codelock');
            if (config.get('enableAutoScan', true) && authManager.isAuthenticated()) {
                try {
                    const fileContext = contextManager.getFileContext(document);
                    const results = await securityAnalyzer.analyzeDocument(document, fileContext);
                    if (results.length > 0) {
                        vulnerabilityProvider.updateVulnerabilities(results);
                        await vscode.commands.executeCommand('setContext', 'codelock.hasVulnerabilities', true);
                    }
                } catch (error) {
                    console.error('Auto-scan failed:', error);
                }
            }
        });

        // Check authentication status on startup
        try {
            const isAuthenticated = await authManager.checkAuthStatus();
            await vscode.commands.executeCommand('setContext', 'codelock.authenticated', isAuthenticated);
        } catch (error) {
            console.error('Failed to check authentication status:', error);
            await vscode.commands.executeCommand('setContext', 'codelock.authenticated', false);
        }

        // Add all disposables to context
        const disposables: vscode.Disposable[] = [
            onSaveDisposable
        ];
        
        // Add all registered commands to disposables
        const registeredCommands = [
            vscode.commands.registerCommand('codelock.analyzeFile', async () => {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active editor');
                    return;
                }
                
                try {
                    const document = activeEditor.document;
                    const fileContext = contextManager.getFileContext(document);
                    const issues = await securityAnalyzer.analyzeDocument(document, fileContext);
                    
                    if (issues.length > 0) {
                        vulnerabilityProvider.updateVulnerabilities(issues);
                        vscode.window.showInformationMessage(`Found ${issues.length} security issues`);
                    } else {
                        vscode.window.showInformationMessage('No security issues found');
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Security analysis failed: ${errorMessage}`);
                }
            }),
            // Add other commands here including all the ones previously registered
            vscode.commands.registerCommand('codelock.login', () => authManager.login()),
            vscode.commands.registerCommand('codelock.logout', () => authManager.logout()),
            vscode.commands.registerCommand('codelock.scanWorkspace', async () => {
                // Implementation for workspace scan
            }),
            // Add other commands as needed
        ];
        
        // Add all commands to disposables
        registeredCommands.forEach(cmd => disposables.push(cmd));
        
        // Add all disposables to the extension context
        extensionContext.subscriptions.push(...disposables);

        console.log('✅ CodeLock extension activated successfully!');
        telemetryManager.track('extension_activated');
        
    } catch (error) {
        console.error('❌ Failed to activate CodeLock extension:', error);
        vscode.window.showErrorMessage(`Failed to activate CodeLock: ${error}`);
        
        // Only track if telemetryManager is initialized
        if (telemetryManager) {
            telemetryManager.track('extension_activation_failed', { error: error instanceof Error ? error.message : String(error) });
        }
        
        // Re-throw to prevent silent failures
        throw error;
    }

    return {
        // Export any public API here
    };

}

export function deactivate() {
    console.log('👋 CodeLock extension deactivated');
    telemetryManager?.track('extension_deactivated');
}
