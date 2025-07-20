import * as vscode from 'vscode';
import { AuthManager } from './auth/authManager';
import { ApiClient } from './api/apiClient';
import { SecurityAnalyzer } from './security/securityAnalyzer';
import { InlineCompletionProvider } from './completion/inlineProvider';
import { ChatProvider } from './chat/chatProvider';
import { VulnerabilityProvider } from './views/vulnerabilityProvider';
import { HistoryProvider } from './views/historyProvider';
import { TelemetryManager } from './telemetry/telemetryManager';
import { ContextManager } from './context/contextManager';

let authManager: AuthManager;
let apiClient: ApiClient;
let securityAnalyzer: SecurityAnalyzer;
let inlineProvider: InlineCompletionProvider;
let chatProvider: ChatProvider;
let vulnerabilityProvider: VulnerabilityProvider;
let historyProvider: HistoryProvider;
let telemetryManager: TelemetryManager;
let contextManager: ContextManager;

export async function activate(context: vscode.ExtensionContext) {
    console.log('🛡️ Seguro: Security-First AI Coding Agent is activating...');

    try {
        // Initialize core services
        authManager = new AuthManager(context);
        apiClient = new ApiClient(authManager);
        securityAnalyzer = new SecurityAnalyzer(apiClient);
        contextManager = new ContextManager();
        telemetryManager = new TelemetryManager(context);
        
        // Initialize providers
        inlineProvider = new InlineCompletionProvider(apiClient, contextManager);
        chatProvider = new ChatProvider(context, apiClient);
        vulnerabilityProvider = new VulnerabilityProvider(context);
        historyProvider = new HistoryProvider(context);

        // Register inline completion provider
        const completionDisposable = vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            inlineProvider
        );

        // Register tree data providers
        vscode.window.registerTreeDataProvider('seguro.vulnerabilities', vulnerabilityProvider);
        vscode.window.registerTreeDataProvider('seguro.history', historyProvider);
        
        // Register webview provider for chat
        vscode.window.registerWebviewViewProvider('seguro.chat', chatProvider);

        // Register commands
        const commands = [
            vscode.commands.registerCommand('seguro.login', async () => {
                try {
                    await authManager.login();
                    vscode.window.showInformationMessage('✅ Successfully logged in to Seguro!');
                    await vscode.commands.executeCommand('setContext', 'seguro.authenticated', true);
                    telemetryManager.track('login_success');
                } catch (error) {
                    vscode.window.showErrorMessage(`❌ Login failed: ${error}`);
                    telemetryManager.track('login_failed', { error: String(error) });
                }
            }),

            vscode.commands.registerCommand('seguro.logout', async () => {
                await authManager.logout();
                vscode.window.showInformationMessage('👋 Logged out from Seguro');
                await vscode.commands.executeCommand('setContext', 'seguro.authenticated', false);
                telemetryManager.track('logout');
            }),

            vscode.commands.registerCommand('seguro.analyzeFile', async () => {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active file to analyze');
                    return;
                }

                if (!authManager.isAuthenticated()) {
                    const result = await vscode.window.showInformationMessage(
                        'Please login to Seguro to analyze files',
                        'Login'
                    );
                    if (result === 'Login') {
                        await vscode.commands.executeCommand('seguro.login');
                    }
                    return;
                }

                const document = activeEditor.document;
                const context = contextManager.getFileContext(document);
                
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: '🔍 Analyzing file for security issues...',
                    cancellable: true
                }, async (progress, token) => {
                    try {
                        const results = await securityAnalyzer.analyzeDocument(document, context, progress, token);
                        
                        if (results.length === 0) {
                            vscode.window.showInformationMessage('✅ No security issues found!');
                        } else {
                            vscode.window.showWarningMessage(`⚠️ Found ${results.length} security issue(s)`);
                            vulnerabilityProvider.updateVulnerabilities(results);
                            await vscode.commands.executeCommand('setContext', 'seguro.hasVulnerabilities', true);
                        }
                        
                        historyProvider.addScanResult({
                            file: document.fileName,
                            timestamp: new Date(),
                            issuesFound: results.length,
                            type: 'file'
                        });
                        
                        telemetryManager.track('file_analyzed', { 
                            language: document.languageId,
                            issues_found: results.length 
                        });
                    } catch (error) {
                        vscode.window.showErrorMessage(`❌ Analysis failed: ${error}`);
                        telemetryManager.track('analysis_failed', { error: String(error) });
                    }
                });
            }),

            vscode.commands.registerCommand('seguro.scanWorkspace', async () => {
                if (!vscode.workspace.workspaceFolders) {
                    vscode.window.showErrorMessage('No workspace folder open');
                    return;
                }

                if (!authManager.isAuthenticated()) {
                    const result = await vscode.window.showInformationMessage(
                        'Please login to Seguro to scan workspace',
                        'Login'
                    );
                    if (result === 'Login') {
                        await vscode.commands.executeCommand('seguro.login');
                    }
                    return;
                }

                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: '🔍 Scanning workspace for security issues...',
                    cancellable: true
                }, async (progress, token) => {
                    try {
                        const results = await securityAnalyzer.scanWorkspace(progress, token);
                        
                        if (results.length === 0) {
                            vscode.window.showInformationMessage('✅ Workspace scan complete - no issues found!');
                        } else {
                            vscode.window.showWarningMessage(`⚠️ Workspace scan found ${results.length} security issue(s)`);
                            vulnerabilityProvider.updateVulnerabilities(results);
                            await vscode.commands.executeCommand('setContext', 'seguro.hasVulnerabilities', true);
                        }
                        
                        historyProvider.addScanResult({
                            file: 'Workspace',
                            timestamp: new Date(),
                            issuesFound: results.length,
                            type: 'workspace'
                        });
                        
                        telemetryManager.track('workspace_scanned', { issues_found: results.length });
                    } catch (error) {
                        vscode.window.showErrorMessage(`❌ Workspace scan failed: ${error}`);
                        telemetryManager.track('workspace_scan_failed', { error: String(error) });
                    }
                });
            }),

            vscode.commands.registerCommand('seguro.generateSecureCode', async () => {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showWarningMessage('No active editor');
                    return;
                }

                if (!authManager.isAuthenticated()) {
                    const result = await vscode.window.showInformationMessage(
                        'Please login to Seguro to generate secure code',
                        'Login'
                    );
                    if (result === 'Login') {
                        await vscode.commands.executeCommand('seguro.login');
                    }
                    return;
                }

                const selection = activeEditor.selection;
                const selectedText = activeEditor.document.getText(selection);
                
                if (!selectedText.trim()) {
                    vscode.window.showWarningMessage('Please select a specification or comment to generate code from');
                    return;
                }

                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: '🪄 Generating secure code...',
                    cancellable: true
                }, async (progress, token) => {
                    try {
                        const context = contextManager.getFileContext(activeEditor.document);
                        const generatedCode = await apiClient.generateSecureCode(selectedText, context, token);
                        
                        const edit = new vscode.WorkspaceEdit();
                        edit.replace(activeEditor.document.uri, selection, generatedCode);
                        await vscode.workspace.applyEdit(edit);
                        
                        vscode.window.showInformationMessage('✅ Secure code generated successfully!');
                        telemetryManager.track('code_generated', { language: activeEditor.document.languageId });
                    } catch (error) {
                        vscode.window.showErrorMessage(`❌ Code generation failed: ${error}`);
                        telemetryManager.track('code_generation_failed', { error: String(error) });
                    }
                });
            }),

            vscode.commands.registerCommand('seguro.fixVulnerability', async (vulnerability) => {
                if (!authManager.isAuthenticated()) {
                    const result = await vscode.window.showInformationMessage(
                        'Please login to Seguro to fix vulnerabilities',
                        'Login'
                    );
                    if (result === 'Login') {
                        await vscode.commands.executeCommand('seguro.login');
                    }
                    return;
                }

                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: '🔧 Fixing security vulnerability...',
                    cancellable: true
                }, async (progress, token) => {
                    try {
                        const fix = await apiClient.fixVulnerability(vulnerability, token);
                        
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
                        vscode.window.showErrorMessage(`❌ Fix failed: ${error}`);
                        telemetryManager.track('vulnerability_fix_failed', { error: String(error) });
                    }
                });
            }),

            vscode.commands.registerCommand('seguro.openChat', async () => {
                await vscode.commands.executeCommand('seguro.chat.focus');
            }),

            vscode.commands.registerCommand('seguro.toggleInlineCompletions', async () => {
                const config = vscode.workspace.getConfiguration('seguro');
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
            const config = vscode.workspace.getConfiguration('seguro');
            if (config.get('enableAutoScan', true) && authManager.isAuthenticated()) {
                try {
                    const context = contextManager.getFileContext(document);
                    const results = await securityAnalyzer.analyzeDocument(document, context);
                    if (results.length > 0) {
                        vulnerabilityProvider.updateVulnerabilities(results);
                        await vscode.commands.executeCommand('setContext', 'seguro.hasVulnerabilities', true);
                    }
                } catch (error) {
                    console.error('Auto-scan failed:', error);
                }
            }
        });

        // Check authentication status on startup
        const isAuthenticated = await authManager.checkAuthStatus();
        await vscode.commands.executeCommand('setContext', 'seguro.authenticated', isAuthenticated);

        // Add all disposables to context
        context.subscriptions.push(
            completionDisposable,
            onSaveDisposable,
            ...commands
        );

        console.log('✅ Seguro extension activated successfully!');
        telemetryManager.track('extension_activated');
        
    } catch (error) {
        console.error('❌ Failed to activate Seguro extension:', error);
        vscode.window.showErrorMessage(`Failed to activate Seguro: ${error}`);
        telemetryManager?.track('extension_activation_failed', { error: String(error) });
    }
}

export function deactivate() {
    console.log('👋 Seguro extension deactivated');
    telemetryManager?.track('extension_deactivated');
}
