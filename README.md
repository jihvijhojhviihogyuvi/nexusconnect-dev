# ChatFlow

ChatFlow is a real-time communication platform inspired by Discord and Slack, built with a modern full-stack TypeScript architecture. It supports direct and group messaging, voice/video calls, and file sharing.

## Core Technologies

*   **Frontend:**
    *   **Framework:** React 18 with TypeScript
    *   **Build Tool:** Vite
    *   **Routing:** Wouter
    *   **UI:** Tailwind CSS with shadcn/ui and Radix UI primitives
    *   **State Management:** TanStack Query (React Query) and React Context API
*   **Backend:**
    *   **Framework:** Express.js with TypeScript
    *   **Real-time:** WebSockets (`ws` library)
    *   **Authentication:** Passport.js with Replit Auth (OIDC)
*   **Database:**
    *   **ORM:** Drizzle ORM
    *   **Database:** PostgreSQL (via Neon serverless driver)

## Getting Started

### Prerequisites

*   Node.js (version 20 or higher)
*   npm (or a compatible package manager)
*   A PostgreSQL database

Before you begin, you will need to create a `.env` file in the root of the project and add your PostgreSQL connection string to it:

```
DATABASE_URL="your_postgresql_connection_string"
```

### Installation and Running

1.  Clone the repository and navigate to the project directory.
2.  Install the dependencies:
    ```bash
    npm install
    ```
3.  Run the development server:
    ```bash
    npm run dev
    ```
    *   The main application will be available at `http://localhost:5000`
    *   A development admin console will be available at `http://localhost:4000`

## Key Commands

*   `npm run dev`: Starts the development server for both the main app and admin console.
*   `npm run build`: Builds the production-ready client and server assets.
*   `npm run start`: Runs the production-built application.
*   `npm run check`: Runs the TypeScript compiler to check for type errors.
*   `npm run db:push`: Pushes schema changes to the database using Drizzle ORM.
