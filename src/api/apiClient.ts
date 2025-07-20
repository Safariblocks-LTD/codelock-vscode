import * as vscode from 'vscode';
import axios, { AxiosInstance, AxiosRequestConfig, CancelToken } from 'axios';
import { AuthManager } from '../auth/authManager';

export interface SecurityIssue {
    id: string;
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    description: string;
    file: string;
    line: number;
    column: number;
    code: string;
    suggestion: string;
    cweId?: string;
    references?: string[];
}

export interface CodeContext {
    language: string;
    fileName: string;
    projectType?: string;
    dependencies?: string[];
    imports?: string[];
    functions?: string[];
    classes?: string[];
    recentFiles?: string[];
}

export interface CompletionRequest {
    prefix: string;
    suffix: string;
    language: string;
    context: CodeContext;
    maxTokens?: number;
}

export interface CompletionResponse {
    completions: string[];
    reasoning?: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
}

export interface ChatRequest {
    messages: ChatMessage[];
    context?: CodeContext;
    maxTokens?: number;
}

export interface ChatResponse {
    message: string;
    reasoning?: string;
    suggestions?: string[];
}

export interface VulnerabilityFix {
    code: string;
    explanation: string;
    confidence: number;
}

export class ApiClient {
    private client: AxiosInstance;
    private authManager: AuthManager;

    constructor(authManager: AuthManager) {
        this.authManager = authManager;
        
        const config = vscode.workspace.getConfiguration('seguro');
        const apiEndpoint = config.get('apiEndpoint', 'https://api.seguro.ai');

        this.client = axios.create({
            baseURL: apiEndpoint,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Seguro-VSCode/0.1.0',
            },
        });

        // Request interceptor to add auth token
        this.client.interceptors.request.use(async (config) => {
            const token = await this.authManager.getValidToken();
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
            return config;
        });

        // Response interceptor for error handling
        this.client.interceptors.response.use(
            (response) => response,
            async (error) => {
                if (error.response?.status === 401) {
                    // Token expired or invalid, try to refresh
                    const token = await this.authManager.getValidToken();
                    if (!token) {
                        vscode.window.showErrorMessage('Authentication expired. Please login again.');
                        await vscode.commands.executeCommand('seguro.login');
                    }
                }
                return Promise.reject(error);
            }
        );
    }

    async analyzeCode(
        code: string, 
        context: CodeContext, 
        cancelToken?: CancelToken
    ): Promise<SecurityIssue[]> {
        try {
            const config = vscode.workspace.getConfiguration('seguro');
            const securityRules = config.get('securityRules', [
                'xss', 'sql-injection', 'hardcoded-secrets', 'insecure-random', 'path-traversal'
            ]);
            const severity = config.get('severity', 'medium');

            const response = await this.client.post('/analyze', {
                code,
                context,
                rules: securityRules,
                minSeverity: severity,
            }, {
                cancelToken,
            });

            return response.data.issues || [];
        } catch (error: any) {
            if (axios.isCancel(error)) {
                throw new Error('Analysis cancelled');
            }
            throw new Error(`Analysis failed: ${error.response?.data?.message || error.message}`);
        }
    }

    async getInlineCompletions(
        request: CompletionRequest,
        cancelToken?: CancelToken
    ): Promise<CompletionResponse> {
        try {
            const config = vscode.workspace.getConfiguration('seguro');
            const maxTokens = config.get('maxContextLines', 100);

            const response = await this.client.post('/complete', {
                ...request,
                maxTokens: request.maxTokens || maxTokens,
                securityFirst: true, // Always prioritize security
            }, {
                cancelToken,
                timeout: 10000, // Shorter timeout for completions
            });

            return response.data;
        } catch (error: any) {
            if (axios.isCancel(error)) {
                throw new Error('Completion cancelled');
            }
            throw new Error(`Completion failed: ${error.response?.data?.message || error.message}`);
        }
    }

    async generateSecureCode(
        specification: string,
        context: CodeContext,
        cancelToken?: CancelToken
    ): Promise<string> {
        try {
            const response = await this.client.post('/generate', {
                specification,
                context,
                securityFirst: true,
                includeComments: true,
            }, {
                cancelToken,
            });

            return response.data.code;
        } catch (error: any) {
            if (axios.isCancel(error)) {
                throw new Error('Code generation cancelled');
            }
            throw new Error(`Code generation failed: ${error.response?.data?.message || error.message}`);
        }
    }

    async fixVulnerability(
        vulnerability: SecurityIssue,
        cancelToken?: CancelToken
    ): Promise<VulnerabilityFix> {
        try {
            const response = await this.client.post('/fix', {
                vulnerability,
                preserveLogic: true,
                addComments: true,
            }, {
                cancelToken,
            });

            return response.data;
        } catch (error: any) {
            if (axios.isCancel(error)) {
                throw new Error('Fix generation cancelled');
            }
            throw new Error(`Fix generation failed: ${error.response?.data?.message || error.message}`);
        }
    }

    async chatWithSeguro(
        request: ChatRequest,
        cancelToken?: CancelToken
    ): Promise<ChatResponse> {
        try {
            const response = await this.client.post('/chat', {
                ...request,
                securityFocus: true,
            }, {
                cancelToken,
            });

            return response.data;
        } catch (error: any) {
            if (axios.isCancel(error)) {
                throw new Error('Chat cancelled');
            }
            throw new Error(`Chat failed: ${error.response?.data?.message || error.message}`);
        }
    }

    async scanWorkspace(
        files: string[],
        cancelToken?: CancelToken,
        onProgress?: (progress: number, file: string) => void
    ): Promise<SecurityIssue[]> {
        try {
            const config = vscode.workspace.getConfiguration('seguro');
            const securityRules = config.get('securityRules', [
                'xss', 'sql-injection', 'hardcoded-secrets', 'insecure-random', 'path-traversal'
            ]);
            const severity = config.get('severity', 'medium');

            const response = await this.client.post('/scan-workspace', {
                files,
                rules: securityRules,
                minSeverity: severity,
            }, {
                cancelToken,
                onUploadProgress: (progressEvent) => {
                    if (onProgress && progressEvent.total) {
                        const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        onProgress(progress, 'Uploading files...');
                    }
                },
            });

            return response.data.issues || [];
        } catch (error: any) {
            if (axios.isCancel(error)) {
                throw new Error('Workspace scan cancelled');
            }
            throw new Error(`Workspace scan failed: ${error.response?.data?.message || error.message}`);
        }
    }

    async getUserUsage(): Promise<{
        requestsThisMonth: number;
        requestsLimit: number;
        tokensUsed: number;
        tokensLimit: number;
    }> {
        try {
            const response = await this.client.get('/usage');
            return response.data;
        } catch (error: any) {
            throw new Error(`Failed to get usage: ${error.response?.data?.message || error.message}`);
        }
    }

    async reportFeedback(
        type: 'bug' | 'feature' | 'improvement',
        message: string,
        context?: any
    ): Promise<void> {
        try {
            await this.client.post('/feedback', {
                type,
                message,
                context,
                version: '0.1.0',
                platform: process.platform,
            });
        } catch (error: any) {
            console.error('Failed to send feedback:', error);
            // Don't throw here as feedback is not critical
        }
    }

    // Health check method
    async ping(): Promise<boolean> {
        try {
            const response = await this.client.get('/health', { timeout: 5000 });
            return response.status === 200;
        } catch (error: any) {
            return false;
        }
    }
}
