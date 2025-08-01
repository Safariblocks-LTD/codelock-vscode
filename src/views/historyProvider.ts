import * as vscode from 'vscode';
import * as path from 'path';

export interface HistoryItem {
    id: string;
    type: 'scan' | 'fix' | 'generation' | 'chat';
    title: string;
    description: string;
    timestamp: Date;
    file?: string;
    line?: number;
    success: boolean;
    details?: any;
}

export class HistoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly historyItem: HistoryItem,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(historyItem.title, collapsibleState);
        
        this.tooltip = `${historyItem.description}\n\nTime: ${historyItem.timestamp.toLocaleString()}\nType: ${historyItem.type}\nStatus: ${historyItem.success ? 'Success' : 'Failed'}`;
        this.description = this.getDescription();
        
        // Set icon based on type and success
        this.iconPath = this.getTypeIcon(historyItem.type, historyItem.success);
        
        // Set context value for menu actions
        this.contextValue = `history-${historyItem.type}`;
        
        // Command to show details or open file
        if (historyItem.file) {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [
                    vscode.Uri.file(historyItem.file),
                    historyItem.line ? {
                        selection: new vscode.Range(
                            historyItem.line - 1,
                            0,
                            historyItem.line - 1,
                            0
                        )
                    } : undefined
                ]
            };
        } else {
            this.command = {
                command: 'seguro.showHistoryDetails',
                title: 'Show Details',
                arguments: [historyItem]
            };
        }
    }

    private getDescription(): string {
        const timeAgo = this.getTimeAgo(this.historyItem.timestamp);
        const fileInfo = this.historyItem.file ? ` • ${path.basename(this.historyItem.file)}` : '';
        const statusIcon = this.historyItem.success ? '✓' : '✗';
        
        return `${timeAgo}${fileInfo} ${statusIcon}`;
    }

    private getTimeAgo(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }

    private getTypeIcon(type: string, success: boolean): vscode.ThemeIcon {
        const color = success ? 'testing.iconPassed' : 'testing.iconFailed';
        
        switch (type) {
            case 'scan':
                return new vscode.ThemeIcon('search', new vscode.ThemeColor(color));
            case 'fix':
                return new vscode.ThemeIcon('wrench', new vscode.ThemeColor(color));
            case 'generation':
                return new vscode.ThemeIcon('code', new vscode.ThemeColor(color));
            case 'chat':
                return new vscode.ThemeIcon('comment', new vscode.ThemeColor(color));
            default:
                return new vscode.ThemeIcon('history', new vscode.ThemeColor(color));
        }
    }
}

