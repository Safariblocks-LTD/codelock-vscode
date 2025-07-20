import * as vscode from 'vscode';
import * as path from 'path';
import { CodeContext } from '../api/apiClient';

export class ContextManager {
    private recentFiles: Map<string, Date> = new Map();
    private readonly maxRecentFiles = 10;

    constructor() {
        // Track recently opened files
        vscode.workspace.onDidOpenTextDocument((document) => {
            this.trackRecentFile(document.fileName);
        });

        vscode.workspace.onDidSaveTextDocument((document) => {
            this.trackRecentFile(document.fileName);
        });
    }

    getFileContext(document: vscode.TextDocument): CodeContext {
        const context: CodeContext = {
            language: document.languageId,
            fileName: path.basename(document.fileName),
            projectType: this.detectProjectType(),
            dependencies: this.extractDependencies(),
            imports: this.extractImports(document),
            functions: this.extractFunctions(document),
            classes: this.extractClasses(document),
            recentFiles: this.getRecentFileNames()
        };

        return context;
    }

    getWorkspaceContext(): Partial<CodeContext> {
        return {
            projectType: this.detectProjectType(),
            dependencies: this.extractDependencies(),
            recentFiles: this.getRecentFileNames()
        };
    }

    private trackRecentFile(fileName: string): void {
        // Don't track certain file types
        const excludeExtensions = ['.git', '.log', '.tmp', '.cache'];
        if (excludeExtensions.some(ext => fileName.includes(ext))) {
            return;
        }

        this.recentFiles.set(fileName, new Date());

        // Keep only the most recent files
        if (this.recentFiles.size > this.maxRecentFiles) {
            const sortedFiles = Array.from(this.recentFiles.entries())
                .sort(([,a], [,b]) => b.getTime() - a.getTime());
            
            this.recentFiles.clear();
            sortedFiles.slice(0, this.maxRecentFiles).forEach(([file, date]) => {
                this.recentFiles.set(file, date);
            });
        }
    }

    private getRecentFileNames(): string[] {
        return Array.from(this.recentFiles.keys())
            .map(filePath => path.basename(filePath));
    }

    private detectProjectType(): string | undefined {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return undefined;

        // Check for common project files
        const projectFiles = [
            { file: 'package.json', type: 'nodejs' },
            { file: 'requirements.txt', type: 'python' },
            { file: 'Pipfile', type: 'python' },
            { file: 'pyproject.toml', type: 'python' },
            { file: 'pom.xml', type: 'java-maven' },
            { file: 'build.gradle', type: 'java-gradle' },
            { file: 'build.gradle.kts', type: 'kotlin-gradle' },
            { file: 'Cargo.toml', type: 'rust' },
            { file: 'go.mod', type: 'go' },
            { file: '*.csproj', type: 'dotnet' },
            { file: '*.sln', type: 'dotnet' },
            { file: 'composer.json', type: 'php' },
            { file: 'Gemfile', type: 'ruby' },
            { file: 'mix.exs', type: 'elixir' },
            { file: 'pubspec.yaml', type: 'dart' },
            { file: 'CMakeLists.txt', type: 'cpp' },
            { file: 'Makefile', type: 'c' }
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

    private extractDependencies(): string[] {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return [];

        const dependencies: string[] = [];

        try {
            const fs = require('fs');
            
            // Node.js dependencies
            const packageJsonPath = path.join(workspaceRoot, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                const deps = [
                    ...Object.keys(packageJson.dependencies || {}),
                    ...Object.keys(packageJson.devDependencies || {})
                ];
                dependencies.push(...deps);
            }

            // Python dependencies
            const requirementsPath = path.join(workspaceRoot, 'requirements.txt');
            if (fs.existsSync(requirementsPath)) {
                const requirements = fs.readFileSync(requirementsPath, 'utf8');
                const pythonDeps = requirements.split('\n')
                    .map((line: string) => line.split('==')[0].split('>=')[0].split('<=')[0].trim())
                    .filter((dep: string) => dep && !dep.startsWith('#'));
                dependencies.push(...pythonDeps);
            }

            // Rust dependencies
            const cargoPath = path.join(workspaceRoot, 'Cargo.toml');
            if (fs.existsSync(cargoPath)) {
                const cargoContent = fs.readFileSync(cargoPath, 'utf8');
                const dependencySection = cargoContent.match(/\[dependencies\]([\s\S]*?)(?=\[|$)/);
                if (dependencySection) {
                    const rustDeps = dependencySection[1]
                        .split('\n')
                        .map((line: string) => line.split('=')[0].trim())
                        .filter((dep: string) => dep && !dep.startsWith('#'));
                    dependencies.push(...rustDeps);
                }
            }

        } catch (error) {
            console.warn('Failed to extract dependencies:', error);
        }

        return [...new Set(dependencies)]; // Remove duplicates
    }

    private extractImports(document: vscode.TextDocument): string[] {
        const text = document.getText();
        const imports: string[] = [];

        // Different import patterns for different languages
        const importPatterns = [
            // JavaScript/TypeScript
            /^import\s+.*?from\s+['"]([^'"]+)['"]/gm,
            /^import\s+['"]([^'"]+)['"]/gm,
            /require\(['"]([^'"]+)['"]\)/g,
            
            // Python
            /^from\s+([^\s]+)\s+import/gm,
            /^import\s+([^\s,]+)/gm,
            
            // Java
            /^import\s+([^;]+);/gm,
            
            // C/C++
            /^#include\s*[<"]([^>"]+)[>"]/gm,
            
            // Go
            /^import\s+['"]([^'"]+)['"]/gm,
            
            // Rust
            /^use\s+([^;]+);/gm
        ];

        for (const pattern of importPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                imports.push(match[1].trim());
            }
        }

        return [...new Set(imports)]; // Remove duplicates
    }

    private extractFunctions(document: vscode.TextDocument): string[] {
        const text = document.getText();
        const functions: string[] = [];

        // Function patterns for different languages
        const functionPatterns = [
            // JavaScript/TypeScript
            /(?:function\s+|const\s+|let\s+|var\s+)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)|\([^)]*\)\s*{)/g,
            /(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
            
            // Python
            /^def\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm,
            /^async\s+def\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm,
            
            // Java/C#
            /(?:public|private|protected|static)?\s*(?:async\s+)?(?:void|int|string|bool|[A-Z][a-zA-Z0-9_]*)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
            
            // C/C++
            /^(?:static\s+)?(?:inline\s+)?(?:void|int|char|float|double|[a-zA-Z_][a-zA-Z0-9_]*)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm,
            
            // Go
            /^func\s+(?:\([^)]*\)\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/gm,
            
            // Rust
            /^(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm
        ];

        for (const pattern of functionPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                functions.push(match[1]);
            }
        }

        return [...new Set(functions)]; // Remove duplicates
    }

    private extractClasses(document: vscode.TextDocument): string[] {
        const text = document.getText();
        const classes: string[] = [];

        // Class patterns for different languages
        const classPatterns = [
            // JavaScript/TypeScript
            /^(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/gm,
            
            // Python
            /^class\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm,
            
            // Java/C#
            /^(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|static\s+)?class\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm,
            
            // C++
            /^(?:class|struct)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm,
            
            // Rust
            /^(?:pub\s+)?struct\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm,
            /^(?:pub\s+)?enum\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm,
            
            // Go
            /^type\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+struct/gm
        ];

        for (const pattern of classPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                classes.push(match[1]);
            }
        }

        return [...new Set(classes)]; // Remove duplicates
    }
}
