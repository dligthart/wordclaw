import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Login from './+page.svelte';

// Mock routing
vi.mock('$app/navigation', () => ({
    goto: vi.fn()
}));

// Mock API
vi.mock('$lib/api', () => ({
    fetchApi: vi.fn()
}));

// Mock Auth
vi.mock('$lib/auth.svelte', () => ({
    auth: {
        user: null,
        loading: false,
        error: null
    },
    checkAuth: vi.fn()
}));

describe('Login Page', () => {
    it('renders the login form', () => {
        const { container } = render(Login);

        expect(screen.getByText('WordClaw Supervisor')).toBeTruthy();
        expect(screen.getByLabelText('Email address')).toBeTruthy();
        expect(screen.getByLabelText('Password')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();

        // Cover the rendering of the UI with a snapshot
        expect(container).toMatchSnapshot();
    });

    it('allows typing in email and password fields', async () => {
        render(Login);

        const emailInput = screen.getByLabelText('Email address') as HTMLInputElement;
        const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;

        await fireEvent.input(emailInput, { target: { value: 'test@example.com' } });
        await fireEvent.input(passwordInput, { target: { value: 'password123' } });

        expect(emailInput.value).toBe('test@example.com');
        expect(passwordInput.value).toBe('password123');
    });
});
