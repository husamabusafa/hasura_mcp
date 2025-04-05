import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, ZodRawShape } from "zod";
import { GraphQLClient, gql, ClientError } from 'graphql-request';
import {
    getIntrospectionQuery,
    IntrospectionQuery,
    IntrospectionObjectType,
    IntrospectionSchema,
    IntrospectionField,
    IntrospectionInputValue,
    IntrospectionInterfaceType,
    IntrospectionInputObjectType,
    IntrospectionEnumType,
    IntrospectionUnionType
} from 'graphql';

const SERVER_NAME = "mcp-servers/hasura-advanced";
const SERVER_VERSION = "1.1.0";
const SCHEMA_RESOURCE_URI = "hasura:/schema";
const SCHEMA_RESOURCE_NAME = "Hasura GraphQL Schema (via Introspection)";
const SCHEMA_MIME_TYPE = "application/json";

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
  capabilities: {
    resources: {},
    tools: {},
  },
});

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error(`Usage: node ${process.argv[1]} <HASURA_GRAPHQL_ENDPOINT> [ADMIN_SECRET]`);
  process.exit(1);
}
const HASURA_ENDPOINT = args[0];
const ADMIN_SECRET = args[1];

console.log(`[INFO] Targeting Hasura Endpoint: ${HASURA_ENDPOINT}`);
if (ADMIN_SECRET) {
  console.log("[INFO] Using Admin Secret.");
} else {
  console.warn("[WARN] No Admin Secret provided. Ensure Hasura permissions are configured for the default role.");
}

const headers: Record<string, string> = {};
if (ADMIN_SECRET) {
  headers['x-hasura-admin-secret'] = ADMIN_SECRET;
}
const gqlClient = new GraphQLClient(HASURA_ENDPOINT, { headers });

async function makeGqlRequest<
    T = any,
    V extends Record<string, any> = Record<string, any>
>(
  query: string,
  variables?: V,
  requestHeaders?: Record<string, string>
): Promise<T> {
  try {
    const combinedHeaders = { ...headers, ...requestHeaders };
    return await gqlClient.request<T>(query, variables, combinedHeaders);
  } catch (error) {
    if (error instanceof ClientError) {
      const gqlErrors = error.response?.errors?.map(e => e.message).join(', ') || 'Unknown GraphQL error';
      console.error(`[ERROR] GraphQL Request Failed: ${gqlErrors}`, error.response);
      throw new Error(`GraphQL operation failed: ${gqlErrors}`);
    }
    console.error("[ERROR] Unexpected error during GraphQL request:", error);
    throw error;
  }
}

let introspectionSchema: IntrospectionSchema | null = null;

async function getIntrospectionSchema(): Promise<IntrospectionSchema> {
    if (introspectionSchema) {
        return introspectionSchema;
    }
    console.log("[INFO] Fetching GraphQL schema via introspection...");
    const introspectionQuery = getIntrospectionQuery();
    try {
        const result = await makeGqlRequest<IntrospectionQuery>(introspectionQuery);
        if (!result.__schema) {
        throw new Error("Introspection query did not return a __schema object.");
        }
        introspectionSchema = result.__schema;
        console.log("[INFO] Introspection successful, schema cached.");
        return introspectionSchema;
    } catch (error) {
        console.error("[ERROR] Failed to fetch or cache introspection schema:", error);
        introspectionSchema = null;
        throw new Error(`Failed to get GraphQL schema: ${error instanceof Error ? error.message : String(error)}`);
    }
}

