
import { startServer } from './server.js';
import dotenv from 'dotenv';

dotenv.config();

startServer().catch((error) => {
    console.error("Fatal error running MCP server:", error);
    process.exit(1);
});