export class HistoryProvider implements vscode.TreeDataProvider<HistoryTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<HistoryTreeItem | undefined | null | void> = new vscode.EventEmitter<HistoryTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<HistoryTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private history: HistoryItem[] = [];
    private context: vscode.ExtensionContext;
    private readonly maxHistoryItems = 100;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadHistory();
        this.registerCommands();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    addHistoryItem(item: HistoryItem): void {
        // Add to beginning of array (most recent first)
        this.history.unshift(item);
        
        // Limit history size
        if (this.history.length > this.maxHistoryItems) {
            this.history = this.history.slice(0, this.maxHistoryItems);
        }
        
        this.saveHistory();
        this.refresh();
    }

    getTreeItem(element: HistoryTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: HistoryTreeItem): Thenable<HistoryTreeItem[]> {
        if (!element) {
            // Root level - show all history items grouped by date
            return Promise.resolve(this.getHistoryGroups());
        }
        return Promise.resolve([]);
    }

    private getHistoryGroups(): HistoryTreeItem[] {
        if (this.history.length === 0) {
            return [];
        }

        // Group by date
        const groups = new Map<string, HistoryItem[]>();
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        for (const item of this.history) {
            let groupKey: string;
            const itemDate = new Date(item.timestamp);
            
            if (this.isSameDay(itemDate, today)) {
                groupKey = 'Today';
            } else if (this.isSameDay(itemDate, yesterday)) {
                groupKey = 'Yesterday';
            } else {
                groupKey = itemDate.toLocaleDateString();
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(item);
        }

        // Create tree items
        const items: HistoryTreeItem[] = [];
        
        // Sort groups by date (most recent first)
        const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
            if (a[0] === 'Today') return -1;
            if (b[0] === 'Today') return 1;
            if (a[0] === 'Yesterday') return -1;
            if (b[0] === 'Yesterday') return 1;
            return new Date(b[0]).getTime() - new Date(a[0]).getTime();
        });

        for (const [groupName, groupItems] of sortedGroups) {
            // Add group header (optional - can be removed if not needed)
            // For now, just add individual items
            for (const item of groupItems) {
                items.push(new HistoryTreeItem(item, vscode.TreeItemCollapsibleState.None));
            }
        }

        return items;
    }

    private isSameDay(date1: Date, date2: Date): boolean {
        return date1.getFullYear() === date2.getFullYear() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getDate() === date2.getDate();
    }

    private loadHistory(): void {
        try {
            const savedHistory = this.context.globalState.get<HistoryItem[]>('codelock.history', []);
            // Convert timestamp strings back to Date objects
            this.history = savedHistory.map(item => ({
                ...item,
                timestamp: new Date(item.timestamp)
            }));
        } catch (error) {
            console.error('Failed to load history:', error);
            this.history = [];
        }
    }

    private saveHistory(): void {
        try {
            this.context.globalState.update('codelock.history', this.history);
        } catch (error) {
            console.error('Failed to save history:', error);
        }
    }

    private registerCommands(): void {
        // Command to show history item details
        const showHistoryDetailsCommand = vscode.commands.registerCommand(
            'codelock.showHistoryDetails',
            async (item: HistoryItem) => {
                const panel = vscode.window.createWebviewPanel(
                    'historyDetails',
                    `History: ${item.title}`,
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true
                    }
                );

                panel.webview.html = this.getHistoryDetailsHtml(item);
            }
        );

        // Command to clear history
        const clearHistoryCommand = vscode.commands.registerCommand(
            'codelock.clearHistory',
            async () => {
                const result = await vscode.window.showWarningMessage(
                    'Are you sure you want to clear all history?',
                    { modal: true },
                    'Yes, Clear All',
                    'Cancel'
                );

                if (result === 'Yes, Clear All') {
                    this.history = [];
                    this.saveHistory();
                    this.refresh();
                    vscode.window.showInformationMessage('History cleared');
                }
            }
        );

        // Command to export history
        const exportHistoryCommand = vscode.commands.registerCommand(
            'codelock.exportHistory',
            async () => {
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file('codelock-history.json'),
                    filters: {
                        'JSON files': ['json']
                    }
                });

                if (uri) {
                    try {
                        const historyJson = JSON.stringify(this.history, null, 2);
                        await vscode.workspace.fs.writeFile(uri, Buffer.from(historyJson));
                        vscode.window.showInformationMessage('History exported successfully');
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to export history: ${error}`);
                    }
                }
            }
        );

        // Command to remove specific history item
        const removeHistoryItemCommand = vscode.commands.registerCommand(
            'codelock.removeHistoryItem',
            async (item: HistoryTreeItem) => {
                this.history = this.history.filter(h => h.id !== item.historyItem.id);
                this.saveHistory();
                this.refresh();
                vscode.window.showInformationMessage('History item removed');
            }
        );

        this.context.subscriptions.push(
            showHistoryDetailsCommand,
            clearHistoryCommand,
            exportHistoryCommand,
            removeHistoryItemCommand
        );
    }

    private getHistoryDetailsHtml(item: HistoryItem): string {
        const statusColor = item.success ? '#4CAF50' : '#F44336';
        const statusText = item.success ? 'Success' : 'Failed';
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>History Details</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        .status {
            color: ${statusColor};
            font-weight: bold;
        }
        .details {
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 15px;
            margin: 15px 0;
        }
        .metadata {
            display: grid;
            grid-template-columns: 120px 1fr;
            gap: 10px;
            margin: 15px 0;
        }
        .metadata-label {
            font-weight: bold;
            color: var(--vscode-descriptionForeground);
        }
        .type-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.8em;
            font-weight: bold;
            text-transform: uppercase;
        }
        .type-scan { background-color: #2196F3; color: white; }
        .type-fix { background-color: #FF9800; color: white; }
        .type-generation { background-color: #4CAF50; color: white; }
        .type-chat { background-color: #9C27B0; color: white; }
    </style>
</head>
<body>
    <h1>📋 History Details</h1>
    
    <div class="metadata">
        <div class="metadata-label">Title:</div>
        <div>${item.title}</div>
        
        <div class="metadata-label">Type:</div>
        <div><span class="type-badge type-${item.type}">${item.type}</span></div>
        
        <div class="metadata-label">Status:</div>
        <div class="status">${statusText}</div>
        
        <div class="metadata-label">Time:</div>
        <div>${item.timestamp.toLocaleString()}</div>
        
        ${item.file ? `
        <div class="metadata-label">File:</div>
        <div>${item.file}</div>
        ` : ''}
        
        ${item.line ? `
        <div class="metadata-label">Line:</div>
        <div>${item.line}</div>
        ` : ''}
    </div>
    
    <h3>Description</h3>
    <p>${item.description}</p>
    
    ${item.details ? `
    <h3>Details</h3>
    <div class="details">
        <pre>${JSON.stringify(item.details, null, 2)}</pre>
    </div>
    ` : ''}
</body>
</html>`;
    }

    // Helper methods for other parts of the extension to add history items
    addScanHistory(file: string, vulnerabilitiesFound: number, success: boolean): void {
        this.addHistoryItem({
            id: this.generateId(),
            type: 'scan',
            title: `Scanned ${path.basename(file)}`,
            description: success 
                ? `Found ${vulnerabilitiesFound} vulnerabilities`
                : 'Scan failed',
            timestamp: new Date(),
            file,
            success,
            details: { vulnerabilitiesFound }
        });
    }

    addFixHistory(file: string, line: number, vulnerabilityType: string, success: boolean): void {
        this.addHistoryItem({
            id: this.generateId(),
            type: 'fix',
            title: `Fixed ${vulnerabilityType}`,
            description: success 
                ? `Successfully fixed vulnerability in ${path.basename(file)}`
                : `Failed to fix vulnerability in ${path.basename(file)}`,
            timestamp: new Date(),
            file,
            line,
            success,
            details: { vulnerabilityType }
        });
    }

    addGenerationHistory(file: string, spec: string, success: boolean): void {
        this.addHistoryItem({
            id: this.generateId(),
            type: 'generation',
            title: 'Generated Code',
            description: success 
                ? `Generated code from spec in ${path.basename(file)}`
                : `Failed to generate code in ${path.basename(file)}`,
            timestamp: new Date(),
            file,
            success,
            details: { spec: spec.substring(0, 100) + '...' }
        });
    }

    addChatHistory(question: string, success: boolean): void {
        this.addHistoryItem({
            id: this.generateId(),
            type: 'chat',
            title: 'Chat Query',
            description: success 
                ? `Asked: "${question.substring(0, 50)}..."`
                : 'Chat query failed',
            timestamp: new Date(),
            success,
            details: { question }
        });
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
}