server.resource(
  SCHEMA_RESOURCE_NAME,
  SCHEMA_RESOURCE_URI,
  { mimeType: SCHEMA_MIME_TYPE },
  async () => {
    console.log(`[INFO] Handling read request for resource: ${SCHEMA_RESOURCE_URI}`);
    try {
      const schema = await getIntrospectionSchema();
      return {
        contents: [
          {
            uri: SCHEMA_RESOURCE_URI,
            text: JSON.stringify(schema, null, 2),
            mimeType: SCHEMA_MIME_TYPE
          }
        ]
      };
    } catch (error) {
      console.error(`[ERROR] Failed to provide schema resource: ${error}`);
      throw new Error(`Failed to retrieve GraphQL schema: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
);

server.tool(
  "run_graphql_query",
  "Executes a read-only GraphQL query against the Hasura endpoint...",
  {
    query: z.string().describe("The GraphQL query string (must be a read-only operation)."),
    variables: z.record(z.unknown()).optional().describe("Optional. An object containing variables..."),
  },
  async ({ query, variables }) => {
    console.log(`[INFO] Executing tool 'run_graphql_query'`);
    if (query.trim().toLowerCase().startsWith('mutation')) {
        throw new Error("This tool only supports read-only queries...");
    }
    try {
      const result = await makeGqlRequest(query, variables);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
       console.error(`[ERROR] Tool 'run_graphql_query' failed: ${error.message}`);
       throw error;
    }
  }
);

server.tool(
  "run_graphql_mutation",
  "Executes a GraphQL mutation to insert, update, or delete data...",
  {
    mutation: z.string().describe("The GraphQL mutation string."),
    variables: z.record(z.unknown()).optional().describe("Optional. An object containing variables..."),
  },
  async ({ mutation, variables }) => {
    console.log(`[INFO] Executing tool 'run_graphql_mutation'`);
    if (!mutation.trim().toLowerCase().startsWith('mutation')) {
        throw new Error("The provided string does not appear to be a mutation...");
    }
    try {
      const result = await makeGqlRequest(mutation, variables);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      console.error(`[ERROR] Tool 'run_graphql_mutation' failed: ${error.message}`);
      throw error;
    }
  }
);

server.tool(
  "list_tables",
  "Lists available data tables (or collections) managed by Hasura, organized by schema with descriptions",
  {
    schemaName: z.string().optional().describe("Optional. The database schema name to filter results. If omitted, returns tables from all schemas.")
  },
  async ({ schemaName }) => {
      console.log(`[INFO] Executing tool 'list_tables' for schema: ${schemaName || 'ALL'}`);
      try {
        const schema = await getIntrospectionSchema();
        
        const query = gql`
          query GetTablesWithDescriptions {
            __type(name: "query_root") {
              fields {
                name
                description
                type {
                  name
                  kind
                }
              }
            }
          }
        `;
        
        const result = await makeGqlRequest(query);
        
        const tablesData: Record<string, Array<{name: string, description: string | null}>> = {};
        
        if (result.__type && result.__type.fields) {
          const fieldEntries = result.__type.fields;
          
          for (const field of fieldEntries) {
            if (field.name.includes('_aggregate') || 
                field.name.includes('_by_pk') || 
                field.name.includes('_stream') ||
                field.name.includes('_mutation') ||
                field.name.startsWith('__')) {
              continue;
            }
            
            let currentSchema = 'public';
            if (field.description && field.description.includes('schema:')) {
              const schemaMatch = field.description.match(/schema:\s*([^\s,]+)/i);
              if (schemaMatch && schemaMatch[1]) {
                currentSchema = schemaMatch[1];
              }
            }
            
            if (schemaName && currentSchema !== schemaName) {
              continue;
            }
            
            if (!tablesData[currentSchema]) {
              tablesData[currentSchema] = [];
            }
            
            tablesData[currentSchema].push({
              name: field.name,
              description: field.description
            });
          }
        }
        
        const formattedOutput = Object.entries(tablesData)
          .map(([schema, tables]) => ({
            schema,
            tables: tables.sort((a, b) => a.name.localeCompare(b.name))
          }))
          .sort((a, b) => a.schema.localeCompare(b.schema));
          
        return { content: [{ type: "text", text: JSON.stringify(formattedOutput, null, 2) }] };
      } catch (error: any) {
        console.error(`[ERROR] Tool 'list_tables' failed: ${error.message}`);
        throw error;
      }
  }
);

server.tool(
  "list_root_fields",
  "Lists the available top-level query, mutation, or subscription fields...",
  {
    fieldType: z.enum(["QUERY", "MUTATION", "SUBSCRIPTION"]).optional().describe("Optional. Filter by 'QUERY'...")
  },
  async ({ fieldType }) => {
    console.log(`[INFO] Executing tool 'list_root_fields', filtering by: ${fieldType || 'ALL'}`);
    try {
      const schema = await getIntrospectionSchema();
      let fields: IntrospectionField[] = [];
      if ((!fieldType || fieldType === "QUERY") && schema.queryType) {
          const queryRoot = schema.types.find(t => t.name === schema.queryType?.name) as IntrospectionObjectType | undefined;
          fields = fields.concat(queryRoot?.fields || []);
      }
      if ((!fieldType || fieldType === "MUTATION") && schema.mutationType) {
          const mutationRoot = schema.types.find(t => t.name === schema.mutationType?.name) as IntrospectionObjectType | undefined;
          fields = fields.concat(mutationRoot?.fields || []);
      }
      if ((!fieldType || fieldType === "SUBSCRIPTION") && schema.subscriptionType) {
          const subscriptionRoot = schema.types.find(t => t.name === schema.subscriptionType?.name) as IntrospectionObjectType | undefined;
          fields = fields.concat(subscriptionRoot?.fields || []);
      }
      const fieldInfo = fields.map(f => ({
          name: f.name,
          description: f.description || "No description.",
      })).sort((a, b) => a.name.localeCompare(b.name));
      return { content: [{ type: "text", text: JSON.stringify(fieldInfo, null, 2) }] };
    } catch (error: any) {
      console.error(`[ERROR] Tool 'list_root_fields' failed: ${error.message}`);
      throw error;
    }
  }
);

server.tool(
  "describe_graphql_type",
  "Provides details about a specific GraphQL type (Object, Input, Scalar, Enum, Interface, Union)...",
  {
    typeName: z.string().describe("The exact, case-sensitive name of the GraphQL type..."),
  },
  async ({ typeName }) => {
    console.log(`[INFO] Executing tool 'describe_graphql_type' for type: ${typeName}`);
     try {
      const schema = await getIntrospectionSchema();
      const typeInfo = schema.types.find(t => t.name === typeName);
      if (!typeInfo) {
          throw new Error(`Type '${typeName}' not found in the schema.`);
      }

      const formattedInfo = {
          kind: typeInfo.kind,
          name: typeInfo.name,
          description: typeInfo.description || null,
          ...(typeInfo.kind === 'OBJECT' || typeInfo.kind === 'INTERFACE' ? {
              fields: (typeInfo as IntrospectionObjectType | IntrospectionInterfaceType).fields?.map((f: IntrospectionField) => ({ 
                  name: f.name,
                  description: f.description || null,
                  type: JSON.stringify(f.type),
                  args: f.args?.map((a: IntrospectionInputValue) => ({ name: a.name, type: JSON.stringify(a.type) })) || [] 
              })) || []
          } : {}),
          ...(typeInfo.kind === 'INPUT_OBJECT' ? {
              inputFields: (typeInfo as IntrospectionInputObjectType).inputFields?.map((f: IntrospectionInputValue) => ({ 
                  name: f.name,
                  description: f.description || null,
                  type: JSON.stringify(f.type),
              })) || []
          } : {}),
          ...(typeInfo.kind === 'ENUM' ? {
              enumValues: (typeInfo as IntrospectionEnumType).enumValues?.map(ev => ({ name: ev.name, description: ev.description || null })) || []
          } : {}),
          ...(typeInfo.kind === 'UNION' || typeInfo.kind === 'INTERFACE' ? {
              possibleTypes: (typeInfo as IntrospectionUnionType | IntrospectionInterfaceType).possibleTypes?.map(pt => pt.name) || []
          } : {}),
      };

      return { content: [{ type: "text", text: JSON.stringify(formattedInfo, null, 2) }] };
    } catch (error: any) {
      console.error(`[ERROR] Tool 'describe_graphql_type' failed: ${error.message}`);
      throw error;
    }
  }
);

server.tool(
  "preview_table_data",
  "Fetch esa limited sample of rows (default 5) from a specified table...",
  {
    tableName: z.string().describe("The exact name of the table..."),
    limit: z.number().int().positive().optional().default(5).describe("Optional. Maximum number of rows..."),
  },
  async ({ tableName, limit }) => {
    console.log(`[INFO] Executing tool 'preview_table_data' for table: ${tableName}, limit: ${limit}`);
    try {
      const schema = await getIntrospectionSchema();
      const tableType = schema.types.find(t => t.name === tableName && t.kind === 'OBJECT') as IntrospectionObjectType | undefined;
      if (!tableType) {
          throw new Error(`Table (Object type) '${tableName}' not found in schema.`);
      }
      const scalarFields = tableType.fields
        ?.filter(f => { 
            let currentType = f.type;
            while (currentType.kind === 'NON_NULL' || currentType.kind === 'LIST') currentType = currentType.ofType;
            return currentType.kind === 'SCALAR' || currentType.kind === 'ENUM';
        })
        .map(f => f.name) || [];
       if (scalarFields.length === 0) {
           console.warn(`[WARN] No scalar fields found for table ${tableName}...`);
           scalarFields.push('__typename');
       }
      const fieldsString = scalarFields.join('\n          ');
      const query = gql` query PreviewData($limit: Int!) { ${tableName}(limit: $limit) { ${fieldsString} } }`;
      const variables = { limit };
      const result = await makeGqlRequest(query, variables);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      console.error(`[ERROR] Tool 'preview_table_data' failed: ${error.message}`);
      throw error;
    }
  }
);

server.tool(
  "aggregate_data",
  "Performs a simple aggregation (count, sum, avg, min, max)...",
  {
    tableName: z.string().describe("The exact name of the table..."),
    aggregateFunction: z.enum(["count", "sum", "avg", "min", "max"]).describe("The aggregation function..."),
    field: z.string().optional().describe("Required for 'sum', 'avg', 'min', 'max'..."),
    filter: z.record(z.unknown()).optional().describe("Optional. A Hasura GraphQL 'where' filter object..."),
  },
  async ({ tableName, aggregateFunction, field, filter }) => {
    console.log(`[INFO] Executing tool 'aggregate_data': ${aggregateFunction} on ${tableName}...`);
    
    if (aggregateFunction !== 'count' && !field) {
      throw new Error(`The 'field' parameter is required for '${aggregateFunction}' aggregation.`);
    }
    if (aggregateFunction === 'count' && field) {
        console.warn(`[WARN] 'field' parameter is ignored for 'count' aggregation.`);
    }

    const aggregateTableName = `${tableName}_aggregate`;
    
    let aggregateSelection = '';
    if (aggregateFunction === 'count') {
        aggregateSelection = `{ count }`;
    } else if (field) { 
        aggregateSelection = `{ ${aggregateFunction} { ${field} } }`;
    } else {
        throw new Error(`'field' parameter is missing for '${aggregateFunction}' aggregation.`);
    }

    const boolExpTypeName = `${tableName}_bool_exp`;
    const filterVariableDefinition = filter ? `($filter: ${boolExpTypeName}!)` : ""; 
    const whereClause = filter ? `where: $filter` : "";

    const query = gql` 
      query AggregateData ${filterVariableDefinition} {
        ${aggregateTableName}(${whereClause}) {
          aggregate ${aggregateSelection}
        }
      }
    `;

    const variables = filter ? { filter } : {};

    try {
      const rawResult = await makeGqlRequest(query, variables);
      
      let finalResult = null;
      if (rawResult && rawResult[aggregateTableName] && rawResult[aggregateTableName].aggregate) {
          finalResult = rawResult[aggregateTableName].aggregate;
      } else {
          console.warn('[WARN] Unexpected result structure from aggregation query:', rawResult);
          finalResult = rawResult; 
      }

      return { content: [{ type: "text", text: JSON.stringify(finalResult, null, 2) }] };
    } catch (error: any) {
      if (error instanceof ClientError && error.response?.errors) {
          const gqlErrors = error.response.errors.map(e => e.message).join(', ');
          console.error(`[ERROR] Tool 'aggregate_data' failed: ${gqlErrors}`, error.response);
          throw new Error(`GraphQL aggregation failed: ${gqlErrors}. Check table/field names and filter syntax.`);
      }
      console.error(`[ERROR] Tool 'aggregate_data' failed: ${error.message}`);
      throw error;
    }
  }
);

server.tool(
  "health_check",
  "Checks if the configured Hasura GraphQL endpoint is reachable...",
  {
    healthEndpointUrl: z.string().url().optional().describe("Optional. A specific HTTP health check URL...")
  },
  async ({ healthEndpointUrl }) => {
    console.log(`[INFO] Executing tool 'health_check'...`);
    try {
        let resultText = "";
        if (healthEndpointUrl) {
            console.log(`[DEBUG] Performing HTTP GET to: ${healthEndpointUrl}`);
            const response = await fetch(healthEndpointUrl, { method: 'GET' });
            resultText = `Health endpoint ${healthEndpointUrl} status: ${response.status} ${response.statusText}`;
             if (!response.ok) throw new Error(resultText);
        } else {
            console.log(`[DEBUG] Performing GraphQL query { __typename } to: ${HASURA_ENDPOINT}`);
            const query = gql`query HealthCheck { __typename }`;
            const result = await makeGqlRequest(query);
            resultText = `GraphQL endpoint ${HASURA_ENDPOINT} is responsive. Result: ${JSON.stringify(result)}`;
        }
         return { content: [{ type: "text", text: `Health check successful. ${resultText}` }] };
    } catch (error: any) {
        console.error(`[ERROR] Tool 'health_check' failed: ${error.message}`);
         return { content: [{ type: "text", text: `Health check failed: ${error.message}` }], isError: false }; 
    }
  }
);

server.tool(
  "describe_table",
  "Shows the structure of a table including all columns with their types and descriptions",
  {
    tableName: z.string().describe("The exact name of the table to describe"),
    schemaName: z.string().optional().default('public').describe("Optional. The database schema name, defaults to 'public'")
  },
  async ({ tableName, schemaName }) => {
    console.log(`[INFO] Executing tool 'describe_table' for table: ${tableName} in schema: ${schemaName}`);
    try {
      const schema = await getIntrospectionSchema();
      
      const tableTypeQuery = gql`
        query GetTableType($typeName: String!) {
          __type(name: $typeName) {
            name
            kind
            description
            fields {
              name
              description
              type {
                kind
                name
                ofType {
                  kind
                  name
                  ofType {
                    kind
                    name
                    ofType {
                      kind
                      name
                    }
                  }
                }
              }
              args {
                name
                description
                type {
                  kind
                  name
                  ofType {
                    kind
                    name
                  }
                }
              }
            }
          }
        }
      `;
      
      const tableTypeResult = await makeGqlRequest(tableTypeQuery, { typeName: tableName });
      
      if (!tableTypeResult.__type) {
        console.log(`[INFO] No direct match for table type: ${tableName}, trying case variations`);
        const pascalCaseName = tableName.charAt(0).toUpperCase() + tableName.slice(1);
        const alternativeResult = await makeGqlRequest(tableTypeQuery, { typeName: pascalCaseName });
        if (!alternativeResult.__type) {
          throw new Error(`Table '${tableName}' not found in schema. Check the table name and schema.`);
        }
        tableTypeResult.__type = alternativeResult.__type;
      }
      
      const columnsInfo = tableTypeResult.__type.fields.map((field: any) => {
        let typeInfo = field.type;
        let typeString = '';
        let isNonNull = false;
        let isList = false;
        
        while (typeInfo) {
          if (typeInfo.kind === 'NON_NULL') {
            isNonNull = true;
            typeInfo = typeInfo.ofType;
          } else if (typeInfo.kind === 'LIST') {
            isList = true;
            typeInfo = typeInfo.ofType;
          } else {
            typeString = typeInfo.name || 'unknown';
            break;
          }
        }
        
        let fullTypeString = '';
        if (isList) {
          fullTypeString = `[${typeString}]`;
        } else {
          fullTypeString = typeString;
        }
        if (isNonNull) {
          fullTypeString += '!';
        }
        
        return {
          name: field.name,
          type: fullTypeString,
          description: field.description || null,
          args: field.args?.length ? field.args : null
        };
      });
      
      const result = {
        table: {
          name: tableName,
          schema: schemaName,
          description: tableTypeResult.__type.description || null,
          columns: columnsInfo.sort((a: any, b: any) => a.name.localeCompare(b.name))
        }
      };
      
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error: any) {
      console.error(`[ERROR] Tool 'describe_table' failed: ${error.message}`);
      throw error;
    }
  }
);

async function main() {
  console.log(`[INFO] Starting ${SERVER_NAME} v${SERVER_VERSION}...`);
  try {
    await getIntrospectionSchema();
  } catch (error) {
    console.warn(`[WARN] Initial schema fetch failed...: ${error}`);
  }

  const transport = new StdioServerTransport();
  console.log("[INFO] Connecting server to STDIO transport...");
  await server.connect(transport);
  console.error(`[INFO] ${SERVER_NAME} v${SERVER_VERSION} connected and running via STDIO.`);
}

main().catch((error) => {
  console.error("[FATAL] Server failed to start or crashed:", error);
  process.exit(1);
});