import pkg from 'mssql';
const { ConnectionPool } = pkg;

// Interface for configuration
interface DbConfig {
    user: string;
    password: string;
    server: string;
    database: string;
    port?: number;
    options: {
        encrypt: boolean;
        trustServerCertificate: boolean;
    };
}

const dbConfig: DbConfig = {
    user: process.env.MSSQL_USER!,
    password: process.env.MSSQL_PASSWORD!,
    server: process.env.MSSQL_SERVER!,
    database: process.env.MSSQL_DATABASE!,
    port: process.env.MSSQL_PORT ? parseInt(process.env.MSSQL_PORT) : 1433,
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

let pool: any | undefined;

async function connectToDatabase(): Promise<any> {
    if (!pool) {
        try {
            if (!process.env.MSSQL_USER || !process.env.MSSQL_PASSWORD || 
                !process.env.MSSQL_SERVER || !process.env.MSSQL_DATABASE) {
                throw new Error('Missing required database environment variables');
            }

            pool = new ConnectionPool(dbConfig);
            await pool.connect();
            console.log('Connected to the database');
        } catch (error: any) {
            console.error('Error connecting to the database:', error.message || error);
            throw error;
        }
    }
    return pool;
}

function getPool(): any {
    if (!pool) {
        throw new Error('Database pool not initialized. Call connectToDatabase first.');
    }
    return pool;
}

function getSqlRequest(): any {
    if (!pool) {
        throw new Error('Database pool not initialized. Call connectToDatabase first.');
    }
    return pool.request();
}

async function closePool(): Promise<void> {
    if (pool) {
        await pool.close();
        pool = undefined;
        console.log('Database connection closed');
    }
}

export { pkg as mssql, connectToDatabase, getPool, getSqlRequest, closePool };
