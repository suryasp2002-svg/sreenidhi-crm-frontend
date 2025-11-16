# PostgreSQL Project

This project is a simple application that connects to a PostgreSQL database. It demonstrates how to handle database connections and execute SQL queries using TypeScript.

## Project Structure

```
postgresql-project
├── src
│   ├── db
│   │   └── index.ts        # Database connection and query handling
│   ├── app.ts              # Application entry point
│   └── types
│       └── index.ts        # Type definitions for User and Post
├── package.json             # npm dependencies and scripts
├── tsconfig.json            # TypeScript configuration
└── README.md                # Project documentation
```

## Setup Instructions

1. **Clone the repository:**
   ```
   git clone <repository-url>
   cd postgresql-project
   ```

2. **Install dependencies:**
   ```
   npm install
   ```

3. **Configure the database connection:**
   Update the database connection settings in `src/db/index.ts` to match your PostgreSQL database credentials.

4. **Run the application:**
   ```
   npm start
   ```

## Usage Examples

- To connect to the database, use the `connect` method from the `Database` class.
- Execute SQL queries using the `query` method.

## License

This project is licensed under the MIT License.