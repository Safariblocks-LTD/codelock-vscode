import * as vscode from 'vscode';

export interface TelemetryEvent {
    event: string;
    properties?: Record<string, any>;
    timestamp: Date;
    userId?: string;
    sessionId: string;
}

export class TelemetryManager {
    private context: vscode.ExtensionContext;
    private sessionId: string;
    private isEnabled: boolean = false;
    private eventQueue: TelemetryEvent[] = [];
    private readonly maxQueueSize = 100;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.sessionId = this.generateSessionId();
        this.updateTelemetrySettings();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('codelock.enableTelemetry')) {
                this.updateTelemetrySettings();
            }
        });

        // Flush events periodically
        setInterval(() => {
            this.flushEvents();
        }, 60000); // Every minute
    }

    track(event: string, properties?: Record<string, any>): void {
        if (!this.isEnabled) {
            return;
        }

        const telemetryEvent: TelemetryEvent = {
            event,
            properties: this.sanitizeProperties(properties),
            timestamp: new Date(),
            sessionId: this.sessionId
        };

        this.eventQueue.push(telemetryEvent);

        // Prevent queue from growing too large
        if (this.eventQueue.length > this.maxQueueSize) {
            this.eventQueue = this.eventQueue.slice(-this.maxQueueSize);
        }

        // Flush immediately for critical events
        const criticalEvents = ['extension_activated', 'extension_deactivated', 'login_success', 'login_failed'];
        if (criticalEvents.includes(event)) {
            this.flushEvents();
        }
    }

    trackError(error: Error, context?: string): void {
        this.track('error_occurred', {
            error_message: error.message,
            error_stack: error.stack?.substring(0, 500), // Limit stack trace length
            context,
            error_name: error.name
        });
    }

    trackPerformance(operation: string, duration: number, success: boolean): void {
        this.track('performance_metric', {
            operation,
            duration_ms: duration,
            success
        });
    }

    trackUsage(feature: string, metadata?: Record<string, any>): void {
        this.track('feature_used', {
            feature,
            ...metadata
        });
    }

    private updateTelemetrySettings(): void {
        const config = vscode.workspace.getConfiguration('seguro');
        this.isEnabled = config.get('enableTelemetry', false);
        
        if (!this.isEnabled) {
            // Clear any queued events if telemetry is disabled
            this.eventQueue = [];
        }
    }

    private generateSessionId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    private sanitizeProperties(properties?: Record<string, any>): Record<string, any> | undefined {
        if (!properties) return undefined;

        const sanitized: Record<string, any> = {};
        
        for (const [key, value] of Object.entries(properties)) {
            // Remove potentially sensitive information
            if (this.isSensitiveKey(key)) {
                continue;
            }

            // Sanitize string values
            if (typeof value === 'string') {
                sanitized[key] = this.sanitizeString(value);
            } else if (typeof value === 'number' || typeof value === 'boolean') {
                sanitized[key] = value;
            } else if (Array.isArray(value)) {
                sanitized[key] = value.length; // Just track array length
            } else {
                sanitized[key] = typeof value; // Just track the type
            }
        }

        return sanitized;
    }

    private isSensitiveKey(key: string): boolean {
        const sensitivePatterns = [
            /password/i,
            /token/i,
            /key/i,
            /secret/i,
            /auth/i,
            /credential/i,
            /email/i,
            /username/i,
            /user_id/i,
            /path/i,
            /file/i,
            /directory/i
        ];

        return sensitivePatterns.some(pattern => pattern.test(key));
    }

    private sanitizeString(value: string): string {
        // Remove file paths, emails, and other potentially sensitive data
        return value
            .replace(/[a-zA-Z]:\\[^\s]+/g, '[FILE_PATH]') // Windows paths
            .replace(/\/[^\s]+/g, '[FILE_PATH]') // Unix paths
            .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]') // Emails
            .replace(/\b[A-Za-z0-9]{20,}\b/g, '[TOKEN]') // Potential tokens
            .substring(0, 200); // Limit length
    }

    private async flushEvents(): Promise<void> {
        if (!this.isEnabled || this.eventQueue.length === 0) {
            return;
        }

        const eventsToSend = [...this.eventQueue];
        this.eventQueue = [];

        try {
            // In a real implementation, you would send these to your telemetry service
            // For now, we'll just log them in development mode
            const config = vscode.workspace.getConfiguration('codelock');
            const isDevelopment = config.get('apiEndpoint', '').includes('localhost');
            
            if (isDevelopment) {
                console.log('Telemetry events:', eventsToSend);
            }

            // Here you would typically send to PostHog, Mixpanel, or your own analytics service
            // await this.sendToTelemetryService(eventsToSend);
            
        } catch (error) {
            console.warn('Failed to send telemetry events:', error);
            // Re-queue events if sending failed (with a limit to prevent infinite growth)
            if (this.eventQueue.length < this.maxQueueSize / 2) {
                this.eventQueue.unshift(...eventsToSend.slice(-10)); // Only re-queue last 10 events
            }
        }
    }

    private async sendToTelemetryService(events: TelemetryEvent[]): Promise<void> {
        // This would be implemented to send to your actual telemetry service
        // Example for PostHog:
        /*
        const response = await fetch('https://app.posthog.com/capture/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                api_key: 'your-posthog-key',
                events: events.map(event => ({
                    event: event.event,
                    properties: {
                        ...event.properties,
                        $timestamp: event.timestamp.toISOString(),
                        session_id: event.sessionId
                    },
                    distinct_id: event.userId || 'anonymous'
                }))
            })
        });
        */
    }

    dispose(): void {
        // Flush any remaining events before disposal
        this.flushEvents();
    }
}
