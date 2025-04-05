
# Advanced Hasura GraphQL MCP Server

**Version:** 1.1.0

This Model Context Protocol (MCP) server provides an advanced interface for AI agents (like those in Cursor or Claude Desktop) to interact with a Hasura GraphQL endpoint. It enables agents to discover the API structure, execute both read-only queries and mutations (with caution), preview data, perform aggregations, and check service health.

This server enhances LLM capabilities by allowing them to leverage your Hasura API dynamically based on natural language requests.

## Features

This server exposes the following MCP capabilities:

**Resources:**

*   **Hasura GraphQL Schema (`hasura:/schema`)**
    *   Provides the full GraphQL schema definition obtained via standard introspection.
    *   **MIME Type:** `application/json`
    *   Agents can read this resource to understand the complete structure of the API, including types, fields, arguments, directives, etc.

**Tools:**

*   **`run_graphql_query`**
    *   **Description:** Executes a read-only GraphQL query against the Hasura endpoint. Use this for fetching data when a specific tool isn't available. Ensure the query does not modify data. *Example: `query { users { id name } }`*
    *   **Input:** `{ query: string, variables?: object }`
    *   **Note:** Performs a basic check to prevent execution of strings starting with `mutation`. Primarily relies on the query itself being read-only.

*   **`run_graphql_mutation`**
    *   **Description:** Executes a GraphQL mutation to insert, update, or delete data. **Use with caution**, ensure the operation is intended and safe. Relies on Hasura permissions configured for the provided Admin Secret or default role. *Example: `mutation { insert_users_one(object: {name: "Test"}) { id } }`*
    *   **Input:** `{ mutation: string, variables?: object }`
    *   **Security:** Allows any mutation permitted by the Hasura role. Ensure appropriate Hasura permissions are configured.

*   **`list_tables`**
    *   **Description:** Lists available data tables (or collections) managed by Hasura, organized by schema with descriptions, based on introspection heuristics (looks for object types with an 'id' field, excluding internal/aggregate types). Useful for discovering available data sources.
    *   **Input:** `{ schemaName?: string }` (Optional schema name, attempts to infer from field descriptions if possible, defaults to 'public' conceptually)

*   **`describe_table`**
    *   **Description:** Shows the structure of a specific table including all its columns (fields) with their GraphQL types and descriptions.
    *   **Input:** `{ tableName: string, schemaName?: string }`

*   **`list_root_fields`**
    *   **Description:** Lists the available top-level query, mutation, or subscription fields from the GraphQL schema. Useful for understanding the primary entry points for operations.
    *   **Input:** `{ fieldType?: 'QUERY' | 'MUTATION' | 'SUBSCRIPTION' }` (Optional filter)

*   **`describe_graphql_type`**
    *   **Description:** Provides details about a specific GraphQL type (Object, Input, Scalar, Enum, Interface, Union) using schema introspection. Essential for understanding how to structure queries or mutations involving specific types.
    *   **Input:** `{ typeName: string }` (Case-sensitive type name)

*   **`preview_table_data`**
    *   **Description:** Fetches a limited sample of rows (default 5) from a specified table to preview its data structure and content. Selects common scalar and enum fields automatically.
    *   **Input:** `{ tableName: string, limit?: number }`

*   **`aggregate_data`**
    *   **Description:** Performs a simple aggregation (count, sum, avg, min, max) on a specified table, optionally applying a Hasura 'where' filter. Use 'list_tables' to find table names. Requires 'field' for non-count aggregations.
    *   **Input:** `{ tableName: string, aggregateFunction: 'count'|'sum'|'avg'|'min'|'max', field?: string, filter?: object }`

*   **`health_check`**
    *   **Description:** Checks if the configured Hasura GraphQL endpoint is reachable and responding to a basic GraphQL query (`{ __typename }`). Can optionally check a specific HTTP health endpoint URL if known.
    *   **Input:** `{ healthEndpointUrl?: string }` (Optional specific health URL)

## Requirements

*   Node.js (v18 or higher recommended, check `.nvmrc` or `package.json engines` if specified)
*   `pnpm` (or `npm`/`yarn`, adjust commands accordingly)
*   Access to a running Hasura GraphQL endpoint.
*   (Optional but recommended) Hasura Admin Secret for privileged access, or properly configured default role permissions.

## Setup and Installation

