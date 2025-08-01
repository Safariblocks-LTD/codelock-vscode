import * as vscode from 'vscode';
import * as keytar from 'keytar';
import { v4 as uuidv4 } from 'uuid';

export interface AuthToken {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    userId: string;
}

export class AuthManager {
    private static readonly SERVICE_NAME = 'codelock-vscode';
    private static readonly TOKEN_KEY = 'auth-token';
    private context: vscode.ExtensionContext;
    private currentToken: AuthToken | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async login(): Promise<void> {
        try {
            // Create a unique session ID for this login attempt
            const sessionId = uuidv4();
            const authUrl = this.buildAuthUrl(sessionId);

            // Open the authentication URL in the user's browser
            await vscode.env.openExternal(vscode.Uri.parse(authUrl));

            // Show progress while waiting for authentication
            const token = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Waiting for authentication...',
                cancellable: true
            }, async (progress, cancellationToken) => {
                return this.waitForAuthCallback(sessionId, cancellationToken);
            });

            if (token) {
                await this.storeToken(token);
                this.currentToken = token;
            } else {
                throw new Error('Authentication was cancelled or failed');
            }
        } catch (error) {
            throw new Error(`Login failed: ${error}`);
        }
    }

    async logout(): Promise<void> {
        try {
            // Revoke the token on the server if possible
            if (this.currentToken) {
                await this.revokeToken(this.currentToken.accessToken);
            }
        } catch (error) {
            console.warn('Failed to revoke token on server:', error);
        }

        // Clear stored token
        await this.clearToken();
        this.currentToken = null;
    }

    async getValidToken(): Promise<string | null> {
        if (!this.currentToken) {
            this.currentToken = await this.loadToken();
        }

        if (!this.currentToken) {
            return null;
        }

        // Check if token is expired
        if (Date.now() >= this.currentToken.expiresAt) {
            try {
                this.currentToken = await this.refreshToken(this.currentToken.refreshToken);
                await this.storeToken(this.currentToken);
            } catch (error) {
                console.error('Failed to refresh token:', error);
                await this.clearToken();
                this.currentToken = null;
                return null;
            }
        }

        return this.currentToken.accessToken;
    }

    isAuthenticated(): boolean {
        return this.currentToken !== null;
    }

    async checkAuthStatus(): Promise<boolean> {
        const token = await this.getValidToken();
        return token !== null;
    }

    getUserId(): string | null {
        return this.currentToken?.userId || null;
    }

    private buildAuthUrl(sessionId: string): string {
        const config = vscode.workspace.getConfiguration('codelock');
        const apiEndpoint = config.get('apiEndpoint', 'https://api.codelock.ai');
        
        const params = new URLSearchParams({
            client_id: 'codelock-vscode',
            response_type: 'code',
            scope: 'read write',
            state: sessionId,
            redirect_uri: 'vscode://codelock-ai.codelock/auth-callback'
        });

        return `${apiEndpoint}/auth/authorize?${params.toString()}`;
    }

    private async waitForAuthCallback(sessionId: string, cancellationToken: vscode.CancellationToken): Promise<AuthToken | null> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                disposable.dispose();
                reject(new Error('Authentication timeout'));
            }, 300000); // 5 minutes timeout

            const disposable = vscode.window.registerUriHandler({
                handleUri: async (uri: vscode.Uri) => {
                    try {
                        clearTimeout(timeout);
                        disposable.dispose();

                        const query = new URLSearchParams(uri.query);
                        const code = query.get('code');
                        const state = query.get('state');
                        const error = query.get('error');

                        if (error) {
                            reject(new Error(`Authentication error: ${error}`));
                            return;
                        }

                        if (state !== sessionId) {
                            reject(new Error('Invalid authentication state'));
                            return;
                        }

                        if (!code) {
                            reject(new Error('No authorization code received'));
                            return;
                        }

                        // Exchange code for token
                        const token = await this.exchangeCodeForToken(code);
                        resolve(token);
                    } catch (err) {
                        reject(err);
                    }
                }
            });

            cancellationToken.onCancellationRequested(() => {
                clearTimeout(timeout);
                disposable.dispose();
                resolve(null);
            });
        });
    }

    private async exchangeCodeForToken(code: string): Promise<AuthToken> {
        const config = vscode.workspace.getConfiguration('codelock');
        const apiEndpoint = config.get('apiEndpoint', 'https://api.codelock.ai');

        const response = await fetch(`${apiEndpoint}/auth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                code: code,
                client_id: 'codelock-vscode',
                redirect_uri: 'vscode://codelock-ai.codelock/auth-callback'
            })
        });

        if (!response.ok) {
            throw new Error(`Token exchange failed: ${response.statusText}`);
        }

        const data = await response.json();
        
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (data.expires_in * 1000),
            userId: data.user_id
        };
    }

    private async refreshToken(refreshToken: string): Promise<AuthToken> {
        const config = vscode.workspace.getConfiguration('codelock');
        const apiEndpoint = config.get('apiEndpoint', 'https://api.codelock.ai');

        const response = await fetch(`${apiEndpoint}/auth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: 'codelock-vscode'
            })
        });

        if (!response.ok) {
            throw new Error(`Token refresh failed: ${response.statusText}`);
        }

        const data = await response.json();
        
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            expiresAt: Date.now() + (data.expires_in * 1000),
            userId: data.user_id
        };
    }

    private async revokeToken(accessToken: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('codelock');
        const apiEndpoint = config.get('apiEndpoint', 'https://api.codelock.ai');

        await fetch(`${apiEndpoint}/auth/revoke`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                token: accessToken
            })
        });
    }

    private async storeToken(token: AuthToken): Promise<void> {
        try {
            await keytar.setPassword(
                AuthManager.SERVICE_NAME,
                AuthManager.TOKEN_KEY,
                JSON.stringify(token)
            );
        } catch (error) {
            // Fallback to VS Code's secret storage if keytar fails
            console.warn('Keytar failed, using VS Code secret storage:', error);
            await this.context.secrets.store(AuthManager.TOKEN_KEY, JSON.stringify(token));
        }
    }

    private async loadToken(): Promise<AuthToken | null> {
        try {
            // Try keytar first
            const tokenStr = await keytar.getPassword(
                AuthManager.SERVICE_NAME,
                AuthManager.TOKEN_KEY
            );
            
            if (tokenStr) {
                return JSON.parse(tokenStr);
            }

            // Fallback to VS Code's secret storage
            const fallbackTokenStr = await this.context.secrets.get(AuthManager.TOKEN_KEY);
            if (fallbackTokenStr) {
                return JSON.parse(fallbackTokenStr);
            }

            return null;
        } catch (error) {
            console.error('Failed to load token:', error);
            return null;
        }
    }

    private async clearToken(): Promise<void> {
        try {
            await keytar.deletePassword(AuthManager.SERVICE_NAME, AuthManager.TOKEN_KEY);
        } catch (error) {
            console.warn('Failed to clear keytar token:', error);
        }

        try {
            await this.context.secrets.delete(AuthManager.TOKEN_KEY);
        } catch (error) {
            console.warn('Failed to clear VS Code secret:', error);
        }
    }
}
