import express from 'express';
import { Database } from './db/index';

const app = express();
const port = process.env.PORT || 3000;

const db = new Database();

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Welcome to the PostgreSQL Project!');
});

const startServer = async () => {
    try {
        await db.connect();
        console.log('Connected to the PostgreSQL database.');

        app.listen(port, () => {
            console.log(`Server is running on http://localhost:${port}`);
        });
    } catch (error) {
        console.error('Error connecting to the database:', error);
    }
};

startServer();