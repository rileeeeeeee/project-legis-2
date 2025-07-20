# Project Legis V2

Project Legis is a web-based legal tool that leverages Google's Gemini Large Language Model (LLM) to analyze, summarize, and demystify complex legal text.

## Technology Stack

-   **Frontend:** HTML, Tailwind CSS, Vanilla JavaScript
-   **Backend:** Node.js, Express.js
-   **API:** Google Gemini API

## Architecture

This application uses a client-server architecture to ensure security. The API key is never exposed to the client.

**Request Flow:**
`Client (Browser) -> Our Node.js Server -> Google Gemini API`

## Setup and Installation

1.  **Clone the repository.**

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create `.env` file:**
    Create a file named `.env` in the root of the project and add your API key:
    ```
    GEMINI_API_KEY=your_actual_api_key_here
    ```

4.  **Run the server:**
    ```bash
    npm start
    ```

5.  **Access the application:**
    Open your browser to `http://localhost:3000`.