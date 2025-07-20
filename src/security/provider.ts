import * as vscode from 'vscode';
import { SecurityAnalyzer, SecurityIssue } from './analyzer';

export class SecurityProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private outputChannel: vscode.OutputChannel;

    constructor(private analyzer: SecurityAnalyzer) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('seguro');
        this.outputChannel = vscode.window.createOutputChannel('Seguro Security');
    }

    showResults(issues: SecurityIssue[]): void {
        this.outputChannel.clear();
        this.outputChannel.show();

        if (issues.length === 0) {
            this.outputChannel.appendLine('✅ No security issues found!');
            return;
        }

        this.outputChannel.appendLine(`🔍 Security Analysis Results (${issues.length} issues found)\n`);

        // Group issues by severity
        const groupedIssues = this.groupBySeverity(issues);

        for (const [severity, severityIssues] of Object.entries(groupedIssues)) {
            if (severityIssues.length === 0) continue;

            const icon = this.getSeverityIcon(severity as any);
            this.outputChannel.appendLine(`${icon} ${severity.toUpperCase()} SEVERITY (${severityIssues.length} issues):`);
            this.outputChannel.appendLine('─'.repeat(50));

            for (const issue of severityIssues) {
                this.outputChannel.appendLine(`📁 File: ${issue.file}`);
                this.outputChannel.appendLine(`📍 Line ${issue.line}, Column ${issue.column}`);
                this.outputChannel.appendLine(`⚠️  ${issue.message}`);
                this.outputChannel.appendLine(`🔧 Rule: ${issue.rule}`);
                
                if (issue.suggestion) {
                    this.outputChannel.appendLine(`💡 Suggestion: ${issue.suggestion}`);
                }
                
                this.outputChannel.appendLine('');
            }
        }
    }

    showInlineWarnings(document: vscode.TextDocument, issues: SecurityIssue[]): void {
        const diagnostics: vscode.Diagnostic[] = [];

        for (const issue of issues) {
            const range = new vscode.Range(
                issue.line - 1,
                issue.column - 1,
                issue.line - 1,
                issue.column + 10 // Highlight a reasonable portion
            );

            const diagnostic = new vscode.Diagnostic(
                range,
                issue.message,
                this.getSeverityLevel(issue.severity)
            );

            diagnostic.code = issue.rule;
            diagnostic.source = 'Seguro';

            if (issue.suggestion) {
                diagnostic.relatedInformation = [
                    new vscode.DiagnosticRelatedInformation(
                        new vscode.Location(document.uri, range),
                        `Suggestion: ${issue.suggestion}`
                    )
                ];
            }

            diagnostics.push(diagnostic);
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private groupBySeverity(issues: SecurityIssue[]): Record<string, SecurityIssue[]> {
        return issues.reduce((groups, issue) => {
            const severity = issue.severity;
            if (!groups[severity]) {
                groups[severity] = [];
            }
            groups[severity].push(issue);
            return groups;
        }, {} as Record<string, SecurityIssue[]>);
    }

    private getSeverityIcon(severity: 'low' | 'medium' | 'high'): string {
        switch (severity) {
            case 'high': return '🚨';
            case 'medium': return '⚠️';
            case 'low': return '💡';
            default: return '❓';
        }
    }

    private getSeverityLevel(severity: 'low' | 'medium' | 'high'): vscode.DiagnosticSeverity {
        switch (severity) {
            case 'high': return vscode.DiagnosticSeverity.Error;
            case 'medium': return vscode.DiagnosticSeverity.Warning;
            case 'low': return vscode.DiagnosticSeverity.Information;
            default: return vscode.DiagnosticSeverity.Hint;
        }
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
        this.outputChannel.dispose();
    }
}
