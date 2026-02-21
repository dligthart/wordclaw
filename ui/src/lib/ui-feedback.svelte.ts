export interface Toast {
    id: string;
    severity: 'success' | 'warning' | 'error' | 'info';
    title: string;
    message?: string;
    code?: string;
    remediation?: string;
    action?: { label: string; handler: () => void };
}

export interface ConfirmRequest {
    title: string;
    message: string;
    confirmLabel: string;
    confirmIntent: 'danger' | 'primary';
    onConfirm: () => Promise<void>;
}

export interface FeedbackPayload {
    severity: 'success' | 'warning' | 'error' | 'info';
    title: string;
    message?: string;
    code?: string;
    remediation?: string;
    action?: { label: string; handler: () => void };
    autoDismissMs?: number;
}

class FeedbackStore {
    toasts = $state<Toast[]>([]);
    confirmRequest = $state<ConfirmRequest | null>(null);

    pushToast(payload: FeedbackPayload) {
        const id = crypto.randomUUID();
        const toast: Toast = {
            id,
            severity: payload.severity,
            title: payload.title,
            message: payload.message,
            code: payload.code,
            remediation: payload.remediation,
            action: payload.action
        };

        this.toasts = [...this.toasts, toast];

        const dismissMs = payload.autoDismissMs ?? (payload.severity === 'success' || payload.severity === 'info' ? 5000 : 0);

        if (dismissMs > 0) {
            setTimeout(() => {
                this.dismissToast(id);
            }, dismissMs);
        }
    }

    dismissToast(id: string) {
        this.toasts = this.toasts.filter(t => t.id !== id);
    }

    openConfirm(request: ConfirmRequest) {
        this.confirmRequest = request;
    }

    closeConfirm() {
        this.confirmRequest = null;
    }
}

export const feedbackStore = new FeedbackStore();
