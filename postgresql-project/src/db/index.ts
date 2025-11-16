import { Client } from 'pg';

export class Database {
    private client: Client;

    constructor() {
        this.client = new Client({
            user: 'your_username',
            host: 'localhost',
            database: 'your_database',
            password: 'your_password',
            port: 5432,
        });
    }

    async connect() {
        await this.client.connect();
    }

    async disconnect() {
        await this.client.end();
    }

    async query(queryText: string, params?: any[]) {
        const res = await this.client.query(queryText, params);
        return res.rows;
    }
}