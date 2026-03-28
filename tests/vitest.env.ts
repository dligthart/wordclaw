const defaultEnv: Record<string, string> = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/wordclaw',
    JWT_SECRET: 'test-jwt-secret',
    COOKIE_SECRET: 'test-cookie-secret',
    L402_SECRET: 'test-l402-secret',
    PUBLIC_WRITE_SECRET: 'test-public-write-secret'
};

export const applyVitestEnvDefaults = () => {
    for (const [key, value] of Object.entries(defaultEnv)) {
        if (!process.env[key]) {
            process.env[key] = value;
        }
    }
};