1.  **Clone the Repository (if applicable):**
    ```bash
    # git clone <repository_url>
    # cd mcp-hasura-advanced
    ```
2.  **Install Dependencies:**
    ```bash
    pnpm install
    ```
3.  **Build the Server:**
    ```bash
    pnpm run build
    ```
    This compiles the TypeScript code into the `dist` directory.

## Running the Server

Execute the compiled script from your terminal, providing the Hasura endpoint URL and optionally the admin secret:

```bash
# Using pnpm start script (defined in package.json)
pnpm start <HASURA_GRAPHQL_ENDPOINT> [ADMIN_SECRET]

# Or using Node directly
node dist/index.js <HASURA_GRAPHQL_ENDPOINT> [ADMIN_SECRET]
```

**Example:**

```bash
pnpm start https://my-hasura.cloud/v1/graphql mysecretkey123
```

or

```bash
node dist/index.js https://my-hasura.cloud/v1/graphql mysecretkey123
```

If no admin secret is needed (using default role permissions):

```bash
pnpm start https://my-hasura.cloud/v1/graphql
```

The server will start, attempt an initial schema introspection, connect to the STDIO transport, and log status messages to `stderr`. It listens for MCP JSON-RPC requests on `stdin` and sends responses to `stdout`.

## Usage with MCP Clients (e.g., Cursor, Claude Desktop)

To connect this server to an MCP client like Cursor:

1.  **Find Absolute Paths:**
    *   Node executable: Run `which node` in your terminal.
    *   Server script: Navigate to the `mcp-hasura-advanced` directory and run `pwd`. Append `/dist/index.js` to the result.
    *   Project directory: The output of `pwd`.
2.  **Configure the Client:** Open your client's configuration file (e.g., `settings.json` for Cursor, `claude_desktop_config.json` for Claude Desktop).
3.  **Add Server Entry:** Add an entry under the appropriate key (e.g., `cursor.customMcpServers` array for Cursor, `mcpServers` object for Claude Desktop).

**Example Cursor `settings.json`:**

```json
{
  // ... other settings ...
  "cursor.customMcpServers": [
    // ... other servers ...
    {
      "name": "My Advanced Hasura Server", // Name shown in Cursor UI
      "command": "/path/to/your/node", // <<< Absolute path from 'which node'
      "args": [
        "/absolute/path/to/mcp-hasura-advanced/dist/index.js", // <<< Absolute path to compiled script
        "https://YOUR_HASURA_ENDPOINT.com/v1/graphql",      // <<< Your endpoint
        "YOUR_ADMIN_SECRET"                                   // <<< Your secret (REMOVE if no secret)
      ],
      // Optional but recommended for module resolution consistency:
      "cwd": "/absolute/path/to/mcp-hasura-advanced" // <<< Absolute path to project root
    }
  ]
}
```

**Example Claude Desktop `claude_desktop_config.json`:**

```json
{
    "mcpServers": {
        // ... other servers ...
        "hasura-advanced": { // Key used internally by Claude
            "command": "/path/to/your/node", // <<< Absolute path from 'which node'
            "args": [
                "/absolute/path/to/mcp-hasura-advanced/dist/index.js", // <<< Absolute path to compiled script
                "https://YOUR_HASURA_ENDPOINT.com/v1/graphql",      // <<< Your endpoint
                "YOUR_ADMIN_SECRET"                                   // <<< Your secret (REMOVE if no secret)
            ],
            // Optional:
            // "cwd": "/absolute/path/to/mcp-hasura-advanced"
        }
    }
}
```

4.  **Replace Placeholders:** Update all placeholders (`/path/to/...`, `https://YOUR...`, `YOUR_ADMIN_SECRET`) with your actual values.
5.  **Restart/Reload Client:** Save the configuration and restart or reload your MCP client application.
6.  **Select Server:** Choose "My Advanced Hasura Server" (or the name you specified) in the client's UI.
7.  **Interact:** Use natural language prompts in your client's chat to leverage the server's tools (e.g., "List tables using the Hasura server", "Describe the 'users' table", "Preview data from the 'orders' table", "Run the query `{ products { name price } }` using the Hasura server").

## Development

*   **Run in Dev Mode:** Use `pnpm run dev <ENDPOINT> [SECRET]` to run the server directly with `ts-node` for faster iteration (no build step needed).
*   **Testing:** Test individual tools by running the server manually (`pnpm start ...`) and piping JSON-RPC requests to its `stdin`.
